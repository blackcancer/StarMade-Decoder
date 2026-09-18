/**
 * @fileoverview
 * Strict, bounded StarMade SMD3 region decoder.
 *
 * Version 6 DATA_AVAILABLE uses zlib and 32^3 little-endian 24-bit words.
 * Version 7 DATA_AVAILABLE uses raw LZ4 and 32^3 native-memory 32-bit words
 * (little-endian on supported x86/x64 StarMade installations). Header integers
 * and SINGLE/BITMAP words use Java DataInput's big-endian representation.
 * Recovery is explicit, reports every skipped slot, and marks results incomplete.
 *
 * Reference: StarMade-Open decf3a1, RemoteSegment, SegmentData4Byte,
 * SegmentSerializationBuffers, SegmentDataSingleSideEdge, IcosahedronHelper.
 * @author InitSysRev
 * @version 1.5.0
 */
import { inflateSync } from 'node:zlib';
import { BufferReader } from '../core/BufferReader.js';
import { decodeLz4Block } from './Lz4Block.js';

/** Region header slots (16^3). */
export const HEADER_SLOT_COUNT = 4096;
/** Four version bytes and 4096 offset/size pairs. */
export const HEADER_SIZE = 4 + HEADER_SLOT_COUNT * 4;
/** Fixed allocation size of a segment sector. */
export const SEGMENT_SECTOR = 48 * 1024;
/** Stored sector offsets are one-based. */
export const OFFSET_SHIFT = 1;
/** Compressed dense segment. */
export const DATA_AVAILABLE = 1;
/** Empty segment. */
export const DATA_EMPTY = 2;
/** Uniform segment. */
export const DATA_SINGLE = 3;
/** Packed palette segment. */
export const DATA_BITMAP = 4;
/** Uniform material clipped to an icosahedron side. */
export const DATA_SINGLE_SIDE_EDGE = 5;
/** Blocks per segment axis. */
export const CHUNK_DIM = 32;
/** Blocks per segment. */
export const BLOCK_COUNT = CHUNK_DIM ** 3;
/** First four-byte/LZ4 segment version. */
export const VERSION_4BYTE = 7;

/** Editable block fields. Unspecified extra bits default to zero on writing. */
export interface BlockData {
  type: number;
  hp: number;
  orientation: number;
  active: boolean;
  /** The six reserved bits at positions 26..31, preserved without interpretation. */
  extra?: number;
}
/** One decoded segment. x/y/z are block-space segment origins, multiples of 32. */
export interface SegmentData {
  x: number; y: number; z: number;
  lastChanged: bigint;
  version: number;
  blocks: BlockData[];
  /** Cached count; writers recompute it from blocks instead of trusting it. */
  blockCount: number;
}
/** One failed region slot in recovery mode. */
export interface Smd3Diagnostic { slot: number; offset: number; message: string; }
/** A region file, including completeness information for recovered inputs. */
export interface Smd3File {
  headerVersion: number;
  segments: SegmentData[];
  usedSlots: number;
  complete?: boolean;
  diagnostics?: Smd3Diagnostic[];
}
/** A normal read from the first 36 bytes of the game's IcoVectors.bin. */
export interface IcoNormal { x: number; y: number; z: number; }
/** Three clipping planes used by IcosahedronHelper.isPointInSide. */
export type IcoSideNormals = readonly [IcoNormal, IcoNormal, IcoNormal];
/** Explicit parsing limits and optional geometry context. */
export interface Smd3ParseOptions {
  mode?: 'strict' | 'recover';
  /** Maximum decoded segments; default 4096; block objects are materialized on first access. */
  maxSegments?: number;
  /** Required only for SINGLE_SIDE_EDGE. No guessed clipping geometry is used. */
  icoSideNormals?: IcoSideNormals;
}

/**
 * Reads the three clipping normals from the game's IcoVectors.bin.
 * @param data Game asset bytes; transforms following the normals are not needed.
 * @returns Three independent normals.
 * @throws {RangeError} For truncated or invalid normals.
 */
export function readIcoSideNormals(data: Buffer | Uint8Array): IcoSideNormals {
  const reader = BufferReader.from(data);
  const read = (): IcoNormal => ({ x: reader.readFloat32BE(), y: reader.readFloat32BE(), z: reader.readFloat32BE() });
  const normals: IcoSideNormals = [read(), read(), read()];
  validateNormals(normals);
  return normals;
}

/** @param normals Geometry context. @throws {RangeError} For invalid clipping planes. */
function validateNormals(normals: IcoSideNormals): void {
  if (normals.length !== 3 || normals.some(n => !n ||
      ![n.x, n.y, n.z].every(Number.isFinite) || (n.x === 0 && n.y === 0 && n.z === 0))) {
    throw new RangeError('Expected three finite, nonzero icosahedron side normals');
  }
}

