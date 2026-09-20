/** @fileoverview Simulation DTO edits, strict writer behavior and exact envelope preservation. */
import { assert } from 'chai';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo } from '../../src/core/TagParser.js';
import { parseSim, simulationFromFields } from '../../src/smd3/SimParser.js';
import { writeSim } from '../../src/smd3/SimWriter.js';
import { SimulationGroup, SimulationState } from '../../src/objects/Simulation.js';
import { envelope, groupTag, metadata, replace, stateTag } from '../helpers/simulation.js';

describe('Simulation DTO preservation', () => {
  it('preserves original envelopes and persists nested DTO edits through the live model accessor', () => {
    for (const compressed of [false, true]) {
      const original = envelope(stateTag(), compressed), input = Buffer.from(original), file = parseSim(new Uint8Array(input)); input.fill(0);
      assert.deepEqual(writeSim(file), original); file.groups[0].members[0] = 'ENTITY_New';
      file.groups[0].startSector.x = 40; file.groups[0].metadata!.getStruct()[1] = Tags.string('target-uid', 'Target_New');
      const model = file.simulation!; assert.deepEqual(model.groups[0].members, ['ENTITY_New', 'ENTITY_B']);
      const read = parseSim(writeSim(file)); assert.equal(read.groups[0].startSector.x, 40);
      assert.equal(read.groups[0].metadata!.getStruct()[1].getString(), 'Target_New');
      assert.equal(read.rootTag!.getStruct()[3].getString(), 'preserved');
      file.groups[0].members[0] = 'ENTITY_A'; file.groups[0].startSector.x = 1; file.groups[0].metadata = metadata();
      assert.deepEqual(writeSim(file), original);
      const output = writeSim(file); output.fill(0); assert.deepEqual(writeSim(file), original);
    }
  });

  it('keeps counter aliases coherent and resets the projection when assigning an immutable model edit', () => {
    const file = parseSim(writeTo(stateTag()));
    file.lastUpdate = 12n; assert.equal(file.uniqueGroups, 12n); assert.equal(file.simulation!.uniqueGroups, 12n);
    file.uniqueGroups = 13n; assert.equal(file.lastUpdate, 13n);
    file.simulation = file.simulation!.withUniqueGroups(14n).addGroup(SimulationGroup.fromTag(groupTag(1)));
    assert.lengthOf(file.groups, 2); assert.equal(file.uniqueGroups, 14n);
    assert.equal(parseSim(writeSim(file)).lastUpdate, 14n);
    const snapshot = file.rootTag!; snapshot.getStruct()[3] = Tags.string(null, 'External mutation');
    assert.equal(file.rootTag!.getStruct()[3].getString(), 'preserved');
    assert.throws(() => { file.simulation = null; }, /SimulationState/);
    assert.throws(() => simulationFromFields({ version: 0, groups: [], uniqueGroups: 1n, lastUpdate: 2n }), /Conflicting/);
  });

  it('writes bare DTOs, preserves supplied raw fields and accepts an explicit immutable snapshot', () => {
    const group = SimulationGroup.fromTag(groupTag()), raw = group.toTag();
    const dto = { version: group.version, type: group.type, members: group.members, startTime: group.startTime,
      startSector: group.startSector, programId: group.programId, metadata: group.metadata };
    const created = parseSim(writeSim({ version: 0, groups: [dto], uniqueGroups: 91n }));
    assert.equal(created.uniqueGroups, 91n); assert.deepEqual(created.groups[0].members, group.members);
    const rawOnly = { ...dto, raw, metadata: undefined };
    const preserved = parseSim(writeSim({ version: 0, groups: [rawOnly], rootTag: stateTag(), lastUpdate: 92n }));
    assert.equal(preserved.uniqueGroups, 92n); assert.deepEqual(writeTo(preserved.groups[0].raw!), writeTo(raw));
    const explicit = new SimulationState(0, [group], 93n);
    assert.equal(parseSim(writeSim({ version: 0, groups: [], simulation: explicit })).uniqueGroups, 93n);
    assert.equal(parseSim(writeSim({ version: 0, groups: [] })).uniqueGroups, 0n);
    const emptyMeta = { version: 1, type: 1, members: [], startTime: 0n, startSector: { x: 0, y: 0, z: 0 }, programId: -1 };
    assert.equal(parseSim(writeSim({ version: 0, groups: [emptyMeta] })).groups[0].metadata!.getByte(), 0);
  });

  it('rejects malformed roots, unsupported versions and invalid DTO edits instead of emitting plausible shells', () => {
    assert.throws(() => parseSim(writeTo(Tags.int(null, 42))), /Compound/);
    assert.throws(() => parseSim(writeTo(Tags.struct(null, []))), /field types/);
    assert.throws(() => parseSim(writeTo(replace(stateTag(), 0, Tags.byte(null, 2)))), /state version/);
    assert.throws(() => writeSim({ version: 0, groups: [], rootTag: Tags.int(null, 42) }), /Compound/);
    const file = parseSim(writeTo(stateTag())); file.groups[0].startSector = null as any;
    assert.throws(() => writeSim(file), /startSector/);
  });

  it('propagates read and write limits, retaining deep data and protecting shared counters from rereads', () => {
    const bytes = writeTo(stateTag()); assert.throws(() => parseSim(bytes, { maxInputBytes: 1 }));
    const file = parseSim(bytes); assert.throws(() => writeSim(file, { maxInputBytes: 1 }));
    assert.deepEqual(writeSim(file, { maxInputBytes: bytes.length }), bytes);
    assert.throws(() => writeSim({ version: 0, groups: [], uniqueGroups: 0n }, { maxNodes: 1 }));
    let deep = Tags.byte(null, 0); for (let i = 0; i < 70; i++) deep = Tags.struct(null, [deep]);
    const root = replace(stateTag(), 3, deep), original = writeTo(root, { maxDepth: 100 }), options = { maxDepth: 100 };
    const parsed = parseSim(original, options); options.maxDepth = 1;
    assert.deepEqual(writeSim(parsed), original); parsed.uniqueGroups = 1n;
    assert.equal(SimulationState.fromBuffer(writeSim(parsed), { maxDepth: 100 }).uniqueGroups, 1n);
    const shared = { remainingNodes: 1000 }, dto = parseSim(bytes, { sharedNodeBudget: shared }), left = shared.remainingNodes;
    dto.simulation!.toBuffer(); writeSim(dto); assert.equal(shared.remainingNodes, left);
  });
});
