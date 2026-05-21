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

import { decodeSectorItems, encodeSectorItems, MAX_ITEMS_PER_SECTOR, type FreeItem } from './SectorItems.js';

export { type FreeItem };

/**
 * Represents the SectorItemsObject model used by StarMade database object parsing.
 */
export class SectorItemsObject {
  readonly items: ReadonlyArray<FreeItem>;

  /**
   * Creates a SectorItemsObject instance.
   *
   * @param items - Input value for the constructor operation.
   */
  private constructor(items: FreeItem[]) {
    this.items = Object.freeze([...items]);
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
  get size(): number { return this.items.length; }

  /**
   * Reports whether isEmpty is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isEmpty(): boolean { return this.items.length === 0; }

  /** All items of a given block type. */
  byType(blockType: number): FreeItem[] {
    return this.items.filter(i => i.blockType === blockType);
  }

  /** Total count of a given block type across all stacks. */
  totalCount(blockType: number): number {
    return this.byType(blockType).reduce((s, i) => s + i.count, 0);
  }

  /** All distinct block types present. */
  get types(): number[] {
    return [...new Set(this.items.map(i => i.blockType))];
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Adds a new item stack. Respects MAX_ITEMS_PER_SECTOR limit.
   */
  withItem(item: FreeItem): SectorItemsObject {
    if (this.items.length >= MAX_ITEMS_PER_SECTOR) {
      throw new RangeError(`Sector item limit reached (${MAX_ITEMS_PER_SECTOR})`);
    }
    return new SectorItemsObject([...this.items, item]);
  }

  /**
   * Removes all items of a given block type.
   */
  withoutType(blockType: number): SectorItemsObject {
    return new SectorItemsObject(this.items.filter(i => i.blockType !== blockType));
  }

  /**
   * Replaces all items of a given block type with a single merged stack
   * at position (0, 0, 0). Useful for cleanup / normalization.
   */
  withMerged(blockType: number): SectorItemsObject {
    const total = this.totalCount(blockType);
    if (total === 0) return this;
    const rest = this.items.filter(i => i.blockType !== blockType);
    const merged: FreeItem = { blockType, count: total, posX: 0, posY: 0, posZ: 0, metaId: -1 };
    return new SectorItemsObject([...rest, merged]);
  }

  /** Removes all items. */
  cleared(): SectorItemsObject {
    return new SectorItemsObject([]);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Encodes to VARBINARY bytes for SECTORS_ITEMS.ITEMS. */
  toBytes(): Buffer {
    return encodeSectorItems([...this.items]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    if (this.isEmpty) return 'SectorItems(empty)';
    const summary = this.types.map(t => `type${t}×${this.totalCount(t)}`).join(', ');
    return `SectorItems(${this.items.length} stacks: ${summary})`;
  }
}
