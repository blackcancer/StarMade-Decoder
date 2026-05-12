/**
 * @fileoverview TradePricesObject business object
 *
 * High-level wrapper around TRADE_NODES.ITEMS (VARBINARY ~20 KB).
 *
 * Models the shop/station trade price list, matching the TradePrices /
 * TradePricePair pattern from Java.
 *
 * Convention (from Java):
 *   type < 0  →  buy order  (station buys from player; blockType = -type)
 *   type > 0  →  sell order (station sells to player;  blockType =  type)
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { decodeTradeNodeItems, encodeTradeNodeItems, type TradePriceEntry } from './TradeNodeItems.js';

export { type TradePriceEntry };

export class TradePricesObject {
  readonly entDbId: bigint;
  readonly entries: ReadonlyArray<TradePriceEntry>;

  private constructor(entDbId: bigint, entries: TradePriceEntry[]) {
    this.entDbId = entDbId;
    this.entries = Object.freeze([...entries]);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes TRADE_NODES.ITEMS bytes.
   * Returns null for null / empty / malformed input.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined): TradePricesObject | null {
    const raw = decodeTradeNodeItems(data);
    if (!raw) return null;
    return new TradePricesObject(raw.entDbId, raw.entries);
  }

  /** Creates an empty price list for the given entity. */
  static empty(entDbId: bigint): TradePricesObject {
    return new TradePricesObject(entDbId, []);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get size(): number { return this.entries.length; }

  get isEmpty(): boolean { return this.entries.length === 0; }

  /** All buy orders (station buys from player). */
  get buyOrders(): TradePriceEntry[] {
    return this.entries.filter(e => e.isBuyOrder);
  }

  /** All sell orders (station sells to player). */
  get sellOrders(): TradePriceEntry[] {
    return this.entries.filter(e => !e.isBuyOrder);
  }

  /** Finds the buy order for a given block type, if any. */
  getBuyOrder(blockType: number): TradePriceEntry | undefined {
    return this.entries.find(e => e.isBuyOrder && e.blockType === blockType);
  }

  /** Finds the sell order for a given block type, if any. */
  getSellOrder(blockType: number): TradePriceEntry | undefined {
    return this.entries.find(e => !e.isBuyOrder && e.blockType === blockType);
  }

  /** All distinct block types with at least one entry. */
  get blockTypes(): number[] {
    return [...new Set(this.entries.map(e => e.blockType))];
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Adds or replaces a buy order (station buys blockType from player).
   * type stored as -blockType per Java convention.
   */
  withBuyOrder(blockType: number, amount: number, price: number, limit = -1): TradePricesObject {
    const rest = this.entries.filter(e => !(e.isBuyOrder && e.blockType === blockType));
    const entry: TradePriceEntry = { type: -blockType, isBuyOrder: true, blockType, amount, price, limit };
    return new TradePricesObject(this.entDbId, [...rest, entry]);
  }

  /**
   * Adds or replaces a sell order (station sells blockType to player).
   * type stored as +blockType per Java convention.
   */
  withSellOrder(blockType: number, amount: number, price: number, limit = -1): TradePricesObject {
    const rest = this.entries.filter(e => !(!e.isBuyOrder && e.blockType === blockType));
    const entry: TradePriceEntry = { type: blockType, isBuyOrder: false, blockType, amount, price, limit };
    return new TradePricesObject(this.entDbId, [...rest, entry]);
  }

  /** Removes all entries for a given block type (both buy and sell). */
  withoutBlock(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => e.blockType !== blockType));
  }

  /** Removes the buy order for a given block type. */
  withoutBuyOrder(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => !(e.isBuyOrder && e.blockType === blockType)));
  }

  /** Removes the sell order for a given block type. */
  withoutSellOrder(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => !(!e.isBuyOrder && e.blockType === blockType)));
  }

  /** Changes the entity DB ID (e.g. after entity relocation). */
  withEntDbId(id: bigint): TradePricesObject {
    return new TradePricesObject(id, [...this.entries]);
  }

  /** Removes all entries. */
  cleared(): TradePricesObject {
    return new TradePricesObject(this.entDbId, []);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Encodes to VARBINARY bytes for TRADE_NODES.ITEMS. */
  toBytes(): Buffer {
    return encodeTradeNodeItems({ entDbId: this.entDbId, entries: [...this.entries] });
  }

  toString(): string {
    return `TradePrices(entity=${this.entDbId}, buy=${this.buyOrders.length}, sell=${this.sellOrders.length})`;
  }
}
