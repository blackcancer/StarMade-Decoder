/** @fileoverview Integer coordinate addressing for entity grids, segment cells and SMD3 regions. */
import { DecodeError } from '../core/DecodeError.js';
import type { BlockPosition } from '../objects/ElementPosition.js';

/** Verifies signed int32 entity-grid coordinates; fractions are never rounded silently. */
export function validateBlockPosition(position: BlockPosition): void {
  for (const value of [position.x, position.y, position.z]) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
      throw new DecodeError('E_RANGE', 'Block coordinates must be signed int32 integers');
    }
  }
}

/** Segment origin in entity-grid coordinates, including floor division for negative positions. */
export function segmentOriginOf(position: BlockPosition): BlockPosition {
  validateBlockPosition(position);
  return { x: Math.floor(position.x / 32) * 32, y: Math.floor(position.y / 32) * 32, z: Math.floor(position.z / 32) * 32 };
}

/** Local cell coordinates in [0,31], even for negative entity-grid positions. */
export function localPositionOf(position: BlockPosition): BlockPosition {
  validateBlockPosition(position);
  return { x: position.x & 31, y: position.y & 31, z: position.z & 31 };
}

/** SMD3 region coordinates; region boundaries include the game's eight-segment shift. */
export function regionCoordinatesOf(position: BlockPosition): BlockPosition {
  validateBlockPosition(position);
  return { x: ((position.x >> 5) + 8) >> 4, y: ((position.y >> 5) + 8) >> 4, z: ((position.z >> 5) + 8) >> 4 };
}

/** Stable key for an already validated integer position. */
export function blockPositionKey(position: BlockPosition): string { return `${position.x},${position.y},${position.z}`; }
