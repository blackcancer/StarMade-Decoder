/**
 * @fileoverview Legacy domain-model defaults, collections and representation variants.
 * Characterizes public fallback behavior while asserting immutable updates and
 * valid tag framing for the supported editing paths.
 */
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../src/core/Tag.js';
import { TagType } from '../src/core/TagType.js';
import { Tags } from '../src/core/TagBuilder.js';
import { writeTo, readFrom } from '../src/core/TagParser.js';
import { BufferWriter } from '../src/core/BufferWriter.js';
import { Matrix4f } from '../src/types/Matrices.js';
import { RawElement } from '../src/serializable/Factories.js';
import { Catalog, CatalogEntry } from '../src/objects/Catalog.js';
import { ChatChannel, ChatChannelManager } from '../src/objects/ChatChannels.js';
import { FloatingItem, FloatingItemsArchive } from '../src/objects/FloatingItems.js';
import { Faction, FactionMember, FactionRelation, FactionManager } from '../src/objects/Factions.js';
import { NPCFactionManager, SimulationGroup, SimulationState } from '../src/objects/Simulation.js';
import { TradeRoute, TradingManager } from '../src/objects/Trading.js';
import { PlayerCharacter, PlayerTransformable } from '../src/objects/PlayerCharacter.js';
import { PlayerState } from '../src/objects/PlayerState.js';
import { SegmentControllerObject } from '../src/objects/SegmentController.js';
import * as Serializable from '../src/objects/Serializables.js';
import { parseCatalog } from '../src/entity/Catalog.js';
import { parseFactions } from '../src/entity/Factions.js';
import { parseFloatingItems } from '../src/entity/FloatingItems.js';
import { parsePlayerState } from '../src/entity/PlayerState.js';
import { parsePlayerCharacter } from '../src/entity/PlayerCharacter.js';
import { parseSegmentController } from '../src/entity/SegmentController.js';

const empty = (): Tag => Tags.struct(null, []);
const bad = (): Tag => new Tag(TagType.STRUCT, null, null);
const slots = (values: Record<number, Tag>, name: string | null = null): Tag => Tags.struct(name,
  Array.from({ length: Math.max(0, ...Object.keys(values).map(Number)) + 1 }, (_, i) => values[i] ?? Tags.nothing(null)));

