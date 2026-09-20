/** @fileoverview Integer coordinate boundaries used by storage, editing and renderers. */
import { assert } from 'chai';
import { validateBlockPosition, segmentOriginOf, localPositionOf, regionCoordinatesOf, blockPositionKey } from '../../src/smd3/BlockCoordinates.js';

describe('BlockCoordinates', () => {
  it('uses negative floor division and shifted region boundaries', () => {
    const position = { x: -1, y: 32, z: -33 };
    assert.deepEqual(segmentOriginOf(position), { x: -32, y: 32, z: -64 });
    assert.deepEqual(localPositionOf(position), { x: 31, y: 0, z: 31 });
    assert.equal(blockPositionKey(position), '-1,32,-33');
    assert.deepEqual(regionCoordinatesOf({ x: -257, y: -256, z: 256 }), { x: -1, y: 0, z: 1 });
    assert.deepEqual(regionCoordinatesOf({ x: -0x80000000, y: 0x7fffffff, z: 255 }), { x: -4194304, y: 4194304, z: 0 });
    for (const value of [-0x80000001, 0x80000000, 1.5, NaN, Infinity]) {
      for (const axis of ['x', 'y', 'z']) assert.throws(() => validateBlockPosition({ x: 0, y: 0, z: 0, [axis]: value }));
    }
  });
});
