/**
 * @fileoverview Element Position
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * ElementPosition — helper for decoding/encoding block positions
 * in StarMade 48-bit long format.
 *
 * Java encoding (ElementCollection):
 *   index = ((z & 0xFFFF) << 32) | ((y & 0xFFFF) << 16) | (x & 0xFFFF)
 *   x = (short)(index & 0xFFFF)
 *   y = (short)((index >> 16) & 0xFFFF)
 *   z = (short)((index >> 32) & 0xFFFF)
 *
 * writeIndexAsShortPos: 3×short (x, y, z)
 *
 * Source: ElementCollection.java
 */

export interface BlockPosition { x: number; y: number; z: number; }

/** Encode (x, y, z) en index long StarMade (48 bits). */
export function posToIndex(x: number, y: number, z: number): bigint {
  return (BigInt(z & 0xFFFF) << 32n) | (BigInt(y & 0xFFFF) << 16n) | BigInt(x & 0xFFFF);
}

/** Decodes a StarMade long index into a position (x, y, z). */
export function indexToPos(index: bigint): BlockPosition {
  const x = Number((index & 0xFFFFn) > 0x7FFFn ? (index & 0xFFFFn) - 0x10000n : (index & 0xFFFFn));
  const y = Number(((index >> 16n) & 0xFFFFn) > 0x7FFFn ? ((index >> 16n) & 0xFFFFn) - 0x10000n : ((index >> 16n) & 0xFFFFn));
  const z = Number(((index >> 32n) & 0xFFFFn) > 0x7FFFn ? ((index >> 32n) & 0xFFFFn) - 0x10000n : ((index >> 32n) & 0xFFFFn));
  return { x, y, z };
}
