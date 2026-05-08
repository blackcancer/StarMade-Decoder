/**
 * @fileoverview StarMade Segment Data Parser
 *
 * Decodes .smd3 segment files into typed block arrays and segment metadata.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Smd3Parser — parser for .smd3 files (StarMade block segments).
 *
 * File format (SegmentRegionFileNew + SegmentHeader) :
 *
 *   ┌─ HEADER (16388 bytes) ──────────────────────────────────────────────┐
 *   │ byte   version                                                      │
 *   │ byte   pad1, pad2, pad3                                             │
 *   │ [4096 × (short offset + short size)]   — segment table         │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌─ DATA (n × SEGMENT_SECTOR of 48 KB each) ────────────────────────┐
 *   │  each slot (slot = (offset-1)*48KB) :                            │
 *   │    byte  version   (6=Chunk16/3-byte, 7=Chunk32/4-byte)            │
 *   │    long  lastChanged (8 bytes BE)                                   │
 *   │    int   segX, segY, segZ (4 bytes BE chacun)                      │
 *   │    byte  dataByte (1=DATA_AVAILABLE, 2=DATA_EMPTY)                 │
 *   │    [if DATA_AVAILABLE]                                              │
 *   │      int  compressedSize                                            │
 *   │      byte[compressedSize] — zlib deflate block data       │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Decompressed block data :
 *   version < 7 (Chunk16, 3 bytes/block) : BLOCK_COUNT_32 × 3 bytes
 *     type    = b[2] + (b[1] & 7) × 256  (11 bits)
 *     hp      = bits 11-18               (8 bits)
 *     active  = bit3 de b[0] == 0        (inverted)
 *     orient  = bits 4-7 de b[0]         (4 bits)
 *
 *   version >= 7 (Chunk32, 4 bytes/block, little-endian int) :
 *     type    = bits 0-12   (13 bits)
 *     hp      = bits 13-19  (7 bits)
 *     active  = bit 20      (1 bit)
 *     orient  = bits 21-25  (5 bits)
 *
 * Java source:
 *   SegmentHeader.java, SegmentDataIONew.java, SegmentData4Byte.java,
 *   Chunk16SegmentData.java, RemoteSegment.java
 */

import { inflateSync } from 'zlib';
import { BufferReader } from '../core/BufferReader.js';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Number of segments in the header (16×16×16 = 4096) */
export const HEADER_SLOT_COUNT = 4096;

/** Header size : 4 bytes + 4096×4 bytes = 16388 */
export const HEADER_SIZE = 4 + HEADER_SLOT_COUNT * 4;

/** Data slot size (48 KB) */
export const SEGMENT_SECTOR = 48 * 1024;

/** Shift applied to the stored offset */
export const OFFSET_SHIFT = 1;

/** byte dataByte = 1 → SegmentData4Byte (zlib data) */
export const DATA_AVAILABLE = 1;

/** byte dataByte = 2 → empty segment */
export const DATA_EMPTY = 2;

/** byte dataByte = 3 → SegmentDataSingle (single block type) */
export const DATA_SINGLE = 3;

/** byte dataByte = 4 → SegmentDataBitMap (compressed palette) */
export const DATA_BITMAP = 4;

/** byte dataByte = 5 → SegmentDataSingleSideEdge (single type, edges only) */
export const DATA_SINGLE_SIDE_EDGE = 5;

/** Chunk dimension (32 in Chunk32 mode) */
export const CHUNK_DIM = 32;
export const BLOCK_COUNT = CHUNK_DIM * CHUNK_DIM * CHUNK_DIM; // 32768

/** Version from which the 4-byte format is used */
export const VERSION_4BYTE = 7;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlockData {
  /** block type/id (0 = air) */
  type: number;
  /** hit points (0-127 or 0-255 depending on version) */
  hp: number;
  /** orientation (0-15 or 0-31 depending on version) */
  orientation: number;
  /** activation state */
  active: boolean;
}

export interface SegmentData {
  /** position in segment coordinates */
  x: number;
  y: number;
  z: number;
  /** last modification timestamp */
  lastChanged: bigint;
  /** data format version */
  version: number;
  /** blocks indexed by local position (index = x + y*DIM + z*DIM*DIM) */
  blocks: BlockData[];
  /** number of non-empty blocks */
  blockCount: number;
}

