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

import { type DatabaseProfile } from './DatabaseProfile.js';

import { decodeTradeNodeItems, encodeTradeNodeItems, type TradePriceEntry } from './TradeNodeItems.js';

export { type TradePriceEntry };

/**
 * Represents the TradePricesObject model used by StarMade database object parsing.
 */
export class TradePricesObject {
  /** Explicit compression contract retained across edits. */
  readonly profile: DatabaseProfile;
  readonly entDbId: bigint;
  readonly #entries: TradePriceEntry[];
  /** Detached price entries; editing a snapshot does not edit the price list. */
  get entries(): ReadonlyArray<TradePriceEntry> { return this.#entries.map(entry => ({ ...entry })); }

  /**
   * Creates a TradePricesObject instance.
   *
   * @param entDbId - Input value for the constructor operation.
   * @param entries - Price entries. @param profile Explicit compression contract.
   */
  private constructor(entDbId: bigint, entries: TradePriceEntry[], profile: DatabaseProfile) {
    this.profile = profile;
    encodeTradeNodeItems({ entDbId, entries }, profile);
    this.entDbId = entDbId;
    this.#entries = entries.map(entry => ({ ...entry }));
    Object.freeze(this);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes TRADE_NODES.ITEMS using the selected compression profile (current by default).
   * Returns null for absent/empty input; malformed input throws.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined, profile: DatabaseProfile = 'current'): TradePricesObject | null {
    const raw = decodeTradeNodeItems(data, profile);
    if (!raw) return null;
    return new TradePricesObject(raw.entDbId, raw.entries, profile);
  }

  /** Creates an empty price list for the entity using the selected profile (current by default). */
  static empty(entDbId: bigint, profile: DatabaseProfile = 'current'): TradePricesObject {
    return new TradePricesObject(entDbId, [], profile);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /**
   * Returns the number of values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get size(): number { return this.#entries.length; }

  /**
   * Reports whether isEmpty is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isEmpty(): boolean { return this.#entries.length === 0; }

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
    return [...new Set(this.#entries.map(e => e.blockType))];
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Adds or replaces a buy order (station buys blockType from player).
   * type stored as -blockType per Java convention.
   */
  withBuyOrder(blockType: number, amount: number, price: number, limit = -1): TradePricesObject {
    if (!Number.isInteger(blockType) || blockType < 1 || blockType > 32768) throw new RangeError('Buy block type must be an integer in [1, 32768]');
    const rest = this.#entries.filter(e => !(e.isBuyOrder && e.blockType === blockType));
    const entry: TradePriceEntry = { type: -blockType, isBuyOrder: true, blockType, amount, price, limit };
    return new TradePricesObject(this.entDbId, [...rest, entry], this.profile);
  }

  /**
   * Adds or replaces a sell order (station sells blockType to player).
   * type stored as +blockType per Java convention.
   */
  withSellOrder(blockType: number, amount: number, price: number, limit = -1): TradePricesObject {
    if (!Number.isInteger(blockType) || blockType < 1 || blockType > 32767) throw new RangeError('Sell block type must be an integer in [1, 32767]');
    const rest = this.#entries.filter(e => !(!e.isBuyOrder && e.blockType === blockType));
    const entry: TradePriceEntry = { type: blockType, isBuyOrder: false, blockType, amount, price, limit };
    return new TradePricesObject(this.entDbId, [...rest, entry], this.profile);
  }

  /** Removes all entries for a given block type (both buy and sell). */
  withoutBlock(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => e.blockType !== blockType), this.profile);
  }

  /** Removes the buy order for a given block type. */
  withoutBuyOrder(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => !(e.isBuyOrder && e.blockType === blockType)), this.profile);
  }

  /** Removes the sell order for a given block type. */
  withoutSellOrder(blockType: number): TradePricesObject {
    return new TradePricesObject(this.entDbId, this.entries.filter(e => !(!e.isBuyOrder && e.blockType === blockType)), this.profile);
  }

  /** Changes the entity DB ID (e.g. after entity relocation). */
  withEntDbId(id: bigint): TradePricesObject {
    return new TradePricesObject(id, [...this.#entries], this.profile);
  }

  /** Removes all entries. */
  cleared(): TradePricesObject {
    return new TradePricesObject(this.entDbId, [], this.profile);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Encodes to VARBINARY bytes for TRADE_NODES.ITEMS. */
  toBytes(): Buffer {
    return encodeTradeNodeItems({ entDbId: this.entDbId, entries: [...this.#entries] }, this.profile);
  }

  /** JSON projection preserving the exact signed 64-bit entity ID as decimal text. */
  toJSON(): { entDbId: string; entries: ReadonlyArray<TradePriceEntry> } {
    return { entDbId: this.entDbId.toString(), entries: this.entries };
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `TradePrices(entity=${this.entDbId}, buy=${this.buyOrders.length}, sell=${this.sellOrders.length})`;
  }
}