describe('Legacy model contracts — sparse domain records', () => {
  it('supplies documented defaults for absent fields and rejects invalid manager roots', () => {
    for (const Ctor of [Catalog, ChatChannelManager, FloatingItemsArchive, FactionManager, NPCFactionManager, SimulationState, TradingManager]) {
      assert.throws(() => (Ctor as any).fromTag(Tags.byte(null, 0)), TypeError);
      const model = (Ctor as any).fromTag(empty());
      assert.instanceOf(model, Ctor);
      assert.equal(model.toTag().type, TagType.STRUCT);
      assert.isString(model.toString());
    }
    const ce = CatalogEntry.fromTag(empty());
    assert.equal(ce.uid, ''); assert.equal(ce.price, 0n); assert.equal(ce.classification, 0);
    assert.equal(CatalogEntry.fromTag(slots({ 3: Tags.int(null, 9) })).price, 9n);
    ce.blueprintType = 'future'; assert.equal(CatalogEntry.fromTag(ce.toTag()).blueprintType, 'SHIP');
    assert.equal(CatalogEntry.fromTag(slots({ 8: Tags.int(null, 999) })).blueprintType, 'UNKNOWN(999)');
    assert.equal(FloatingItem.fromTag(empty()).count, 0);
    assert.equal(FloatingItem.fromTag(empty()).blockType, 0);
    assert.equal(FactionMember.fromTag(empty()).playerUID, '');
    assert.equal(FactionMember.fromTag(empty()).role, 0);
    const relation = FactionRelation.fromTag(empty());
    assert.equal(relation.factionA, 0); assert.equal(relation.factionB, 0); assert.isTrue(relation.isNeutral);
    assert.equal(new FactionRelation(1, 2, 99).relationName, 'UNKNOWN');
    const faction = Faction.fromTag(empty(), 7);
    assert.equal(faction.id, 7); assert.equal(faction.name, ''); assert.equal(faction.factionPoints, 0);
    assert.isFalse(faction.openToJoin); assert.isFalse(faction.allyNeutral);
    const group = SimulationGroup.fromTag(empty());
    assert.equal(group.version, 0); assert.equal(group.type, 0); assert.equal(group.startTime, 0n);
    assert.equal(SimulationState.fromTag(empty()).withLastUpdate(12n).lastUpdate, 12n);
    const route = TradeRoute.fromTag(empty());
    assert.equal(route.blockPrice, 0n); assert.equal(route.fleetId, -1n);
    assert.isNull(route.startSystem); assert.equal(TradeRoute.fromTag(route.toTag()).blockPrice, 0n);
    const legacyBlocks = { ...route, blocks: {} };
    assert.equal(TradeRoute.fromTag(TradeRoute.prototype.toTag.call(legacyBlocks)).blocks.totalBlocks, 0);
  });

  it('skips malformed optional collection members, never the valid neighbors', () => {
    const malformedCatalog = Tags.struct(null, [Tags.byte(null, 1), Tags.struct('pv0', [Tags.int(null, 3), bad(), empty()])]);
    assert.equal(Catalog.fromTag(malformedCatalog).entries.length, 1);
    const malformedChannels = Tags.struct(null, [Tags.struct('CHANNELS', [bad(), empty(), Tags.byte(null, 0)])]);
    assert.equal(ChatChannelManager.fromTag(malformedChannels).channels.length, 1);
    const malformedItems = Tags.struct(null, [Tags.struct('floatingItems', [bad(), empty(), Tags.byte(null, 0)])]);
    assert.equal(FloatingItemsArchive.fromTag(malformedItems).items.length, 1);
    const malformedFactions = slots({ 3: Tags.struct(null, [Tags.byte(null, 0), empty(), slots({ 1: bad() }), slots({ 1: empty() })]),
      6: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) });
    assert.equal(FactionManager.fromTag(malformedFactions).factions.size, 1);
    assert.equal(FactionManager.fromTag(malformedFactions).relations.length, 1);
    const withMembers = Faction.fromTag(slots({ 4: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) }), 2);
    assert.equal(withMembers.memberCount, 1);
    for (const Ctor of [SimulationState, TradingManager]) {
      const model = Ctor.fromTag(slots({ 1: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) }));
      assert.equal('groups' in model ? model.groups.length : model.routes.length, 1);
    }
  });

  it('handles v1/v2 channel layouts and immutable channel removal', () => {
    assert.equal(ChatChannel.fromTag(empty()).uid, '');
    for (const version of [0, 1]) {
      const old = ChatChannel.fromTag(slots({ 0: Tags.byte(null, version) }));
      assert.equal(old.password, ''); assert.isFalse(old.isPermanent); assert.isTrue(old.isPublic);
      const full = ChatChannel.fromTag(slots({ 0: Tags.byte(null, version), 1: Tags.string(null, 'old'),
        2: Tags.struct(null, [Tags.string(null, 'mod')]), 3: Tags.struct(null, [Tags.string(null, 'ban')]),
        4: Tags.string(null, 'pw'), 5: Tags.byte(null, 1) }));
      assert.deepEqual(full.moderators, ['mod']); assert.deepEqual(full.banned, ['ban']);
      assert.equal(full.password, 'pw'); assert.isTrue(full.isPermanent);
      assert.deepEqual(ChatChannel.fromTag(full.toTag()), full);
    }
    const a = new ChatChannel('a', '', false, false, [], [], []);
    const b = new ChatChannel('b', 'pw', true, true, [], [], []);
    const manager = new ChatChannelManager(0, [a, b]);
    assert.deepEqual(manager.removeChannel('a').channels, [b]);
    assert.deepEqual(manager.updateChannel('a', b).channels, [b, b]);
    assert.deepEqual(manager.channels, [a, b]);
    assert.deepEqual(ChatChannel.fromTag(a.toTag()), a);
  });

  it('updates both sides of relations and collections without losing other entries', () => {
    const a = Faction.fromTag(empty(), 1), b = Faction.fromTag(empty(), 2);
    a.openToJoin = true; a.allyNeutral = true;
    assert.isTrue(Faction.fromTag(a.toTag(), 1).openToJoin);
    assert.isTrue(Faction.fromTag(a.toTag(), 1).allyNeutral);
    const manager = new FactionManager(0, new Map([[1, a], [2, b]]), [new FactionRelation(1, 2, 0), new FactionRelation(3, 4, 0)], 0n);
    assert.equal(manager.getRelation(2, 1)!.relation, 0);
    assert.equal(manager.setRelation(2, 1, 1).getRelation(1, 2)!.relation, 1);
    assert.equal(manager.setRelation(2, 1, 1).relations.length, 2);
    assert.equal(manager.getRelation(1, 2)!.relation, 0);
    const item = new FloatingItem(5, 2), other = new FloatingItem(6, 1);
    const items = new FloatingItemsArchive(0, 2, [item, other]);
    assert.equal(items.addItem(new FloatingItem(5, 3)).byType(5)!.count, 5);
    assert.equal(items.addItem(new FloatingItem(5, 3)).byType(6)!.count, 1);
    assert.equal(items.byType(5)!.count, 2);
    const entry = CatalogEntry.fromTag(empty()); entry.uid = 'a'; entry.ownerUID = 'User';
    const catalog = new Catalog([entry], [entry]);
    assert.lengthOf(catalog.byOwner('USER'), 2);
    const routes = [TradeRoute.fromTag(empty()), TradeRoute.fromTag(empty()), TradeRoute.fromTag(empty())];
    [[1, 2], [2, 1], [3, 4]].forEach(([from, to], i) => { routes[i].fromFactionId = from; routes[i].toFactionId = to; });
    assert.deepEqual(new TradingManager(0, routes).routesBetween(1, 2), routes.slice(0, 2));
  });

  it('reads sparse players and named sector variants and writes valid controller edits', () => {
    for (const tag of [empty(), Tags.byte(null, 0)]) {
      const pc = PlayerCharacter.fromTag(tag), ps = PlayerState.fromTag(tag), sc = SegmentControllerObject.fromTag(tag);
      assert.equal(pc.id, 0); assert.equal(pc.speed, 4); assert.equal(pc.stepHeight, 0);
      assert.equal(ps.credits, 0n); assert.equal(ps.lastLogin, 0n); assert.equal(ps.lastLogout, 0n);
      assert.equal(ps.lastEnteredEntity, ''); assert.isFalse(ps.hasCreativeMode);
      assert.equal(sc.uniqueId, ''); assert.isNull(sc.minPos); assert.isNull(sc.maxPos);
      assert.isNull(sc.controlElementMapper); assert.isNull(sc.elementCountMap);
      assert.equal(sc.withFactionCode(7).factionCode, 0);
      if (tag.type !== TagType.STRUCT) assert.strictEqual(ps.withCreativeMode(true), ps);
    }
    const tr = PlayerTransformable.fromTag(empty());
    assert.equal(tr.mass, 0.1); assert.isFalse(tr.noAI); assert.isNull(tr.sectorPosition);
    tr.noAI = true; assert.isTrue(PlayerTransformable.fromTag(tr.toTag()).noAI);
    const position = Tags.vector3i('sector', 1, 2, 3), logout = Tags.vector3i('lsector', 4, 5, 6), local = Tags.vector3f('lspawn', 7, 8, 9);
    const ps = PlayerState.fromTag(Tags.struct(null, [position, logout, local, position, Tags.struct('pFac', [Tags.int(null, 1)])]));
    assert.equal(ps.currentSector!.x, 1); assert.equal(ps.logoutSector!.y, 5); assert.equal(ps.logoutLocalPos!.z, 9);
    assert.equal(ps.withFaction(3).factionId, 3);
    const matrix = new Matrix4f();
    const transform = slots({ 1: Tags.matrix4f(null, matrix), 3: position, 4: Tags.int('fid', 7), 5: Tags.string('own', 'user') }, 'transformable');
    const root = Tags.struct(null, [Tags.string('uniqueId', 'id'), Tags.vector3i('minPos', 0, 0, 0), Tags.vector3i('maxPos', 1, 1, 1), transform]);
    const controller = SegmentControllerObject.fromTag(root);
    assert.strictEqual(controller.transform, matrix);
    const edited = controller.withFactionCode(12);
    assert.equal(edited.factionCode, 12);
    assert.equal(SegmentControllerObject.fromTag(readFrom(writeTo(edited.toTag()))).factionCode, 12);
  });
});

