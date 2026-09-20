/**
 * @fileoverview SectorItemsObject business object
 *
 * High-level wrapper around SECTORS_ITEMS.ITEMS (VARBINARY ~5 KB).
 *
 * Models the free-floating item collection in a sector, matching
 * the FreeItem / Sector.loadItems pattern from Java.
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { decodeSectorItems, encodeSectorItems, MAX_ITEMS_PER_SECTOR, FREE_ITEM_BYTE_SIZE, type FreeItem } from './SectorItems.js';

export { type FreeItem };

/**
 * Represents the SectorItemsObject model used by StarMade database object parsing.
 */
export class SectorItemsObject {
  readonly #items: FreeItem[];
  /** Detached item records, preserving all persisted fields. */
  get items(): ReadonlyArray<FreeItem> { return this.#items.map(item => ({ ...item })); }

  /**
   * Creates a SectorItemsObject instance.
   *
   * @param items - Input value for the constructor operation.
   */
  private constructor(items: FreeItem[]) {
    const bytes = encodeSectorItems(items);
    for (const [index, item] of items.entries()) {
      for (const value of [item.posX, item.posY, item.posZ]) {
        if (typeof value !== 'number' || (Number.isFinite(value) && !Number.isFinite(Math.fround(value)))) {
          throw new RangeError('Item position must contain numbers representable as float32');
        }
      }
      if (bytes.subarray(index * FREE_ITEM_BYTE_SIZE, (index + 1) * FREE_ITEM_BYTE_SIZE).every(byte => byte === 0)) {
        throw new RangeError('An entirely zero item record is reserved for padding');
      }
    }
    this.#items = items.map(item => ({ ...item }));
    Object.freeze(this);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes SECTORS_ITEMS.ITEMS bytes.
   * Returns an empty instance for null/empty input.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined): SectorItemsObject {
    return new SectorItemsObject(decodeSectorItems(data));
  }

  /** Creates an empty SectorItemsObject. */
  static empty(): SectorItemsObject {
    return new SectorItemsObject([]);
  }

  /** Creates from an explicit list of items. */
  static from(items: FreeItem[]): SectorItemsObject {
    return new SectorItemsObject(items);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /**
   * Returns the number of values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get size(): number { return this.#items.length; }

  /**
   * Reports whether isEmpty is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isEmpty(): boolean { return this.#items.length === 0; }

  /** All items of a given block type. */
  byType(blockType: number): FreeItem[] {
    return this.#items.filter(i => i.blockType === blockType).map(item => ({ ...item }));
  }

  /** Total count of a given block type across all stacks. */
  totalCount(blockType: number): number {
    return this.byType(blockType).reduce((s, i) => s + i.count, 0);
  }

  /** All distinct block types present. */
  get types(): number[] {
    return [...new Set(this.#items.map(i => i.blockType))];
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Adds a new item stack. Respects MAX_ITEMS_PER_SECTOR limit.
   */
  withItem(item: FreeItem): SectorItemsObject {
    if (this.#items.length >= MAX_ITEMS_PER_SECTOR) {
      throw new RangeError(`Sector item limit reached (${MAX_ITEMS_PER_SECTOR})`);
    }
    return new SectorItemsObject([...this.#items, item]);
  }

  /**
   * Removes all items of a given block type.
   */
  withoutType(blockType: number): SectorItemsObject {
    return new SectorItemsObject(this.#items.filter(i => i.blockType !== blockType));
  }

  /**
   * Replaces all items of a given block type with a single merged stack
   * at position (0, 0, 0), keeping their shared metadata ID.
   * Rejects different metadata IDs or a total outside the signed 32-bit format.
   */
  withMerged(blockType: number): SectorItemsObject {
    const total = this.totalCount(blockType);
    if (total === 0) return this;
    const matches = this.byType(blockType);
    const metaId = matches[0].metaId;
    if (matches.some(item => item.metaId !== metaId)) throw new RangeError('Cannot merge different item metadata IDs');
    const rest = this.#items.filter(i => i.blockType !== blockType);
    const merged: FreeItem = { blockType, count: total, posX: 0, posY: 0, posZ: 0, metaId };
    return new SectorItemsObject([...rest, merged]);
  }

  /** Removes all items. */
  cleared(): SectorItemsObject {
    return new SectorItemsObject([]);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Encodes to VARBINARY bytes for SECTORS_ITEMS.ITEMS. */
  toBytes(): Buffer {
    return encodeSectorItems([...this.#items]);
  }

  /** Detached JSON projection; nonfinite IEEE-754 coordinates remain explicit strings. */
  toJSON(): { items: unknown[] } {
    return { items: JSON.parse(JSON.stringify(this.#items, (_key, value: unknown) =>
      typeof value === 'number' && !Number.isFinite(value) ? String(value) : value)) as unknown[] };
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    if (this.isEmpty) return 'SectorItems(empty)';
    const summary = this.types.map(t => `type${t}×${this.totalCount(t)}`).join(', ');
    return `SectorItems(${this.#items.length} stacks: ${summary})`;
  }
}
