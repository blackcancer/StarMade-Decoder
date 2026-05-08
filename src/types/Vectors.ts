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
  constructor(public x: number, public y: number, public z: number) {}
  toString(): string { return `Vector3b(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector3i — 3 composantes int32 (x, y, z) */
export class Vector3i {
  constructor(public x: number, public y: number, public z: number) {}
  toString(): string { return `Vector3i(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector3f — 3 composantes float32 (x, y, z) */
export class Vector3f {
  constructor(public x: number, public y: number, public z: number) {}
  toString(): string { return `Vector3f(${this.x}, ${this.y}, ${this.z})`; }
}

/** Vector4f — 4 composantes float32 (x, y, z, w) */
export class Vector4f {
  constructor(
    public x: number, public y: number,
    public z: number, public w: number
  ) {}
  toString(): string { return `Vector4f(${this.x}, ${this.y}, ${this.z}, ${this.w})`; }
}
