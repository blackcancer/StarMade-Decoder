/**
 * @fileoverview StarMade Template Parser
 *
 * Decodes .smtpl template files into block pieces, connections, and text metadata.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmtplParser — parser for .smtpl files (StarMade block templates)
 *
 * Format binaire (CopyArea.java) :
 *   byte    version     (VERSION = 6 current)
 *
 *   Version >= 6 (4-byte data par bloc) :
 *     int   minX, minY, minZ
 *     int   maxX, maxY, maxZ
 *     int   piecesSize
 *     [piecesSize × VoidSegmentPiece] :
 *       int   voidX, voidY, voidZ
 *       int   data    (SegmentData4Byte : bits 0-12=type, 13-19=hp, 20=active, 21-25=orient)
 *     int   connectionsSize
 *       long key + int lSize + lSize×long
 *     int   textSize
 *       long key + UTF  text
 *     int   filterSize
 *       long key + int lSize + lSize×(short+int)
 *     int   prodSize
 *       long key + short value
 *     int   prodLimitSize
 *       long key + int value
 *     int   fillUpFilterSize
 *       long key + int lSize + lSize×(short+int)
 *
 *   Versions <= 5 (3-byte data par bloc) :
 *     min/max puis piecesSize×(3×int voidPos + 3×byte data)
 *     followed by the same connections/text/filter/prod sections
 *
 * Java source: CopyArea.java, VoidSegmentPiece.java, SegmentPiece.java
 */

import { BufferReader } from '../core/BufferReader.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemplatePiece {
  x: number; y: number; z: number;
  type: number;
  hp: number;
  active: boolean;
  orientation: number;
}

export interface TemplateConnection {
  from: bigint;
  targets: bigint[];
}

export interface SmtplFile {
  version: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** Copied area dimensions */
  sizeX: number; sizeY: number; sizeZ: number;
  pieces: TemplatePiece[];
  connections: TemplateConnection[];
  /** Texts associated with positions (panels, etc.) */
  texts: Map<bigint, string>;
  totalBlocks: number;
}

// ── Parser principal ──────────────────────────────────────────────────────────

export function parseSmtpl(data: Buffer | Uint8Array): SmtplFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const version = r.readInt8();

  let minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0;
  const pieces: TemplatePiece[] = [];
  const connections: TemplateConnection[] = [];
  const texts = new Map<bigint, string>();

  if (version >= 6) {
    // Current 4-byte format
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const data4 = r.readInt32BE();
      pieces.push(_decode4BytePiece(vx, vy, vz, data4));
    }

    _readConnections(r, connections);
    _readTexts(r, texts);
    _readFilters(r);       // filterSize + entries
    _readProdMap(r);       // prodSize + entries (long→short)
    _readProdLimitMap(r);  // prodLimitSize + entries (long→int)
    _readFilters(r);       // fillUpFilterSize + entries

  } else if (version >= 4) {
    // Format 3-byte pieces, same structure
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const b0 = r.readInt8(), b1 = r.readInt8(), b2 = r.readInt8();
      pieces.push(_decode3BytePiece(vx, vy, vz, b0, b1, b2));
    }

    _readConnections(r, connections);
    _readTexts(r, texts);
    _readFilters(r);
    _readProdMap(r);

  } else {
    // Very old versions (1-3) — same structure 3-byte but without prod/filter
    minX = r.readInt32BE(); minY = r.readInt32BE(); minZ = r.readInt32BE();
    maxX = r.readInt32BE(); maxY = r.readInt32BE(); maxZ = r.readInt32BE();

    const piecesSize = r.readInt32BE();
    for (let i = 0; i < piecesSize; i++) {
      const vx = r.readInt32BE(), vy = r.readInt32BE(), vz = r.readInt32BE();
      const b0 = r.readInt8(), b1 = r.readInt8(), b2 = r.readInt8();
      pieces.push(_decode3BytePiece(vx, vy, vz, b0, b1, b2));
    }

    if (!r.isEOF()) _readConnections(r, connections);
    if (!r.isEOF()) _readTexts(r, texts);
  }

  return {
    version,
    minX, minY, minZ, maxX, maxY, maxZ,
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
    pieces,
    connections,
    texts,
    totalBlocks: pieces.length,
  };
}

// ── Block decoding ─────────────────────────────────────────────────────────────

function _decode4BytePiece(x: number, y: number, z: number, data: number): TemplatePiece {
  return {
    x, y, z,
    type:        data & 0x1FFF,
    hp:          (data >> 13) & 0x7F,
    active:      ((data >> 20) & 0x1) === 1,
    orientation: (data >> 21) & 0x1F,
  };
}

function _decode3BytePiece(x: number, y: number, z: number, b0: number, b1: number, b2: number): TemplatePiece {
  const u0 = b0 & 0xff, u1 = b1 & 0xff, u2 = b2 & 0xff;
  const type        = u2 + ((u1 & 0x07) * 256);
  const hp          = ((u1 & 0xf8) >> 3) | ((u0 & 0x03) << 5);
  const active      = (u0 & 0x08) === 0;
  const orientation = (u0 >> 4) & 0x0f;
  return { x, y, z, type, hp, active, orientation };
}

// ── Sections communes ─────────────────────────────────────────────────────────

function _readConnections(r: BufferReader, out: TemplateConnection[]): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    const key   = r.readInt64BE();
    const lSize = r.readInt32BE();
    const targets: bigint[] = [];
    for (let j = 0; j < lSize; j++) targets.push(r.readInt64BE());
    out.push({ from: key, targets });
  }
}

function _readTexts(r: BufferReader, out: Map<bigint, string>): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    const key  = r.readInt64BE();
    const text = r.readJavaUTF();
    out.set(key, text);
  }
}

function _readFilters(r: BufferReader): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    r.readInt64BE(); // key
    const lSize = r.readInt32BE();
    for (let j = 0; j < lSize; j++) {
      r.readInt16BE(); // short type
      r.readInt32BE(); // int count
    }
  }
}

function _readProdMap(r: BufferReader): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    r.readInt64BE();  // key
    r.readInt16BE();  // short value
  }
}

function _readProdLimitMap(r: BufferReader): void {
  if (r.isEOF()) return;
  const size = r.readInt32BE();
  for (let i = 0; i < size; i++) {
    r.readInt64BE();  // key
    r.readInt32BE();  // int value
  }
}
