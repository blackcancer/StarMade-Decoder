/**
 * @fileoverview Transform
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SectorPosition — StarMade sector coordinates.
 *
 * A sector is a universe region identified by (x, y, z) en int32.
 * Port of sector Vector3i in SimpleTransformableSendableObject.
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';

/**
 * Represents the SectorPosition model used by high-level entity component modelling.
 */
export class SectorPosition {
  /**
   * Creates a SectorPosition instance.
   *
   * @param x - Input value for the constructor operation.
   * @param y - Input value for the constructor operation.
   * @param z - Input value for the constructor operation.
   */
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  static ZERO = new SectorPosition(0, 0, 0);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SectorPosition {
    if (tag.type !== TagType.VECTOR3i) throw new TypeError('SectorPosition: expected VECTOR3i');
    const v = tag.getVector3i();
    return new SectorPosition(v.x, v.y, v.z);
  }

  /**
   * Creates a value from Values.
   *
   * @param x - Input value for the fromValues operation.
   * @param y - Input value for the fromValues operation.
   * @param z - Input value for the fromValues operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromValues(x: number, y: number, z: number): SectorPosition {
    return new SectorPosition(x, y, z);
  }

  /**
   * Converts this value to Tag.
   *
   * @param name - Input value for the toTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  toTag(name: string | null = null): Tag {
    return Tags.vector3i(name, this.x, this.y, this.z);
  }

  /**
   * Handles the equals operation used by high-level entity component modelling.
   *
   * @param other - Input value for the equals operation.
   * @returns The computed StarMade-Decoder value.
   */
  equals(other: SectorPosition): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `SectorPosition(${this.x}, ${this.y}, ${this.z})`; }
}

// ── EntityTransform ────────────────────────────────────────────────────────────

/**
 * EntityTransform — position and orientation in StarMade space.
 *
 * Port of com.bulletphysics.linearmath.Transform :
 *   origin : Vector3f (absolute position in the sector)
 *   basis  : Matrix3f (matrice de rotation 3×3)
 *
 * In Tags, the transform is stored as a LIST of 16 floats
 * (Matrix4f row-major) in SimpleTransformableSendableObject.toTagStructure().
 * Or directly as MATRIX4f in some contexts.
 *
 * Source: TransformTools.serializeFully = Matrix3f (9f) + Vector3f (3f)
 */

export class EntityTransform {
  /**
   * Creates a EntityTransform instance.
   *
   * @param originX - Input value for the constructor operation.
   * @param originY - Input value for the constructor operation.
   * @param originZ - Input value for the constructor operation.
   * @param m00 - Input value for the constructor operation.
   * @param m01 - Input value for the constructor operation.
   * @param m02 - Input value for the constructor operation.
   * @param m10 - Input value for the constructor operation.
   * @param m11 - Input value for the constructor operation.
   * @param m12 - Input value for the constructor operation.
   * @param m20 - Input value for the constructor operation.
   * @param m21 - Input value for the constructor operation.
   * @param m22 - Input value for the constructor operation.
   */
  constructor(
    /** Position in local sector coordinates */
    readonly originX: number,
    readonly originY: number,
    readonly originZ: number,
    /** Matrice de rotation 3×3 (row-major) */
    readonly m00: number, readonly m01: number, readonly m02: number,
    readonly m10: number, readonly m11: number, readonly m12: number,
    readonly m20: number, readonly m21: number, readonly m22: number,
  ) {}

  static IDENTITY = new EntityTransform(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);

  /**
   * Parses from a LIST de 16 floats (Matrix4f format in PlayerCharacter/SimpleTransformable).
   * Ordre row-major : [m00,m01,m02,m03, m10,m11,m12,m13, m20,m21,m22,m23, tx,ty,tz,1]
   */
  static fromMatrix4fList(tag: Tag): EntityTransform {
    if (tag.type !== TagType.LIST) throw new TypeError('EntityTransform: expected LIST');
    const floats = tag.getList().map(t => t.getFloat());
    if (floats.length < 16) return EntityTransform.IDENTITY;
    // Matrix4f layout : row-major
    // [0..3]=row0, [4..7]=row1, [8..11]=row2, [12..15]=row3
    // Translation = column 3 of the transpose = row3 x,y,z
    return new EntityTransform(
      floats[12], floats[13], floats[14],   // origin (tx, ty, tz)
      floats[0],  floats[1],  floats[2],    // row0 → col0 of the rotation
      floats[4],  floats[5],  floats[6],    // row1 → col1
      floats[8],  floats[9],  floats[10],   // row2 → col2
    );
  }

  /** Parses from a direct MATRIX4f Tag. */
  static fromMatrix4fTag(tag: Tag): EntityTransform {
    if (tag.type !== TagType.MATRIX4f) throw new TypeError('EntityTransform: expected MATRIX4f');
    const m = tag.getMatrix4f();
    return new EntityTransform(
      m.m30, m.m31, m.m32,
      m.m00, m.m01, m.m02,
      m.m10, m.m11, m.m12,
      m.m20, m.m21, m.m22,
    );
  }

  /** Rebuilds the 16-float LIST. */
  toMatrix4fList(name: string | null = null): Tag {
    const floats = [
      this.m00, this.m01, this.m02, 0,
      this.m10, this.m11, this.m12, 0,
      this.m20, this.m21, this.m22, 0,
      this.originX, this.originY, this.originZ, 1,
    ].map(f => Tags.float(null, f));
    return Tags.list(name, floats);
  }

  /**
   * Returns a copy updated with the requested value.
   *
   * @param overrides - Input value for the with operation.
   * @returns The computed StarMade-Decoder value.
   */
  with(overrides: Partial<{
    originX: number; originY: number; originZ: number;
    m00: number; m01: number; m02: number;
    m10: number; m11: number; m12: number;
    m20: number; m21: number; m22: number;
  }>): EntityTransform {
    return new EntityTransform(
      overrides.originX ?? this.originX,
      overrides.originY ?? this.originY,
      overrides.originZ ?? this.originZ,
      overrides.m00 ?? this.m00, overrides.m01 ?? this.m01, overrides.m02 ?? this.m02,
      overrides.m10 ?? this.m10, overrides.m11 ?? this.m11, overrides.m12 ?? this.m12,
      overrides.m20 ?? this.m20, overrides.m21 ?? this.m21, overrides.m22 ?? this.m22,
    );
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `EntityTransform(origin=(${this.originX.toFixed(2)},${this.originY.toFixed(2)},${this.originZ.toFixed(2)}))`;
  }
}
