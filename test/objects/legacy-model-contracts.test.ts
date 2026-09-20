/**
 * @fileoverview Legacy domain-model defaults, collections and representation variants.
 * Characterizes public fallback behavior while asserting immutable updates and
 * valid tag framing for the supported editing paths.
 */
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo, readFrom } from '../../src/core/TagParser.js';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { Matrix4f } from '../../src/types/Matrices.js';
import { RawElement } from '../../src/serializable/Factories.js';
import { Catalog, CatalogEntry } from '../../src/objects/Catalog.js';
import { ChatChannel, ChatChannelManager } from '../../src/objects/ChatChannels.js';
import { FloatingItem, FloatingItemsArchive } from '../../src/objects/FloatingItems.js';
import { Faction, FactionMember, FactionRelation, FactionManager } from '../../src/objects/Factions.js';
import { NPCFactionManager, SimulationGroup, SimulationState } from '../../src/objects/Simulation.js';
import { ElementCountMap } from '../../src/objects/Serializables.js';
import { TradeRoute, TradingManager } from '../../src/objects/Trading.js';
import { PlayerCharacter, PlayerTransformable } from '../../src/objects/PlayerCharacter.js';
import { PlayerState } from '../../src/objects/PlayerState.js';
import { SegmentControllerObject } from '../../src/objects/SegmentController.js';
import * as Serializable from '../../src/objects/Serializables.js';
import { parseCatalog } from '../../src/entity/Catalog.js';
import { parseFactions } from '../../src/entity/Factions.js';
import { parseFloatingItems } from '../../src/entity/FloatingItems.js';
import { parsePlayerState } from '../../src/entity/PlayerState.js';
import { parsePlayerCharacter } from '../../src/entity/PlayerCharacter.js';
import { parseSegmentController } from '../../src/entity/SegmentController.js';

const empty = (): Tag => Tags.struct(null, []);
const bad = (): Tag => new Tag(TagType.STRUCT, null, null);
const slots = (values: Record<number, Tag>, name: string | null = null): Tag => Tags.struct(name,
  Array.from({ length: Math.max(0, ...Object.keys(values).map(Number)) + 1 }, (_, i) => values[i] ?? Tags.nothing(null)));
/** Explicit test permissions; creating a faction never supplies administrative defaults. */
const newFactionForContract = (id: number): Faction => new Faction(id, '', '', 0n, [], false, '', '', false, false, 0, 0, false, false,
  Tags.struct('0', [Tags.int(null, id), Tags.struct(null, Array.from({ length: 5 }, () => Tags.long(null, 0n))),
    Tags.struct(null, ['One', 'Two', 'Three', 'Four', 'Five'].map(value => Tags.string(null, value)))]));

