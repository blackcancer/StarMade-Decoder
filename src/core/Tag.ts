/**
 * @fileoverview Tag
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Tag — faithful port of the Java Tag class.
 *
 * NBT-style data hierarchy for StarMade files.
 * Each tag has a type, an optional name, and a typed value.
 *
 * Reference source: org.schema.schine.resource.tag.Tag
 */

import { TagType, TAG_TYPE_NAMES } from './TagType.js';
import { Vector3b, Vector3i, Vector3f, Vector4f } from '../types/Vectors.js';
import { Matrix3f, Matrix4f } from '../types/Matrices.js';
import type { SerializableTagElement } from '../serializable/SerializableTagElement.js';

// ── Supported Value Union ───────────────────────────────────────────────

/**
 * Defines the TagValue type used by core binary tag parsing and serialization.
 */
export type TagValue =
  | null                    // FINISH, NOTHING
  | number                  // BYTE, SHORT, INT, FLOAT, DOUBLE
  | bigint                  // LONG
  | string                  // STRING
  | Uint8Array              // BYTE_ARRAY
  | Vector3b                // VECTOR3b
  | Vector3i                // VECTOR3i
  | Vector3f                // VECTOR3f
  | Vector4f                // VECTOR4f
  | Matrix3f                // MATRIX3f
  | Matrix4f                // MATRIX4f
  | Tag[]                   // LIST, STRUCT
  | SerializableTagElement; // SERIALIZABLE

// ── Constante Java ──────────────────────────────────────────────────────────

/**
 * Defines NULL_STRING for core binary tag parsing and serialization.
 */
export const NULL_STRING = 'null';

// ── Tag class ───────────────────────────────────────────────────────────────

/**
 * Represents the Tag model used by core binary tag parsing and serialization.
 */
export class Tag {
  readonly type: TagType;
  readonly name: string | null;
  readonly value: TagValue;

  /** For LIST tags: element type */
  readonly listType: TagType | null;

  /** Byte length read from the stream (optional, diagnostic only) */
  size: bigint = 0n;

  /**
   * Creates a Tag instance.
   *
   * @param type - Input value for the constructor operation.
   * @param name - Input value for the constructor operation.
   * @param value - Input value for the constructor operation.
   * @param listType - Input value for the constructor operation.
   */
  constructor(type: TagType, name: string | null, value: TagValue, listType?: TagType) {
    this.type     = type;
    this.name     = name === NULL_STRING ? null : name;
    this.value    = value;
    this.listType = listType ?? null;
  }

  // ── Typed Accessors (matching Java getters) ─────────────────────────

