/**
 * @fileoverview Byte-preserving editor for one SMD3 region document.
 *
 * Reference: StarMade-Open decf3a1990f29b9505041f122188bf19489bcf7e,
 * SegmentHeader (table entries, fixed sectors and retained empty offsets),
 * SegmentDataIONew.write and RemoteSegment.serialize. Unchanged records retain
 * their original codec, version, timestamps and bytes. Changed records use the
 * canonical v7 writer. Existing unreferenced bytes are never compacted away.
 */
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import { BLOCK_COUNT, HEADER_SIZE, HEADER_SLOT_COUNT, SEGMENT_SECTOR, parseSmd3 } from './Smd3Parser.js';
import type { SegmentData, Smd3File, Smd3ParseOptions } from './Smd3Parser.js';
import { encodeBlockWord, writeSmd3 } from './Smd3Writer.js';

/** Immutable comparison data, independent of mutable caller models. */
interface Snapshot { metadata: string; words: Buffer; }
/** Original table cell and its decoded semantic state. */
interface OriginalRecord { offset: number; snapshot: Snapshot; }
/** A validated coordinate's table cell and containing region. */
interface Location { cell: number; region: string; }

/**
 * Computes the game's x-fastest table index from aligned entity coordinates.
 * @param segment - Segment whose position must fit signed int32 coordinates.
 * @returns Its table cell and region identity.
 * @throws {DecodeError} For invalid or unaligned coordinates.
 */
function locate(segment: SegmentData): Location {
  const coordinates = [segment.x, segment.y, segment.z];
  for (const value of coordinates) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff || value % 32 !== 0) {
      throw new DecodeError('E_RANGE', 'Segment coordinates must be aligned int32 block coordinates');
    }
  }
  const grid = coordinates.map(value => (value >> 5) + 8);
  const [x, y, z] = grid.map(value => ((value % 16) + 16) % 16);
  return { cell: x + y * 16 + z * 256, region: grid.map(value => Math.floor(value / 16)).join(',') };
}

/**
 * Snapshots all editable fields, ignoring only derived block/slot counters.
 * @param segment - Current segment model.
 * @returns Scalar metadata and exact uint32 block words.
 * @throws {DecodeError} For invalid metadata, arrays or block fields.
 */
function snapshot(segment: SegmentData): Snapshot {
  boundedInteger(segment.version, 'segment version', 255);
  if (typeof segment.lastChanged !== 'bigint' || segment.lastChanged < -0x8000000000000000n || segment.lastChanged > 0x7fffffffffffffffn) {
    throw new DecodeError('E_RANGE', 'Segment timestamp must be a signed int64 bigint');
  }
  if (!Array.isArray(segment.blocks) || segment.blocks.length !== BLOCK_COUNT) {
    throw new DecodeError('E_RANGE', `A segment needs ${BLOCK_COUNT} blocks`);
  }
  const words = Buffer.alloc(BLOCK_COUNT * 4);
  for (let i = 0; i < BLOCK_COUNT; i++) words.writeUInt32LE(encodeBlockWord(segment.blocks[i]), i * 4);
  return { metadata: JSON.stringify([segment.x, segment.y, segment.z, segment.version, String(segment.lastChanged)]), words };
}

/**
 * Rejects partial recovery results before any output is produced.
 * @param file - Region model to qualify for editing.
 * @throws {DecodeError} If omissions were recorded or completeness is false.
 */
function requireComplete(file: Smd3File): void {
  if (file.complete === false || file.diagnostics?.length) {
    throw new DecodeError('E_INCOMPLETE', 'Cannot edit an incomplete SMD3 recovery result');
  }
}

/**
 * Owns original region bytes and an independently mutable decoded model.
 *
 * Removing a segment clears its table size but retains its allocated sector,
 * as SegmentHeader.writeEmptyDirectly does. Moving uses removal plus insertion
 * in the destination cell. New allocations follow all original sectors and
 * reserved offsets; holes and trailing bytes retain their original offsets.
 * A changed record may overwrite padding it grows into, but all bytes outside
 * that record and its table entry remain untouched. Counters are derived and
 * never override block contents. Every call starts from the original snapshot,
 * so reverting edits recovers the exact original bytes.
 */
export class Smd3Document {
  readonly file: Smd3File;
  private readonly original: Buffer;
  private readonly records = new Map<number, OriginalRecord>();
  private readonly maxBytes: number;
  private readonly maxBlocks: number;
  private readonly nextOffset: number;
  private readonly region: string | undefined;