describe('Legacy parser contracts — named and positional wire variants', () => {
  it('reads nested catalog entries and ignores non-record separators', () => {
    const inner = Tags.struct('cv0', [Tags.string(null, 'id'), Tags.string(null, 'name'), Tags.string(null, 'description'),
      Tags.int(null, 7), Tags.int(null, 9), Tags.float(null, 2), Tags.byte(null, 1), Tags.nothing(null)]);
    const result = parseCatalog(Tags.struct(null, [Tags.byte(null, 0), Tags.struct('pv0', [Tags.byte(null, 0), Tags.struct(null, [inner])])]));
    assert.deepEqual(result.playerEntries[0], { uid: 'id', name: 'name', description: 'description', price: 7, mass: 2, style: 1 });
  });
  it('keeps absent primitive defaults and reads named matrix/sector fields', () => {
    assert.equal(parseFactions(empty()).version, 0);
    assert.equal(parseFactions(Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [Tags.string(null, 'name')])])).factions[0].id, 1);
    const items = parseFloatingItems(Tags.struct(null, [Tags.struct('floatingItems', [empty()])]));
    assert.equal(items.version, 0); assert.equal(items.declaredCount, 0); assert.isUndefined(items.items[0].type); assert.isUndefined(items.items[0].count);
    assert.equal(parsePlayerState(empty()).credits, 0n);
    assert.equal(parsePlayerState(Tags.struct(null, [Tags.vector3i('sector', 1, 2, 3)])).currentSector!.y, 2);
    assert.deepEqual(parsePlayerCharacter(empty()), { id: 0, speed: 0, stepHeight: 0 });
    const matrix = new Matrix4f();
    const transform = slots({ 1: Tags.matrix4f(null, matrix) }, 'transformable');
    assert.strictEqual(parsePlayerCharacter(Tags.struct(null, [transform])).transform, matrix);
    assert.strictEqual(parseSegmentController(Tags.struct(null, [transform])).transform, matrix);
    const named = Tags.struct(null, [Tags.string('uniqueId', 'id'), Tags.string('realName', 'name'),
      Tags.vector3i('minPos', 1, 2, 3), Tags.vector3i('maxPos', 4, 5, 6)]);
    assert.equal(parseSegmentController(named).minPos!.x, 1);
    for (const name of ['container', 's3']) {
      assert.equal(parseSegmentController(Tags.struct(null, [Tags.byte(name, 0), named])).uniqueId, 'id');
    }
  });
});

