/**
 * @fileoverview Context-dependent SINGLE_SIDE_EDGE geometry.
 *
 * Implements the three strict half-space tests used by IcosahedronHelper and
 * SegmentDataSingleSideEdge in StarMade-Open (reference commit decf3a1990f29).
 * The game loads normals from data/IcoVectors.bin. They are not guessed or
 * redistributed here: the caller supplies the bytes from its own installation.
 * Each multiplication/addition is rounded as a Java float operation.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { DecodeError } from '../core/DecodeError.js';

/** One single-precision plane normal. */
export interface IcoNormal { readonly x: number; readonly y: number; readonly z: number; }
/** The three normals defining a side of the game's icosahedral planet. */
export type IcoSideNormals = readonly [IcoNormal, IcoNormal, IcoNormal];

/**
 * Reads the first nine big-endian floats of the game's IcoVectors.bin.
 * @param data - Complete file bytes, or its first 36 bytes.
 * @returns Three validated normals, rounded to single precision.
 * @throws {DecodeError} For truncated, non-finite, or zero normals.
 * @example
 * const normals = readIcoSideNormals(fs.readFileSync('data/IcoVectors.bin'));
 * const file = parseSmd3(bytes, { sideNormals: normals });
 */
export function readIcoSideNormals(data: Buffer | Uint8Array): IcoSideNormals {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (b.length < 36) throw new DecodeError('E_TRUNCATED', 'IcoVectors.bin needs at least 36 bytes');
  return normalizeIcoSideNormals(Array.from({ length: 3 }, (_, i) => ({
    x: b.readFloatBE(i * 12), y: b.readFloatBE(i * 12 + 4), z: b.readFloatBE(i * 12 + 8),
  })) as unknown as IcoSideNormals);
}

/**
 * Validates and snapshots the normals supplied by a caller.
 * @param normals - Exactly three finite, non-zero plane normals.
 * @returns A defensive single-precision copy.
 * @throws {DecodeError} For an invalid normal set.
 */
export function normalizeIcoSideNormals(normals: IcoSideNormals): IcoSideNormals {
  if (!Array.isArray(normals) || normals.length !== 3) throw new DecodeError('E_RANGE', 'Exactly three side normals are required');
  return normals.map(n => {
    if (!n || ![n.x, n.y, n.z].every(Number.isFinite)) throw new DecodeError('E_RANGE', 'Side normals must be finite');
    const result = { x: Math.fround(n.x), y: Math.fround(n.y), z: Math.fround(n.z) };
    if (![result.x, result.y, result.z].every(Number.isFinite) || !(result.x || result.y || result.z)) {
      throw new DecodeError('E_RANGE', 'Invalid single-precision side normal');
    }
    return Object.freeze(result);
  }) as unknown as IcoSideNormals;
}

/**
 * Tests a block center using the same float ordering as Java.
 * @param x - Segment-local block coordinate minus 16 plus segment position.
 * @param y - Segment-local block coordinate minus 16 plus segment position.
 * @param z - Segment-local block coordinate minus 16 plus segment position.
 * @param normals - Validated normals from the game installation.
 * @returns True only when all three plane dot products are strictly positive.
 */
export function isPointInIcoSide(x: number, y: number, z: number, normals: IcoSideNormals): boolean {
  const f = Math.fround;
  x = f(x); y = f(y); z = f(z);
  return normals.every(n => f(f(f(n.x * x) + f(n.y * y)) + f(n.z * z)) > 0);
}
