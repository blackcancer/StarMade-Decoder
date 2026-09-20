/** @fileoverview Segment ownership, iteration, metadata and renderer export contracts. */
import { assert } from 'chai';
import { Segment } from '../../src/smd3/Segment.js';
import { BlockState } from '../../src/smd3/BlockState.js';
import { BlockDefinition, BlockConfig } from '../../src/config/BlockConfig.js';
import { emptySegment } from '../../src/smd3/Smd3Writer.js';

describe('Segment', () => {
  it('edits independent segments and exports complete data without aliasing', () => {
    const segment = new Segment({ x: -32, y: 32, z: 64 });
    assert.equal(segment.x, -32); assert.equal(segment.y, 32); assert.equal(segment.z, 64);
    assert.equal(segment.blockCount, 0); assert.equal(segment.version, 7);
    assert.equal(new Segment().x, 0);
    segment.setTimestamp(-0x8000000000000000n);
    const value = { type: 5, hp: 127, orientation: 31, active: true, extra: 63 };
    segment.set(31, 0, 16, value); value.type = 8;
    assert.equal(segment.blockCount, 1); assert.equal(segment.get(31, 0, 16).type, 5);
    assert.equal(segment.lastChanged, -0x8000000000000000n);
    const config = BlockConfig.fromBlocks([BlockDefinition.create({ id: 5, name: 'Hull' })]);
    const [placed] = [...segment.entries(config)];
    assert.deepEqual(placed.position, { x: -1, y: 32, z: 80 }); assert.equal(placed.definition!.name, 'Hull');
    assert.equal([...segment.entries()][0].state.extra, 63);
    assert.isTrue(segment.entries(undefined, true).next().value!.state.isAir);
    const exported = segment.toData(); exported.blocks[31 + 16 * 1024].type = 42;
    assert.equal(segment.get(31, 0, 16).type, 5); assert.equal(exported.blockCount, 1);
    const words = segment.toPackedWords(); assert.equal(words[31 + 16 * 1024], 0xffffe005);
    words.fill(0); assert.equal(segment.blockCount, 1);
    const json = JSON.parse(JSON.stringify(segment));
    assert.equal(json.lastChanged, '-9223372036854775808'); assert.equal(json.words.length, 32768);
    assert.equal(json.words[31 + 16 * 1024], 0xffffe005);
    segment.set(31, 0, 16, BlockState.create(0)); assert.equal(segment.blockCount, 0);
    segment.setTimestamp(0x7fffffffffffffffn); assert.equal(segment.lastChanged, 0x7fffffffffffffffn);
  });

  it('makes ownership explicit and rejects invalid models before mutation', () => {
    const raw = emptySegment(); raw.blockCount = 999;
    const copied = Segment.fromData(raw), attached = Segment.attach(raw);
    assert.equal(attached.blockCount, 0);
    attached.set(0, 0, 0, BlockState.create(7)); assert.equal(raw.blocks[0].type, 7);
    assert.equal(copied.get(0, 0, 0).type, 0);
    copied.set(0, 0, 0, BlockState.create(8)); assert.equal(raw.blocks[0].type, 7);
    assert.throws(() => attached.set(32, 0, 0, BlockState.create(5)));
    assert.throws(() => attached.set(0, 0, 0, { type: -1, hp: 0, active: false, orientation: 0 }));
    assert.equal(attached.get(0, 0, 0).type, 7);
    for (const origin of [{ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 31 }]) assert.throws(() => new Segment(origin));
    for (const timestamp of [1 as unknown as bigint, -0x8000000000000001n, 0x8000000000000000n]) assert.throws(() => attached.setTimestamp(timestamp));
    assert.throws(() => Segment.attach({ ...raw, blocks: [] }));
    assert.throws(() => Segment.attach({ ...raw, version: -1 }));
    raw.blocks[0].type = -1; assert.throws(() => Segment.attach(raw));
  });
});
