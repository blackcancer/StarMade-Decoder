/** @fileoverview Positional snapshots expose storage coordinates without renderer transformations. */
import { assert } from 'chai';
import { PlacedBlock } from '../../src/smd3/PlacedBlock.js';
import { BlockState } from '../../src/smd3/BlockState.js';
import { BlockDefinition } from '../../src/config/BlockConfig.js';

describe('PlacedBlock', () => {
  it('captures position independently and resolves optional block metadata', () => {
    const position = { x: -1, y: 16, z: 32 }, state = BlockState.create(5);
    const definition = BlockDefinition.create({ id: 5, name: 'Hull' });
    const block = new PlacedBlock(position, state, definition); position.x = 42;
    assert.equal(block.position.x, -1); assert.strictEqual(block.definition, definition);
    assert.deepEqual(block.localPosition, { x: 31, y: 16, z: 0 });
    assert.deepEqual(block.segmentOrigin, { x: -32, y: 0, z: 32 });
    const json = block.toJSON(); json.position.x = 90; json.state.hp = 0;
    assert.equal(block.position.x, -1); assert.equal(block.state.hp, 127);
    assert.isTrue(Object.isFrozen(block)); assert.isTrue(Object.isFrozen(block.position));
    assert.isUndefined(new PlacedBlock(position, state).definition);
    assert.throws(() => new PlacedBlock({ x: 0.5, y: 0, z: 0 }, state));
    assert.deepEqual(JSON.parse(JSON.stringify(block)).state, state.toJSON());
  });
});
