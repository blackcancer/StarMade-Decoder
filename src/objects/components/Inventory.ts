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
 * Real inv1 data contains LIST<INT> slots, LIST<SHORT> types and STRUCT values.
 * Stash/factory envelopes and opaque metadata survive edits. The obsolete SDK's
 * anonymous tuple encoding is available only through explicit legacy methods.
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { boundedInteger, DecodeError } from '../../core/DecodeError.js';
import { copyInventoryTag, readInventoryWire, writeInventoryWire } from './InventoryWire.js';
import { writeTo } from '../../core/TagParser.js';

// ── ItemStack ─────────────────────────────────────────────────────────────────

/**
 * Describes the ItemMeta data shape used by high-level entity component modelling.
 */
export interface ItemMeta {
  id: number;
  type: number;
  orientation: number;
  subId: number;
  /** Opaque metadata payload; its contents are not an item quantity. */
  payload?: Tag;
}

/** One multislot contains distinct regular types belonging to the same inventory group. */
export interface ItemGroup { name: string; items: { type: number; count: number }[]; }

/** Optional caller constraint; the file itself does not encode a universal inventory volume limit. */
export interface InventoryCapacity { maximum: number; volumeOf: (type: number) => number; }
/** Optional occupied-slot bound retained by every immutable edit after reading. */
export interface InventoryReadOptions { maxSlots?: number; }
/** JSON-safe item projection; opaque payloads contain complete encoded Tags, never truncated previews. */
export interface ItemStackJSON {
  slot: number; type: number; count: number;
  meta?: Omit<ItemMeta, 'payload'> & { payloadTagBase64?: string };
  group?: ItemGroup;
}

/**
 * Represents the ItemStack model used by high-level entity component modelling.
 */
export class ItemStack {
  private readonly _meta?: ItemMeta;
  private readonly _group?: ItemGroup;
  /**
   * Creates a ItemStack instance.
   *
   * @param slot - Input value for the constructor operation.
   * @param type - Input value for the constructor operation.
   * @param count - Input value for the constructor operation.
   * @param meta - Input value for the constructor operation.
   */
  constructor(
    readonly slot: number,
    /** Block type ID */
    readonly type: number,
    /** Quantity */
    readonly count: number,
    /** Optional metadata (orientation, subtype...) */
    meta?: ItemMeta,
    group?: ItemGroup,
  ) {
    boundedInteger(slot, 'inventory slot', 0x7fffffff);
    boundedInteger(count, 'item count', 0x7fffffff);
    if (!Number.isInteger(type) || type < -32768 || type > 32767) throw new DecodeError('E_RANGE', 'Item type must be a signed short');
    if (meta?.payload) {
      if (type >= 0 || type === -32768 || type !== meta.type || count !== 1) throw new DecodeError('E_FORMAT', 'A special metadata item has quantity one');
      boundedInteger(meta.id, 'metadata id', 0x7fffffff);
      if (!Number.isInteger(meta.subId) || meta.subId < -32768 || meta.subId > 32767) throw new DecodeError('E_RANGE', 'Metadata subtype must be a signed short');
    }
    if (group) {
      if (type !== -32768 || meta || typeof group.name !== 'string' || group.items.length === 0) throw new DecodeError('E_FORMAT', 'Invalid multislot container');
      const types = new Set<number>(); let total = 0;
      for (const item of group.items) {
        boundedInteger(item.type, 'multislot type', 32767); boundedInteger(item.count, 'multislot count', 0x7fffffff);
        if (!item.type || !item.count || types.has(item.type)) throw new DecodeError('E_FORMAT', 'Multislot members require unique positive types and counts');
        types.add(item.type); total = Math.min(0x7fffffff, total + item.count);
      }
      if (count !== total) throw new DecodeError('E_FORMAT', 'Multislot aggregate differs from its members');
    }
    this._meta = meta ? { ...meta, ...(meta.payload ? { payload: copyInventoryTag(meta.payload) } : {}) } : undefined;
    this._group = group ? structuredClone(group) : undefined;
    Object.defineProperty(this, '_meta', { enumerable: false });
    Object.defineProperty(this, '_group', { enumerable: false });
    Object.freeze(this);
  }

