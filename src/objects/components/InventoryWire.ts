/** @fileoverview Strict inventory wire decoding with preserved stash/factory envelopes and opaque item payloads. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { readFrom, writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { tagModelOptions } from '../../core/TagModel.js';
import { boundedInteger, DecodeError } from '../../core/DecodeError.js';
import type { ItemMeta, ItemGroup, ItemStack } from './Inventory.js';

/** Decoded values are separate from the original private envelope snapshot. */
export interface InventoryWireItem { slot: number; type: number; count: number; meta?: ItemMeta; group?: ItemGroup; }
/** A strict inventory plus its complete original wrapper bytes. */
export interface InventoryWireData { items: InventoryWireItem[]; template: Buffer; }

/** Copies an opaque Tag using the validated binary format, including typed empty lists. */
export function copyInventoryTag(tag: Tag, options: TagReadOptions = {}): Tag {
  return readFrom(inventoryTagBytes(tag, options), tagModelOptions(options));
}
/** Encodes an inventory snapshot within the caller's output and traversal budgets. */
export function inventoryTagBytes(tag: Tag, options: TagReadOptions = {}): Buffer { return writeTo(tag, tagModelOptions(options)); }

/** Returns non-terminator children from a STRUCT. */
function children(tag: Tag): Tag[] {
  if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Expected inventory STRUCT');
  return tag.getStruct().filter(child => child.type !== TagType.FINISH);
}
/** Recognizes actual inventory names, as distinct from the old SDK's anonymous wrapper format. */
function namedInventory(tag: Tag): boolean { return tag.name === 'inv1' || tag.name === 'inv' || tag.name === 'inventory'; }
/** Finds the inventory content inside supported envelopes, retaining every parent for serialization. */
function content(tag: Tag, parents: Tag[] = []): { tag: Tag; parents: Tag[] } {
  if (namedInventory(tag) || tag.getStruct()[0]?.type === TagType.LIST) return { tag, parents };
  const nested = children(tag)[1];
  if (nested?.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Missing wrapped inventory');
  return content(nested, [...parents, tag]);
}
/** Reads a typed list or an older direct STRUCT list without inventing missing entries. */
function list(tag: Tag, type: TagType): Tag[] {
  const values = tag.type === TagType.LIST ? tag.getList() : children(tag);
  if ((tag.type === TagType.LIST && tag.listType !== type) || values.some(value => value.type !== type)) {
    throw new DecodeError('E_FORMAT', 'Incorrect inventory list type');
  }
  return values;
}
/** Validates signed short inventory types without depending on an installed catalogue. */
function itemType(type: number): void {
  if (!Number.isInteger(type) || type < -32768 || type > 32767 || type === 0) throw new DecodeError('E_RANGE', 'Inventory type must be a nonzero signed short');
}
/** Validates positive stack counts with the game's signed-int storage ceiling. */
function count(value: number): number {
  boundedInteger(value, 'item count', 0x7fffffff);
  if (value === 0) throw new DecodeError('E_RANGE', 'Inventory stacks must contain at least one item');
  return value;
}

/** Decodes a normal, metadata or grouped value with no lossy fallback. */
function decodeItem(slot: number, type: number, value: Tag, options: TagReadOptions): InventoryWireItem {
  boundedInteger(slot, 'inventory slot', 0x7fffffff); itemType(type);
  if (value.type === TagType.INT) {
    if (type < 0) throw new DecodeError('E_FORMAT', 'Special inventory items require structured payloads');
    return { slot, type, count: count(value.getInt()) };
  }
  const parts = children(value);
  if (type === -32768) {
    if (parts[0]?.type !== TagType.STRING) throw new DecodeError('E_FORMAT', 'Multislot requires a group name');
    const seen = new Set<number>(), items = parts.slice(1).map(entry => {
      const sub = children(entry);
      if (sub[0]?.type !== TagType.SHORT || sub[1]?.type !== TagType.INT) throw new DecodeError('E_FORMAT', 'Invalid multislot entry');
      const type = sub[0].getShort(); itemType(type);
      if (type < 0 || seen.has(type)) throw new DecodeError('E_FORMAT', 'Duplicate or special multislot type');
      seen.add(type); return { type, count: count(sub[1].getInt()) };
    });
    if (!items.length) throw new DecodeError('E_FORMAT', 'Empty multislot');
    return { slot, type, count: items.reduce((sum, item) => Math.min(0x7fffffff, sum + item.count), 0), group: { name: parts[0].getString(), items } };
  }
  if (type >= 0 || parts[0]?.type !== TagType.INT || parts[1]?.type !== TagType.SHORT || !parts[2] || parts[1].getShort() !== type) {
    throw new DecodeError('E_FORMAT', 'Invalid special inventory metadata');
  }
  boundedInteger(parts[0].getInt(), 'metadata id', 0x7fffffff);
  return { slot, type, count: 1, meta: { id: parts[0].getInt(), type, orientation: 0,
    subId: parts[3]?.type === TagType.SHORT ? parts[3].getShort() : -1, payload: copyInventoryTag(parts[2], options) } };
}

/** Recognizes actual format variants; anonymous legacy SDK tuples return undefined for compatibility. */
export function readInventoryWire(tag: Tag, maxSlots = Infinity, options: TagReadOptions = {}): InventoryWireData | undefined {
  if (maxSlots !== Infinity) boundedInteger(maxSlots, 'maxSlots', 0x7fffffff);
  if (tag.type !== TagType.STRUCT) return undefined;
  const parts = children(tag), nested = parts[1];
  if (!namedInventory(tag) && tag.name !== 'stash' && parts[0]?.type !== TagType.LIST &&
      !(nested?.type === TagType.STRUCT && (namedInventory(nested) || nested.name === 'stash'))) return undefined;
  const local = tagModelOptions(options), template = inventoryTagBytes(tag, local), inner = content(readFrom(template, local)).tag, data = children(inner);
  if (data.length < 3 || data[2].type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Missing inventory lists');
  const slots = list(data[0], TagType.INT), types = list(data[1], TagType.SHORT), values = children(data[2]);
  if (slots.length > maxSlots) throw new DecodeError('E_LIMIT', 'Inventory exceeds the requested occupied-slot limit');
  if (slots.length !== types.length || slots.length !== values.length) throw new DecodeError('E_FORMAT', 'Inventory list lengths differ');
  const seen = new Set<number>(), items = slots.map((slot, index) => {
    const value = slot.getInt();
    if (seen.has(value)) throw new DecodeError('E_FORMAT', 'Duplicate inventory slot');
    seen.add(value); return decodeItem(value, types[index].getShort(), values[index], local);
  });
  return { items, template };
}

/** Preserves an existing scalar's name while replacing its value. */
function scalar(previous: Tag | undefined, next: Tag): Tag { return previous ? Tags.rename(next, previous.name) : next; }
/** Encodes complete item values while retaining extensions inside existing metadata/group records. */
function encodeItem(item: ItemStack, previous: Tag | undefined, options: TagReadOptions): Tag {
  if (item.group) {
    const group = item.group, prior = previous?.type === TagType.STRUCT ? children(previous) : [];
    const entries = group.items.map(part => {
      const existing = prior.slice(1).find(entry => entry.type === TagType.STRUCT && children(entry)[0]?.value === part.type);
      const data = existing ? children(existing) : [];
      data[0] = scalar(data[0], Tags.short(null, part.type)); data[1] = scalar(data[1], Tags.int(null, part.count));
      return Tags.struct(existing?.name ?? null, data);
    });
    return Tags.struct(previous?.name ?? null, [scalar(prior[0], Tags.string(null, group.name)), ...entries]);
  }
  const meta = item.meta;
  if (meta?.payload) {
    const data = previous?.type === TagType.STRUCT ? children(previous) : [];
    data[0] = scalar(data[0], Tags.int(null, meta.id)); data[1] = scalar(data[1], Tags.short(null, meta.type)); data[2] = copyInventoryTag(meta.payload, options);
    if (data[3]?.type === TagType.SHORT) data[3] = scalar(data[3], Tags.short(null, meta.subId));
    else if (meta.subId !== -1) data.splice(3, 0, Tags.short(null, meta.subId));
    return Tags.struct(previous?.name ?? null, data);
  }
  if (meta || item.type < 0) throw new DecodeError('E_FORMAT', 'Special items require their opaque metadata payload');
  return scalar(previous, Tags.int(null, item.count));
}

/** Writes named inv1 LISTs for new data and preserves the original wrapper/schema on edits. */
export function writeInventoryWire(items: readonly ItemStack[], template?: Buffer, options: TagReadOptions = {}): Tag {
  const local = tagModelOptions(options);
  const source = template ? content(readFrom(template, local)) : undefined;
  const data = source ? children(source.tag) : [];
  const previousSlots = data[0] ? list(data[0], TagType.INT) : [];
  const previousTypes = data[1] ? list(data[1], TagType.SHORT) : [];
  const previousValues = data[2] ? children(data[2]) : [];
  const previous = new Map(previousSlots.map((slot, index) => [slot.getInt(), previousValues[index]]));
  const order = new Map(previousSlots.map((slot, index) => [slot.getInt(), index]));
  const sorted = [...items].sort((a, b) => (order.get(a.slot) ?? Infinity) - (order.get(b.slot) ?? Infinity) || a.slot - b.slot);
  const slots: Tag[] = [], types: Tag[] = [], values: Tag[] = [];
  for (const item of sorted) {
    boundedInteger(item.slot, 'inventory slot', 0x7fffffff); itemType(item.type); count(item.count);
    const index = order.get(item.slot);
    slots.push(scalar(index === undefined ? undefined : previousSlots[index], Tags.int(null, item.slot)));
    types.push(scalar(index === undefined ? undefined : previousTypes[index], Tags.short(null, item.type)));
    values.push(encodeItem(item, previous.get(item.slot), local));
  }
  /** Retains legacy STRUCT containers while new inventories use explicit typed LISTs. */
  const field = (old: Tag | undefined, values: Tag[], type: TagType): Tag => old?.type === TagType.STRUCT
    ? Tags.struct(old.name, values) : new Tag(TagType.LIST, old?.name ?? null, values, type);
  data[0] = field(data[0], slots, TagType.INT); data[1] = field(data[1], types, TagType.SHORT);
  data[2] = Tags.struct(data[2]?.name ?? null, values);
  let result = Tags.struct(source ? source.tag.name : 'inv1', data);
  for (const parent of [...source?.parents ?? []].reverse()) {
    const outer = children(parent); outer[1] = result; result = Tags.struct(parent.name, outer);
  }
  // Reuse the independent decoder validation to reject inconsistent metadata/group values.
  readInventoryWire(result, Infinity, local);
  return result;
}
