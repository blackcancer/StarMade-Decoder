/**
 * @fileoverview Validated SMD3 writer and block-edit helpers.
 *
 * Produces version 7 segment records with little-endian LZ4-compressed block words.
 * Counts are recomputed; zero-type blocks with non-zero raw fields are preserved.
 * Records that cannot fit the game's fixed 48 KiB sector are rejected BEFORE
 * copying, never truncated. Recovery results and duplicate region cells are
 * refused. This is a semantic migration writer, not a byte-exact archive editor.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { encodeLz4Block } from './Lz4Block.js';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import {
  HEADER_SIZE, HEADER_SLOT_COUNT, SEGMENT_SECTOR, OFFSET_SHIFT, DATA_AVAILABLE,
  DATA_EMPTY, BLOCK_COUNT, VERSION_4BYTE, posToIndex,
} from './Smd3Parser.js';
import type { Smd3File, SegmentData, BlockData } from './Smd3Parser.js';

/**
 * Validates and packs all 32 bits of a block.
 * @param block - Complete block fields; absent extra means zero.
 * @returns An unsigned 32-bit word.
 * @throws {DecodeError} For non-integer or out-of-range fields.
 */
export function encodeBlockWord(block: BlockData): number {
  if (!block || typeof block.active !== 'boolean') throw new DecodeError('E_RANGE', 'A block requires a boolean active field');
  boundedInteger(block.type, 'block.type', 0x1fff);
  boundedInteger(block.hp, 'block.hp', 127);
  boundedInteger(block.orientation, 'block.orientation', 31);
  boundedInteger(block.extra ?? 0, 'block.extra', 63);
  return (block.type | (block.hp << 13) | ((block.active ? 1 : 0) << 20) |
    (block.orientation << 21) | ((block.extra ?? 0) << 26)) >>> 0;
}

/**
 * Encodes one segment after validating every block and its coordinates.
 * @param seg - Segment in entity block coordinates.
 * @returns Unpadded serialized record, guaranteed to fit a storage sector.
 * @throws {DecodeError} For invalid fields or unrepresentable compressed data.
 */
function encodeSegment(seg: SegmentData): Buffer {
  if (!Array.isArray(seg.blocks) || seg.blocks.length !== BLOCK_COUNT) throw new DecodeError('E_RANGE', `A segment needs ${BLOCK_COUNT} blocks`);
  const blockBuf = Buffer.alloc(BLOCK_COUNT * 4);
  let allZero = true;
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const word = encodeBlockWord(seg.blocks[i]);
    blockBuf.writeUInt32LE(word, i * 4);
    allZero = allZero && word === 0;
  }
  const compressed = allZero ? null : encodeLz4Block(blockBuf);
  const size = compressed ? 26 + compressed.length : 22;
  if (size > SEGMENT_SECTOR) {
    throw new DecodeError('E_LIMIT', `Compressed segment requires ${size} bytes, exceeding the ${SEGMENT_SECTOR}-byte sector capacity`);
  }
  const out = Buffer.alloc(size);
  out.writeUInt8(VERSION_4BYTE, 0);
  out.writeBigInt64BE(seg.lastChanged, 1);
  out.writeInt32BE(seg.x, 9); out.writeInt32BE(seg.y, 13); out.writeInt32BE(seg.z, 17);
  out.writeUInt8(compressed ? DATA_AVAILABLE : DATA_EMPTY, 21);
  if (compressed) {
    out.writeInt32BE(22, 22); // Java serializeLZ4 stores the preceding header length here.
    compressed.copy(out, 26);
  }
  return out;
}

/**
 * Writes validated version 7 segments to their region cells.
 * @param file - A complete region, not a partial recovery result.
 * @param segVersion - Must equal 7; other versions are not writable.
 * @returns A new file buffer. The input model is not modified.
 * @throws {DecodeError} For incomplete input, invalid coordinates, colliding cells,
 * mixed regions, an unsupported version, or a compressed record exceeding 48 KiB.
 * @remarks Legacy input block values are migrated semantically to v7. Keep a backup.
 */
