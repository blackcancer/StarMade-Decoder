/**
 * @fileoverview Read-only projection of StarMade inventory meta-object Tags.
 * Layouts follow StarMade-Open MetaObjectManager and its native subclasses.
 */
import { Tag } from '../../core/Tag.js';
import { TagType } from '../../core/TagType.js';
import type { ItemStack } from './Inventory.js';

/** Game-owned family, with `unknown` reserved for modded type IDs. */
export type MetaObjectCategory = 'weapon' | 'helmet' | 'flashlight' | 'logbook' |
  'blueprint' | 'recipe' | 'build-prohibiter' | 'virtual-blueprint' |
  'block-storage' | 'unknown';
/** Whether the native payload was decoded, absent, unfamiliar or malformed. */
export type MetaObjectStatus = 'ready' | 'absent' | 'unknown' | 'invalid';

/** Stable, language-neutral fields; absent fields are omitted, never synthesized. */
export interface MetaObjectProperties {
  readonly damage?: number;
  readonly healingPower?: number;
  readonly supplyPower?: number;
  readonly projectileSpeed?: number;
  readonly reloadMs?: number;
  readonly colorRgba?: readonly [number, number, number, number];
  readonly range?: number;
  readonly radius?: number;
  readonly marking?: string;
  readonly markerName?: string;
  /** Signed 64-bit encoded marker location as an exact decimal string. */
  readonly markerLocation?: string;
  readonly chargePerSecond?: number;
  readonly active?: boolean;
  /** Stored signed model byte, without a localized label. */
  readonly model?: number;
  readonly text?: string;
  readonly blueprintName?: string;
  readonly blueprintUid?: string;
  readonly blueprintGoalBytes?: number;
  readonly blueprintProgressBytes?: number;
  readonly storageBytes?: number;
  readonly recipeVersion?: 'v0' | 'v1' | 'v2';
  readonly recipeProductCount?: number;
  /** Signed 32/64-bit game values represented exactly as decimal strings. */
  readonly producedGoods?: string;
  readonly fixedPrice?: string;
  readonly maxLevel?: number;
}

/** Native identity and a detached, bounded view of an ItemStack's payload. */
export interface MetaObjectDetails {
  readonly category: MetaObjectCategory;
  readonly status: MetaObjectStatus;
  readonly typeId: number;
  readonly subtype: number | null;
  readonly instanceId: number | null;
  /** Zero-based index in StarMade's `meta-icons` sheet, when determined. */
  readonly iconIndex: number | null;
  readonly properties: Readonly<MetaObjectProperties>;
  /** Missing, wrong-type or unrepresentable known fields; empty for other statuses. */
  readonly invalidFields: readonly string[];
}

/** Key of one stable projected property. */
type Field = keyof MetaObjectProperties;
/** Native Tag representation expected by one property. */
type FieldKind = 'int' | 'float' | 'byte' | 'active' | 'color' | 'string' | 'long' | 'bytes' | 'integer64';
/** Positional native field specification. */
type FieldSpec = readonly [Field, FieldKind];
/** Upper bound for non-logbook strings copied into a projection. */
const MAX_STRING = 4096;
/** Logbook.MAX_LENGTH in StarMade-Open, measured in UTF-16 code units. */
const MAX_LOGBOOK_TEXT = 1024;
/** Native item type IDs and their stable categories. */
const FAMILIES: Readonly<Record<number, MetaObjectCategory>> = Object.freeze({
  [-9]: 'blueprint', [-10]: 'recipe', [-11]: 'logbook', [-12]: 'helmet',
  [-13]: 'build-prohibiter', [-14]: 'flashlight', [-15]: 'virtual-blueprint',
  [-16]: 'block-storage', [-32]: 'weapon',
});
/** Positional Tags produced by the nine native Weapon.getBytesTag methods. */
const WEAPONS: Readonly<Record<number, readonly FieldSpec[]>> = Object.freeze({
  1: [['damage', 'int'], ['projectileSpeed', 'float'], ['reloadMs', 'int'], ['colorRgba', 'color']],
  2: [['healingPower', 'int'], ['projectileSpeed', 'float'], ['reloadMs', 'int'], ['colorRgba', 'color']],
  3: [['supplyPower', 'int'], ['projectileSpeed', 'float'], ['reloadMs', 'int'], ['colorRgba', 'color']],
  4: [['marking', 'string'], ['markerName', 'string'], ['markerLocation', 'long']],
  5: [['damage', 'int'], ['projectileSpeed', 'float'], ['reloadMs', 'int'], ['colorRgba', 'color'], ['radius', 'float'], ['range', 'float']],
  6: [['damage', 'int'], ['projectileSpeed', 'float'], ['reloadMs', 'float'], ['colorRgba', 'color'], ['range', 'float']],
  7: [['reloadMs', 'float'], ['colorRgba', 'color'], ['range', 'float']],
  8: [['damage', 'int'], ['reloadMs', 'float'], ['colorRgba', 'color'], ['range', 'float']],
  9: [['marking', 'string'], ['markerName', 'string'], ['markerLocation', 'long'], ['chargePerSecond', 'float']],
});

