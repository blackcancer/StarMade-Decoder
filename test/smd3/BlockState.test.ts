/** @fileoverview Complete immutable storage words and catalogue hitpoint conversion contracts. */
import { assert } from 'chai';
import { BlockState } from '../../src/smd3/BlockState.js';

describe('BlockState', () => {
  it('preserves all 32 bits and produces detached structural values', () => {
    const source = { type: 8191, hp: 127, active: true, orientation: 31, extra: 63 };
    const block = new BlockState(source); source.type = 0;
    assert.equal(block.toWord(), 0xffffffff);
    assert.deepEqual(block.toJSON(), { type: 8191, hp: 127, active: true, orientation: 31, extra: 63 });
    assert.deepEqual(BlockState.fromWord(0xffffffff).toJSON(), block.toJSON());
    assert.equal(BlockState.fromWord(0).toWord(), 0);
    assert.isTrue(BlockState.create(0).isAir);
    assert.isFalse(BlockState.create(5).isAir);
    assert.equal(BlockState.create(5).hp, 127);
    assert.equal(BlockState.create(5, { hp: 19, active: true, orientation: 3, extra: 2 }).hp, 19);
    const changed = block.with({ type: 4, hp: 0, active: false, orientation: 0, extra: 0 });
    assert.equal(changed.toWord(), 4); assert.equal(block.type, 8191);
    changed.toJSON().type = 22; assert.equal(changed.type, 4);
    assert.isTrue(Object.isFrozen(block));
    for (const word of [-1, 0x100000000, 1.5, NaN]) assert.throws(() => BlockState.fromWord(word));
    assert.throws(() => block.with({ type: -1 }));
    assert.equal(BlockState.create(0, { extra: 63, hp: 42 }).extra, 63);
  });

  it('distinguishes stored health from real hitpoints and validates the definition', () => {
    const block = BlockState.create(5, { hp: 64 }), definition = { id: 5, hp: 1000 };
    assert.equal(block.fullHitpoints(definition), 503);
    assert.equal(block.withFullHitpoints(500, definition).hp, 64);
    assert.equal(block.withFullHitpoints(1000, definition).hp, 127);
    assert.equal(block.withFullHitpoints(0, definition).hp, 0);
    for (const hp of [0, -1, NaN, 1.5, 0x80000000]) assert.throws(() => block.fullHitpoints({ id: 5, hp }));
    assert.throws(() => block.fullHitpoints({ id: 6, hp: 100 }));
    assert.throws(() => block.withFullHitpoints(1001, definition));
  });
});
