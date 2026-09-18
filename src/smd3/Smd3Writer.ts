/**
 * @fileoverview
 * Validated SMD3 writer with explicit version selection and loss prevention.
 * Version 7 uses raw LZ4/little-endian block words. Version 6 uses zlib/24-bit
 * words and rejects fields that cannot be represented. Writers never trust a
 * cached blockCount, truncate compression, or silently overwrite header slots.
 * Byte identity, original compression and sector allocation are not preserved.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { deflateSync } from 'node:zlib';
import { encodeLz4Block } from './Lz4Block.js';
import { HEADER_SIZE, HEADER_SLOT_COUNT, SEGMENT_SECTOR, DATA_AVAILABLE,
  DATA_EMPTY, CHUNK_DIM, BLOCK_COUNT, VERSION_4BYTE, posToIndex } from './Smd3Parser.js';
import type { Smd3File, SegmentData, BlockData } from './Smd3Parser.js';

/** @param value Integer. @param max Inclusive maximum. @param name Field name. @throws {RangeError} On overflow. */
function unsigned(value: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${name}: ${value}`);
}
/** @param block Editable block. @param version Output version. @returns Packed unsigned word. */
function encodeBlock(block: BlockData, version: number): number {
  if (!block) throw new TypeError('Missing block');
  unsigned(block.type, version === 6 ? 2047 : 8191, 'block type');
  unsigned(block.hp, 127, 'block hitpoints');
  unsigned(block.orientation, 31, 'block orientation');
  unsigned(block.extra ?? 0, version === 6 ? 0 : 63, 'block extra bits');
  if (typeof block.active !== 'boolean') throw new TypeError('Block active must be boolean');
  if (version === 6) return block.type | (block.hp << 11) | (+block.active << 18) | (block.orientation << 19);
  return (block.type | (block.hp << 13) | (+block.active << 20) |
    (block.orientation << 21) | ((block.extra ?? 0) << 26)) >>> 0;
}
/** @param segment Source segment. @param version Output version. @returns Exact serialized bytes, without padding. */
function encodeSegment(segment: SegmentData, version: number): Buffer {
  if (segment.blocks.length !== BLOCK_COUNT) throw new RangeError(`Expected ${BLOCK_COUNT} blocks`);
  const width = version === 6 ? 3 : 4;
  const raw = Buffer.alloc(BLOCK_COUNT * width);
  let hasData = false;
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const word = encodeBlock(segment.blocks[i], version);
    hasData ||= word !== 0;
    raw.writeUIntLE(word, i * width, width);
  }
  // Preserve nonzero metadata even on air blocks rather than discarding it.
  const compressed = hasData ? (version === 6 ? deflateSync(raw) : encodeLz4Block(raw)) : null;
  const length = compressed ? 26 + compressed.length : 22;
  if (length > SEGMENT_SECTOR) {
    throw new RangeError(`SMD3 segment (${segment.x},${segment.y},${segment.z}) needs ${length} bytes; sector capacity is ${SEGMENT_SECTOR}`);
  }
  const out = Buffer.alloc(length);
  out.writeUInt8(version, 0);
  out.writeBigInt64BE(segment.lastChanged, 1);
  out.writeInt32BE(segment.x, 9); out.writeInt32BE(segment.y, 13); out.writeInt32BE(segment.z, 17);
  out[21] = compressed ? DATA_AVAILABLE : DATA_EMPTY;
  if (compressed) {
    out.writeInt32BE(compressed.length, 22);
    compressed.copy(out, 26);
  }
  return out;
}
/** @param segment Segment origin. @returns Region header index. @throws {RangeError} On invalid coordinates. */
function localIndex(segment: SegmentData): number {
  for (const value of [segment.x, segment.y, segment.z]) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647 || value % CHUNK_DIM !== 0) {
      throw new RangeError(`Invalid segment origin: ${value}`);
    }
  }
  return (((segment.z >> 5) + 8) & 15) * 256 + (((segment.y >> 5) + 8) & 15) * 16 + (((segment.x >> 5) + 8) & 15);
}

/**
 * Encodes one SMD3 region with validated fields and recomputed occupancy.
 * @param file Complete decoded region. Recovered/incomplete files are rejected.
 * @param segVersion Explicit output version: 7 (default) or 6.
 * @returns A newly allocated region buffer.
 * @throws {Error} On incomplete inputs, collisions, overflow or unsupported versions.
 */
export function writeSmd3(file: Smd3File, segVersion = VERSION_4BYTE): Buffer {
  if (segVersion !== 6 && segVersion !== 7) throw new RangeError(`Unsupported output version ${segVersion}`);
  if (file.complete === false || (file.diagnostics?.length ?? 0) !== 0) throw new Error('Cannot write an incomplete recovered SMD3 file');
  unsigned(file.headerVersion, 255, 'header version');
  if (file.segments.length > HEADER_SLOT_COUNT) throw new RangeError('Too many SMD3 segments');
  const used = new Set<number>();
  const encoded = file.segments.map(segment => {
    const index = localIndex(segment);
    if (used.has(index)) throw new Error(`Duplicate SMD3 header slot ${index}`);
    used.add(index);
    return { index, bytes: encodeSegment(segment, segVersion) };
  });
  const out = Buffer.alloc(HEADER_SIZE + encoded.length * SEGMENT_SECTOR);
  out[0] = file.headerVersion;
  for (let i = 0; i < encoded.length; i++) {
    const { index, bytes } = encoded[i];
    out.writeInt16BE(i + 1, 4 + index * 4);
    out.writeUInt16BE(bytes.length, 6 + index * 4);
    bytes.copy(out, HEADER_SIZE + i * SEGMENT_SECTOR);
  }
  return out;
}

/**
 * Creates independent editable air blocks at a segment origin.
 * @param x Block-space origin x (multiple of 32).
 * @param y Block-space origin y (multiple of 32).
 * @param z Block-space origin z (multiple of 32).
 * @returns A new segment with independent block objects.
 */
export function emptySegment(x = 0, y = 0, z = 0): SegmentData {
  const segment: SegmentData = { x, y, z, lastChanged: BigInt(Date.now()), version: VERSION_4BYTE,
    blocks: Array.from({ length: BLOCK_COUNT }, () => ({ type: 0, hp: 0, orientation: 0, active: false })), blockCount: 0 };
  localIndex(segment);
  return segment;
}
/** @returns An empty, complete SMD3 region. */
export function emptySmd3File(): Smd3File {
  return { headerVersion: VERSION_4BYTE, segments: [], usedSlots: 0, complete: true, diagnostics: [] };
}
/**
 * Replaces one block and refreshes cached occupancy even after direct edits.
 * @param segment Segment to mutate.
 * @param x Local x. @param y Local y. @param z Local z.
 * @param block Replacement value (copied, never shared).
 * @throws {RangeError} On invalid coordinates or block fields.
 */
export function setBlock(segment: SegmentData, x: number, y: number, z: number, block: BlockData): void {
  encodeBlock(block, 7);
  const index = posToIndex(x, y, z);
  segment.blocks[index] = { ...block };
  segment.blockCount = segment.blocks.reduce((count, value) => count + Number(value.type !== 0), 0);
}
