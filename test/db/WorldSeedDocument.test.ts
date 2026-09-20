/** @fileoverview Signed seed model boundaries and detached binary/JSON values. */
import { assert } from 'chai';
import { WorldSeedDocument } from '../../src/db/WorldSeedDocument.js';

describe('Format models: WorldSeedDocument', () => {
  it('round-trips signed boundaries without precision loss or aliases', () => {
    for (const seed of [-0x8000000000000000n, -1n, 0n, 0x7fffffffffffffffn]) {
      const document = new WorldSeedDocument(seed), bytes = document.toBuffer();
      const parsed = WorldSeedDocument.fromBuffer(bytes); bytes.fill(0);
      assert.equal(parsed.seed, seed); assert.equal(JSON.parse(JSON.stringify(parsed)).seed, seed.toString());
      assert.equal(parsed.withSeed(19n).seed, 19n); assert.equal(parsed.seed, seed);
    }
  });
  it('rejects inexact values and explicit byte budget excesses', () => {
    for (const seed of [1, 1.5, 0x8000000000000000n, -0x8000000000000001n]) assert.throws(() => new WorldSeedDocument(seed as bigint));
    assert.throws(() => new WorldSeedDocument(0n, {maxBytes: 7}));
    assert.throws(() => WorldSeedDocument.fromBuffer(Buffer.alloc(7)));
    assert.throws(() => WorldSeedDocument.fromBuffer(Buffer.alloc(8), {maxBytes: 7}));
  });
});
