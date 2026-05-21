/**
 * @fileoverview Trade Node DB — TRADE_NODES.ITEMS decoder/encoder
 *
 * Covers the VARBINARY column of the TRADE_NODES table in the StarMade HSQLDB.
 *
 * TRADE_NODES.ITEMS (VARBINARY ~20 KB)
 *   Written by ShoppingAddOn.serializeTradePrices() via DataOutputStream.
 *
 * Wire format:
 *   int   uncompressedSize   — byte count of the inflated payload
 *   int   deflatedSize       — byte count of the zlib-deflated payload
 *   byte[deflatedSize]       — zlib DEFLATE (no gzip header) of the payload
 *
 * Payload (TradePrices.serialize, DataOutput big-endian):
 *   long  entDbId            — entity DB ID of the shop/station
 *   int   count              — number of price entries
 *   [count × TradePriceEntry]
 *
 * TradePriceEntry:
 *   short  type    — block type ID; negative = buy order, positive = sell order
 *   int    amount  — quantity available
 *   int    price   — price per unit (credits)
 *   int    limit   — trade limit (-1 = unlimited)
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import zlib from 'node:zlib';
import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';

/**
 * Describes the TradePriceEntry data shape used by StarMade database object parsing.
 */
export interface TradePriceEntry {
  /**
   * Block type ID.
   * Negative = buy order (station buys from player): abs(type) = block type.
   * Positive = sell order (station sells to player).
   */
  type: number;
  /** Whether this is a buy order (station buys from player). */
  isBuyOrder: boolean;
  /** Resolved (absolute) block type ID. */
  blockType: number;
  /** Available quantity. */
  amount: number;
  /** Price per unit in credits. */
  price: number;
  /** Trade limit (-1 = unlimited). */
  limit: number;
}

/**
 * Describes the TradePrices data shape used by StarMade database object parsing.
 */
export interface TradePrices {
  /** Entity DB ID of the shop/station owning this price list. */
  entDbId: bigint;
  /** Price entries (buy and sell orders). */
  entries: TradePriceEntry[];
}

/**
 * Decodes `TRADE_NODES.ITEMS` (VARBINARY).
 *
 * Returns null for null/empty input.
 * Throws on malformed zlib data.
 */
export function decodeTradeNodeItems(data: Buffer | Uint8Array | null | undefined): TradePrices | null {
  if (!data || data.length < 8) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const uncompressedSize = r.readInt32BE();
  const deflatedSize     = r.readInt32BE();
  const compressed       = Buffer.from(r.readBytes(deflatedSize));

  const payload = zlib.inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 64 });
  const pr = BufferReader.from(payload);

  const entDbId = pr.readInt64BE();
  const count   = pr.readInt32BE();
  const entries: TradePriceEntry[] = [];

  for (let i = 0; i < count; i++) {
    const type      = pr.readInt16BE();
    const amount    = pr.readInt32BE();
    const price     = pr.readInt32BE();
    const limit     = pr.readInt32BE();
    const isBuyOrder = type < 0;
    const blockType = isBuyOrder ? -type : type;
    entries.push({ type, isBuyOrder, blockType, amount, price, limit });
  }

  return { entDbId, entries };
}

/**
 * Encodes `TradePrices` back to VARBINARY bytes for `TRADE_NODES.ITEMS`.
 */
export function encodeTradeNodeItems(prices: TradePrices): Buffer {
  // Build payload
  const pw = new BufferWriter();
  pw.writeInt64BE(prices.entDbId);
  pw.writeInt32BE(prices.entries.length);
  for (const e of prices.entries) {
    pw.writeInt16BE(e.type);
    pw.writeInt32BE(e.amount);
    pw.writeInt32BE(e.price);
    pw.writeInt32BE(e.limit);
  }
  const payload = pw.toBuffer();

  // Compress with raw deflate (no gzip header), matching Java Deflater
  const compressed = zlib.deflateRawSync(payload);

  const w = new BufferWriter(8 + compressed.length);
  w.writeInt32BE(payload.length);
  w.writeInt32BE(compressed.length);
  w.writeBytes(compressed);
  return w.toBuffer();
}