  /**
   * Returns Byte.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getByte(): number {
    this._assert(TagType.BYTE);
    return this.value as number;
  }

  /**
   * Returns Short.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getShort(): number {
    this._assert(TagType.SHORT);
    return this.value as number;
  }

  /**
   * Returns Int.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getInt(): number {
    this._assert(TagType.INT);
    return this.value as number;
  }

  /**
   * Returns Long.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getLong(): bigint {
    this._assert(TagType.LONG);
    return this.value as bigint;
  }

  /**
   * Returns Float.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getFloat(): number {
    this._assert(TagType.FLOAT);
    return this.value as number;
  }

  /**
   * Returns Double.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getDouble(): number {
    this._assert(TagType.DOUBLE);
    return this.value as number;
  }

  /**
   * Returns String.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getString(): string {
    this._assert(TagType.STRING);
    return this.value as string;
  }

  /**
   * Returns ByteArray.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getByteArray(): Uint8Array {
    this._assert(TagType.BYTE_ARRAY);
    return this.value as Uint8Array;
  }

  /**
   * Returns Struct.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getStruct(): Tag[] {
    this._assert(TagType.STRUCT);
    return this.value as Tag[];
  }

  /**
   * Returns List.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getList(): Tag[] {
    this._assert(TagType.LIST);
    return this.value as Tag[];
  }

  /**
   * Returns Vector3b.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getVector3b(): Vector3b {
    this._assert(TagType.VECTOR3b);
    return this.value as Vector3b;
  }

  /**
   * Returns Vector3i.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getVector3i(): Vector3i {
    this._assert(TagType.VECTOR3i);
    return this.value as Vector3i;
  }

  /**
   * Returns Vector3f.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getVector3f(): Vector3f {
    this._assert(TagType.VECTOR3f);
    return this.value as Vector3f;
  }

  /**
   * Returns Vector4f.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getVector4f(): Vector4f {
    this._assert(TagType.VECTOR4f);
    return this.value as Vector4f;
  }

  /**
   * Returns Matrix3f.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getMatrix3f(): Matrix3f {
    this._assert(TagType.MATRIX3f);
    return this.value as Matrix3f;
  }

  /**
   * Returns Matrix4f.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getMatrix4f(): Matrix4f {
    this._assert(TagType.MATRIX4f);
    return this.value as Matrix4f;
  }

  /**
   * Returns Boolean.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getBoolean(): boolean {
    return this.getByte() !== 0;
  }

  /**
   * Returns Serializable.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getSerializable(): SerializableTagElement {
    this._assert(TagType.SERIALIZABLE);
    return this.value as SerializableTagElement;
  }

  // ── STRUCT / LIST lookup ───────────────────────────────────────────

  /**
   * Finds the first child tag with the provided name using recursive search.
   * Port of Tag.findTagByName().
   */
  findByName(name: string): Tag | null {
    if (this.type !== TagType.LIST && this.type !== TagType.STRUCT) return null;
    const subtags = this.value as Tag[];
    for (const sub of subtags) {
      if (sub.name === name) return sub;
      const found = sub.findByName(name);
      if (found) return found;
    }
    return null;
  }

  // ── Debug Display ────────────────────────────────────────────────────────

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    const typeName = TAG_TYPE_NAMES[this.type];
    const valStr = Array.isArray(this.value) ? 'STRUCT/LIST' :
                   this.value instanceof Uint8Array ? `[${this.value.length} bytes]` :
                   String(this.value);
    return `${typeName}("${this.name ?? ''}"): ${valStr} (size: ${this.size})`;
  }

  /** Indented recursive display matching the Java Tag.print() behavior */
  print(indent = 0): void {
    if (this.type === TagType.FINISH) return;
    const pad = '   '.repeat(indent);
    const typeName = TAG_TYPE_NAMES[this.type];
    const nameStr = this.name ? `("${this.name}")` : '';

    if (this.type === TagType.BYTE_ARRAY) {
      const b = this.value as Uint8Array;
      console.log(`${pad}${typeName}${nameStr}: [${b.length} bytes]`);
    } else if (this.type === TagType.LIST) {
      const subtags = this.value as Tag[];
      const lt = this.listType !== null ? TAG_TYPE_NAMES[this.listType] : '?';
      console.log(`${pad}${typeName}${nameStr}: ${subtags.length} entries of type ${lt}`);
      for (const st of subtags) st.print(indent + 1);
      console.log(`${pad}}`);
    } else if (this.type === TagType.STRUCT) {
      const subtags = this.value as Tag[];
      console.log(`${pad}${typeName}${nameStr}: ${subtags.length - 1} entries`);
      console.log(`${pad}{`);
      for (const st of subtags) st.print(indent + 1);
      console.log(`${pad}}`);
    } else {
      console.log(`${pad}${typeName}${nameStr}: ${this.value}`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Validates input data for core binary tag parsing and serialization.
   *
   * @param expected - Input value for the _assert operation.
   */
  private _assert(expected: TagType): void {
    if (this.type !== expected) {
      throw new TypeError(
        `Expected ${TAG_TYPE_NAMES[expected]} but got ${TAG_TYPE_NAMES[this.type]}` +
        (this.name ? ` (tag: "${this.name}")` : '')
      );
    }
  }
}

/** FINISH singleton matching Java FinishTag.INST */
export const FINISH_TAG = new Tag(TagType.FINISH, null, null);