  /** Detached metadata, including its opaque payload, so callers cannot mutate a stored stack. */
  get meta(): ItemMeta | undefined {
    return this._meta ? { ...this._meta, ...(this._meta.payload ? { payload: copyInventoryTag(this._meta.payload) } : {}) } : undefined;
  }
  /** Detached multislot membership; the containing slot's count is not one constituent's count. */
  get group(): ItemGroup | undefined { return this._group ? structuredClone(this._group) : undefined; }
  /** Moves the same complete stack to another slot without sharing mutable metadata. */
  withSlot(slot: number): ItemStack { return new ItemStack(slot, this.type, this.count, this.meta, this.group); }
  /** Creates one metadata object without inventing an orientation or treating payload bytes as quantity. */
  static special(slot: number, meta: Omit<ItemMeta, 'orientation'> & { payload: Tag }): ItemStack {
    return new ItemStack(slot, meta.type, 1, { ...meta, orientation: 0 });
  }
  /** Creates a grouped slot; one remaining member becomes a regular stack as in the game format. */
  static grouped(slot: number, name: string, items: ItemGroup['items']): ItemStack {
    const stack = new ItemStack(slot, -32768, items.reduce((sum, item) => Math.min(0x7fffffff, sum + item.count), 0), undefined, { name, items });
    return items.length === 1 ? new ItemStack(slot, items[0].type, items[0].count) : stack;
  }
  /** Detached JSON projection; opaque Tags are represented as exact base64 binary envelopes. */
  toJSON(): ItemStackJSON {
    const meta = this.meta, group = this.group;
    return { slot: this.slot, type: this.type, count: this.count,
      ...(meta ? { meta: { id: meta.id, type: meta.type, orientation: meta.orientation, subId: meta.subId,
        ...(meta.payload ? { payloadTagBase64: writeTo(meta.payload).toString('base64') } : {}) } } : {}),
      ...(group ? { group } : {}) };
  }

  /**
   * Returns a copy updated with Count.
   *
   * @param count - Input value for the withCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCount(count: number): ItemStack {
    if (this._group && count !== this.count) throw new DecodeError('E_FORMAT', 'Edit multislot members instead of its aggregate count');
    return new ItemStack(this.slot, this.type, count, this.meta, this.group);
  }

  /**
   * Returns a copy updated with Type.
   *
   * @param type - Input value for the withType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withType(type: number): ItemStack {
    if (this._group && type !== this.type) throw new DecodeError('E_FORMAT', 'Edit multislot members instead of its container type');
    return new ItemStack(this.slot, type, this.count, this.meta, this.group);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `ItemStack(slot=${this.slot}, type=${this.type}, count=${this.count}${this._meta ? ', meta='+JSON.stringify({ id: this._meta.id, type: this._meta.type, subId: this._meta.subId }) : ''})`;
  }
}

// ── Inventory ─────────────────────────────────────────────────────────────────

/**
 * Represents the Inventory model used by high-level entity component modelling.
 */
export class Inventory {
  /** Map<slot, ItemStack> */
  private readonly _slots: Map<number, ItemStack>;

  readonly maxSlots: number;

  /**
   * Creates a Inventory instance.
   *
   * @param slots - Input value for the constructor operation.
   * @param maxSlots - Input value for the constructor operation.
   */
  constructor(slots: ReadonlyMap<number, ItemStack>, maxSlots = Infinity, private readonly template?: Buffer) {
    if (maxSlots !== Infinity) boundedInteger(maxSlots, 'maxSlots', 0x7fffffff);
    if (slots.size > maxSlots) throw new DecodeError('E_LIMIT', 'Inventory exceeds the explicit slot policy');
    this._slots   = new Map(slots);
    for (const [slot, item] of this._slots) if (slot !== item.slot) throw new DecodeError('E_FORMAT', 'Inventory map key differs from the item slot');
    this.maxSlots = maxSlots;
    this.template = template ? Buffer.from(template) : undefined;
    Object.defineProperty(this, 'template', { enumerable: false });
  }

  static EMPTY = new Inventory(new Map());

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag, options: InventoryReadOptions = {}): Inventory {
    const wire = readInventoryWire(tag, options.maxSlots);
    if (wire) return new Inventory(new Map(wire.items.map(item => [item.slot,
      new ItemStack(item.slot, item.type, item.count, item.meta, item.group)])), options.maxSlots, wire.template);
    throw new DecodeError('E_UNSUPPORTED', 'Unrecognized inventory format; old SDK tuples require fromLegacyTag');
  }