describe('Legacy serializable contracts — empty and alternative representations', () => {
  it('handles empty payloads, absent counts and minimal buffered metadata', () => {
    for (const Ctor of [Serializable.ControlElementMapper, Serializable.ElementCountMap, Serializable.LongSet,
      Serializable.BlockBuffer, Serializable.Long2Vector3fMap, Serializable.Long2TransformMap]) {
      const model = (Ctor as any).fromRaw(new Uint8Array());
      assert.instanceOf(model, Ctor);
      assert.isString(model.toString());
    }
    const counts = new Serializable.ElementCountMap([]);
    assert.equal(counts.getCount(999), 0);
    const map = new Serializable.ControlElementMapper([]);
    assert.equal(map.toRawElement().factoryId, 0);
    const buffered = new Serializable.BlockBuffer([{ x: 1, y: 2, z: 3, data: 5, hasMeta: true }]);
    const b = Serializable.BlockBuffer.fromRaw(buffered.toRaw()).blocks[0];
    assert.equal(b.controllerPos, 0n); assert.deepEqual(b.connectedFrom, []);
    const enormous = Buffer.alloc(4); enormous.writeInt32BE(1000001);
    assert.throws(() => Serializable.ControlElementMapper.fromRaw(enormous), /Too many/);
    const unknown = Buffer.alloc(13); unknown[0] = 255;
    assert.equal(Serializable.NPCFactionNewsEvent.fromRaw(unknown).eventType, 'TRADING');
  });
  it('decodes each coordinate-width combination in network controller maps', () => {
    for (let mask = 0; mask < 8; mask++) {
      const w = new BufferWriter();
      w.writeInt32BE(-2); w.writeInt32BE(1);
      for (let i = 0; i < 3; i++) w.writeInt16BE(0);
      w.writeInt32BE(1); w.writeInt16BE(5); w.writeInt32BE(1);
      for (let i = 0; i < 3; i++) w.writeInt8((mask >> i) & 1);
      for (let i = 0; i < 3; i++) w.writeInt16BE(10);
      for (let i = 0; i < 3; i++) (mask & (1 << i)) ? w.writeInt16BE(i + 1) : w.writeInt8(i + 1);
      assert.deepEqual(Serializable.ControlElementMapper.fromRaw(w.toBuffer()).links[0].targets, [{ x: 11, y: 12, z: 13 }]);
    }
  });
});
