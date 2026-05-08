/**
 * @fileoverview SMD3 Writer
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Smd3Writer — encoder for .smd3 files (StarMade block segments).
 *
 * Exact inverse of Smd3Parser.ts.
 *
 * Written format :
 *   HEADER (16388 bytes) : byte version + 3×padding + 4096×(short offset + short size)
 *   DATA: segments in their slots (each slot = SEGMENT_SECTOR = 48KB)
 *     byte  segVersion + int64 lastChanged + int32 x,y,z + byte dataByte
 *     [if DATA_AVAILABLE] int32 compressedSize + bytes zlib
 *
 * Block encoding 4-byte (version >= 7) :
 *   int32 BE par bloc : bits 0-12=type, 13-19=hp, 20=active, 21-25=orient
 *
 * Block encoding 3-byte (version < 7, read-only — always written as v7)
 *
 * Java source: RemoteSegment.serialize(), SegmentData4Byte.serialize()
 */

import { deflateSync } from 'zlib';
import {
  HEADER_SIZE, HEADER_SLOT_COUNT, SEGMENT_SECTOR, OFFSET_SHIFT,
  DATA_AVAILABLE, DATA_EMPTY, CHUNK_DIM, BLOCK_COUNT, VERSION_4BYTE,
} from './Smd3Parser.js';
import type { Smd3File, SegmentData, BlockData } from './Smd3Parser.js';

// ── Block Encoding ────────────────────────────────────────────────────────────

function _encode4Byte(block: BlockData): number {
  let v = 0;
  v |= (block.type & 0x1FFF);
  v |= ((block.hp & 0x7F) << 13);
  v |= (block.active ? 1 : 0) << 20;
  v |= ((block.orientation & 0x1F) << 21);
  return v;
}

// ── Writer de segment ─────────────────────────────────────────────────────────

function _encodeSegment(seg: SegmentData, fileVersion: number): Buffer {
  const buf = Buffer.alloc(SEGMENT_SECTOR);
  let off = 0;

  // Segment header
  buf.writeUInt8(fileVersion, off++);
  buf.writeBigInt64BE(seg.lastChanged, off); off += 8;
  buf.writeInt32BE(seg.x, off); off += 4;
  buf.writeInt32BE(seg.y, off); off += 4;
  buf.writeInt32BE(seg.z, off); off += 4;

  if (seg.blockCount === 0) {
    buf.writeUInt8(DATA_EMPTY, off);
    return buf;
  }

  buf.writeUInt8(DATA_AVAILABLE, off++);

  // Encode blocks en 4-byte BE
  const blockBuf = Buffer.alloc(BLOCK_COUNT * 4);
  for (let i = 0; i < BLOCK_COUNT; i++) {
    blockBuf.writeInt32BE(_encode4Byte(seg.blocks[i]), i * 4);
  }

  // Compress with zlib
  const compressed = deflateSync(blockBuf);
  buf.writeInt32BE(compressed.length, off); off += 4;
  compressed.copy(buf, off);

  return buf;
}

// ── Writer principal ──────────────────────────────────────────────────────────

/**
 * Encodes an Smd3File to a binary Buffer ready to write to disk.
 *
 * Segments are written in 4-byte format (version 7) regardless of
 * the original format — automatic migration.
 *
 * @param file       Smd3File to encode
 * @param segVersion Version to write in each segment (default: VERSION_4BYTE=7)
 */
export function writeSmd3(file: Smd3File, segVersion = VERSION_4BYTE): Buffer {
  // Allocate: HEADER + n × SEGMENT_SECTOR
  const totalSize = HEADER_SIZE + file.segments.length * SEGMENT_SECTOR;
  const out = Buffer.alloc(totalSize, 0);

  // ── Header ──
  out.writeUInt8(file.headerVersion >= 0 ? file.headerVersion : segVersion, 0);
  // bytes 1-3 : padding = 0 (already zero)

  // Write segments into their slots
  let dataSlotIndex = 0; // data slot number (0-based)

  for (const seg of file.segments) {
    // Compute the slot in the header table (local index in the grid 16×16×16)
    // Note : the smd3 stores until 4096 slots, each segment occupies 1 slot
    // For a simple file, slots are allocated sequentially
    const localIdx = _getLocalIndex(seg.x, seg.y, seg.z);

    // Offset in the header table
    const hdrOff = 4 + localIdx * 4;

    // dataOffset (1-based car OFFSET_SHIFT=1)
    const dataOffset = dataSlotIndex + OFFSET_SHIFT;

    // Write into the header : short offset (signed) + short size
    const segBuf = _encodeSegment(seg, segVersion);
    const size = segBuf.length; // always SEGMENT_SECTOR

    out.writeInt16BE(dataOffset, hdrOff);
    out.writeUInt16BE(size > 0xFFFF ? 0xFFFF : size, hdrOff + 2);

    // Write segment data into the slot
    const absPos = HEADER_SIZE + dataSlotIndex * SEGMENT_SECTOR;
    segBuf.copy(out, absPos);

    dataSlotIndex++;
  }

  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Computes the local index (0–4095) in the 16×16×16 header grid. */
function _getLocalIndex(segX: number, segY: number, segZ: number): number {
  // Port of SegmentHeader.getSegIndex / getLocalIndex
  const DIM = 16;
  const DIMENSION_HALF = 8; // SegmentBufferManager.DIMENSION_HALF
  const lx = _modU16(_divUSeg(segX) + DIMENSION_HALF) % DIM;
  const ly = _modU16(_divUSeg(segY) + DIMENSION_HALF) % DIM;
  const lz = _modU16(_divUSeg(segZ) + DIMENSION_HALF) % DIM;
  return (lz * DIM * DIM) + (ly * DIM) + lx;
}

function _divUSeg(i: number): number {
  return i >> 5; // div par 32 (Chunk32 mode)
}

function _modU16(i: number): number {
  return ((i % 16) + 16) % 16;
}

// ── Empty segment creation ────────────────────────────────────────────────

/** Creates an empty SegmentData with all blocks set to type=0. */
export function emptySegment(x = 0, y = 0, z = 0): SegmentData {
  return {
    x, y, z,
    lastChanged: BigInt(Date.now()),
    version: VERSION_4BYTE,
    blocks: new Array(BLOCK_COUNT).fill({ type: 0, hp: 0, orientation: 0, active: false }),
    blockCount: 0,
  };
}

/** Creates an empty Smd3File with no segments. */
export function emptySmd3File(): Smd3File {
  return { headerVersion: VERSION_4BYTE, segments: [], usedSlots: 0 };
}
