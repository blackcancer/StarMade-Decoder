/** @fileoverview Faction wire contracts and preservation from independently built current/legacy records. */
import { assert } from 'chai';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { readFrom, writeTo, readTagDocument } from '../../src/core/TagParser.js';
import { registerAllFactories } from '../../src/serializable/Factories.js';
import { Faction, FactionManager, FactionMember, FactionRelation, RELATION_WAR, RELATION_ALLY, RELATION_NEUTRAL } from '../../src/objects/Factions.js';
import { parseFactions } from '../../src/entity/Factions.js';

/** Source schema: role masks and names are parallel five-entry STRUCTs. */
function roles(id = 7): Tag {
  return Tags.struct('0', [Tags.int('factionId', id),
    Tags.struct('masks', [0n, 2n, 4n, 8n, 0x4000000000000010n].map(v => Tags.long(null, v))),
    Tags.struct('names', ['Visitor', 'Builder', 'Pilot', 'Officer', 'Owner'].map(v => Tags.string(null, v))),
    Tags.byteArray('extension', Buffer.from([0, 255, 19]))]);
}
/** Source FactionPermission persists BYTE role, activity, position and last-seen time. */
function member(name = 'Ada', role = 4): Tag {
  return Tags.struct('member-record', [Tags.string('uid', name), Tags.byte('rank', role), Tags.long('active', 123n),
    Tags.vector3i('seen-sector', 12, -5, 91), Tags.long('seen-at', 456n), Tags.string('future-member', 'retained')]);
}
/** Thirty current faction fields followed by an extension; no SDK faction writer is used. */
function faction(id = 7): Tag {
  return Tags.struct('f0', [Tags.string('code', 'retain-code'), Tags.string('name', `Faction-${id}`), Tags.string('description', 'Before'),
    Tags.long('created', 123n), Tags.struct('mem', [member(), member('Lin', 1)]),
    Tags.byte('open', 1), roles(id), Tags.string('home', 'ENTITY_HOME'), Tags.string('pw', 'unchanged'), Tags.int('id', id),
    Tags.byte('fn', 1), Tags.byte('en', 0), Tags.vector3i('home-sector', 4, 5, 6), Tags.byte('aw', 1),
    Tags.struct('enemies', [Tags.string(null, 'Pirate')]), Tags.int('mode', 2), Tags.vector3f('color', .25, .5, .75),
    Tags.byte('hub', 1), Tags.float('points', 19.5), Tags.int('inactive', 3),
    ...Array.from({ length: 6 }, (_, i) => Tags.float(`stat-${i}`, i + .5)), Tags.int('deaths', 9), Tags.float('lost', 2.25),
    Tags.struct('systems', [Tags.vector3i(null, 1, 2, 3)]), Tags.struct('additional', [Tags.byteArray('raw', Buffer.from([3, 0, 255]))]),
    Tags.string('future-faction', 'extension')]);
}
/** A wrapper retains both its own name and extension fields. */
function wrapper(id: number): Tag { return Tags.struct(`entry-${id}`, [Tags.int('key', id), faction(id), Tags.long('entry-extension', 99n)]); }
/** Current manager layout, including invitations and the ID generator. */
function manager(): Tag {
  return Tags.struct('factions-v2', [Tags.byte('version', 0), Tags.struct('preset', [Tags.string(null, 'preset')]),
    Tags.struct('configs', [Tags.long(null, 123n)]), Tags.struct('factions', [wrapper(7), wrapper(-20000)]),
    Tags.struct('custom-invites', [Tags.string('invite-extension', 'invitation')]), Tags.struct('NStruct', [Tags.string(null, 'news')]),
    Tags.struct('relations', [Tags.struct('relation', [Tags.int('a', 7), Tags.int('b', -20000), Tags.byte('state', 2), Tags.string('future', 'relation-extension')])]),
    Tags.struct('offers', [Tags.string(null, 'offer')]), Tags.long('updated', 999n), Tags.struct('npc-news', [Tags.string(null, 'npc-event')]),
    Tags.int('creator', -19999), Tags.byteArray('future-manager', Buffer.from([0, 255, 7]))]);
}
/** Structural equality uses independently serialized bytes, preserving names/types/order. */
function same(a: Tag, b: Tag): void { assert.deepEqual(writeTo(a), writeTo(b)); }
/** Returns an edited fixture rather than reconstructing unrelated slots. */
function patch(tag: Tag, index: number, value: Tag): Tag {
  const entries = [...tag.getStruct()]; entries[index] = value;
  return new Tag(TagType.STRUCT, tag.name, entries);
}

