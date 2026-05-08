/**
 * @fileoverview Inventory
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Inventory — inventory of a StarMade entity.
 *
 * Port of Inventory.fromTagStructure() Java.
 *
 * Structure Tag (version >= 1) :
 *   STRUCT [
 *     [0] STRUCT slots   [STRUCT [INT slot, FINISH]...]
 *     [1] STRUCT types   [STRUCT [SHORT type, FINISH]...]
 *     [2] STRUCT values  [STRUCT [INT count, FINISH]... or STRUCT metadata...]
 *     FINISH
 *   ]
 *
 * Chaque ItemStack :
 *   - slot  : int (index de slot)
 *   - type  : short (block type ID)
 *   - count : int (quantity)
 *   - meta  : optionnel (ID, type, orientation, subId)
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';

// ── ItemStack ─────────────────────────────────────────────────────────────────

export interface ItemMeta {
  id: number;
  type: number;
  orientation: number;
  subId: number;
}

export class ItemStack {
  constructor(
    readonly slot: number,
    /** Block type ID */
    readonly type: number,
    /** Quantity */
    readonly count: number,
    /** Optional metadata (orientation, subtype...) */
    readonly meta?: ItemMeta,
  ) {}

  withCount(count: number): ItemStack {
    return new ItemStack(this.slot, this.type, count, this.meta);
  }

  withType(type: number): ItemStack {
    return new ItemStack(this.slot, type, this.count, this.meta);
  }

  toString(): string {
    return `ItemStack(slot=${this.slot}, type=${this.type}, count=${this.count}${this.meta ? ', meta='+JSON.stringify(this.meta) : ''})`;
  }
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export class Inventory {
  /** Map<slot, ItemStack> */
  private readonly _slots: Map<number, ItemStack>;

  readonly maxSlots: number;

  constructor(slots: Map<number, ItemStack>, maxSlots = 36) {
    this._slots   = slots;
    this.maxSlots = maxSlots;
  }

  static EMPTY = new Inventory(new Map());

  static fromTag(tag: Tag): Inventory {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);

    const readList = (t: Tag | undefined): Tag[] => {
      if (!t || t.type !== TagType.STRUCT) return [];
      return t.getStruct().filter(c => c.type !== TagType.FINISH);
    };

    const slotTags  = readList(s[0]);
    const typeTags  = readList(s[1]);
    const valueTags = readList(s[2]);

    const slots = new Map<number, ItemStack>();

    for (let i = 0; i < slotTags.length; i++) {
      const slotTag = slotTags[i];
      const typeTag = typeTags[i];
      const valTag  = valueTags[i];

      if (!slotTag || !typeTag || !valTag) continue;

      // slot can be INT direct value or STRUCT [INT]
      const slot = slotTag.type === TagType.INT ? slotTag.getInt()
        : (slotTag.type === TagType.STRUCT ? slotTag.getStruct().filter(t=>t.type!==TagType.FINISH)[0]?.getInt() ?? -1 : -1);
      if (slot < 0) continue;

      // type can be SHORT direct value or STRUCT [SHORT]
      const blockType = typeTag.type === TagType.SHORT ? typeTag.getShort()
        : (typeTag.type === TagType.STRUCT ? typeTag.getStruct().filter(t=>t.type!==TagType.FINISH)[0]?.getShort() ?? 0 : 0);

      // count can be a direct INT, STRUCT [INT], or STRUCT complex metadata
      if (valTag.type === TagType.INT) {
        slots.set(slot, new ItemStack(slot, blockType, valTag.getInt()));
        continue;
      }

      if (valTag.type === TagType.STRUCT) {
        const ms = valTag.getStruct().filter(t => t.type !== TagType.FINISH);
        // Simple wrap [INT]
        if (ms.length === 1 && ms[0]?.type === TagType.INT) {
          slots.set(slot, new ItemStack(slot, blockType, ms[0].getInt()));
          continue;
        }
        // Meta struct : [id INT, type SHORT, count INT, subId SHORT]
        if (ms.length >= 2 && ms[0]?.type === TagType.INT) {
          const id    = ms[0].getInt();
          const mType = ms[1]?.type === TagType.SHORT ? ms[1].getShort() : 0;
          const count = ms[2]?.type === TagType.INT   ? ms[2].getInt()   : 1;
          const subId = ms[3]?.type === TagType.SHORT ? ms[3].getShort() : 0;
          slots.set(slot, new ItemStack(slot, blockType, count, { id, type: mType, orientation: 0, subId }));
          continue;
        }
      }

      // Fallback
      slots.set(slot, new ItemStack(slot, blockType, 1));
    }

    return new Inventory(slots);
  }

  toTag(): Tag {
    const items = [...this._slots.values()].sort((a, b) => a.slot - b.slot);

    // Each list is a STRUCT containing direct Tags (INT/SHORT/INT|STRUCT)
    const slotTags: Tag[]  = [...items.map(i => Tags.int(null, i.slot)),   FINISH_TAG];
    const typeTags: Tag[]  = [...items.map(i => Tags.short(null, i.type)), FINISH_TAG];

    const valueTags: Tag[] = items.map(i => {
      if (i.meta) {
        return Tags.struct(null, [
          Tags.int(null, i.meta.id),
          Tags.short(null, i.meta.type),
          Tags.int(null, i.count),
          Tags.short(null, i.meta.subId),
        ]);
      }
      return Tags.int(null, i.count);
    });
    valueTags.push(FINISH_TAG);

    return Tags.struct(null, [
      new Tag(TagType.STRUCT, null, slotTags),
      new Tag(TagType.STRUCT, null, typeTags),
      new Tag(TagType.STRUCT, null, valueTags),
    ]);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  get(slot: number): ItemStack | undefined  { return this._slots.get(slot); }
  has(slot: number): boolean                { return this._slots.has(slot); }
  get items(): ItemStack[]                   { return [...this._slots.values()]; }
  get size(): number                         { return this._slots.size; }
  get isFull(): boolean                      { return this._slots.size >= this.maxSlots; }

  /** All items of a given block type. */
  byType(type: number): ItemStack[] {
    return [...this._slots.values()].filter(i => i.type === type);
  }

  /** Total for one block type. */
  countOf(type: number): number {
    return this.byType(type).reduce((s, i) => s + i.count, 0);
  }

  // ── Immutable updates ──────────────────────────────────────────────

  set(item: ItemStack): Inventory {
    const m = new Map(this._slots);
    m.set(item.slot, item);
    return new Inventory(m, this.maxSlots);
  }

  remove(slot: number): Inventory {
    const m = new Map(this._slots);
    m.delete(slot);
    return new Inventory(m, this.maxSlots);
  }

  clear(): Inventory { return new Inventory(new Map(), this.maxSlots); }

  toString(): string {
    return `Inventory(${this._slots.size}/${this.maxSlots} slots)`;
  }
}
