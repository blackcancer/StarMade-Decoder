/**
 * @fileoverview Bounded StarMade SMD3 region decoder.
 *
 * Region headers contain 4,096 big-endian offset/size pairs. Segment headers,
 * SINGLE values and BITMAP words are also big-endian. Compressed block arrays
 * are little-endian: zlib-compressed 24-bit values before v7, raw LZ4
 * compressed native little-endian 32-bit values in v7 (x86/ARM game builds).
 *
 * Strict parsing never silently omits a segment. Recovery returns diagnostics
 * and complete=false; writeSmd3 refuses such partial results. SINGLE_SIDE_EDGE
 * requires normals from the caller's game installation (see readIcoSideNormals).
 *
 * Reference: StarMade-Open decf3a1990f29, SegmentData4Byte.inflate,
 * SegmentDataBitMap.serializeRemoteSegment, SegmentDataSingleSideEdge.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { inflateSync } from 'node:zlib';
import { decodeLz4Block } from './Lz4Block.js';
import { DecodeError, boundedInteger, reportDecodeFailure } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import { isPointInIcoSide, normalizeIcoSideNormals } from './IcoGeometry.js';
import type { IcoSideNormals } from './IcoGeometry.js';

/** Number of cells in the 16 x 16 x 16 region table. */
export const HEADER_SLOT_COUNT = 4096;
/** Four header bytes followed by 4,096 four-byte entries. */
export const HEADER_SIZE = 4 + HEADER_SLOT_COUNT * 4;
/** Fixed storage sector size in bytes. */
export const SEGMENT_SECTOR = 48 * 1024;
/** Stored sector offsets are one-based. */
export const OFFSET_SHIFT = 1;
/** Dense block array: zlib before v7, raw LZ4 in v7. */
export const DATA_AVAILABLE = 1;
/** Explicitly empty segment. */
export const DATA_EMPTY = 2;
/** Uniform raw block value. */
export const DATA_SINGLE = 3;
/** Palette with packed indices. */
export const DATA_BITMAP = 4;
/** Uniform value restricted by the game's three side planes. */
export const DATA_SINGLE_SIDE_EDGE = 5;
/** Segment width in blocks for this SMD3 implementation. */
export const CHUNK_DIM = 32;
/** Number of block positions per segment. */
export const BLOCK_COUNT = CHUNK_DIM ** 3;
/** First version using 32-bit block values. */
export const VERSION_4BYTE = 7;

/** Decoded block fields; absent extra is equivalent to zero. */
export interface BlockData {
  /** Block identifier: 0 is air, 0..8191 in v7. */
  type: number;
  /** Stored hitpoint value, 0..127 (not scaled hitpoints). */
  hp: number;
  /** Stored orientation, 0..31. */
  orientation: number;
  /** Raw activation bit. */
  active: boolean;
  /** Reserved bits 26..31, preserved even when their meaning is unknown. */
  extra?: number;
}
/** Segment position is in entity block coordinates, not segment indices. */
export interface SegmentData {
  x: number;
  y: number;
  z: number;
  lastChanged: bigint;
  version: number;
  blocks: BlockData[];
  /** Derived statistic; writers always recompute content instead of trusting it. */
  blockCount: number;
}
/** Parsed region with explicit completeness information. */
export interface Smd3File {
  headerVersion: number;
  segments: SegmentData[];
  usedSlots: number;
  /** False means at least one record was omitted in explicit recovery mode. */
  complete?: boolean;
  diagnostics?: DecodeDiagnostic[];
}
/** Per-operation budgets; zero budgets are allowed and reject non-empty input. */
export interface Smd3ParseOptions {
  mode?: 'strict' | 'recover';
  maxInputBytes?: number;
  maxBlocks?: number;
  sideNormals?: IcoSideNormals;
  /** Explicit migration aid for v7 files written by SDK <=1.4.0; never auto-detected. */
  legacyV7ZlibBigEndian?: boolean;
}

/**
 * Decodes a region without modifying its bytes.
 * @param data - Complete .smd3 file contents.
 * @param options - Strict/recovery policy, geometry context and resource limits.
 * @returns Validated segments and explicit diagnostics for recovered omissions.
 * @throws {DecodeError} On malformed input, missing geometry context, or budget exhaustion.
 * @remarks Default limits are 256 MiB of input and 16,777,216 decoded blocks.
 */