/**
 * Parses a region, rejecting corruption and unsupported versions by default.
 * @param data Complete SMD3 bytes.
 * @param options Recovery policy, limits and game geometry context.
 * @returns Decoded segments and explicit diagnostics.
 * @throws {Error} On corrupt, over-budget or unsupported input in strict mode.
 */
export function parseSmd3(data: Buffer | Uint8Array, options: Smd3ParseOptions = {}): Smd3File {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < HEADER_SIZE) throw new RangeError(`Truncated SMD3 header: ${buf.length} bytes`);
  const maxSegments = options.maxSegments ?? 4096;
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 0 || maxSegments > HEADER_SLOT_COUNT) {
    throw new RangeError('maxSegments must be an integer from 0 to 4096');
  }
  if (options.mode !== undefined && options.mode !== 'strict' && options.mode !== 'recover') {
    throw new TypeError('Invalid SMD3 parsing mode');
  }
  if (options.icoSideNormals) validateNormals(options.icoSideNormals);
  const segments: SegmentData[] = [];
  const diagnostics: Smd3Diagnostic[] = [];
  const sectors = new Set<number>();
  const positions = new Set<string>();
  let usedSlots = 0;
  for (let slot = 0; slot < HEADER_SLOT_COUNT; slot++) {
    const headerOffset = 4 + slot * 4;
    const offset = buf.readInt16BE(headerOffset);
    const size = buf.readUInt16BE(headerOffset + 2);
    // Java keeps the allocated offset when deleting a segment (size=0).
    if (size === 0 && offset >= 0) continue;
    usedSlots++;
    const start = HEADER_SIZE + (offset - OFFSET_SHIFT) * SEGMENT_SECTOR;
    try {
      if (usedSlots > maxSegments) throw new RangeError(`SMD3 segment budget exceeded (${maxSegments})`);
      if (offset <= 0 || offset > HEADER_SLOT_COUNT || size < 22 || size > SEGMENT_SECTOR || start > buf.length - size) {
        throw new RangeError(`Invalid SMD3 slot offset=${offset}, size=${size}`);
      }
      if (sectors.has(offset)) throw new Error('Overlapping SMD3 sector reference');
      sectors.add(offset);
      // A subarray enforces the declared slot boundary for every field.
      const segment = parseSegment(buf.subarray(start, start + size), options);
      const key = `${segment.x},${segment.y},${segment.z}`;
      if (positions.has(key)) throw new Error(`Duplicate segment position ${key}`);
      positions.add(key);
      segments.push(segment);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (options.mode !== 'recover') throw new Error(`SMD3 slot ${slot} at byte ${start}: ${message}`, { cause });
      diagnostics.push({ slot, offset: start, message });
    }
  }
  return { headerVersion: buf[0], segments, usedSlots, complete: diagnostics.length === 0, diagnostics };
}

/** @param word Four-byte packed value. @returns Decoded fields, including reserved bits. */
function decodeWord(word: number): BlockData {
  const block: BlockData = { type: word & 0x1fff, hp: (word >>> 13) & 127,
    active: (word & 0x100000) !== 0, orientation: (word >>> 21) & 31 };
  if ((word >>> 26) !== 0) block.extra = word >>> 26;
  return block;
}

/**
 * Applies Java float arithmetic to the game's three half-space tests.
 * @param index Local block index.
 * @param origin Segment origin.
 * @param normals Game-provided clipping normals.
 * @returns Whether the point belongs to this side.
 */
function isInSide(index: number, origin: IcoNormal, normals: IcoSideNormals): boolean {
  const f = Math.fround;
  const x = f((index & 31) - 16 + origin.x);
  const y = f(((index >>> 5) & 31) - 16 + origin.y);
  const z = f((index >>> 10) - 16 + origin.z);
  return normals.every(n => f(f(f(f(n.x) * x) + f(f(n.y) * y)) + f(f(n.z) * z)) > 0);
}