  /** Explicit compatibility reader for anonymous old-SDK tuples, including their historical lossy fallbacks. */
  static fromLegacyTag(tag: Tag): Inventory {
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

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return writeInventoryWire(this.items, this.template);
  }

  /** Explicit obsolete SDK tuple writer; this representation is not a current game inventory. */
  toLegacyTag(): Tag {
    const items = [...this._slots.values()].sort((a, b) => a.slot - b.slot);
    if (items.some(item => item.group || item.meta?.payload)) throw new DecodeError('E_UNSUPPORTED', 'Legacy inventory tuples cannot represent grouped or opaque metadata items');

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

  /**
   * Returns the requested value.
   *
   * @param slot - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(slot: number): ItemStack | undefined  { return this._slots.get(slot); }
  /**
   * Reports whether has is true for the current value.
   *
   * @param slot - Input value for the has operation.
   * @returns The computed StarMade-Decoder value.
   */
  has(slot: number): boolean                { return this._slots.has(slot); }
  /**
   * Handles the items operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get items(): ItemStack[]                   { return [...this._slots.values()]; }
  /**
   * Returns the number of values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get size(): number                         { return this._slots.size; }
  /**
   * Reports whether the caller's occupied-slot limit has been reached; no game capacity is inferred.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isFull(): boolean                      { return this._slots.size >= this.maxSlots; }

  /** All items of a given block type. */
  byType(type: number): ItemStack[] {
    return [...this._slots.values()].filter(i => i.type === type || i.group?.items.some(item => item.type === type));
  }

  /** Total for one block type. */
  countOf(type: number): number {
    const result = this.byType(type).reduce((s, i) => s + (i.group && i.type !== type ? i.group.items.find(item => item.type === type)!.count : i.count), 0);
    return boundedInteger(result, 'aggregate item count');
  }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Stores the requested value.
   *
   * @param item - Input value for the set operation.
   * @returns The computed StarMade-Decoder value.
   */
  set(item: ItemStack): Inventory {
    if (item.count === 0) return this.remove(item.slot);
    const m = new Map(this._slots);
    m.set(item.slot, item);
    return new Inventory(m, this.maxSlots, this.template);
  }

  /**
   * Handles the remove operation used by high-level entity component modelling.
   *
   * @param slot - Input value for the remove operation.
   * @returns The computed StarMade-Decoder value.
   */
  remove(slot: number): Inventory {
    const m = new Map(this._slots);
    m.delete(slot);
    return new Inventory(m, this.maxSlots, this.template);
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): Inventory { return new Inventory(new Map(), this.maxSlots, this.template); }

  /** Replaces only item contents while retaining this inventory's stash/factory metadata envelope. */
  withContents(inventory: Inventory): Inventory {
    return new Inventory(new Map(inventory.items.map(item => [item.slot, item])), this.maxSlots, this.template);
  }

  /** Adds regular items into a compatible stack or the first unused slot, without overflow. */
  add(type: number, count: number, slot?: number): Inventory {
    boundedInteger(type, 'item type', 32767); boundedInteger(count, 'item count', 0x7fffffff);
    if (!type || !count) throw new DecodeError('E_RANGE', 'Adding items requires a positive type and quantity');
    if (slot === undefined) {
      slot = this.items.find(item => item.type === type && !item.meta && !item.group && item.count <= 0x7fffffff - count)?.slot;
      if (slot === undefined) { slot = 0; while (this.has(slot)) slot++; }
    }
    const existing = this.get(slot);
    if (existing && (existing.type !== type || existing.meta || existing.group)) throw new DecodeError('E_FORMAT', 'Destination slot contains incompatible items');
    return this.set(new ItemStack(slot, type, (existing?.count ?? 0) + count));
  }

  /** Splits a regular stack into an unused slot; failure leaves the original inventory unchanged. */
  split(sourceSlot: number, destinationSlot: number, count: number): Inventory {
    const source = this.requireItem(sourceSlot);
    if (this.has(destinationSlot) || source.meta || source.group) throw new DecodeError('E_FORMAT', 'Split needs a regular stack and an empty destination');
    Inventory.checkAmount(count, source.count);
    const result = count === source.count ? this.remove(sourceSlot) : this.set(source.withCount(source.count - count));
    return result.set(new ItemStack(destinationSlot, source.type, count));
  }

  /** Merges two regular stacks of the same type with signed-int overflow checks. */
  merge(sourceSlot: number, destinationSlot: number): Inventory {
    const source = this.requireItem(sourceSlot), destination = this.requireItem(destinationSlot);
    if (sourceSlot === destinationSlot || source.type !== destination.type || source.meta || destination.meta || source.group || destination.group) {
      throw new DecodeError('E_FORMAT', 'Merge requires distinct compatible regular stacks');
    }
    return this.remove(sourceSlot).set(destination.withCount(source.count + destination.count));
  }

  /** Transfers atomically between two inventories; special/grouped stacks can only move in full. */
  transferTo(target: Inventory, sourceSlot: number, destinationSlot: number, amount?: number,
    capacity?: InventoryCapacity): { source: Inventory; target: Inventory } {
    if (target === this) throw new DecodeError('E_FORMAT', 'Use split or merge within one inventory');
    const item = this.requireItem(sourceSlot), count = amount ?? item.count;
    Inventory.checkAmount(count, item.count);
    if ((item.meta || item.group) && count !== item.count) throw new DecodeError('E_FORMAT', 'Special/grouped stacks must be moved as a whole');
    const destination = target.get(destinationSlot);
    let updated: Inventory;
    if (destination) {
      if (item.meta || item.group || destination.meta || destination.group || item.type !== destination.type) throw new DecodeError('E_FORMAT', 'Incompatible transfer destination');
      updated = target.set(destination.withCount(destination.count + count));
    } else updated = target.set(count === item.count ? item.withSlot(destinationSlot) : new ItemStack(destinationSlot, item.type, count));
    if (capacity) updated.assertCapacity(capacity);
    return { source: count === item.count ? this.remove(sourceSlot) : this.set(item.withCount(item.count - count)), target: updated };
  }

  /** Computes volume using an explicit catalogue policy, including each multislot constituent. */
  usedVolume(volumeOf: (type: number) => number): number {
    let volume = 0;
    for (const item of this.items) for (const part of item.group?.items ?? [item]) {
      const unit = volumeOf(part.type);
      if (!Number.isFinite(unit) || unit < 0) throw new DecodeError('E_RANGE', 'Item volume must be finite and nonnegative');
      volume += unit * part.count;
      if (!Number.isFinite(volume)) throw new DecodeError('E_RANGE', 'Inventory volume overflow');
    }
    return volume;
  }

  /** Applies a caller-supplied capacity; the SDK does not invent server/game capacity rules. */
  assertCapacity(capacity: InventoryCapacity): this {
    if (!Number.isFinite(capacity.maximum) || capacity.maximum < 0) throw new DecodeError('E_RANGE', 'Capacity must be finite and nonnegative');
    if (this.usedVolume(capacity.volumeOf) > capacity.maximum) throw new DecodeError('E_LIMIT', 'Inventory volume exceeds capacity');
    return this;
  }

  /** JSON-safe item projection; null means no caller-supplied occupied-slot limit, not game capacity. */
  toJSON(): { items: ItemStackJSON[]; maxSlots: number | null } {
    return { items: this.items.map(item => item.toJSON()), maxSlots: this.maxSlots === Infinity ? null : this.maxSlots };
  }

  /** Requires an occupied source slot before an immutable transaction. */
  private requireItem(slot: number): ItemStack {
    boundedInteger(slot, 'inventory slot', 0x7fffffff);
    const item = this.get(slot);
    if (!item) throw new DecodeError('E_RANGE', 'Source inventory slot is empty');
    return item;
  }

  /** Requires a positive amount that fits the source stack. */
  private static checkAmount(count: number, maximum: number): void {
    boundedInteger(count, 'transfer amount', maximum);
    if (!count) throw new DecodeError('E_RANGE', 'Transfer amount must be positive');
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `Inventory(${this._slots.size}/${this.maxSlots} slots)`;
  }
}