export function parseSmd3(data: Buffer | Uint8Array, options: Smd3ParseOptions = {}): Smd3File {
  const mode = options.mode ?? 'strict';
  if (mode !== 'strict' && mode !== 'recover') throw new DecodeError('E_RANGE', 'Invalid parsing mode');
  const maxInput = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
  const maxBlocks = boundedInteger(options.maxBlocks ?? 16 * 1024 * 1024, 'maxBlocks');
  if (data.length > maxInput) throw new DecodeError('E_LIMIT', 'SMD3 input byte budget exceeded');
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < HEADER_SIZE) throw new DecodeError('E_TRUNCATED', 'Truncated SMD3 region header', { offset: buf.length });
  const normals = options.sideNormals ? normalizeIcoSideNormals(options.sideNormals) : undefined;
  const segments: SegmentData[] = [];
  const diagnostics: DecodeDiagnostic[] = [];
  const sectors = new Set<number>();
  let usedSlots = 0;
  let decodedBlocks = 0;
  for (let i = 0; i < HEADER_SLOT_COUNT; i++) {
    const hdrOff = 4 + i * 4;
    const rawOffset = buf.readInt16BE(hdrOff);
    const rawSize = buf.readUInt16BE(hdrOff + 2);
    // Java retains allocated offsets when a segment becomes empty (size=0).
    // isEmptyOrNoData deliberately accepts either sentinel independently.
    if (rawOffset === 0 || rawSize === 0) continue;
    usedSlots++;
    const absPos = HEADER_SIZE + (rawOffset - OFFSET_SHIFT) * SEGMENT_SECTOR;
    try {
      if (rawOffset < 1 || rawSize < 22 || rawSize > SEGMENT_SECTOR) {
        throw new DecodeError('E_FORMAT', `Invalid SMD3 table entry ${i}`, { offset: hdrOff });
      }
      if (sectors.has(rawOffset)) throw new DecodeError('E_FORMAT', `Duplicate SMD3 storage sector ${rawOffset}`, { offset: hdrOff });
      sectors.add(rawOffset);
      if (absPos + rawSize > buf.length) throw new DecodeError('E_TRUNCATED', `Truncated SMD3 segment ${i}`, { offset: absPos });
      decodedBlocks += BLOCK_COUNT;
      if (decodedBlocks > maxBlocks) throw new DecodeError('E_LIMIT', 'SMD3 decoded block budget exceeded', { offset: absPos });
      // A bounded slice prevents a malformed payload from reading the next sector.
      segments.push(parseSegment(buf.subarray(absPos, absPos + rawSize), normals, options.legacyV7ZlibBigEndian === true));
    } catch (error) {
      reportDecodeFailure(error, mode, diagnostics, { offset: absPos, path: `segment[${i}]` });
    }
  }
  return { headerVersion: buf[0], segments, usedSlots, complete: diagnostics.length === 0, diagnostics };
}

/**
 * Decodes a single record already bounded by its region table entry.
 * @param b - Exactly the declared record bytes (may include sector padding).
 * @param normals - Optional caller-provided geometry context.
 * @param legacyBE - Explicit opt-in for the historical SDK's incorrect v7 byte order.
 * @returns One complete segment.
 * @throws {DecodeError} For an unsupported representation or invalid record.
 */
function parseSegment(b: Buffer, normals: IcoSideNormals | undefined, legacyBE: boolean): SegmentData {
  const need = (size: number): void => {
    if (!Number.isSafeInteger(size) || size < 0 || size > b.length) throw new DecodeError('E_TRUNCATED', 'Segment payload exceeds its declared size');
  };
  need(22);
  const version = b[0];
  if (version < 3 || version > VERSION_4BYTE) throw new DecodeError('E_UNSUPPORTED', `Unsupported SMD3 segment version ${version}`);
  const lastChanged = b.readBigInt64BE(1);
  const x = b.readInt32BE(9), y = b.readInt32BE(13), z = b.readInt32BE(17);
  const dataByte = b[21];
  let blocks: BlockData[];
  if (dataByte === DATA_EMPTY) {
    blocks = Array.from({ length: BLOCK_COUNT }, () => decodeBlockWord(0));
  } else if (dataByte === DATA_SINGLE || dataByte === DATA_SINGLE_SIDE_EDGE) {
    need(26);
    if (version < 6) throw new DecodeError('E_UNSUPPORTED', 'Pre-v6 optimized segments require game migration context');
    if (dataByte === DATA_SINGLE_SIDE_EDGE && !normals) {
      throw new DecodeError('E_UNSUPPORTED', 'SINGLE_SIDE_EDGE requires sideNormals from data/IcoVectors.bin');
    }
    const word = b.readUInt32BE(22);
    blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => {
      const inside = dataByte === DATA_SINGLE || isPointInIcoSide(
        ((i & 31) - 16 + x) | 0, (((i >> 5) & 31) - 16 + y) | 0,
        (((i >> 10) & 31) - 16 + z) | 0, normals!,
      );
      return decodeVersionedBlock(inside ? word : 0, version);
    });
  } else if (dataByte === DATA_BITMAP) {
    need(30);
    if (version < 6) throw new DecodeError('E_UNSUPPORTED', 'Pre-v6 optimized segments require game migration context');
    const shift = b.readInt32BE(22), count = b.readInt32BE(26);
    if (shift < 3 || shift > 5 || count < 1 || count > 16 || count > 2 ** (32 >> shift)) {
      throw new DecodeError('E_FORMAT', 'Invalid SMD3 bitmap palette or shift');
    }
    const bits = 32 >> shift;
    const mask = (1 << bits) - 1;
    const start = 30 + count * 4;
    need(start + (BLOCK_COUNT >> shift) * 4);
    blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => {
      const packed = b.readUInt32BE(start + (i >> shift) * 4);
      const index = (packed >>> ((i & ((1 << shift) - 1)) * bits)) & mask;
      if (index >= count) throw new DecodeError('E_FORMAT', `Bitmap palette index ${index} is out of range`);
      return decodeVersionedBlock(b.readUInt32BE(30 + index * 4), version);
    });
  } else if (dataByte === DATA_AVAILABLE) {
    need(26);
    const storedSize = b.readInt32BE(22);
    const width = version < VERSION_4BYTE ? 3 : 4;
    const expected = BLOCK_COUNT * width;
    let inflated: Buffer;
    if (version === VERSION_4BYTE && !legacyBE) {
      // RemoteSegment.serializeLZ4 writes the preceding header size (22),
      // not the compressed byte count. The region table bounds the LZ4 block.
      if (storedSize !== 22 && storedSize !== b.length - 26) throw new DecodeError('E_FORMAT', 'Invalid v7 LZ4 record header');
      inflated = decodeLz4Block(b.subarray(26), expected);
    } else {
      if (storedSize <= 0) throw new DecodeError('E_FORMAT', 'Invalid compressed segment length');
      need(26 + storedSize);
      try {
        inflated = inflateSync(b.subarray(26, 26 + storedSize), { maxOutputLength: expected });
      } catch (cause) {
        throw new DecodeError('E_FORMAT', 'Invalid or oversized compressed SMD3 payload', { cause });
      }
      if (inflated.length !== expected) throw new DecodeError('E_FORMAT', `Expected ${expected} inflated segment bytes, got ${inflated.length}`);
    }
    blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => {
      if (width === 4) return decodeBlockWord(legacyBE ? inflated.readUInt32BE(i * 4) : inflated.readUInt32LE(i * 4));
      return decodeVersionedBlock(inflated.readUIntLE(i * 3, 3), version);
    });
  } else {
    throw new DecodeError('E_UNSUPPORTED', `Unknown SMD3 data type ${dataByte}`);
  }
  let blockCount = 0;
  for (const block of blocks) if (block.type !== 0) blockCount++;
  return { x, y, z, lastChanged, version, blocks, blockCount };
}

