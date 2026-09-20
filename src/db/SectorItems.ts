/**
 * @fileoverview Sector Items DB — SECTORS_ITEMS.ITEMS decoder/encoder
 *
 * Covers the VARBINARY column of the SECTORS_ITEMS table in the StarMade HSQLDB.
 *
 * SECTORS_ITEMS.ITEMS (VARBINARY ~5 KB)
 *   Written by SectorItemTable.getItemBinaryString() via DataOutputStream.
 *   Each FreeItem entry is exactly 22 bytes (big-endian):
 *     short  blockType  (2)
 *     int    count      (4)
 *     float  posX       (4)  — local position in sector
 *     float  posY       (4)
 *     float  posZ       (4)
 *     int    metaId     (4)
 *   Total: 2 + 4 + 4 + 4 + 4 + 4 = 22 bytes per item.
 *
 * Note: Sector.itemDataSize = 22 (confirmed from SectorItemTable usage).
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { DecodeError } from '../core/DecodeError.js';
import { readDatabase, readZeroPadding } from './DatabaseValidation.js';
import { BufferWriter } from '../core/BufferWriter.js';

/** Byte size of a single FreeItem entry on disk. */
export const FREE_ITEM_BYTE_SIZE = 22;

/** Maximum items per sector (itemArraySize / itemDataSize). */
export const MAX_ITEMS_PER_SECTOR = Math.floor((22 * 1024) / FREE_ITEM_BYTE_SIZE);

/**
 * Describes the FreeItem data shape used by StarMade database object parsing.
 */
export interface FreeItem {
  /** Block type ID (short; signed negative = buy order in shop context). */
  blockType: number;
  /** Stack count. */
  count: number;
  /** Local sector X position (float). */
  posX: number;
  /** Local sector Y position (float). */
  posY: number;
  /** Local sector Z position (float). */
  posZ: number;
  /** Meta ID (used for variant / color / etc.). -1 = none. */
  metaId: number;
}

/**
 * Decodes `SECTORS_ITEMS.ITEMS` (VARBINARY).
 *
 * Returns an empty array for null/empty input.
 * Entirely zero records and trailing zero-byte padding are ignored.
 * Other records, including type zero with metadata or signed-zero floats, are preserved.
 */
export function decodeSectorItems(data: Buffer | Uint8Array | null | undefined): FreeItem[] {
  if (!data || data.length === 0) return [];
  return readDatabase(data, 'SECTORS_ITEMS.ITEMS', r => {
  const items: FreeItem[] = [];
  while (r.remaining() >= FREE_ITEM_BYTE_SIZE) {
    const start = r.offset;
    const blockType = r.readInt16BE();
    const count = r.readInt32BE();
    const posX  = r.readFloat32BE();
    const posY  = r.readFloat32BE();
    const posZ  = r.readFloat32BE();
    const metaId = r.readInt32BE();
    // A gameplay view may ignore type zero; this codec preserves every meaningful byte.
    if (data.subarray(start, start + FREE_ITEM_BYTE_SIZE).every(byte => byte === 0)) continue;
    items.push({ blockType, count, posX, posY, posZ, metaId });
  }
  readZeroPadding(r);
  return items;
  });
}

/**
 * Encodes a list of FreeItems into VARBINARY bytes for `SECTORS_ITEMS.ITEMS`.
 *
 * Rejects values exceeding `MAX_ITEMS_PER_SECTOR` rather than truncating them.
 * Does NOT pad to the full column size — the DB driver handles that.
 */
export function encodeSectorItems(items: FreeItem[]): Buffer {
  if (items.length > MAX_ITEMS_PER_SECTOR) throw new DecodeError('E_LIMIT', 'Sector item capacity exceeded');
  const limited = items;
  const w = new BufferWriter(limited.length * FREE_ITEM_BYTE_SIZE);
  for (const item of limited) {
    w.writeInt16BE(item.blockType);
    w.writeInt32BE(item.count);
    w.writeFloat32BE(item.posX);
    w.writeFloat32BE(item.posY);
    w.writeFloat32BE(item.posZ);
    w.writeInt32BE(item.metaId);
  }
  return w.toBuffer();
}
