/**
 * @fileoverview Matrices
 *
 * Defines shared math and geometry types used across the StarMade decoder.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Matrix3f — matrice 3×3 float32, row-major.
 * Wire order: m00 m01 m02 m10 m11 m12 m20 m21 m22
 */
export class Matrix3f {
  constructor(
    public m00 = 0, public m01 = 0, public m02 = 0,
    public m10 = 0, public m11 = 0, public m12 = 0,
    public m20 = 0, public m21 = 0, public m22 = 0,
  ) {}

  toString(): string {
    const f = (n: number) => n.toFixed(4).padStart(9);
    return `Matrix3f:\n[${f(this.m00)} ${f(this.m01)} ${f(this.m02)}]\n` +
           `[${f(this.m10)} ${f(this.m11)} ${f(this.m12)}]\n` +
           `[${f(this.m20)} ${f(this.m21)} ${f(this.m22)}]`;
  }
}

/**
 * Matrix4f — matrice 4×4 float32, row-major.
 * Wire order: m00..m03, m10..m13, m20..m23, m30..m33
 */
export class Matrix4f {
  constructor(
    public m00 = 0, public m01 = 0, public m02 = 0, public m03 = 0,
    public m10 = 0, public m11 = 0, public m12 = 0, public m13 = 0,
    public m20 = 0, public m21 = 0, public m22 = 0, public m23 = 0,
    public m30 = 0, public m31 = 0, public m32 = 0, public m33 = 0,
  ) {}

  toString(): string {
    const f = (n: number) => n.toFixed(4).padStart(9);
    return `Matrix4f:\n` +
      `[${f(this.m00)} ${f(this.m01)} ${f(this.m02)} ${f(this.m03)}]\n` +
      `[${f(this.m10)} ${f(this.m11)} ${f(this.m12)} ${f(this.m13)}]\n` +
      `[${f(this.m20)} ${f(this.m21)} ${f(this.m22)} ${f(this.m23)}]\n` +
      `[${f(this.m30)} ${f(this.m31)} ${f(this.m32)} ${f(this.m33)}]`;
  }
}