  /**
   * Copies and strictly qualifies an existing region for safe document edits.
   * @param data - Original bytes; later caller changes do not affect this document.
   * @param options - Parser limits/context, also applied to output size and blocks.
   * @throws {DecodeError} For invalid input, ambiguous layout, or partial recovery.
   */
  constructor(data: Buffer | Uint8Array, options: Smd3ParseOptions = {}) {
    this.maxBytes = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
    this.maxBlocks = boundedInteger(options.maxBlocks ?? 16 * 1024 * 1024, 'maxBlocks');
    if (data.length > this.maxBytes) throw new DecodeError('E_LIMIT', 'SMD3 document input byte budget exceeded');
    this.original = Buffer.from(data);
    this.file = parseSmd3(this.original, options);
    requireComplete(this.file);
    let next = Math.ceil((this.original.length - HEADER_SIZE) / SEGMENT_SECTOR) + 1;
    let segmentIndex = 0;
    let region: string | undefined;
    const allocated = new Set<number>();
    for (let cell = 0; cell < HEADER_SLOT_COUNT; cell++) {
      const offset = this.original.readInt16BE(4 + cell * 4);
      const size = this.original.readUInt16BE(6 + cell * 4);
      if (offset < 0 || (offset > 0 && allocated.has(offset))) {
        throw new DecodeError('E_FORMAT', 'Ambiguous SMD3 sector allocation');
      }
      if (offset > 0) { allocated.add(offset); next = Math.max(next, offset + 1); }
      if (offset === 0 || size === 0) continue;
      const segment = this.file.segments[segmentIndex++];
      const location = locate(segment);
      if (location.cell !== cell) throw new DecodeError('E_FORMAT', 'SMD3 table cell disagrees with its segment position');
      if (region !== undefined && region !== location.region) throw new DecodeError('E_FORMAT', 'SMD3 source contains different regions');
      region = location.region;
      this.records.set(cell, { offset, snapshot: snapshot(segment) });
    }
    this.nextOffset = next;
    this.region = region;
  }

  /**
   * Serializes edits while retaining every untouched record and original byte.
   * @param file - Replacement model, or the document's mutable model by default.
   * @returns Detached bytes; neither original bytes nor model metadata are changed.
   * @throws {DecodeError} For incomplete results, invalid edits, or exhausted limits.
   */
  toBuffer(file: Smd3File = this.file): Buffer {
    requireComplete(file);
    boundedInteger(file.headerVersion, 'headerVersion', 255);
    boundedInteger(file.segments.length, 'segment count', HEADER_SLOT_COUNT);
    if (file.segments.length * BLOCK_COUNT > this.maxBlocks) throw new DecodeError('E_LIMIT', 'SMD3 document block budget exceeded');
    const cells = new Set<number>();
    const updates: { cell: number; offset: number; bytes: Buffer }[] = [];
    let region = this.region;
    let next = this.nextOffset;
    let length = this.original.length;
    for (const segment of file.segments) {
      const location = locate(segment);
      if (region !== undefined && region !== location.region) throw new DecodeError('E_RANGE', 'Segments belong to different SMD3 regions');
      region = location.region;
      const cell = location.cell;
      if (cells.has(cell)) throw new DecodeError('E_FORMAT', 'Duplicate SMD3 region cell');
      cells.add(cell);
      const current = snapshot(segment);
      const previous = this.records.get(cell);
      if (previous && previous.snapshot.metadata === current.metadata && previous.snapshot.words.equals(current.words)) continue;
      // Reuse the canonical writer only for a changed record, never an untouched
      // legacy/optimized record whose byte representation must remain intact.
      const encoded = writeSmd3({ headerVersion: file.headerVersion, usedSlots: 1, segments: [segment] });
      const size = encoded.readUInt16BE(6 + cell * 4);
      const bytes = encoded.subarray(HEADER_SIZE, HEADER_SIZE + size);
      const reserved = this.original.readInt16BE(4 + cell * 4);
      const offset = reserved === 0 ? next++ : reserved;
      if (offset > 0x7fff) throw new DecodeError('E_LIMIT', 'SMD3 sector offset capacity exceeded');
      const start = HEADER_SIZE + (offset - 1) * SEGMENT_SECTOR;
      const end = start >= this.original.length ? start + SEGMENT_SECTOR : start + bytes.length;
      length = Math.max(length, end);
      if (length > this.maxBytes) throw new DecodeError('E_LIMIT', 'SMD3 document output byte budget exceeded');
      updates.push({ cell, offset, bytes });
    }
    const output = Buffer.alloc(length);
    this.original.copy(output);
    output[0] = file.headerVersion;
    for (const cell of this.records.keys()) {
      if (!cells.has(cell)) output.writeUInt16BE(0, 6 + cell * 4);
    }
    for (const update of updates) {
      output.writeInt16BE(update.offset, 4 + update.cell * 4);
      output.writeUInt16BE(update.bytes.length, 6 + update.cell * 4);
      update.bytes.copy(output, HEADER_SIZE + (update.offset - 1) * SEGMENT_SECTOR);
    }
    return output;
  }
}
