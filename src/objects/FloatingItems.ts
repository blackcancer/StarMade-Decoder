/**
 * @fileoverview Floating Items
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * FloatingItems — business object for FLOATING_ITEMS_ARCHIVE.ent
 *
 * Structure :
 *   STRUCT [
 *     BYTE   version
 *     INT    declaredCount
 *     STRUCT "floatingItems" [
 *       STRUCT item [
 *         SHORT  blockType
 *         INT    count
 *         FINISH
 *       ]
 *       ...
 *       FINISH
 *     ]
 *     FINISH
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';

/**
 * Represents the FloatingItem model used by high-level StarMade object modelling.
 */
export class FloatingItem {
  /**
   * Creates a FloatingItem instance.
   *
   * @param blockType - Input value for the constructor operation.
   * @param count - Input value for the constructor operation.
   */
  constructor(
    public blockType: number,
    public count: number,
  ) {}

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): FloatingItem {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    return new FloatingItem(
      s[0]?.type === TagType.SHORT ? s[0].getShort() : 0,
      s[1]?.type === TagType.INT   ? s[1].getInt()   : 0,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [Tags.short(null, this.blockType), Tags.int(null, this.count)]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `FloatingItem(type=${this.blockType}, count=${this.count})`; }
}

/**
 * Represents the FloatingItemsArchive model used by high-level StarMade object modelling.
 */
export class FloatingItemsArchive {
  /**
   * Creates a FloatingItemsArchive instance.
   *
   * @param version - Input value for the constructor operation.
   * @param declaredCount - Input value for the constructor operation.
   * @param items - Input value for the constructor operation.
   * @param _rootName - Input value for the constructor operation.
   */
  constructor(
    public version: number,
    public declaredCount: number,
    public items: FloatingItem[],
    private _rootName: string | null = null,
  ) {}

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Handles the byType operation used by high-level StarMade object modelling.
   *
   * @param blockType - Input value for the byType operation.
   * @returns The computed StarMade-Decoder value.
   */
  byType(blockType: number): FloatingItem | undefined {
    return this.items.find(i => i.blockType === blockType);
  }

  /**
   * Converts this value to talCount.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get totalCount(): number { return this.items.reduce((s, i) => s + i.count, 0); }

  // ── Updates ──────────────────────────────────────────────────────────

  /**
   * Handles the addItem operation used by high-level StarMade object modelling.
   *
   * @param item - Input value for the addItem operation.
   * @returns The computed StarMade-Decoder value.
   */
  addItem(item: FloatingItem): FloatingItemsArchive {
    const existing = this.items.find(i => i.blockType === item.blockType);
    if (existing) {
      return new FloatingItemsArchive(this.version, this.declaredCount,
        this.items.map(i => i.blockType === item.blockType
          ? new FloatingItem(i.blockType, i.count + item.count) : i), this._rootName);
    }
    return new FloatingItemsArchive(this.version, this.declaredCount, [...this.items, item], this._rootName);
  }

  /**
   * Handles the removeItem operation used by high-level StarMade object modelling.
   *
   * @param blockType - Input value for the removeItem operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeItem(blockType: number): FloatingItemsArchive {
    return new FloatingItemsArchive(this.version, this.declaredCount,
      this.items.filter(i => i.blockType !== blockType), this._rootName);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): FloatingItemsArchive {
    if (root.type !== TagType.STRUCT) throw new TypeError('FloatingItemsArchive: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

    const version       = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    const declaredCount = s[1]?.type === TagType.INT  ? s[1].getInt()  : 0;
    const items: FloatingItem[] = [];

    const itemsStruct = s.find(t => t.name === 'floatingItems' && t.type === TagType.STRUCT);
    if (itemsStruct) {
      for (const item of itemsStruct.getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (item.type === TagType.STRUCT) {
          try { items.push(FloatingItem.fromTag(item)); } catch { /* skip */ }
        }
      }
    }

    return new FloatingItemsArchive(version, declaredCount, items, root.name);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const itemTags = [...this.items.map(i => i.toTag()), FINISH_TAG];
    return Tags.struct(this._rootName, [
      Tags.byte(null, this.version),
      Tags.int(null, this.declaredCount),
      new Tag(TagType.STRUCT, 'floatingItems', itemTags),
    ]);
  }

  /** Encodes to binary for FLOATING_ITEMS_ARCHIVE.ent. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array): FloatingItemsArchive {
    return FloatingItemsArchive.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `FloatingItemsArchive(v${this.version}, declared=${this.declaredCount}, actual=${this.items.length})`;
  }
}
