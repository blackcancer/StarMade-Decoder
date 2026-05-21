/**
 * @fileoverview Tag Serializer
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * TagSerializer — converts a Tag into a human-readable JSON object.
 *
 * Native JSON issues (JSON.stringify(tag)) :
 *   - type: 13 instead of "STRUCT"
 *   - name: null always present for anonymous tags
 *   - size: "0n" and listType: null everywhere — noise
 *   - BigInt crash JSON.stringify
 *   - SERIALIZABLE = blob opaque { factoryId, raw: Uint8Array }
 *
 * Format produit par toObject() :
 * ```json
 * {
 *   "type": "STRUCT",
 *   "name": "PlayerCharacter",           // omitted when null
 *   "children": [                         // for STRUCT/LIST
 *     { "type": "INT", "name": "id", "value": 142 },
 *     { "type": "FLOAT", "name": "speed", "value": 4.0 },
 *     { "type": "SERIALIZABLE", "name": "cs1", "factoryId": 0, "bytes": 110 }
 *   ]
 * }
 * ```
 *
 * Conventions :
 *   - LONG     → string with "n" suffix  : "50000n"
 *   - BYTE_ARRAY → { "bytes": N, "hex": "aabbcc..." } (truncated to 32 bytes)
 *   - SERIALIZABLE → { "factoryId": N, "bytes": N, "hex": "..." }
 *   - STRUCT   → { "type": "STRUCT", "name": ..., "children": [...] }
 *   - LIST     → { "type": "LIST", "name": ..., "elementType": "INT", "items": [...] }
 *   - FINISH   → omitted automatically
 *   - Vecteurs → { "x": ..., "y": ..., "z": ... }
 */

import { Tag } from './Tag.js';
import { TagType, TAG_TYPE_NAMES } from './TagType.js';
import type { RawElement } from '../serializable/Factories.js';

// ── Type de l'objet produit ───────────────────────────────────────────────────

/**
 * Defines the TagObject type used by core binary tag parsing and serialization.
 */
export type TagObject =
  | StructObject
  | ListObject
  | PrimitiveObject
  | SerializableObject
  | ByteArrayObject;

/**
 * Describes the StructObject data shape used by core binary tag parsing and serialization.
 */
export interface StructObject {
  type: 'STRUCT';
  name?: string;
  children: TagObject[];
}

/**
 * Describes the ListObject data shape used by core binary tag parsing and serialization.
 */
export interface ListObject {
  type: 'LIST';
  name?: string;
  elementType: string;
  items: TagObject[];
}

/**
 * Describes the PrimitiveObject data shape used by core binary tag parsing and serialization.
 */
export interface PrimitiveObject {
  type: string;
  name?: string;
  value: string | number | boolean | VecObject | MatObject;
}

/**
 * Describes the SerializableObject data shape used by core binary tag parsing and serialization.
 */
export interface SerializableObject {
  type: 'SERIALIZABLE';
  name?: string;
  factoryId: number;
  factoryName: string;
  bytes: number;
  hex: string;
}

/**
 * Describes the ByteArrayObject data shape used by core binary tag parsing and serialization.
 */
export interface ByteArrayObject {
  type: 'BYTE_ARRAY';
  name?: string;
  bytes: number;
  hex: string;
}

/**
 * Describes the VecObject data shape used by core binary tag parsing and serialization.
 */
export interface VecObject { x: number; y: number; z: number; w?: number; }
/**
 * Describes the MatObject data shape used by core binary tag parsing and serialization.
 */
export interface MatObject { rows: number[][]; }

// ── SERIALIZABLE factory names ──────────────────────────────────────────

/**
 * Defines FACTORY_NAMES for core binary tag parsing and serialization.
 */
const FACTORY_NAMES: Record<number, string> = {
  0: 'ControlElementMapper',
  1: 'ElementCountMap',
  2: 'NPCFactionNewsEvent',
  3: 'LongSet',
  4: 'BlockBuffer',
  5: 'Long2Vector3fMap',
  6: 'Long2TransformMap',
};

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * Converts a Tag into a readable plain object.
 * Ready for safe JSON.stringify (BigInt → string).
 */