/**
 * Interprets a raw word using its version's bit allocation.
 * @param word - Raw block value from a dense array or palette.
 * @param version - Segment version (legacy v6 uses 11-bit identifiers).
 * @returns Independent block fields; older values are exposed without game-dependent migrations.
 */
function decodeVersionedBlock(word: number, version: number): BlockData {
  return version >= VERSION_4BYTE ? decodeBlockWord(word) : {
    type: word & 0x7ff, hp: (word >>> 11) & 127,
    active: ((word >>> 18) & 1) !== 0, orientation: (word >>> 19) & 31,
  };
}

/**
 * Splits all 32 bits of a v7 block without discarding reserved fields.
 * @param word - Unsigned or signed 32-bit block word.
 * @returns An independent block value; zero extra is omitted for API compatibility.
 */
export function decodeBlockWord(word: number): BlockData {
  const block: BlockData = {
    type: word & 0x1fff, hp: (word >>> 13) & 127,
    active: ((word >>> 20) & 1) !== 0, orientation: (word >>> 21) & 31,
  };
  const extra = word >>> 26;
  if (extra !== 0) block.extra = extra;
  return block;
}

/**
 * Converts a validated block index to local coordinates.
 * @param index - Integer in [0, 32767].
 * @returns Local x, y, z coordinates.
 * @throws {DecodeError} If index is outside the segment.
 */
export function indexToPos(index: number): { x: number; y: number; z: number } {
  boundedInteger(index, 'block index', BLOCK_COUNT - 1);
  return { x: index & 31, y: (index >> 5) & 31, z: index >> 10 };
}

/**
 * Converts validated local coordinates to a block index.
 * @param x - Integer in [0, 31].
 * @param y - Integer in [0, 31].
 * @param z - Integer in [0, 31].
 * @returns The x-fastest block index.
 * @throws {DecodeError} If any coordinate is invalid.
 */
export function posToIndex(x: number, y: number, z: number): number {
  boundedInteger(x, 'x', 31); boundedInteger(y, 'y', 31); boundedInteger(z, 'z', 31);
  return x + y * CHUNK_DIM + z * CHUNK_DIM * CHUNK_DIM;
}

/**
 * Returns a block at local coordinates (a borrowed mutable object).
 * @param segment - Decoded segment.
 * @param x - Local block x.
 * @param y - Local block y.
 * @param z - Local block z.
 * @returns The stored block, or undefined for an incomplete caller-created array.
 * @throws {DecodeError} For invalid coordinates.
 */
export function getBlock(segment: SegmentData, x: number, y: number, z: number): BlockData | undefined {
  return segment.blocks[posToIndex(x, y, z)];
}
