/** @fileoverview Immutable serialized sector coordinates and full 16-component entity matrices; no geometry calculations. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { Matrix4f } from '../../types/Matrices.js';

/** Named matrix slots in the persisted row-major order, including the four previously discarded values. */
const slots = ['m00','m01','m02','m03','m10','m11','m12','m13','m20','m21','m22','m23','originX','originY','originZ','m33'] as const;
/** Serializable edits; these are stored coordinates, with no normalization or matrix arithmetic. */
export type EntityTransformChanges = Partial<Record<typeof slots[number], number>>;
/** Checks the finite float32 representation before serialization can round an overflow to infinity. */
function float(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE', 'Transform requires finite float32 values');
  return Math.fround(value);
}
/** Converts a full row-major array into the wire matrix object. */
function matrix(values: readonly number[]): Matrix4f { return new Matrix4f(...values); }
/** Keeps a source name unless the caller explicitly requests a different one. */
function renamed(tag: Tag, name?: string | null): Tag { return name === undefined ? tag : Tags.rename(tag, name); }

/** An immutable signed-int32 sector coordinate retaining its source name and limits. */
export class SectorPosition {
  #file: TagModelFile;
  readonly x: number; readonly y: number; readonly z: number;
  /** Creates a validated coordinate; an internal source carries the original name across edits. */
  constructor(x: number, y: number, z: number, options: TagReadOptions = {}, source?: TagModelFile) {
    this.#file = source ?? new TagModelFile(Tags.vector3i(null, x, y, z), options);
    const value = this.#file.root.getVector3i(); this.x = value.x; this.y = value.y; this.z = value.z; Object.freeze(this);
  }
  static readonly ZERO = new SectorPosition(0, 0, 0);
  /** Snapshots a VECTOR3i Tag, rejecting wrong types and out-of-range coordinates. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): SectorPosition {
    return new SectorPosition(0, 0, 0, options, new TagModelFile(tag, options));
  }
  /** Creates a coordinate from three signed-int32 values. */
  static fromValues(x: number, y: number, z: number, options: TagReadOptions = {}): SectorPosition { return new SectorPosition(x, y, z, options); }
  /** Returns a detached Tag, retaining its name unless explicitly overridden. */
  toTag(name?: string | null): Tag { return renamed(this.#file.root, name); }
  /** Changes only supplied coordinate values and retains source naming and resource limits. */
  with(changes: Partial<{x: number; y: number; z: number}>): SectorPosition {
    const value = {x:this.x, y:this.y, z:this.z};
    for (const key of ['x','y','z'] as const) if (changes[key] !== undefined) value[key] = changes[key];
    return SectorPosition.fromTag(Tags.vector3i(this.#file.root.name, value.x, value.y, value.z), this.#file.options);
  }
  /** Compares serialized coordinates. */
  equals(other: SectorPosition): boolean { return this.x === other.x && this.y === other.y && this.z === other.z; }
  /** Diagnostic representation. */
  toString(): string { return `SectorPosition(${this.x}, ${this.y}, ${this.z})`; }
}

/** Immutable LIST/FLOAT or MATRIX4f value preserving all sixteen wire components. */
export class EntityTransform {
  #file: TagModelFile;
  #values: readonly number[];
  readonly originX!: number; readonly originY!: number; readonly originZ!: number;
  readonly m00!: number; readonly m01!: number; readonly m02!: number; readonly m03!: number;
  readonly m10!: number; readonly m11!: number; readonly m12!: number; readonly m13!: number;
  readonly m20!: number; readonly m21!: number; readonly m22!: number; readonly m23!: number; readonly m33!: number;
  /** Creates the existing twelve-value projection with canonical remaining values (0,0,0,1). */
  constructor(originX: number, originY: number, originZ: number,
    m00: number, m01: number, m02: number, m10: number, m11: number, m12: number,
    m20: number, m21: number, m22: number, options: TagReadOptions = {}, source?: TagModelFile) {
    this.#file = source ?? new TagModelFile(Tags.list(null, [m00,m01,m02,0,m10,m11,m12,0,m20,m21,m22,0,originX,originY,originZ,1].map(value => Tags.float(null, float(value)))), options);
    const root = this.#file.root;
    if (root.type === TagType.LIST) {
      if (root.listType !== TagType.FLOAT || root.getList().length !== 16) throw new DecodeError('E_FORMAT', 'EntityTransform requires exactly 16 FLOAT values');
      this.#values = Object.freeze(root.getList().map(value => float(value.getFloat())));
    } else {
      const m = root.getMatrix4f(); this.#values = Object.freeze(Array.from({length:16}, (_, index) => float(m[`m${Math.floor(index / 4)}${index % 4}` as keyof Matrix4f] as number)));
    }
    slots.forEach((key,index) => Object.defineProperty(this,key,{value:this.#values[index],enumerable:true}));
    Object.freeze(this);
  }
  static readonly IDENTITY = new EntityTransform(0,0,0,1,0,0,0,1,0,0,0,1);
  /** Copies a strictly typed sixteen-float LIST. */
  static fromMatrix4fList(tag: Tag, options: TagReadOptions = {}): EntityTransform {
    if (tag.type !== TagType.LIST) throw new TypeError('EntityTransform: expected LIST');
    return EntityTransform.read(tag, options);
  }
  /** Copies a MATRIX4f without changing its four non-projected components. */
  static fromMatrix4fTag(tag: Tag, options: TagReadOptions = {}): EntityTransform {
    if (tag.type !== TagType.MATRIX4f) throw new TypeError('EntityTransform: expected MATRIX4f');
    return EntityTransform.read(tag, options);
  }
  /** Constructs a validated projection around an immutable complete wire value. */
  private static read(tag: Tag, options: TagReadOptions): EntityTransform { return new EntityTransform(0,0,0,1,0,0,0,1,0,0,0,1,options,new TagModelFile(tag, options)); }
  /** Emits the original wire variant, with a detached mutable Tag tree. */
  toTag(name?: string | null): Tag { return renamed(this.#file.root, name); }
  /** Explicitly converts all sixteen stored values to a FLOAT LIST. */
  toMatrix4fList(name?: string | null): Tag { return Tags.list(name === undefined ? this.#file.root.name : name, this.#values.map(value => Tags.float(null,value))); }
  /** Explicitly converts all sixteen stored values to MATRIX4f. */
  toMatrix4fTag(name?: string | null): Tag { return Tags.matrix4f(name === undefined ? this.#file.root.name : name, matrix(this.#values)); }
  /** Changes supplied scalar components while retaining every other value and the source wire variant. */
  with(changes: EntityTransformChanges): EntityTransform {
    const values = [...this.#values];
    slots.forEach((key,index) => { if (changes[key] !== undefined) values[index] = float(changes[key]); });
    const root = this.#file.root;
    return EntityTransform.read(root.type === TagType.LIST ? Tags.list(root.name, values.map(value => Tags.float(null,value))) : Tags.matrix4f(root.name,matrix(values)), this.#file.options);
  }
  /** Diagnostic representation. */
  toString(): string { return `EntityTransform(origin=(${this.originX.toFixed(2)},${this.originY.toFixed(2)},${this.originZ.toFixed(2)}))`; }
}