export function writeSmd3(file: Smd3File, segVersion = VERSION_4BYTE): Buffer {
  if (segVersion !== VERSION_4BYTE) throw new DecodeError('E_UNSUPPORTED', 'SMD3 writing supports segment version 7 only');
  if (file.complete === false || file.diagnostics?.length) throw new DecodeError('E_INCOMPLETE', 'Cannot write an incomplete SMD3 recovery result');
  boundedInteger(file.headerVersion, 'headerVersion', 255);
  boundedInteger(file.segments.length, 'segment count', HEADER_SLOT_COUNT);
  const cells = new Set<number>();
  let region: string | undefined;
  const records = file.segments.map(seg => {
    if (seg.version < 6 || seg.version > 7) throw new DecodeError('E_UNSUPPORTED', 'Writing pre-v6 segments requires game-dependent migration');
    for (const value of [seg.x, seg.y, seg.z]) {
      if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff || value % 32 !== 0) {
        throw new DecodeError('E_RANGE', 'Segment coordinates must be aligned int32 block coordinates');
      }
    }
    const xyz = [seg.x, seg.y, seg.z].map(v => (v >> 5) + 8);
    const regionKey = xyz.map(v => Math.floor(v / 16)).join(',');
    if (region !== undefined && region !== regionKey) throw new DecodeError('E_RANGE', 'Segments belong to different SMD3 regions');
    region = regionKey;
    const [x, y, z] = xyz.map(v => ((v % 16) + 16) % 16);
    const index = x + y * 16 + z * 256;
    if (cells.has(index)) throw new DecodeError('E_FORMAT', `Duplicate region cell ${index}`);
    cells.add(index);
    return { index, bytes: encodeSegment(seg) };
  });
  const out = Buffer.alloc(HEADER_SIZE + records.length * SEGMENT_SECTOR);
  out.writeUInt8(VERSION_4BYTE, 0); // Java always writes the current region header version.
  records.forEach(({ index, bytes }, slot) => {
    out.writeInt16BE(slot + OFFSET_SHIFT, 4 + index * 4);
    out.writeUInt16BE(bytes.length, 6 + index * 4);
    bytes.copy(out, HEADER_SIZE + slot * SEGMENT_SECTOR);
  });
  return out;
}

/**
 * Creates an empty segment with independent block objects.
 * @param x - Entity block x, aligned to 32 when written.
 * @param y - Entity block y, aligned to 32 when written.
 * @param z - Entity block z, aligned to 32 when written.
 * @returns A mutable segment containing 32,768 independent air blocks.
 */
export function emptySegment(x = 0, y = 0, z = 0): SegmentData {
  return {
    x, y, z, lastChanged: BigInt(Date.now()), version: VERSION_4BYTE,
    blocks: Array.from({ length: BLOCK_COUNT }, () => ({ type: 0, hp: 0, orientation: 0, active: false })),
    blockCount: 0,
  };
}

/** @returns An empty complete version 7 region. */
export function emptySmd3File(): Smd3File {
  return { headerVersion: VERSION_4BYTE, segments: [], usedSlots: 0, complete: true, diagnostics: [] };
}

/**
 * Replaces a single block by value, then refreshes the derived non-air count.
 * @param segment - Segment to edit in place.
 * @param x - Local x coordinate, 0..31.
 * @param y - Local y coordinate, 0..31.
 * @param z - Local z coordinate, 0..31.
 * @param block - New value; the supplied object is copied, never shared.
 * @throws {DecodeError} For invalid block fields or local coordinates.
 * @remarks The timestamp is left unchanged; callers control edit timestamps.
 */
export function setBlock(segment: SegmentData, x: number, y: number, z: number, block: BlockData): void {
  const index = posToIndex(x, y, z);
  encodeBlockWord(block);
  if (segment.blocks.length !== BLOCK_COUNT) throw new DecodeError('E_RANGE', 'Invalid segment block array');
  segment.blocks[index] = { ...block };
  segment.blockCount = segment.blocks.reduce((n, b) => n + (b.type !== 0 ? 1 : 0), 0);
}