/** @param bytes Bounded segment bytes. @param options Decode context. @returns A complete segment. */
function parseSegment(bytes: Buffer, options: Smd3ParseOptions): SegmentData {
  const r = BufferReader.from(bytes);
  const version = r.readUInt8();
  if (version !== 6 && version !== 7) throw new Error(`Unsupported SMD3 segment version ${version}; migration is not implicit`);
  const lastChanged = r.readInt64BE();
  const x = r.readInt32BE(), y = r.readInt32BE(), z = r.readInt32BE();
  const dataType = r.readUInt8();
  const words = new Uint32Array(BLOCK_COUNT);
  if (dataType === DATA_EMPTY) {
    // The compact typed array is already zero-filled.
  } else if (dataType === DATA_SINGLE || dataType === DATA_SINGLE_SIDE_EDGE) {
    const word = r.readUInt32BE();
    if (dataType === DATA_SINGLE_SIDE_EDGE && !options.icoSideNormals) {
      throw new Error('SINGLE_SIDE_EDGE requires icoSideNormals from the game IcoVectors.bin asset');
    }
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const present = dataType === DATA_SINGLE || isInSide(i, { x, y, z }, options.icoSideNormals!);
      words[i] = present ? word : 0;
    }
  } else if (dataType === DATA_BITMAP) {
    const shift = r.readInt32BE();
    const count = r.readInt32BE();
    if (shift < 1 || shift > 5 || count < 1 || count > BLOCK_COUNT) throw new RangeError('Invalid SMD3 palette header');
    const bits = 32 >>> shift;
    if (count > 2 ** bits) throw new RangeError('Palette exceeds index bit capacity');
    const wordCount = BLOCK_COUNT >>> shift;
    if (count + wordCount > Math.floor(r.remaining() / 4)) throw new RangeError('Truncated SMD3 palette data');
    const palette = Array.from({ length: count }, () => r.readUInt32BE());
    const bitmap = Array.from({ length: wordCount }, () => r.readUInt32BE());
    const mask = (2 ** bits) - 1;
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const index = (bitmap[i >>> shift] >>> ((i & ((1 << shift) - 1)) * bits)) & mask;
      if (index >= palette.length) throw new RangeError(`Invalid palette index ${index}`);
      words[i] = palette[index];
    }
  } else if (dataType === DATA_AVAILABLE) {
    const declared = r.readInt32BE();
    let inflated: Buffer;
    if (version === 6) {
      if (declared <= 0 || declared > r.remaining()) throw new RangeError('Invalid compressed SMD3 length');
      inflated = inflateSync(r.readBytes(declared), { maxOutputLength: BLOCK_COUNT * 3 });
      if (inflated.length !== BLOCK_COUNT * 3) throw new RangeError('Truncated three-byte SMD3 payload');
      for (let i = 0; i < BLOCK_COUNT; i++) {
        const word = inflated.readUIntLE(i * 3, 3);
        words[i] = (word & 2047) | (((word >>> 11) & 127) << 13) |
          (((word >>> 18) & 1) << 20) | (((word >>> 19) & 31) << 21);
      }
    } else {
      // RemoteSegment.serializeLZ4 in the pinned Java revision writes 22 here
      // (the running header size), not the compressed length. The region slot
      // boundary and the fixed decoded size therefore delimit that variant.
      if (declared <= 0 || (declared !== 22 && declared > r.remaining())) throw new RangeError('Invalid LZ4 SMD3 length');
      const compressed = bytes.subarray(r.offset, declared === 22 ? bytes.length : r.offset + declared);
      const decoded = decodeLz4Block(compressed, BLOCK_COUNT * 4);
      if (declared !== 22 && decoded.bytesRead !== declared) throw new Error('LZ4 compressed size mismatch');
      inflated = decoded.data;
      for (let i = 0; i < BLOCK_COUNT; i++) words[i] = inflated.readUInt32LE(i * 4);
    }
  } else {
    throw new Error(`Unsupported SMD3 data type ${dataType}`);
  }
  let blockCount = 0;
  for (const word of words) if ((word & 8191) !== 0) blockCount++;
  let materialized: BlockData[] | undefined;
  // Preserve the existing mutable-array API without eagerly allocating 32768
  // objects for every segment of a large blueprint. Once accessed, the array
  // is stable, so direct edits remain visible to the writer.
  return { x, y, z, lastChanged, version, blockCount,
    get blocks(): BlockData[] {
      return materialized ??= Array.from(words, decodeWord);
    },
    set blocks(value: BlockData[]) { materialized = value; },
  };
}

/** @param index Local block index. @returns Its x/y/z coordinates. @throws {RangeError} Outside the segment. */
export function indexToPos(index: number): { x: number; y: number; z: number } {
  if (!Number.isInteger(index) || index < 0 || index >= BLOCK_COUNT) throw new RangeError('Invalid block index');
  return { x: index & 31, y: (index >>> 5) & 31, z: index >>> 10 };
}
/** @param x Local x. @param y Local y. @param z Local z. @returns Local index. @throws {RangeError} Outside the segment. */
export function posToIndex(x: number, y: number, z: number): number {
  if (![x, y, z].every(v => Number.isInteger(v) && v >= 0 && v < CHUNK_DIM)) throw new RangeError('Invalid local block coordinates');
  return x + y * CHUNK_DIM + z * CHUNK_DIM * CHUNK_DIM;
}
/** @param seg Segment. @param x Local x. @param y Local y. @param z Local z. @returns The editable block. */
export function getBlock(seg: SegmentData, x: number, y: number, z: number): BlockData {
  return seg.blocks[posToIndex(x, y, z)];
}