export interface Smd3File {
  /** header version */
  headerVersion: number;
  /** parsed segments */
  segments: SegmentData[];
  /** number of used slots */
  usedSlots: number;
}

// ── Parser principal ──────────────────────────────────────────────────────────

/**
 * Parses a complete .smd3 file.
 * @param data File buffer (read-only, not modified)
 */
export function parseSmd3(data: Buffer | Uint8Array): Smd3File {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // ── Header ──
  const headerVersion = buf.readUInt8(0);
  // bytes 1-3 : padding

  const segments: SegmentData[] = [];
  let usedSlots = 0;

  for (let i = 0; i < HEADER_SLOT_COUNT; i++) {
    const hdrOff = 4 + i * 4;
    const rawOffset = buf.readInt16BE(hdrOff);       // signed
    const rawSize   = buf.readUInt16BE(hdrOff + 2);  // unsigned

    // offset=0 → no data for this slot
    if (rawOffset === 0 || rawSize === 0) continue;

    usedSlots++;

    const dataOffset = rawOffset - OFFSET_SHIFT;
    const absPos = HEADER_SIZE + dataOffset * SEGMENT_SECTOR;

    if (absPos + rawSize > buf.length) continue; // out of bounds

    const seg = _parseSegment(buf, absPos, rawSize);
    if (seg) segments.push(seg);
  }

  return { headerVersion, segments, usedSlots };
}

// ── Parser de segment ─────────────────────────────────────────────────────────

function _parseSegment(buf: Buffer, absPos: number, size: number): SegmentData | null {
  if (absPos + 22 > buf.length) return null;

  const version     = buf.readUInt8(absPos);
  const lastChanged = buf.readBigInt64BE(absPos + 1);
  const x           = buf.readInt32BE(absPos + 9);
  const y           = buf.readInt32BE(absPos + 13);
  const z           = buf.readInt32BE(absPos + 17);
  const dataByte    = buf.readUInt8(absPos + 21);

  if (dataByte === DATA_EMPTY) {
    return {
      x, y, z, lastChanged, version,
      blocks: new Array(BLOCK_COUNT).fill(null).map(() => ({ type: 0, hp: 0, orientation: 0, active: false })),
      blockCount: 0,
    };
  }

  // Special formats SINGLE / SINGLE_SIDE_EDGE (dataByte 3 or 5) :
  // Payload = 1 int32 BE (filledType = encoded SegmentData4Byte value)
  if (dataByte === DATA_SINGLE || dataByte === DATA_SINGLE_SIDE_EDGE) {
    if (absPos + 26 > buf.length) return null;
    const filledType = buf.readInt32BE(absPos + 22);
    const type        = filledType & 0x1FFF;
    const hp          = (filledType >> 13) & 0x7F;
    const active      = ((filledType >> 20) & 0x1) === 1;
    const orientation = (filledType >> 21) & 0x1F;
    const block: BlockData = { type, hp, orientation, active };
    const blocks = new Array(BLOCK_COUNT).fill(block);
    return { x, y, z, lastChanged, version, blocks, blockCount: type !== 0 ? BLOCK_COUNT : 0 };
  }

  // Format BITMAP (dataByte 4) :
  // Payload = int indexBitShift + int blockTypeLength + blockTypeLength×int + (BLOCK_COUNT>>indexBitShift)×int
  if (dataByte === DATA_BITMAP) {
    if (absPos + 30 > buf.length) return null;
    const indexBitShift = buf.readInt32BE(absPos + 22);
    const blockTypeLength = buf.readInt32BE(absPos + 26);
    const shift = 5; // constante Java
    const indexBitShiftInv = shift - indexBitShift;
    const bitMask = (1 << (32 >> indexBitShift)) - 1;
    const indexBitMask = (1 << indexBitShift) - 1;

    let off = absPos + 30;
    const blockTypeData: number[] = [];
    for (let i = 0; i < blockTypeLength; i++) {
      blockTypeData.push(buf.readInt32BE(off)); off += 4;
    }
    const bitMapLen = BLOCK_COUNT >> indexBitShift;
    const bitMap: number[] = [];
    for (let i = 0; i < bitMapLen; i++) {
      bitMap.push(buf.readInt32BE(off)); off += 4;
    }

    const blocks: BlockData[] = new Array(BLOCK_COUNT);
    let blockCount = 0;
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const bmIdx = i >> indexBitShift;
      const bitPos = (i & indexBitMask) << indexBitShiftInv;
      const typeIdx = (bitMap[bmIdx] >>> bitPos) & bitMask;
      const raw = blockTypeData[typeIdx] ?? 0;
      const type        = raw & 0x1FFF;
      const hp          = (raw >> 13) & 0x7F;
      const active      = ((raw >> 20) & 0x1) === 1;
      const orientation = (raw >> 21) & 0x1F;
      blocks[i] = { type, hp, orientation, active };
      if (type !== 0) blockCount++;
    }
    return { x, y, z, lastChanged, version, blocks, blockCount };
  }

  // Classic zlib-backed 4Byte format (dataByte 1)
  if (dataByte !== DATA_AVAILABLE) return null;

  if (absPos + 26 > buf.length) return null;
  const compressedSize = buf.readInt32BE(absPos + 22);
  const compStart = absPos + 26;

  if (compStart + compressedSize > buf.length) return null;

  const compressed = buf.slice(compStart, compStart + compressedSize);

  let inflated: Buffer;
  try {
    inflated = inflateSync(compressed);
  } catch {
    return null;
  }

  const blocks = version < VERSION_4BYTE
    ? _decode3Byte(inflated)
    : _decode4Byte(inflated);

  const blockCount = blocks.filter(b => b.type !== 0).length;

  return { x, y, z, lastChanged, version, blocks, blockCount };
}

