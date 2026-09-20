/** @fileoverview Position identity and immutable ownership for inventories stored in manager containers. */
import { assert } from 'chai';
import { InventoryLocation } from '../../../src/objects/components/InventoryLocation.js';
import { Inventory } from '../../../src/objects/components/Inventory.js';

describe('InventoryLocation', () => {
  it('uses the full signed block position independently of inventory kind', () => {
    const position = { x: -1, y: 16, z: 32 }, location = new InventoryLocation(3, position, Inventory.EMPTY);
    position.x = 7; assert.equal(location.key, '-1,16,32'); assert.equal(location.kind, 3);
    assert.strictEqual(location.inventory, Inventory.EMPTY); assert.isTrue(Object.isFrozen(location.position));
    assert.throws(() => new InventoryLocation(-1, position, Inventory.EMPTY));
    assert.throws(() => new InventoryLocation(3, { x: 0.5, y: 0, z: 0 }, Inventory.EMPTY));
  });
});
