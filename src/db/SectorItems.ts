/**
 * @fileoverview Sector Items DB — SECTORS_ITEMS.ITEMS decoder/encoder
 *
 * Covers the VARBINARY column of the SECTORS_ITEMS table in the StarMade HSQLDB.
 *
 * SECTORS_ITEMS.ITEMS (VARBINARY ~5 KB)
 *   Written by SectorItemTable.getItemBinaryString() via DataOutputStream.
 *   Each FreeItem entry is exactly 14 bytes (big-endian):
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

import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';

/** Byte size of a single FreeItem entry on disk. */
export const FREE_ITEM_BYTE_SIZE = 22;

/** Maximum items per sector (itemArraySize / itemDataSize). */
export const MAX_ITEMS_PER_SECTOR = Math.floor((22 * 1024) / FREE_ITEM_BYTE_SIZE);

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
 * Trailing zero-bytes (padding) are ignored.
 */
export function decodeSectorItems(data: Buffer | Uint8Array | null | undefined): FreeItem[] {
  if (!data || data.length === 0) return [];
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const items: FreeItem[] = [];
  const r = BufferReader.from(buf);
  while (r.remaining() >= FREE_ITEM_BYTE_SIZE) {
    const blockType = r.readInt16BE();
    // Zero blockType with zero count = padding sentinel — skip
    const count = r.readInt32BE();
    const posX  = r.readFloat32BE();
    const posY  = r.readFloat32BE();
    const posZ  = r.readFloat32BE();
    const metaId = r.readInt32BE();
    if (blockType === 0 && count === 0) continue;
    items.push({ blockType, count, posX, posY, posZ, metaId });
  }
  return items;
}

/**
 * Encodes a list of FreeItems into VARBINARY bytes for `SECTORS_ITEMS.ITEMS`.
 *
 * Trims to `MAX_ITEMS_PER_SECTOR` entries if needed (matching Java behaviour).
 * Does NOT pad to the full column size — the DB driver handles that.
 */
export function encodeSectorItems(items: FreeItem[]): Buffer {
  const limited = items.slice(0, MAX_ITEMS_PER_SECTOR);
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