export function toObject(tag: Tag): TagObject {
  const typeName = _shortName(tag.type);
  const name = tag.name ?? undefined;

  switch (tag.type) {
    case TagType.FINISH:
      // Should not be called directly
      return { type: 'FINISH' } as any;

    case TagType.STRUCT: {
      const children = (tag.value as Tag[])
        .filter(t => t.type !== TagType.FINISH)
        .map(toObject);
      return name ? { type: 'STRUCT', name, children } : { type: 'STRUCT', children };
    }

    case TagType.LIST: {
      const items = (tag.value as Tag[]).map(toObject);
      const elementType = tag.listType !== null ? _shortName(tag.listType) : 'NOTHING';
      return name
        ? { type: 'LIST', name, elementType, items }
        : { type: 'LIST', elementType, items };
    }

    case TagType.LONG: {
      const v = (tag.value as bigint).toString() + 'n';
      return name ? { type: typeName, name, value: v } : { type: typeName, value: v };
    }

    case TagType.BYTE_ARRAY: {
      const arr = tag.value as Uint8Array;
      const hex = _hexTrunc(arr);
      return name
        ? { type: 'BYTE_ARRAY', name, bytes: arr.length, hex }
        : { type: 'BYTE_ARRAY', bytes: arr.length, hex };
    }

    case TagType.SERIALIZABLE: {
      const elem = tag.value as RawElement;
      const factoryId = elem.factoryId;
      const raw = elem.raw ?? new Uint8Array(0);
      const hex = _hexTrunc(raw);
      const factoryName = FACTORY_NAMES[factoryId] ?? `Unknown(${factoryId})`;
      return name
        ? { type: 'SERIALIZABLE', name, factoryId, factoryName, bytes: raw.length, hex }
        : { type: 'SERIALIZABLE', factoryId, factoryName, bytes: raw.length, hex };
    }

    case TagType.VECTOR3b:
    case TagType.VECTOR3i:
    case TagType.VECTOR3f: {
      const v = tag.value as any;
      const val: VecObject = { x: v.x, y: v.y, z: v.z };
      return name ? { type: typeName, name, value: val } : { type: typeName, value: val };
    }

    case TagType.VECTOR4f: {
      const v = tag.value as any;
      const val: VecObject = { x: v.x, y: v.y, z: v.z, w: v.w };
      return name ? { type: typeName, name, value: val } : { type: typeName, value: val };
    }

    case TagType.MATRIX3f: {
      const m = tag.value as any;
      const rows = [
        [m.m00, m.m01, m.m02],
        [m.m10, m.m11, m.m12],
        [m.m20, m.m21, m.m22],
      ];
      return name ? { type: 'MATRIX3f', name, value: { rows } } : { type: 'MATRIX3f', value: { rows } };
    }

    case TagType.MATRIX4f: {
      const m = tag.value as any;
      const rows = [
        [m.m00, m.m01, m.m02, m.m03],
        [m.m10, m.m11, m.m12, m.m13],
        [m.m20, m.m21, m.m22, m.m23],
        [m.m30, m.m31, m.m32, m.m33],
      ];
      return name ? { type: 'MATRIX4f', name, value: { rows } } : { type: 'MATRIX4f', value: { rows } };
    }

    case TagType.NOTHING:
      return name ? { type: 'NOTHING', name, value: null as any } : { type: 'NOTHING', value: null as any };

    default: {
      // BYTE, SHORT, INT, FLOAT, DOUBLE, STRING
      const v = tag.value as any;
      return name ? { type: typeName, name, value: v } : { type: typeName, value: v };
    }
  }
}

/**
 * Serializes a Tag to readable JSON (BigInt-safe).
 */
export function toJSON(tag: Tag, indent = 2): string {
  return JSON.stringify(toObject(tag), null, indent);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Short type name (without the "TAG_" prefix). */
function _shortName(type: TagType): string {
  return TAG_TYPE_NAMES[type].replace('TAG_', '');
}

/** Hex truncated to 32 bytes with "..." when longer. */
function _hexTrunc(arr: Uint8Array, maxBytes = 32): string {
  const slice = arr.slice(0, maxBytes);
  const hex = Buffer.from(slice).toString('hex');
  return arr.length > maxBytes ? hex + '…' : hex;
}
