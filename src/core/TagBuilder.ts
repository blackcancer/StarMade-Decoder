/**
 * @fileoverview Tag Builder
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * TagBuilder — fluent API for creating and modifying StarMade Tag trees.
 *
 * Complements the immutable Tag class with static factories
 * and fluent builders for STRUCTs and LISTs.
 *
 * Inspired by the Java Tag API with modern TypeScript ergonomics.
 *
 * @example
 * ```ts
 * // Create a simple tag
 * const t = Tags.int('health', 100);
 * const s = Tags.string('name', 'Explorer');
 *
 * // Create a complete STRUCT
 * const ship = Tags.struct('Ship', [
 *   Tags.string('name', 'Explorer'),
 *   Tags.int('factionId', 0),
 *   Tags.vector3i('sector', 4, 4, 4),
 * ]);
 *
 * // Modify a value in an existing STRUCT
 * const modified = Tags.setField(shipTag, 'factionId', Tags.int('factionId', 42));
 *
 * // Serialize
 * const buf = writeTo(ship);
 * ```
 */

import { Tag, FINISH_TAG, TagValue } from './Tag.js';
import { TagType } from './TagType.js';
import { Vector3b, Vector3i, Vector3f, Vector4f } from '../types/Vectors.js';
import { Matrix3f, Matrix4f } from '../types/Matrices.js';

// ── Factories statiques ───────────────────────────────────────────────────────

/**
 * Factory namespace for concise Tag creation.
 * Port of the Java static methods Tag.getXxxTag() + new Tag(Type.XXX, name, value).
 */
export const Tags = {

  // ── Primitives ──────────────────────────────────────────────────────────────

  /** Creates a TAG_Byte (int8). Accepts signed values (-128 to 127) or unsigned values (0 to 255). */
  byte(name: string | null, value: number): Tag {
    // Normalize to signed int8: -128..127
    const signed = value > 127 ? value - 256 : value;
    return new Tag(TagType.BYTE, name, signed);
  },

  /** Creates a TAG_Byte from a boolean (1 or 0). */
  bool(name: string | null, value: boolean): Tag {
    return new Tag(TagType.BYTE, name, value ? 1 : 0);
  },

  /** Creates a TAG_Short (int16). */
  short(name: string | null, value: number): Tag {
    return new Tag(TagType.SHORT, name, value);
  },

  /** Creates a TAG_Int (int32). */
  int(name: string | null, value: number): Tag {
    return new Tag(TagType.INT, name, value);
  },

  /** Creates a TAG_Long (int64). */
  long(name: string | null, value: bigint | number): Tag {
    return new Tag(TagType.LONG, name, typeof value === 'number' ? BigInt(value) : value);
  },

  /** Creates a TAG_Float (float32). */
  float(name: string | null, value: number): Tag {
    return new Tag(TagType.FLOAT, name, value);
  },

  /** Creates a TAG_Double (float64). */
  double(name: string | null, value: number): Tag {
    return new Tag(TagType.DOUBLE, name, value);
  },

  /** Creates a TAG_String. */
  string(name: string | null, value: string): Tag {
    return new Tag(TagType.STRING, name, value);
  },

  /** Creates a TAG_Byte_Array. */
  byteArray(name: string | null, value: Uint8Array | number[]): Tag {
    const arr = value instanceof Uint8Array ? value : new Uint8Array(value);
    return new Tag(TagType.BYTE_ARRAY, name, arr);
  },

  /** Creates a TAG_Nothing with no payload. */
  nothing(name: string | null): Tag {
    return new Tag(TagType.NOTHING, name, null);
  },

  // ── Vecteurs & matrices ────────────────────────────────────────────────────

  /** Creates a TAG_Vector3b. */
  vector3b(name: string | null, x: number, y: number, z: number): Tag {
    return new Tag(TagType.VECTOR3b, name, new Vector3b(x, y, z));
  },

  /** Creates a TAG_Vector3i. */
  vector3i(name: string | null, x: number, y: number, z: number): Tag {
    return new Tag(TagType.VECTOR3i, name, new Vector3i(x, y, z));
  },

  /** Creates a TAG_Vector3f. */
  vector3f(name: string | null, x: number, y: number, z: number): Tag {
    return new Tag(TagType.VECTOR3f, name, new Vector3f(x, y, z));
  },

  /** Creates a TAG_Vector4f. */
  vector4f(name: string | null, x: number, y: number, z: number, w: number): Tag {
    return new Tag(TagType.VECTOR4f, name, new Vector4f(x, y, z, w));
  },

  /** Creates a TAG_Matrix3f. */
  matrix3f(name: string | null, m: Matrix3f): Tag {
    return new Tag(TagType.MATRIX3f, name, m);
  },

  /** Creates a TAG_Matrix4f. */
  matrix4f(name: string | null, m: Matrix4f): Tag {
    return new Tag(TagType.MATRIX4f, name, m);
  },

  // ── Conteneurs ─────────────────────────────────────────────────────────────

  /**
   * Creates a TAG_Compound (STRUCT) with the provided child tags.
   * FINISH_TAG is automatically appended at the end of the list.
   */
  struct(name: string | null, children: Tag[]): Tag {
    const all = [...children.filter(t => t.type !== TagType.FINISH), FINISH_TAG];
    return new Tag(TagType.STRUCT, name, all);
  },

  /**
   * Creates a homogeneous TAG_List.
   * All elements must have the same type.
   */
  list(name: string | null, items: Tag[]): Tag {
    if (items.length === 0) {
      return new Tag(TagType.LIST, name, [], TagType.NOTHING);
    }
    const listType = items[0].type;
    if (!items.every(t => t.type === listType)) {
      throw new TypeError('All LIST elements must have the same type');
    }
    return new Tag(TagType.LIST, name, items, listType);
  },

  /**
   * Creates a TAG_List of STRUCT values, the most common case.
   */
  listOfStructs(name: string | null, items: Tag[]): Tag {
    return Tags.list(name, items);
  },

  // ── Updates ──────────────────────────────────────────────────────────

  /**
   * Replaces or adds a named field in an existing STRUCT.
   * Returns a new immutable Tag.
   *
   * @example
   * const updated = Tags.setField(playerTag, 'factionId', Tags.int('factionId', 42));
   */
  setField(struct: Tag, fieldName: string, newValue: Tag): Tag {
    if (struct.type !== TagType.STRUCT) {
      throw new TypeError(`setField: expected STRUCT, got ${struct.type}`);
    }
    const children = struct.getStruct();
    const idx = children.findIndex(t => t.name === fieldName && t.type !== TagType.FINISH);

    let newChildren: Tag[];
    if (idx >= 0) {
      // Replacement
      newChildren = [...children];
      newChildren[idx] = newValue;
    } else {
      // Insert before FINISH
      const withoutFinish = children.filter(t => t.type !== TagType.FINISH);
      newChildren = [...withoutFinish, newValue, FINISH_TAG];
    }

    return new Tag(TagType.STRUCT, struct.name, newChildren);
  },

  /**
   * Removes a named field from a STRUCT.
   * Returns a new immutable Tag.
   */
  removeField(struct: Tag, fieldName: string): Tag {
    if (struct.type !== TagType.STRUCT) {
      throw new TypeError(`removeField: expected STRUCT, got ${struct.type}`);
    }
    const newChildren = struct.getStruct().filter(t => t.name !== fieldName || t.type === TagType.FINISH);
    return new Tag(TagType.STRUCT, struct.name, newChildren);
  },

  /**
   * Creates a copy of a Tag with a new name.
   */
  rename(tag: Tag, newName: string | null): Tag {
    return new Tag(tag.type, newName, tag.value, tag.listType ?? undefined);
  },

  /**
   * Creates a copy of a Tag with a new value.
   */
  withValue(tag: Tag, newValue: TagValue): Tag {
    return new Tag(tag.type, tag.name, newValue, tag.listType ?? undefined);
  },

  /**
   * Merges several fields into an existing STRUCT, equivalent to multiple setField calls.
   * Returns a new Tag.
   */
  mergeFields(struct: Tag, fields: Tag[]): Tag {
    let result = struct;
    for (const field of fields) {
      if (field.name) result = Tags.setField(result, field.name, field);
    }
    return result;
  },

  // ── Typed reads safe ─────────────────────────────────────────────────────

  /**
   * Reads a field from a STRUCT by name, with a default value when absent.
   */
  getInt(struct: Tag, name: string, def = 0): number {
    return struct.findByName(name)?.getInt() ?? def;
  },

  getLong(struct: Tag, name: string, def = 0n): bigint {
    return struct.findByName(name)?.getLong() ?? def;
  },

  getString(struct: Tag, name: string, def = ''): string {
    return struct.findByName(name)?.getString() ?? def;
  },

  getByte(struct: Tag, name: string, def = 0): number {
    return struct.findByName(name)?.getByte() ?? def;
  },

  getFloat(struct: Tag, name: string, def = 0): number {
    return struct.findByName(name)?.getFloat() ?? def;
  },

  getBool(struct: Tag, name: string, def = false): boolean {
    const t = struct.findByName(name);
    return t ? t.getByte() !== 0 : def;
  },
};

