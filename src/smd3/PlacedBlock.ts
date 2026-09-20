/** @fileoverview A block value located in one entity's grid, with optional catalogue metadata. */
import type { BlockDefinition } from '../config/BlockConfig.js';
import type { BlockPosition } from '../objects/ElementPosition.js';
import { BlockState } from './BlockState.js';
import { localPositionOf, segmentOriginOf, validateBlockPosition } from './BlockCoordinates.js';

/** Immutable positional snapshot; attached entities keep separate grids and transforms. */
export class PlacedBlock {
  readonly position: Readonly<BlockPosition>;
  /** Captures a position and an immutable state; catalogue lookup may legitimately be absent. */
  constructor(position: BlockPosition, readonly state: BlockState, readonly definition?: BlockDefinition) {
    validateBlockPosition(position);
    this.position = Object.freeze({ ...position });
    Object.freeze(this);
  }
  /** Local cell inside its 32-cube segment. */
  get localPosition(): BlockPosition { return localPositionOf(this.position); }
  /** Segment origin in entity-grid coordinates. */
  get segmentOrigin(): BlockPosition { return segmentOriginOf(this.position); }
  /** JSON-safe snapshot with the full block definition kept outside mesh payloads. */
  toJSON(): { position: BlockPosition; state: ReturnType<BlockState['toJSON']> } {
    return { position: { ...this.position }, state: this.state.toJSON() };
  }
}