describe('Legacy model contracts — sparse domain records', () => {
  it('supplies documented defaults for absent fields and rejects invalid manager roots', () => {
    assert.throws(() => FactionManager.fromTag(Tags.byte(null, 0)), TypeError);
    assert.throws(() => FactionManager.fromTag(empty()));
    const factionManager = new FactionManager(0, new Map(), [], 0n);
    assert.equal(factionManager.toTag().type, TagType.STRUCT); assert.isString(factionManager.toString());
    assert.throws(() => CatalogEntry.fromTag(empty()));
    assert.throws(() => Catalog.fromTag(empty()));
    const ce = new CatalogEntry('entry', 'owner', 9n, '', 0, 'SHIP', 0n, 0, 0);
    assert.equal(CatalogEntry.fromTag(ce.toTag()).price, 9n);
    assert.throws(() => ce.with({ blueprintType: 'future' }));
    assert.equal(CatalogEntry.fromTag(ce.with({ blueprintType: 'UNKNOWN(999)' }).toTag()).blueprintType, 'UNKNOWN(999)');
    assert.throws(() => FloatingItem.fromTag(empty()), /metadata record/);
    assert.throws(() => FloatingItemsArchive.fromTag(Tags.byte(null, 0)), /STRUCT/);
    const emptyArchive = FloatingItemsArchive.fromTag(empty());
    assert.equal(emptyArchive.totalCount, 0); assert.equal(emptyArchive.format, 'legacy');
    assert.equal(emptyArchive.toTag().type, TagType.STRUCT); assert.isString(emptyArchive.toString());
    assert.throws(() => FactionMember.fromTag(empty()));
    assert.throws(() => FactionRelation.fromTag(empty()));
    const relation = new FactionRelation(0, 0, 0);
    assert.equal(relation.factionA, 0); assert.equal(relation.factionB, 0); assert.isTrue(relation.isNeutral);
    assert.equal(new FactionRelation(1, 2, 99).relationName, 'UNKNOWN');
    assert.throws(() => Faction.fromTag(empty(), 7));
    const faction = newFactionForContract(7);
    assert.equal(faction.id, 7); assert.equal(faction.name, ''); assert.equal(faction.factionPoints, 0);
    assert.isFalse(faction.openToJoin); assert.isFalse(faction.allyNeutral);
    assert.throws(() => SimulationGroup.fromTag(empty()), /field types/);
    assert.throws(() => SimulationState.fromTag(empty()), /field types/);
    assert.throws(() => NPCFactionManager.fromTag(empty()), /field types/);
    assert.equal(new SimulationState(0, [], 0n).withLastUpdate(12n).lastUpdate, 12n);
    assert.throws(() => TradeRoute.fromTag(empty()));
    assert.throws(() => TradingManager.fromTag(empty()));
  });

  it('skips malformed optional collection members, never the valid neighbors', () => {
    const malformedCatalog = Tags.struct(null, [Tags.byte(null, 1), Tags.struct('pv0', [Tags.int(null, 3), bad(), empty()])]);
    assert.throws(() => Catalog.fromTag(malformedCatalog));
    const malformedChannels = Tags.struct(null, [Tags.struct('CHANNELS', [bad(), empty(), Tags.byte(null, 0)])]);
    assert.throws(() => ChatChannelManager.fromTag(malformedChannels));
    const malformedItems = Tags.struct(null, [Tags.struct('floatingItems', [bad(), empty(), Tags.byte(null, 0)])]);
    assert.throws(() => FloatingItemsArchive.fromTag(malformedItems));
    const malformedFactions = slots({ 3: Tags.struct(null, [Tags.byte(null, 0), empty(), slots({ 1: bad() }), slots({ 1: empty() })]),
      6: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) });
    assert.throws(() => FactionManager.fromTag(malformedFactions));
    assert.throws(() => Faction.fromTag(slots({ 4: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) }), 2));
    assert.throws(() => SimulationState.fromTag(slots({ 0: Tags.byte(null, 0),
      1: Tags.struct(null, [bad(), empty(), Tags.byte(null, 0)]) })));
  });

  it('handles v1/v2 channel layouts and immutable channel removal', () => {
    assert.throws(() => ChatChannel.fromTag(empty()));
    assert.throws(() => ChatChannelManager.fromTag(empty()));
    for (const version of [0, 1]) {
      assert.throws(() => ChatChannel.fromTag(slots({ 0: Tags.byte(null, version) })));
      const full = ChatChannel.fromTag(slots({ 0: Tags.byte(null, version), 1: Tags.string(null, 'old'),
        2: Tags.struct(null, [Tags.string(null, 'mod')]), 3: Tags.struct(null, [Tags.string(null, 'ban')]),
        4: Tags.string(null, 'pw'), 5: Tags.byte(null, 1) }));
      assert.deepEqual(full.moderators, ['mod']); assert.deepEqual(full.banned, ['ban']);
      assert.equal(full.password, 'pw'); assert.isTrue(full.isPermanent);
      assert.equal(full.version, version); assert.isTrue(full.isPublic);
      assert.deepEqual(ChatChannel.fromTag(full.toTag()), full);
    }
    const a = new ChatChannel('a', '', false, false, [], [], []);
    const b = new ChatChannel('b', 'pw', true, true, [], [], []);
    const manager = new ChatChannelManager(0, [a, b]);
    assert.deepEqual(manager.removeChannel('a').channels, [b]);
    assert.throws(() => manager.updateChannel('a', b), /duplicate/);
    assert.equal(manager.updateChannel('a', a.with({ password: 'new' })).find('a')!.password, 'new');
    assert.deepEqual(manager.channels, [a, b]);
    assert.deepEqual(ChatChannel.fromTag(a.toTag()), a);
  });

  it('updates both sides of relations and collections without losing other entries', () => {
    const a = newFactionForContract(1).with({ openToJoin: true, allyNeutral: true }), b = newFactionForContract(2);
    assert.isTrue(Faction.fromTag(a.toTag(), 1).openToJoin);
    assert.isTrue(Faction.fromTag(a.toTag(), 1).allyNeutral);
    const manager = new FactionManager(0, new Map([[1, a], [2, b]]), [new FactionRelation(1, 2, 0), new FactionRelation(3, 4, 0)], 0n);
    assert.equal(manager.getRelation(2, 1)!.relation, 0);
    assert.equal(manager.setRelation(2, 1, 1).getRelation(1, 2)!.relation, 1);
    assert.equal(manager.setRelation(2, 1, 1).relations.length, 2);
    assert.equal(manager.getRelation(1, 2)!.relation, 0);
    const item = new FloatingItem(5, -2, Tags.string(null, 'first')), other = new FloatingItem(6, -2, Tags.string(null, 'other'));
    const position = { x: 0, y: 1, z: 2 };
    const items = FloatingItemsArchive.create(10).addItem(position, item).addItem(position, other);
    const changed = items.updateItem(item.withPayload(Tags.string(null, 'updated')));
    assert.equal(changed.item(5)!.payload.getString(), 'updated');
    assert.equal(changed.item(6)!.payload.getString(), 'other');
    assert.equal(changed.itemsOfType(-2).length, 2);
    assert.equal(items.item(5)!.payload.getString(), 'first');
    const entry = new CatalogEntry('a', 'User', 0n, '', 0, 'SHIP', 0n, 0, 0);
    const catalog = new Catalog([entry]);
    assert.lengthOf(catalog.byOwner('USER'), 1);
    assert.throws(() => new Catalog([entry, entry]));
    const point = { x: 0, y: 0, z: 0 };
    const route = new TradeRoute(new ElementCountMap([]), 0n, 0n, 0n, 0n, 0n, -1n, 0, point, point, point, 1, 2, '', '', '', '', point, []);
    const routes = [route, route.with({fromFactionId:2,toFactionId:1}), route.with({fromFactionId:3,toFactionId:4})];
    assert.deepEqual(new TradingManager(0, routes).routesBetween(1, 2), routes.slice(0, 2));
  });

  it('rejects absent player/controller schemas and preserves explicit controller edits', () => {
    for (const tag of [empty(), Tags.byte(null, 0)]) {
      assert.throws(() => PlayerCharacter.fromTag(tag));
      assert.throws(() => PlayerState.fromTag(tag));
      assert.throws(() => SegmentControllerObject.fromTag(tag));
    }
    assert.throws(() => PlayerTransformable.fromTag(empty()));
    const position=Tags.vector3i('sector',1,2,3),matrix=new Matrix4f();
    const transform=slots({1:Tags.matrix4f(null,matrix),3:position,4:Tags.int('fid',7),5:Tags.string('own','user')},'transformable');
    const root=Tags.struct(null,[Tags.string('uniqueId','id'),Tags.vector3i('minPos',0,0,0),Tags.vector3i('maxPos',1,1,1),transform]);
    const controller=SegmentControllerObject.fromTag(root);
    assert.deepEqual(controller.transform,matrix);assert.notStrictEqual(controller.transform,matrix);
    const edited=controller.withFactionCode(12);assert.equal(edited.factionCode,12);
    assert.equal(SegmentControllerObject.fromTag(readFrom(writeTo(edited.toTag()))).factionCode,12);
  });
});