// ── StructBuilder — API fluente ───────────────────────────────────────────────

/**
 * Fluent builder for constructing a STRUCT step by step.
 *
 * @example
 * ```ts
 * const tag = new StructBuilder('PlayerCharacter')
 *   .add(Tags.int('id', 142))
 *   .add(Tags.float('speed', 4.0))
 *   .add(Tags.string('name', 'InitSysRev'))
 *   .build();
 * ```
 */
export class StructBuilder {
  private readonly _name: string | null;
  private readonly _children: Tag[] = [];

  constructor(name: string | null = null) {
    this._name = name;
  }

  /** Adds a child tag. */
  add(tag: Tag): this {
    this._children.push(tag);
    return this;
  }

  /** Adds a tag conditionally. */
  addIf(condition: boolean, tag: Tag): this {
    if (condition) this._children.push(tag);
    return this;
  }

  /** Adds multiple tags. */
  addAll(tags: Tag[]): this {
    this._children.push(...tags);
    return this;
  }

  /** Builds the final STRUCT Tag with an automatic FINISH_TAG. */
  build(): Tag {
    return Tags.struct(this._name, this._children);
  }
}

// ── ListBuilder ───────────────────────────────────────────────────────────────

/**
 * Fluent builder for constructing a homogeneous LIST.
 */
export class ListBuilder {
  private readonly _name: string | null;
  private readonly _items: Tag[] = [];

  constructor(name: string | null = null) {
    this._name = name;
  }

  add(tag: Tag): this {
    this._items.push(tag);
    return this;
  }

  addAll(tags: Tag[]): this {
    this._items.push(...tags);
    return this;
  }

  build(): Tag {
    return Tags.list(this._name, this._items);
  }
}
