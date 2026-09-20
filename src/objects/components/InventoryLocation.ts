/** @fileoverview Inventories are located by block position; their kind is a separate property. */
import { boundedInteger } from '../../core/DecodeError.js';
import type { BlockPosition } from '../ElementPosition.js';
import { validateBlockPosition, blockPositionKey } from '../../smd3/BlockCoordinates.js';
import type { Inventory } from './Inventory.js';

/** Immutable location within one entity; multiple cargo inventories may have the same kind. */
export class InventoryLocation {
  readonly position: Readonly<BlockPosition>;
  /** Captures the inventory's kind and signed-int32 storage position. */
  constructor(readonly kind: number, position: BlockPosition, readonly inventory: Inventory) {
    boundedInteger(kind, 'inventory kind', 0x7fffffff); validateBlockPosition(position);
    this.position = Object.freeze({ ...position }); Object.freeze(this);
  }
  /** Stable position key, independent of inventory kind. */
  get key(): string { return blockPositionKey(this.position); }
}