/** Projects a special inventory item without changing its stored Tag or bytes. */
export function describeMetaObject(item: ItemStack): MetaObjectDetails | null {
  if (item.type >= 0 || item.type === -32768) return null;
  const meta = item.meta;
  const category = FAMILIES[item.type] ?? 'unknown';
  const subtype = meta?.subId ?? null;
  const iconIndex = category === 'unknown' ? null : category === 'weapon'
    ? subtype !== null && subtype >= 1 && subtype <= 9 ? 31 + subtype : null : -item.type;
  const base = { category, typeId: item.type, subtype, instanceId: meta?.id ?? null,
    iconIndex, properties: {} as MetaObjectProperties, invalidFields: [] as string[] };
  if (!meta?.payload) return { ...base, status: 'absent' };
  if (category === 'unknown' || (category === 'weapon' && !Object.hasOwn(WEAPONS, subtype!))) {
    return { ...base, status: 'unknown' };
  }
  const payload = meta.payload;
  if (category === 'recipe' && payload.type === TagType.STRUCT &&
      payload.name !== 'v0' && payload.name !== 'v1' && payload.name !== 'v2') {
    return { ...base, status: 'unknown' };
  }
  const properties: Record<string, unknown> = {};
  const invalidFields: string[] = [];
  const read = (tag: Tag | undefined, [field, kind]: FieldSpec, limit = MAX_STRING): void => {
    const value = readValue(tag, kind, limit);
    if (value === undefined) invalidFields.push(field);
    else properties[field] = value;
  };
  if (category === 'helmet') read(payload, ['model', 'byte']);
  else if (category === 'logbook') read(payload, ['text', 'string'], MAX_LOGBOOK_TEXT);
  else if (category === 'recipe') {
    if (payload.type !== TagType.STRUCT) invalidFields.push('$root');
    else readRecipe(payload, properties, invalidFields, read);
  }
  else {
    const fields = category === 'weapon' ? WEAPONS[subtype!] :
      category === 'flashlight' ? [['colorRgba', 'color'], ['active', 'active']] :
      category === 'build-prohibiter' ? [['radius', 'float'], ['active', 'active']] :
      category === 'blueprint' ? [['blueprintGoalBytes', 'bytes'], ['blueprintProgressBytes', 'bytes'], ['blueprintName', 'string']] :
      category === 'virtual-blueprint' ? [['blueprintUid', 'string'], ['blueprintName', 'string']] :
      [['storageBytes', 'bytes']];
    if (payload.type !== TagType.STRUCT) invalidFields.push('$root');
    else {
      const children = payload.getStruct().filter(tag => tag.type !== TagType.FINISH);
      fields.forEach((field, index) => read(children[index], field as FieldSpec));
    }
  }
  return { ...base, status: invalidFields.length ? 'invalid' : 'ready',
    properties: properties as MetaObjectProperties, invalidFields };
}

/** Reads one primitive without coercion, clipping or interpreting encoded positions. */
function readValue(tag: Tag | undefined, kind: FieldKind, maxString: number): unknown {
  if (!tag) return undefined;
  if (kind === 'int') return tag.type === TagType.INT ? tag.getInt() : undefined;
  if (kind === 'byte') return tag.type === TagType.BYTE ? tag.getByte() : undefined;
  if (kind === 'active') return tag.type === TagType.BYTE ? tag.getByte() !== 0 : undefined;
  if (kind === 'long') return tag.type === TagType.LONG ? tag.getLong().toString() : undefined;
  if (kind === 'integer64') return tag.type === TagType.LONG ? tag.getLong().toString()
    : tag.type === TagType.INT ? String(tag.getInt()) : undefined;
  if (kind === 'bytes') return tag.type === TagType.BYTE_ARRAY ? tag.getByteArray().length : undefined;
  if (kind === 'string') return tag.type === TagType.STRING && tag.getString().length <= maxString
    ? tag.getString() : undefined;
  if (kind === 'float') return tag.type === TagType.FLOAT && Number.isFinite(tag.getFloat())
    ? tag.getFloat() : undefined;
  if (tag.type !== TagType.VECTOR4f) return undefined;
  const { x, y, z, w } = tag.getVector4f();
  return [x, y, z, w].every(Number.isFinite) ? [x, y, z, w] as const : undefined;
}

/** Summarizes versioned recipes while leaving their nested product Tags opaque. */
function readRecipe(payload: Tag, properties: Record<string, unknown>, invalidFields: string[],
  read: (tag: Tag | undefined, field: FieldSpec) => void): void {
  properties.recipeVersion = payload.name;
  const children = payload.getStruct().filter(tag => tag.type !== TagType.FINISH);
  if (children[0]?.type !== TagType.STRUCT) invalidFields.push('recipeProductCount');
  else properties.recipeProductCount = children[0].getStruct().filter(tag => tag.type !== TagType.FINISH).length;
  read(children[1], ['producedGoods', 'integer64']);
  if (payload.name !== 'v0') read(children[2], ['fixedPrice', 'long']);
  if (payload.name === 'v2') read(children[3], ['maxLevel', 'byte']);
}