describe('Factions preservation and immutable validation', () => {
  it('retains manager, wrapper, faction and member fields across no-op, edits and exact reverts', () => {
    const original = manager(), model = FactionManager.fromTag(original);
    same(model.toTag(), original);
    const changed = model.setFaction(model.get(7)!.with({ description: 'After' }));
    const expectedFaction = patch(faction(), 2, Tags.string('description', 'After'));
    const expectedEntry = patch(wrapper(7), 1, expectedFaction);
    same(changed.toTag(), patch(original, 3, patch(original.getStruct()[3], 0, expectedEntry)));
    same(changed.setFaction(changed.get(7)!.with({ description: 'Before' })).toTag(), original);
    same(model.withLastUpdate(1n).toTag(), patch(original, 8, Tags.long('updated', 1n)));
    assert.equal(model.lastUpdate, 999n);
    assert.throws(() => { (model as any).version = 1; }, TypeError);
  });

  it('preserves member activity and old SDK INT ranks until an explicit immutable edit', () => {
    for (const original of [member(), patch(member(), 1, Tags.int('rank', 4))]) {
      const model = FactionMember.fromTag(original);
      same(model.toTag(), original);
      const changed = model.with({ role: 2 });
      same(changed.toTag(), patch(original, 1, Tags.byte('rank', 2)));
      same(changed.with({ role: 4 }).toTag(), original);
      assert.throws(() => { (model as any).role = 1; }, TypeError);
    }
    const original = faction(), model = Faction.fromTag(original, 7);
    const changed = model.with({ members: [new FactionMember('Ada', 2), model.members[1]] });
    same(changed.toTag(), patch(original, 4, patch(original.getStruct()[4], 0, patch(member(), 1, Tags.byte('rank', 2)))));
    const removed = changed.with({ members: [model.members[1]] });
    assert.equal(removed.members[0].playerUID, 'Lin');
    assert.equal(removed.with({ members: [...removed.members, new FactionMember('New', -1)] }).memberCount, 2);
    const updatedRoles = model.roles; updatedRoles.getStruct()[1].getStruct()[0] = Tags.long(null, 17n);
    assert.equal(model.with({ roles: updatedRoles }).roles.getStruct()[1].getStruct()[0].getLong(), 17n);
    assert.equal(model.roles.getStruct()[1].getStruct()[0].getLong(), 0n);
    assert.equal(model.with({ code: 'new-code' }).toTag().getStruct()[0].getString(), 'new-code');
  });

  it('uses exact relation codes and preserves stored endpoint ordering and extensions', () => {
    assert.equal(RELATION_NEUTRAL, 0); assert.equal(RELATION_WAR, 1); assert.equal(RELATION_ALLY, 2);
    const model = FactionManager.fromTag(manager()), changed = model.setRelation(-20000, 7, RELATION_WAR);
    const relation = changed.getRelation(7, -20000)!;
    assert.isTrue(relation.isWar); assert.isFalse(relation.isAlly); assert.isFalse(relation.isNeutral);
    assert.equal(relation.relationName, 'WAR'); assert.equal(relation.factionA, 7); assert.equal(relation.factionB, -20000);
    assert.equal(changed.toTag().getStruct()[6].getStruct()[0].getStruct()[3].getString(), 'relation-extension');
    assert.isTrue(model.getRelation(-20000, 7)!.isAlly); assert.equal(model.getRelation(7, -20000)!.relationName, 'ALLY');
    assert.isFalse(model.getRelation(7, -20000)!.isWar);
    const neutral = new FactionRelation(1, 2, 0); assert.isTrue(neutral.isNeutral); assert.equal(neutral.relationName, 'NEUTRAL');
    assert.equal(new FactionRelation(1, 2, 99).relationName, 'UNKNOWN');
    const added = changed.setRelation(2, 3, 0).setRelation(7, 9, 2).setRelation(8, 7, 1);
    const replaced = added.setRelation(3, 2, 2);
    assert.equal(replaced.getRelation(2, 3)!.relation, 2);
    assert.equal(replaced.getRelation(7, -20000)!.relation, 1);
    assert.equal(added.getRelation(2, 3)!.relation, 0);
    assert.lengthOf(added.getRelationsOf(7), 3); assert.lengthOf(added.getRelationsOf(2), 1);
    assert.isUndefined(added.getRelation(40, 50));
    const removed = added.removeFaction(7); assert.isUndefined(removed.get(7)); assert.lengthOf(removed.relations, 1);
    same(removed.toTag().getStruct()[4], manager().getStruct()[4]);
    assert.throws(() => { (relation as any).relation = 0; }, TypeError);
    assert.equal(neutral.with({ factionA: 5, factionB: 6 }).factionA, 5);
  });

  it('detaches all constructor collections, roles, source Tags and returned data', () => {
    const input = manager(), model = FactionManager.fromTag(input);
    input.getStruct()[1].getStruct()[0] = Tags.string(null, 'mutated source');
    model.toTag().getStruct()[9].getStruct()[0] = Tags.string(null, 'mutated result');
    model.factions.clear(); model.relations.length = 0; model.get(7)!.members.length = 0;
    model.get(7)!.roles.getStruct()[0] = Tags.int(null, 42);
    same(model.toTag(), manager());
    const revision = model.setFaction(model.get(7)!.with({ description: 'After' }));
    const expected = revision.toBuffer(), detached = revision.toTag();
    detached.getStruct()[3].getStruct()[0].getStruct()[2].value = 100n;
    assert.deepEqual(revision.toBuffer(), expected);
    same(model.toTag(), manager());
    const members = [new FactionMember('Ada', 0)], roleTag = roles();
    const fresh = new Faction(7, 'Created', '', 1n, members, false, '', '', false, true, 1, 0, false, false, roleTag);
    const factions = new Map([[7, fresh]]), relations = [new FactionRelation(7, 8, 0)], archive = new FactionManager(0, factions, relations, 1n);
    members.length = 0; roleTag.getStruct()[0] = Tags.int(null, 42); factions.clear(); relations.length = 0;
    assert.equal(archive.get(7)!.memberCount, 1); assert.equal(archive.relations.length, 1); assert.equal(fresh.roles.getStruct()[0].getInt(), 7);
    const edited = archive.setRelation(7, 8, 2);
    assert.throws(() => { (edited.get(7)!.members[0] as any).playerUID = 'Other'; }, TypeError);
    assert.throws(() => { (edited.get(7) as any).name = 'Other'; }, TypeError);
    assert.equal(archive.get(7)!.members[0].playerUID, 'Ada');
    assert.equal(archive.getRelation(7, 8)!.relation, 0);
  });

  it('preserves GZIP, file version, trailing bytes and exact file reverts', () => {
    for (const compressed of [false, true]) {
      const canonical = writeTo(manager()); canonical.writeInt16BE(9);
      const tail = Buffer.from([99, 1, 0, 255]);
      const original = compressed ? gzipSync(Buffer.concat([canonical.subarray(2), tail])) : Buffer.concat([canonical, tail]);
      const input = Buffer.from(original), model = FactionManager.fromBuffer(new Uint8Array(input)); input.fill(0);
      assert.deepEqual(model.toBuffer(), original);
      const output = model.toBuffer(); output.fill(0); assert.deepEqual(model.toBuffer(), original);
      const changed = model.setRelation(7, -20000, 1), document = readTagDocument(changed.toBuffer());
      assert.equal(document.compressed, compressed); assert.deepEqual(document.trailingData, tail);
      if (!compressed) assert.equal(document.version, 9);
      assert.deepEqual(changed.setRelation(7, -20000, 2).toBuffer(), original);
    }
  });

  it('retains real v0/v1 manager layouts, including their optional timestamp', () => {
    for (const version of ['factions-v0', 'factions-v1']) for (const time of [false, true]) {
      const old = Tags.struct(version, [Tags.struct('factions', [version === 'factions-v0' ? faction() : wrapper(7)]),
        Tags.struct('invites', [Tags.string(null, 'invitation')]), Tags.struct('news', []),
        Tags.struct('relations', [new FactionRelation(7, 8, 0).toTag()]), Tags.struct('offers', []),
        ...(time ? [Tags.long('time', 10n), Tags.byte('future', 3)] : [])]);
      const model = FactionManager.fromTag(old); assert.equal(model.get(7)!.name, 'Faction-7'); same(model.toTag(), old);
      assert.equal(model.lastUpdate, time ? 10n : 0n);
      const changed = model.setRelation(8, 7, 2).withLastUpdate(20n), output = changed.toTag();
      assert.equal(output.name, version); same(output.getStruct()[1], old.getStruct()[1]);
      assert.equal(output.getStruct()[5].getLong(), 20n); assert.equal(FactionManager.fromTag(output).getRelation(7, 8)!.relation, 2);
      if (time) assert.equal(output.getStruct().length, old.getStruct().length);
    }
  });

  it('accepts actual optional suffixes and fills proper wire fields when they are explicitly introduced', () => {
    for (const count of [2, 3, 4, 5]) {
      const original = Tags.struct('member', member().getStruct().slice(0, count)), model = FactionMember.fromTag(original);
      same(model.toTag(), original); assert.equal(FactionMember.fromTag(model.with({ role: 1 }).toTag()).role, 1);
    }
    for (const count of [13, 14, 15, 16, 17, 18, 26, 28, 29, 30]) {
      const original = Tags.struct('f0', faction().getStruct().slice(0, count)), model = Faction.fromTag(original, 7);
      same(model.toTag(), original);
      const changed = model.with({ factionMode: 7, showInHub: true, factionPoints: 123.5 });
      const result = Faction.fromTag(changed.toTag(), 7);
      assert.equal(result.factionMode, 7); assert.isTrue(result.showInHub); assert.equal(result.factionPoints, 123.5);
      if (count < 26) same(changed.with({ factionMode: model.factionMode, showInHub: model.showInHub, factionPoints: 0 }).toTag(), original);
    }
    const flags = patch(patch(patch(patch(faction(), 5, Tags.byte('open', 2)), 10, Tags.byte('fn', -1)), 11, Tags.byte('en', 2)), 17, Tags.byte('hub', -1));
    const parsed = Faction.fromTag(flags, 7); assert.isFalse(parsed.openToJoin); assert.isTrue(parsed.allyNeutral); assert.isTrue(parsed.attackNeutral); assert.isTrue(parsed.showInHub);
    same(parsed.toTag(), flags);
  });

  it('requires explicit matching roles and derives NPC status from the actual ID interval', () => {
    const create = (payload?: Tag) => new Faction(7, 'Created', '', 1n, [new FactionMember('Ada', 0)], false, '', '', false, true, 1, 0, false, false, payload, 'custom');
    assert.throws(() => create(), /explicit roles/);
    const fresh = create(roles()), tag = fresh.toTag(); assert.equal(tag.name, 'f0'); same(tag.getStruct()[6], roles());
    assert.equal(tag.getStruct()[12].type, TagType.VECTOR3i); assert.equal(tag.getStruct()[14].type, TagType.STRUCT);
    assert.equal(tag.getStruct()[16].type, TagType.VECTOR3f); assert.equal(tag.getStruct()[29].type, TagType.BYTE);
    const archive = new FactionManager(0, new Map([[7, fresh]]), [], 5n), loaded = FactionManager.fromBuffer(archive.toBuffer());
    assert.equal(loaded.get(7)!.name, 'Created'); assert.lengthOf(loaded.playerFactions, 1); assert.lengthOf(loaded.npcFactions, 0);
    assert.include(fresh.toString(), 'members=1'); assert.include(loaded.toString(), '1 factions');
    const added = loaded.setFaction(Faction.fromTag(faction(-20000), -20000)); assert.lengthOf(added.npcFactions, 1);
    assert.equal(FactionManager.fromTag(added.toTag()).factions.size, 2);
    for (const [id, expected] of [[-10000001, false], [-10000000, true], [-10001, true], [-10000, false], [-1, false], [7, false]] as const) assert.equal(Faction.fromTag(faction(id), id).isNPC, expected);
    assert.throws(() => fresh.with({ id: 9 }), /matching id/);
    assert.equal(fresh.with({ id: 9, roles: roles(9) }).id, 9);
    assert.throws(() => fresh.with({ roles: undefined }), /explicit roles/);
  });

  it('rejects malformed roles rather than loading false/default permissions', () => {
    const cases = [Tags.byte(null, 0), Tags.struct('unexpected-name', []), Tags.struct('0', []),
      patch(roles(), 0, Tags.int('factionId', 9)), patch(roles(), 1, Tags.byte('masks', 0)), patch(roles(), 2, Tags.byte('names', 0)),
      patch(roles(), 1, Tags.struct('masks', [])), patch(roles(), 2, Tags.struct('names', [])),
      patch(roles(), 1, patch(roles().getStruct()[1], 0, Tags.int(null, 0))),
      patch(roles(), 2, patch(roles().getStruct()[2], 0, Tags.byte(null, 0)))];
    const model = Faction.fromTag(faction(), 7);
    for (const value of cases) { assert.throws(() => model.with({ roles: value }), /Faction roles/); assert.throws(() => Faction.fromTag(patch(faction(), 6, value), 7)); }
  });

  it('preserves noncanonical wrapper IDs and all unrelated opaque manager fields on sibling edits', () => {
    const original = patch(manager(), 3, Tags.struct('factions', [patch(wrapper(7), 0, Tags.int('legacy-key', 70)), wrapper(-20000)]));
    const model = FactionManager.fromTag(original), changed = model.setFaction(model.get(-20000)!.with({ name: 'Changed' }));
    same(changed.toTag().getStruct()[3].getStruct()[0], original.getStruct()[3].getStruct()[0]);
    for (const index of [1, 2, 4, 5, 7, 9, 10, 11]) same(changed.toTag().getStruct()[index], original.getStruct()[index]);
  });

  it('rejects missing/wrong required and optional wire types without skipping corrupted neighbors', () => {
    const empty = Tags.struct(null, []);
    for (const parse of [() => FactionMember.fromTag(empty), () => FactionRelation.fromTag(empty), () => Faction.fromTag(empty, 7), () => FactionManager.fromTag(empty)]) assert.throws(parse);
    assert.throws(() => FactionManager.fromTag(Tags.int(null, 1)), TypeError);
    assert.throws(() => FactionMember.fromTag(Tags.int(null, 1)), /STRUCT/);
    for (let index = 0; index < 5; index++) assert.throws(() => FactionMember.fromTag(patch(member(), index, Tags.nothing(null))));
    for (let index = 0; index < 3; index++) assert.throws(() => FactionRelation.fromTag(patch(new FactionRelation(7, 8, 0).toTag(), index, Tags.nothing(null))));
    for (let index = 0; index <= 28; index++) assert.throws(() => Faction.fromTag(patch(faction(), index, Tags.nothing(null)), 7));
    for (const count of [19, 25, 27]) assert.throws(() => Faction.fromTag(Tags.struct('f0', faction().getStruct().slice(0, count)), 7), /Incomplete/);
    for (const index of [4, 14, 28]) assert.throws(() => Faction.fromTag(patch(faction(), index, Tags.struct(null, [Tags.byte(null, 1)])), 7));
    for (let index = 0; index < 11; index++) assert.throws(() => FactionManager.fromTag(patch(manager(), index, Tags.nothing(null))));
    assert.throws(() => FactionManager.fromTag(patch(manager(), 0, Tags.byte(null, 1))), /Unsupported/);
    for (const bad of [Tags.byte(null, 1), Tags.struct('wrapper', []), Tags.struct(null, [Tags.int(null, 7)])]) assert.throws(() => FactionManager.fromTag(patch(manager(), 3, Tags.struct(null, [wrapper(7), bad]))));
    assert.throws(() => FactionManager.fromTag(patch(manager(), 6, Tags.struct(null, [new FactionRelation(7, 8, 0).toTag(), empty]))));
    const old = Tags.struct('factions-v1', [Tags.struct(null, []), Tags.struct(null, []), Tags.struct(null, []), Tags.struct(null, []), Tags.struct(null, []), Tags.int(null, 1)]);
    assert.throws(() => FactionManager.fromTag(old));
    assert.throws(() => FactionManager.fromTag(patch(manager(), 3, new Tag(TagType.STRUCT, null, null))));
  });

  it('rejects duplicate identities, invalid mutable input shapes and unrepresentable scalar values', () => {
    assert.throws(() => FactionManager.fromTag(patch(manager(), 3, Tags.struct(null, [wrapper(7), wrapper(7)]))), /Duplicate faction/);
    const model = Faction.fromTag(faction(), 7), relation = new FactionRelation(7, 8, 0);
    assert.throws(() => new FactionManager(0, new Map([[99, model]]), [], 0n), /map key/);
    assert.throws(() => new FactionManager(0, new Map([[7, null as any]]), [], 0n), /map key/);
    assert.throws(() => new FactionManager(0, null as any, [], 0n));
    assert.throws(() => new FactionManager(0, new Map(), null as any, 0n));
    assert.throws(() => new FactionManager(0, new Map(), [null as any], 0n));
    assert.throws(() => new FactionManager(0, new Map(), [relation, new FactionRelation(8, 7, 2)], 0n), /Duplicate faction relation/);
    assert.throws(() => new FactionManager(1, new Map(), [], 0n), /Unsupported/);
    for (const rank of [NaN, -129, 128, 1.5]) assert.throws(() => new FactionMember('Ada', rank), /wire range/);
    assert.throws(() => new FactionRelation(0x80000000, 1, 0), /wire range/);
    assert.throws(() => model.with({ members: [model.members[0], model.members[0]] }), /duplicate/);
    assert.throws(() => model.with({ members: [null as any] }), /Invalid/);
    assert.throws(() => model.with({ members: null as any }), /collection/);
    for (const changes of [{ name: 3 }, { description: null }, { openToJoin: 1 }, { showInHub: 'yes' }]) assert.throws(() => model.with(changes as any), /Invalid faction/);
    for (const factionPoints of [NaN, Infinity, 1e100]) assert.throws(() => model.with({ factionPoints }), /finite float32/);
    assert.throws(() => model.with({ id: 0x80000000 }), /wire range/);
    assert.throws(() => model.with({ factionMode: 1.5 }), /wire range/);
    assert.throws(() => new Faction(7, '', '', 0n, [], false, '', '', false, false, 0, 0, false, true, roles()), /NPC category/);
    assert.throws(() => FactionManager.fromTag(manager()).setFaction(null as any), /replacement/);
    assert.throws(() => FactionManager.fromTag(manager()).removeFaction(NaN), /wire range/);
  });

  it('propagates configurable limits to every snapshot and immutable update without recharging shared budgets', () => {
    const root = manager(), bytes = writeTo(root);
    for (const opts of [{ maxInputBytes: 1 }, { maxInflatedBytes: 1 }, { maxDepth: 2 }, { maxNodes: 1 }, { maxListLength: 2 }]) assert.throws(() => FactionManager.fromBuffer(bytes, opts));
    assert.throws(() => Faction.fromTag(faction(), 7, { maxNodes: 2 }));
    assert.throws(() => FactionMember.fromTag(member(), { maxNodes: 2 }));
    assert.throws(() => FactionRelation.fromTag(new FactionRelation(1, 2, 0).toTag(), { maxNodes: 2 }));
    const counter = { remainingNodes: 10000 }; readFrom(bytes, { sharedNodeBudget: counter });
    const sharedNodeBudget = { remainingNodes: 10000 - counter.remainingNodes };
    const parsed = FactionManager.fromBuffer(bytes, { sharedNodeBudget }); assert.equal(sharedNodeBudget.remainingNodes, 0); same(parsed.toTag(), root);
    const compressed = gzipSync(bytes.subarray(2)), sharedInflationBudget = { remainingBytes: bytes.length - 2 };
    const packed = FactionManager.fromBuffer(compressed, { sharedInflationBudget, maxInputBytes: compressed.length, maxInflatedBytes: bytes.length - 2 });
    assert.equal(sharedInflationBudget.remainingBytes, 0); assert.deepEqual(packed.toBuffer(), compressed);
    let deep = Tags.string(null, 'future'); for (let n = 0; n < 70; n++) deep = Tags.struct(null, [deep]);
    const deepRoot = manager(); deepRoot.getStruct().splice(-1, 0, Tags.rename(deep, 'deep-extension'));
    const opts = { maxDepth: 80 }, deepBytes = writeTo(deepRoot, opts), extended = FactionManager.fromBuffer(deepBytes, opts); opts.maxDepth = 1;
    assert.throws(() => FactionManager.fromBuffer(deepBytes)); assert.deepEqual(extended.toBuffer(), deepBytes);
    assert.ok(readFrom(extended.withLastUpdate(2n).toBuffer(), { maxDepth: 80 }).findByName('deep-extension'));
    assert.equal(parseFactions(deepRoot, { maxDepth: 80 }).totalCount, 2);
    assert.throws(() => parseFactions(deepRoot));
    const bounded = FactionManager.fromBuffer(bytes, { maxInflatedBytes: bytes.length });
    assert.throws(() => bounded.setFaction(bounded.get(7)!.with({ description: 'x'.repeat(bytes.length) })), /limit|budget/i);
  });

  it('retains the full real file while adding a member and supports the typed projection without fabricated credits', () => {
    registerAllFactories(); const original = fs.readFileSync('samples/FACTIONS.fac'), model = FactionManager.fromBuffer(original);
    assert.deepEqual(model.toBuffer(), original);
    const entry = model.all[0], count = entry.memberCount, edited = model.setFaction(entry.with({ members: [...entry.members, new FactionMember('OracleMember', 3)] }));
    const output = FactionManager.fromBuffer(edited.toBuffer()); assert.equal(output.get(entry.id)!.members[count].role, 3);
    same(output.get(entry.id)!.roles, entry.roles);
    for (const slot of [1, 2, 4, 5, 7, 9]) same(output.toTag().getStruct()[slot], model.toTag().getStruct()[slot]);
    assert.deepEqual(edited.setFaction(entry).toBuffer(), original);
    const data = parseFactions(manager()); assert.equal(data.totalCount, 2);
    assert.deepEqual(data.factions.map(f => [f.id, f.name, f.memberCount]), [[7, 'Faction-7', 2], [-20000, 'Faction--20000', 2]]);
    assert.isUndefined(data.factions[0].credits);
    assert.throws(() => parseFactions(Tags.byte(null, 0)), TypeError);
    assert.throws(() => parseFactions(Tags.struct(null, [Tags.byte(null, 0), Tags.struct('preset', [Tags.string(null, 'not a faction')])])));
  });
});