describe('Legacy parser contracts — named and positional wire variants', () => {
  it('projects catalog values without mistaking permission flags for price or ratings for entries', () => {
    const entry = new CatalogEntry('id', 'owner', 99n, 'description', 2, 'SHIP', 0n, 7, 1, 5);
    const result = parseCatalog(new Catalog([entry], new Map([['id', new Map([['Alice', 3]])]])).toTag());
    assert.equal(result.entries[0].price, '99'); assert.equal(result.entries[0].permission, 5);
    assert.equal(result.entries[0].timesSpawned, 7); assert.equal(result.ratings.id.Alice, 3);
    assert.equal(result.totalCount, 1);
  });
  it('rejects missing DTO schemas and projects real stored transform representations', () => {
    assert.throws(() => parseFactions(empty()));
    assert.throws(() => parseFactions(Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [Tags.string(null, 'name')])])));
    const items = parseFloatingItems(FloatingItemsArchive.create(50).toTag());
    assert.equal(items.version, 0); assert.equal(items.nextId, 50); assert.isEmpty(items.items); assert.isEmpty(items.sectors);
    assert.throws(() => parsePlayerState(empty()));
    assert.throws(() => parsePlayerState(Tags.struct(null, [Tags.vector3i('sector', 1, 2, 3)])));
    assert.equal(parsePlayerState(Tags.struct(null, [Tags.long('credits', 9n), Tags.vector3i('sector', 1, 2, 3)])).currentSector!.y, 2);
    assert.throws(() => parsePlayerCharacter(empty()));
    const values = Array.from({ length: 16 }, (_, i) => i + .5);
    const character = Tags.struct(null, [Tags.int(null, 2), Tags.float(null, 4), Tags.float(null, .5),
      Tags.struct('transformable', [Tags.float(null, 1), Tags.list(null, values.map(value => Tags.float(null, value)))])]);
    assert.deepEqual(parsePlayerCharacter(character).transformValues, values);
    assert.isUndefined(parsePlayerCharacter(character).transform);
    const matrix = new Matrix4f();
    const transform = slots({ 1: Tags.matrix4f(null, matrix) }, 'transformable');
    assert.throws(() => parsePlayerCharacter(Tags.struct(null, [transform])));
    assert.throws(() => parseSegmentController(Tags.struct(null, [transform])));
    const matrixRoot = Tags.struct(null, [Tags.string('uniqueId', 'id'), Tags.vector3i(null, 0, 0, 0), Tags.vector3i(null, 1, 1, 1), transform]);
    assert.deepEqual(parseSegmentController(matrixRoot).transform, matrix);
    assert.notStrictEqual(parseSegmentController(matrixRoot).transform, matrix);
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
      assert.throws(() => (Ctor as any).fromRaw(new Uint8Array()), /Truncated/);
      const model = (Ctor as any).fromRaw(new (Ctor as any)([]).toRaw());
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
    assert.throws(() => Serializable.NPCFactionNewsEvent.fromRaw(unknown), /Unknown NPC event ordinal/);
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
