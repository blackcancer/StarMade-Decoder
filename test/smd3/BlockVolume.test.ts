/** @fileoverview Sparse grid allocation, live ownership and negative-region persistence. */
import { assert } from 'chai';
import { BlockVolume } from '../../src/smd3/BlockVolume.js';
import { BlockState } from '../../src/smd3/BlockState.js';
import { BlockConfig, BlockDefinition } from '../../src/config/BlockConfig.js';
import { emptySegment, emptySmd3File, writeSmd3 } from '../../src/smd3/Smd3Writer.js';
import { parseSmd3 } from '../../src/smd3/Smd3Parser.js';
import type { Smd3File } from '../../src/smd3/Smd3Parser.js';

describe('BlockVolume', () => {
  it('allocates shifted positive/negative regions and exports actual writable geometry', () => {
    const files: Smd3File[] = [], config = BlockConfig.fromBlocks([BlockDefinition.create({ id: 5, name: 'Hull' })]);
    const grid = new BlockVolume(files, { config });
    assert.equal(grid.blockCount, 0); assert.equal(grid.get({ x: 9, y: 0, z: 0 }).type, 0);
    assert.isUndefined(grid.segmentAt({ x: 0, y: 0, z: 0 }));
    grid.remove({ x: 0, y: 0, z: 0 }); assert.equal(grid.segmentCount, 0);
    for (const x of [-257, -256, -1, 0, 31, 32, 255, 256]) grid.set({ x, y: 16, z: 16 }, BlockState.create(5));
    assert.equal(grid.blockCount, 8); assert.equal(files.length, 3); assert.equal(grid.segmentCount, 7);
    assert.equal(grid.blockAt({ x: -1, y: 16, z: 16 }).definition!.name, 'Hull');
    assert.deepEqual([...grid.countsByType()], [[5, 8]]);
    const roundTrip = BlockVolume.fromFiles(grid.toFiles().map(file => parseSmd3(writeSmd3(file))));
    assert.deepEqual([...roundTrip.entries()].map(block => block.toJSON()), [...grid.entries()].map(block => block.toJSON()));
    assert.isUndefined(roundTrip.blockAt({ x: 0, y: 16, z: 16 }).definition);
    grid.remove({ x: 0, y: 16, z: 16 }); assert.equal(grid.blockCount, 7); assert.equal(roundTrip.blockCount, 8);
    assert.isTrue(grid.entries(true).next().value!.state.isAir);
    const first = grid.segments[0], timestamp = first.lastChanged;
    grid.set({ x: -257, y: 16, z: 16 }, BlockState.create(7));
    assert.equal(first.lastChanged, timestamp); assert.equal(grid.get({ x: -257, y: 16, z: 16 }).type, 7);
    assert.equal(grid.countsByType().get(5), 6); assert.equal(grid.countsByType().get(7), 1);
    const snapshot = grid.toFiles(); snapshot[0].segments[0].blocks.fill(BlockState.create(0).toJSON());
    assert.equal(grid.get({ x: -257, y: 16, z: 16 }).type, 7);
  });

  it('retains nonzero raw air fields and explicitly binds known empty region locations', () => {
    const grid = new BlockVolume();
    grid.set({ x: 0, y: 0, z: 0 }, BlockState.create(0, { extra: 63 }));
    assert.equal(grid.segmentCount, 1); assert.equal(grid.blockCount, 0); assert.equal(grid.get({ x: 0, y: 0, z: 0 }).extra, 63);
    const empty = emptySmd3File(), files = [empty], hint = { x: -1, y: 0, z: 0 };
    const bound = new BlockVolume(files, { regionCoordinates: new Map([[empty, hint]]) });
    hint.x = 40;
    bound.set({ x: -257, y: 0, z: 0 }, BlockState.create(5));
    assert.equal(files.length, 1); assert.strictEqual(files[0], empty); assert.equal(empty.usedSlots, 1);
    assert.equal(bound.refresh().blockCount, 1);
    const anonymousEmpty = new BlockVolume([emptySmd3File()]); assert.equal(anonymousEmpty.segmentCount, 0);
    anonymousEmpty.set({ x: 0, y: 0, z: 0 }, BlockState.create(5)); assert.equal(anonymousEmpty.toFiles().length, 1);
    const copied = BlockVolume.fromFiles(files); copied.remove({ x: -257, y: 0, z: 0 }); assert.equal(bound.blockCount, 1);
  });

  it('validates completeness, positions, ambiguity and budgets before allocating or editing', () => {
    const file = { ...emptySmd3File(), segments: [emptySegment()] };
    for (const broken of [{ ...file, complete: false }, { ...file, diagnostics: [{ code: 'E_FORMAT' as const, message: 'omitted' }] }]) {
      assert.throws(() => new BlockVolume([broken]));
    }
    assert.throws(() => new BlockVolume([file], { maxSegments: 0 }));
    assert.throws(() => new BlockVolume([], { maxSegments: -1 }));
    for (const x of [0.5, -4194305, 4194305]) assert.throws(() => new BlockVolume([file], {
      regionCoordinates: new Map([[file, { x, y: 0, z: 0 }]])
    }));
    assert.throws(() => new BlockVolume([file], { regionCoordinates: new Map([[file, { x: 1, y: 0, z: 0 }]]) }));
    assert.throws(() => new BlockVolume([{ ...file, segments: [emptySegment(), emptySegment(512)] }]));
    assert.throws(() => new BlockVolume([file, file]));
    assert.throws(() => new BlockVolume([file, { ...emptySmd3File(), segments: [emptySegment(32)] }]));
    const raw = emptySmd3File(); raw.segments.push(emptySegment());
    const files = [raw], grid = new BlockVolume(files, { maxSegments: 1 });
    assert.throws(() => grid.set({ x: 32, y: 0, z: 0 }, BlockState.create(1)));
    assert.equal(grid.segmentCount, 1); assert.equal(files.length, 1);
    assert.throws(() => grid.set({ x: 0.5, y: 0, z: 0 }, BlockState.create(1)));
    assert.throws(() => grid.set({ x: 0, y: 0, z: 0 }, { type: -1, hp: 0, active: false, orientation: 0 }));
    raw.segments.push(emptySegment(32)); assert.throws(() => grid.refresh()); assert.equal(grid.segmentCount, 1);
    raw.segments.pop(); raw.segments[0].blocks[0].type = 5;
    assert.equal(grid.refresh().blockCount, 1);
    raw.segments[0].version = 5;
    assert.throws(() => grid.set({ x: 0, y: 0, z: 0 }, BlockState.create(2)));
    assert.equal(raw.segments[0].blocks[0].type, 5);
    raw.segments[0].version = 6; grid.set({ x: 0, y: 0, z: 0 }, BlockState.create(2));
    assert.equal(grid.get({ x: 0, y: 0, z: 0 }).type, 2);
  });
});
