/** @fileoverview Strict simulation contracts, immutable updates, bounded reads and source preservation. */
import { assert } from 'chai';
import fs from 'node:fs';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { readFrom, readTagDocument, writeTo } from '../../src/core/TagParser.js';
import { SimulationGroup, SimulationState, NPCFactionManager } from '../../src/objects/Simulation.js';
import { envelope, groupTag, metadata, omit, replace, stateTag } from '../helpers/simulation.js';

/** Compare complete typed trees, including all names and opaque payload bytes. */
function same(a: Tag, b: Tag): void { assert.deepEqual(writeTo(a), writeTo(b)); }

describe('Simulation strict preservation', () => {
  it('reads all supported group types, required sector and subtype metadata without losing extensions', () => {
    for (const type of [0, 1, 2]) for (const version of [0, 1]) {
      const tag = groupTag(type, version), model = SimulationGroup.fromTag(tag);
      same(model.toTag(), tag); same(model.metadata, metadata(type));
      assert.deepEqual(model.startSector, { x: 1, y: -2, z: 3 }); assert.equal(model.startTime, 1234567890123456n);
      assert.deepEqual(model.members, ['ENTITY_A', 'ENTITY_B']); assert.equal(model.programId, 1);
      assert.include(model.toString(), 'SimulationGroup');
    }
    const noProgram = new SimulationGroup(1, 1, [], 0n, { x: 0, y: 0, z: 0 }, -2147483648);
    assert.equal(SimulationGroup.fromTag(noProgram.toTag()).programId, -2147483648);
    assert.equal(new SimulationGroup(1, 1, [], 0n, { x: 0, y: 0, z: 0 }, 0).programId, 0);
  });

  it('patches only selected fields and supports exact reverts of nested metadata, names and member edits', () => {
    const original = groupTag(), group = SimulationGroup.fromTag(original);
    const changed = group.with({ members: ['ENTITY_C'], startSector: { x: 5, y: 6, z: 7 } });
    same(changed.toTag(), replace(replace(original, 2, Tags.struct('members', [Tags.string('first', 'ENTITY_C')])),
      4, Tags.vector3i('origin-sector', 5, 6, 7)));
    same(changed.with({ members: group.members, startSector: group.startSector }).toTag(), original);
    const meta = group.metadata; meta.getStruct()[1] = Tags.string('target-uid', 'ENTITY_New');
    const next = group.with({ metadata: meta }); same(next.toTag(), replace(original, 6, meta));
    same(next.with({ metadata: group.metadata }).toTag(), original);
    const appended = group.with({ members: [...group.members, 'ENTITY_C'] }).toTag().getStruct()[2].getStruct();
    assert.equal(appended[0].name, 'first'); assert.equal(appended[2].getString(), 'ENTITY_C');
  });

  it('detaches constructor arguments, getters, trees and immutable state snapshots', () => {
    const members = ['A'], sector = { x: 0, y: 0, z: 0 }, meta = metadata();
    const group = new SimulationGroup(1, 2, members, 0n, sector, 1, meta);
    members[0] = 'Changed'; sector.x = 99; meta.getStruct()[1] = Tags.string(null, 'Changed');
    group.members.push('Extra'); group.startSector.y = 99; group.metadata.getStruct()[1] = Tags.string(null, 'Changed');
    assert.deepEqual(group.members, ['A']); assert.equal(group.startSector.x, 0); assert.equal(group.startSector.y, 0);
    assert.equal(group.metadata.getStruct()[1].getString(), 'ENTITY_Target'); assert.isFrozen(group);
    const input = stateTag(), state = SimulationState.fromTag(input); input.getStruct()[3] = Tags.string(null, 'Changed');
    state.toTag().getStruct()[3] = Tags.string(null, 'Changed'); same(state.toTag(), stateTag());
    const groups = [group], created = new SimulationState(0, groups, 1n); groups.length = 0; created.groups.length = 0;
    assert.lengthOf(created.groups, 1); assert.isFrozen(created); assert.isFrozen(created.groups[0]);
    const added = state.addGroup(group); assert.lengthOf(added.groups, 2); assert.lengthOf(state.groups, 1);
    same(added.removeGroup(1).toTag(), state.toTag());
    assert.equal(added.withLastUpdate(20n).uniqueGroups, 20n); assert.equal(added.withUniqueGroups(21n).lastUpdate, 21n);
    assert.include(state.toString(), 'uniqueGroups=9007199254740993');
    for (const index of [-1, 1, 1.5, NaN]) assert.throws(() => state.removeGroup(index), /index/);
  });

  it('retains original envelopes exactly through edits and reverts, including the legacy absent counter', () => {
    for (const compressed of [false, true]) {
      const bytes = envelope(stateTag(), compressed), input = Buffer.from(bytes), state = SimulationState.fromBuffer(new Uint8Array(input));
      input.fill(0); assert.deepEqual(state.toBuffer(), bytes); const output = state.toBuffer(); output.fill(0);
      const edited = state.withUniqueGroups(9007199254740994n), document = readTagDocument(edited.toBuffer());
      assert.equal(document.compressed, compressed); assert.deepEqual(document.trailingData, Buffer.from([5, 0, 255, 18]));
      if (!compressed) assert.equal(document.version, 23);
      assert.equal(SimulationState.fromBuffer(edited.toBuffer()).uniqueGroups, 9007199254740994n);
      assert.deepEqual(edited.withUniqueGroups(state.uniqueGroups).toBuffer(), bytes);
    }
    const old = Tags.struct('SimulationState', [Tags.byte(null, 0), Tags.struct(null, [])]);
    const legacy = SimulationState.fromTag(old); assert.equal(legacy.uniqueGroups, 0n); same(legacy.toTag(), old);
    assert.equal(legacy.withUniqueGroups(4n).toTag().getStruct()[2].getLong(), 4n);
    same(legacy.withUniqueGroups(4n).withUniqueGroups(0n).toTag(), old);
  });

  it('rejects missing/shifted mandatory group fields instead of silently inventing defaults', () => {
    for (let slot = 0; slot < 6; slot++) {
      assert.throws(() => SimulationGroup.fromTag(replace(groupTag(), slot, Tags.string(null, 'wrong'))), /field types/);
    }
    const withoutMetadata = Tags.struct(null, groupTag().getStruct().slice(0, 6));
    assert.throws(() => SimulationGroup.fromTag(withoutMetadata), /metadata is missing/);
    assert.throws(() => SimulationGroup.fromTag(omit(groupTag(), 4)), /field types/);
    assert.throws(() => SimulationGroup.fromTag(replace(groupTag(), 2, Tags.struct(null, [Tags.int(null, 7)]))), /STRING/);
    assert.throws(() => SimulationState.fromTag(Tags.struct(null, [])), /field types/);
    assert.throws(() => SimulationState.fromTag(replace(stateTag(), 2, Tags.string(null, 'wrong'))), /uniqueGroups/);
    assert.throws(() => SimulationState.fromTag(replace(stateTag(), 1, Tags.struct(null, [Tags.byte(null, 0)]))), /Compound/);
    assert.throws(() => NPCFactionManager.fromTag(Tags.struct(null, [])), /field types/);
    for (const type of [SimulationGroup, SimulationState, NPCFactionManager]) assert.throws(() => type.fromTag(Tags.byte(null, 0)), /Compound/);
  });

  it('rejects unsupported versions/types/programs, malformed subtype metadata and scalar overflow', () => {
    const group = SimulationGroup.fromTag(groupTag());
    for (const changes of [{ version: 2 }, { version: NaN }, { type: 3 }, { type: -1 }, { programId: 2 }]) {
      assert.throws(() => group.with(changes), /Unsupported/);
    }
    assert.throws(() => group.with({ startSector: null as any }), /startSector/);
    assert.throws(() => group.with({ metadata: Tags.byte(null, 0) }), /Attack metadata/);
    assert.throws(() => group.with({ metadata: Tags.struct(null, []) }), /field types/);
    assert.throws(() => group.with({ type: 0 }), /Target-sector/);
    assert.throws(() => group.with({ metadata: new Tag(TagType.FINISH, null, null) }), /metadata must occupy/);
    for (const changes of [{ programId: NaN }, { programId: -2147483649 }, { startTime: 1n << 63n },
      { startSector: { x: .5, y: 0, z: 0 } }, { members: [42 as any] }]) assert.throws(() => group.with(changes));
    assert.throws(() => new SimulationState(1, [], 0n), /state version/);
    assert.throws(() => new NPCFactionManager(1), /NPC manager version/);
    assert.throws(() => new SimulationState(0, [], 1n << 63n));
  });

  it('propagates caller budgets through reads, immutable edits and unknown deep fields', () => {
    const bytes = writeTo(stateTag());
    for (const options of [{ maxInputBytes: 1 }, { maxInflatedBytes: 1 }, { maxDepth: 1 }, { maxNodes: 1 }, { maxListLength: 0 }]) {
      assert.throws(() => SimulationState.fromBuffer(bytes, options));
    }
    const base = new SimulationState(0, [], 0n), count = readFrom(base.toBuffer());
    const constrained = SimulationState.fromBuffer(base.toBuffer(), { maxNodes: 6 });
    same(constrained.toTag(), count); assert.throws(() => constrained.addGroup(SimulationGroup.fromTag(groupTag())), /budget/);
    let deep = Tags.byte(null, 0); for (let i = 0; i < 70; i++) deep = Tags.struct(null, [deep]);
    const root = replace(stateTag(), 3, deep), deepBytes = writeTo(root, { maxDepth: 100 });
    const options = { maxDepth: 100 }, decoded = SimulationState.fromBuffer(deepBytes, options); options.maxDepth = 1;
    assert.deepEqual(decoded.withUniqueGroups(4n).withUniqueGroups(decoded.uniqueGroups).toBuffer(), deepBytes);
    const shared = { remainingNodes: 1000 }, sharedInflation = { remainingBytes: 100000 };
    const node = SimulationState.fromBuffer(envelope(stateTag(), true), { sharedNodeBudget: shared, sharedInflationBudget: sharedInflation });
    const remaining = shared.remainingNodes, bytesLeft = sharedInflation.remainingBytes;
    node.withUniqueGroups(10n).toBuffer(); assert.equal(shared.remainingNodes, remaining); assert.equal(sharedInflation.remainingBytes, bytesLeft);
  });

  it('retains NPC manager extensions/envelopes and validates its options', () => {
    const tag = Tags.struct('npc-manager', [Tags.byte('version', 0), Tags.string('unknown', 'keep')]);
    for (const compressed of [false, true]) {
      const bytes = envelope(tag, compressed), model = NPCFactionManager.fromBuffer(bytes);
      assert.isFrozen(model); same(model.toTag(), tag); assert.deepEqual(model.with({}).toBuffer(), bytes);
      assert.deepEqual(model.with({ version: 0 }).toBuffer(), bytes); assert.include(model.toString(), 'v0');
    }
    assert.equal(NPCFactionManager.fromBuffer(new NPCFactionManager(0).toBuffer()).version, 0);
    assert.throws(() => NPCFactionManager.fromBuffer(writeTo(tag), { maxNodes: 1 }));
    const model = NPCFactionManager.fromTag(tag); const out = model.toTag(); out.getStruct()[1] = Tags.string(null, 'changed'); same(model.toTag(), tag);
  });

  it('round-trips the actual server simulation and NPC manager samples exactly', () => {
    for (const [file, Type] of [['SIMULATION_STATE.sim', SimulationState], ['NPCFACTIONS_0_0_0.tag', NPCFactionManager]] as const) {
      const bytes = fs.readFileSync(`samples/${file}`), model = Type.fromBuffer(bytes); assert.deepEqual(model.toBuffer(), bytes);
    }
  });
});