// ── 3-byte/block decoding (Chunk16, version < 7) ────────────────────────────

function _decode3Byte(inflated: Buffer): BlockData[] {
  const blocks: BlockData[] = new Array(BLOCK_COUNT);

  for (let i = 0; i < BLOCK_COUNT; i++) {
    const idx = i * 3;
    const b0 = inflated[idx]     & 0xff;
    const b1 = inflated[idx + 1] & 0xff;
    const b2 = inflated[idx + 2] & 0xff;

    // type : bits 0-10 (11 bits)
    const type = b2 + ((b1 & 0x07) * 256);
    // hp : bits 11-18 (8 bits)
    const hp = ((b1 & 0xf8) >> 3) | ((b0 & 0x03) << 5);
    // active : bit 3 de b0, 0 = active (inverted)
    const active = (b0 & 0x08) === 0;
    // orientation : bits 4-7 de b0 (4 bits)
    const orientation = (b0 >> 4) & 0x0f;

    blocks[i] = { type, hp, orientation, active };
  }

  return blocks;
}

// ── 4-byte/block decoding (Chunk32, version >= 7, little-endian) ────────────

function _decode4Byte(inflated: Buffer): BlockData[] {
  const blocks: BlockData[] = new Array(BLOCK_COUNT);

  for (let i = 0; i < BLOCK_COUNT; i++) {
    // SegmentData4Byte stocke en little-endian (ByteBuffer natif Java = BE, mais readFrom utilise LE via ByteBuffer)
    // In practice, verify: SegmentData4Byte inflate() writes through inflater.inflate(byteBuffer)
    // which is a ByteBuffer in native order (BE on the JVM) — readInt32BE is used
    const v = inflated.readInt32BE(i * 4);

    // type    : bits 0-12   (13 bits)
    const type        = v & 0x1FFF;
    // hp      : bits 13-19  (7 bits)
    const hp          = (v >> 13) & 0x7F;
    // active  : bit 20      (1 bit, 1=active)
    const active      = ((v >> 20) & 0x1) === 1;
    // orient  : bits 21-25  (5 bits)
    const orientation = (v >> 21) & 0x1F;

    blocks[i] = { type, hp, orientation, active };
  }

  return blocks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the local position (x, y, z) from a block index.
 * Indexing: index = x + y*DIM + z*DIM²
 */
export function indexToPos(index: number): { x: number; y: number; z: number } {
  const z = Math.floor(index / (CHUNK_DIM * CHUNK_DIM));
  const y = Math.floor((index % (CHUNK_DIM * CHUNK_DIM)) / CHUNK_DIM);
  const x = index % CHUNK_DIM;
  return { x, y, z };
}

/**
 * Returns the block index from a local position.
 */
export function posToIndex(x: number, y: number, z: number): number {
  return x + y * CHUNK_DIM + z * CHUNK_DIM * CHUNK_DIM;
}

/**
 * Retrieves a block from its local coordinates in a segment.
 */
export function getBlock(seg: SegmentData, x: number, y: number, z: number): BlockData {
  return seg.blocks[posToIndex(x, y, z)];
}
