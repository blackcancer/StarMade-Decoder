/**
 * @fileoverview Vectors
 *
 * Defines shared math and geometry types used across the StarMade decoder.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/** Vector3b — 3 composantes int8 (x, y, z) */
export class Vector3b {
  /**
   * Creates a Vector3b instance.
   *
   * @param x - Input value for the constructor operation.
   * @param y - Input value for the constructor operation.
   * @param z - Input value for the constructor operation.
   */
  constructor(public x: number, public y: number, public z: number) {}
  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `Vector3b(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector3i — 3 composantes int32 (x, y, z) */
export class Vector3i {
  /**
   * Creates a Vector3i instance.
   *
   * @param x - Input value for the constructor operation.
   * @param y - Input value for the constructor operation.
   * @param z - Input value for the constructor operation.
   */
  constructor(public x: number, public y: number, public z: number) {}
  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `Vector3i(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector3f — 3 composantes float32 (x, y, z) */
export class Vector3f {
  /**
   * Creates a Vector3f instance.
   *
   * @param x - Input value for the constructor operation.
   * @param y - Input value for the constructor operation.
   * @param z - Input value for the constructor operation.
   */
  constructor(public x: number, public y: number, public z: number) {}
  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `Vector3f(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector4f — 4 composantes float32 (x, y, z, w) */
export class Vector4f {
  /**
   * Creates a Vector4f instance.
   *
   * @param x - Input value for the constructor operation.
   * @param y - Input value for the constructor operation.
   * @param z - Input value for the constructor operation.
   * @param w - Input value for the constructor operation.
   */
  constructor(
    public x: number, public y: number,
    public z: number, public w: number
  ) {}
  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `Vector4f(${this.x}, ${this.y}, ${this.z}, ${this.w})`; }
}
