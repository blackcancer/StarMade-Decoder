/**
 * @fileoverview Serializable Business Object Tests
 *
 * Exercises complete RawElement to business object to raw bytes round-trips,
 * plus PlayerState and SegmentControllerObject integration paths.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { TagType } from '../src/core/TagType.js';
import { Tag } from '../src/core/Tag.js';
import { RawElement } from '../src/serializable/Factories.js';
import {
  ControlElementMapper, ElementCountMap, NPCFactionNewsEvent,
  LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap,
  decodeSerializable,
} from '../src/objects/Serializables.js';
import { posToIndex, indexToPos } from '../src/objects/ElementPosition.js';
import { PlayerState } from '../src/objects/PlayerState.js';
import { SegmentControllerObject } from '../src/objects/SegmentController.js';

registerAllFactories();

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

// ── Helper ────────────────────────────────────────────────────────────────────

function findAllSer(tag: Tag, factoryId?: number): Tag[] {
  const results: Tag[] = [];
  const walk = (t: Tag) => {
    if (t.type === TagType.SERIALIZABLE) {
      const elem = t.value as RawElement;
      if (factoryId === undefined || elem.factoryId === factoryId) results.push(t);
    }
    if (t.type === TagType.STRUCT || t.type === TagType.LIST) (t.value as Tag[]).forEach(walk);
  };
  walk(tag);
  return results;
}

// ── ElementPosition ───────────────────────────────────────────────────────────

describe('ElementPosition — long position encoding', () => {
  it('posToIndex / indexToPos round-trip', () => {
    for (const [x, y, z] of [[0,0,0],[100,200,300],[-5,-10,-15],[32767,-32768,0]] as [number,number,number][]) {
      const idx = posToIndex(x, y, z);
      const pos = indexToPos(idx);
      assert.equal(pos.x, x, `x=${x}`);
      assert.equal(pos.y, y, `y=${y}`);
      assert.equal(pos.z, z, `z=${z}`);
    }
    console.log('    ElementPosition round-trip: ok');
  });
});

// ── SERIALIZABLE 0 : ControlElementMapper ────────────────────────────────────

describe('ControlElementMapper (factoryId=0)', function () {

  it('parses from ENTITY_SHIP', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag, 0);
    assert.isAbove(sers.length, 0, 'CEM must exist');
    const cem = ControlElementMapper.fromRaw((sers[0].value as RawElement).raw);
    console.log('    CEM:', cem.toString(), 'links:', cem.links.slice(0,2).map(l =>
      `from(${l.from.x},${l.from.y},${l.from.z}) type=${l.type} targets=${l.targets.length}`));
  });

  it('fromRaw → toRaw → fromRaw round-trip exact', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag, 0);
    for (const ser of sers) {
      const raw1 = (ser.value as RawElement).raw;
      const cem = ControlElementMapper.fromRaw(raw1);
      const raw2 = cem.toRaw();
      assert.equal(Buffer.from(raw2).toString('hex'), Buffer.from(raw1).toString('hex'), 'CEM raw round-trip');
    }
    console.log('    CEM raw round-trip: ok');
  });

  it('update: addLink + toRaw + fromRaw → new link is present', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag, 0);
    const cem = ControlElementMapper.fromRaw((sers[0].value as RawElement).raw);
    const original = cem.links.length;
    const modified = cem.addLink({ x: 5, y: 5, z: 5 }, 42, { x: 6, y: 6, z: 6 });
    const rt = ControlElementMapper.fromRaw(modified.toRaw());
    assert.equal(rt.links.length, original + 1);
    const newLink = rt.links.find(l => l.from.x === 5 && l.from.y === 5 && l.from.z === 5);
    assert.isDefined(newLink);
    assert.equal(newLink!.type, 42);
    console.log('    CEM addLink: ok (total links:', rt.links.length + ')');
  });

  it('update: removeFrom + toRaw + fromRaw', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const cem = ControlElementMapper.fromRaw((findAllSer(tag, 0)[0].value as RawElement).raw);
    if (cem.links.length === 0) { console.log('    (skip — no links)'); return; }
    const first = cem.links[0].from;
    const reduced = cem.removeFrom(first);
    const rt = ControlElementMapper.fromRaw(reduced.toRaw());
    assert.isUndefined(rt.links.find(l => l.from.x === first.x && l.from.y === first.y && l.from.z === first.z));
    console.log('    CEM removeFrom: ok');
  });
});

// ── SERIALIZABLE 1 : ElementCountMap ─────────────────────────────────────────

describe('ElementCountMap (factoryId=1)', function () {

  it('parse and inspect', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag, 1);
    if (sers.length === 0) { console.log('    (ECM not found — skip)'); return; }
    const ecm = ElementCountMap.fromRaw((sers[0].value as RawElement).raw);
    console.log('    ECM:', ecm.toString());
    ecm.counts.slice(0,3).forEach(c => console.log('    type=' + c.type + ' count=' + c.count));
  });

  it('fromRaw → toRaw round-trip exact', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag, 1);
    for (const ser of sers) {
      const raw1 = (ser.value as RawElement).raw;
      const ecm = ElementCountMap.fromRaw(raw1);
      assert.equal(Buffer.from(ecm.toRaw()).toString('hex'), Buffer.from(raw1).toString('hex'));
    }
    console.log('    ECM raw round-trip: ok');
  });

  it('update: setCount + round-trip', () => {
    const ecm = new ElementCountMap([{ type: 1, count: 100 }, { type: 2, count: 50 }]);
    const modified = ecm.setCount(1, 999).setCount(3, 42);
    const rt = ElementCountMap.fromRaw(modified.toRaw());
    assert.equal(rt.getCount(1), 999);
    assert.equal(rt.getCount(2), 50);
    assert.equal(rt.getCount(3), 42);
    assert.equal(rt.totalBlocks, 999 + 50 + 42);
    console.log('    ECM setCount round-trip: ok');
  });
});

// ── SERIALIZABLE 2 : NPCFactionNewsEvent ──────────────────────────────────────

describe('NPCFactionNewsEvent (factoryId=2)', function () {

  it('parses from FACTIONS.fac', () => {
    const tag = load('FACTIONS.fac');
    const sers = findAllSer(tag, 2);
    assert.isAbove(sers.length, 0);
    const ev = NPCFactionNewsEvent.fromRaw((sers[0].value as RawElement).raw);
    console.log('    NPCFactionNewsEvent:', ev.toString());
  });

  it('fromRaw → toRaw round-trip exact', () => {
    const tag = load('FACTIONS.fac');
    for (const ser of findAllSer(tag, 2)) {
      const raw1 = (ser.value as RawElement).raw;
      const ev = NPCFactionNewsEvent.fromRaw(raw1);
      assert.equal(Buffer.from(ev.toRaw()).toString('hex'), Buffer.from(raw1).toString('hex'), 'NPCFactionNewsEvent round-trip');
    }
    console.log('    NPCFactionNewsEvent round-trip: ok');
  });

  it('create every type and round-trip', () => {
    const cases: NPCFactionNewsEvent[] = [
      new NPCFactionNewsEvent('TRADING', 12345678n, 1),
      new NPCFactionNewsEvent('WAR', 9999n, 2),
      new NPCFactionNewsEvent('GROWN', 1000n, 3, { x: 10, y: 20, z: 30 }),
      new NPCFactionNewsEvent('LOST_TERRITORY', 2000n, 4, { x: -5, y: 0, z: 5 }),
      new NPCFactionNewsEvent('ALLIES', 3000n, 5, undefined, 'ENTITY_SHIP_test'),
      new NPCFactionNewsEvent('LOST_STATION', 4000n, 6, undefined, 'MY_STATION'),
    ];
    for (const ev of cases) {
      const rt = NPCFactionNewsEvent.fromRaw(ev.toRaw());
      assert.equal(rt.eventType, ev.eventType, 'eventType');
      assert.equal(rt.time, ev.time, 'time');
      assert.equal(rt.factionId, ev.factionId, 'factionId');
      if (ev.system) {
        assert.equal(rt.system?.x, ev.system.x); assert.equal(rt.system?.y, ev.system.y); assert.equal(rt.system?.z, ev.system.z);
      }
      if (ev.otherEnt) assert.equal(rt.otherEnt, ev.otherEnt);
    }
    console.log('    All NPCFactionNewsEvent types round-trip: ok');
  });
});

// ── SERIALIZABLE 3 : LongSet ──────────────────────────────────────────────────

describe('LongSet (factoryId=3)', function () {

  it('parse and inspect', () => {
    const tag = load('TRADING.tag');
    const sers = findAllSer(tag, 3);
    if (sers.length === 0) { console.log('    (skip)'); return; }
    const ls = LongSet.fromRaw((sers[0].value as RawElement).raw);
    console.log('    LongSet:', ls.toString());
    ls.positions.slice(0,3).forEach(p => console.log('    pos:', p));
  });

  it('fromRaw → toRaw round-trip exact', () => {
    const tag = load('TRADING.tag');
    for (const ser of findAllSer(tag, 3)) {
      const raw1 = (ser.value as RawElement).raw;
      assert.equal(Buffer.from(LongSet.fromRaw(raw1).toRaw()).toString('hex'), Buffer.from(raw1).toString('hex'));
    }
    console.log('    LongSet round-trip: ok');
  });

  it('add / remove + round-trip', () => {
    const ls = new LongSet([posToIndex(1, 2, 3), posToIndex(4, 5, 6)]);
    const modified = ls.addPos(7, 8, 9).remove(posToIndex(1, 2, 3));
    const rt = LongSet.fromRaw(modified.toRaw());
    assert.equal(rt.values.length, 2);
    assert.isFalse(rt.has(posToIndex(1, 2, 3)));
    assert.isTrue(rt.has(posToIndex(4, 5, 6)));
    assert.isTrue(rt.has(posToIndex(7, 8, 9)));
    console.log('    LongSet add/remove round-trip: ok');
  });
});

// ── SERIALIZABLE 4 : BlockBuffer ─────────────────────────────────────────────

describe('BlockBuffer (factoryId=4)', function () {

  it('create and round-trip', () => {
    const bb = new BlockBuffer([
      { x: 1, y: 2, z: 3, data: 0x1FFF, hasMeta: false },
      { x: 4, y: 5, z: 6, data: 0xFF, hasMeta: true, controllerPos: 12345n, connectedFrom: [67890n] },
    ]);
    const rt = BlockBuffer.fromRaw(bb.toRaw());
    assert.equal(rt.blocks.length, 2);
    assert.equal(rt.blocks[0].x, 1); assert.equal(rt.blocks[0].data, 0x1FFF);
    assert.isTrue(rt.blocks[1].hasMeta);
    assert.equal(rt.blocks[1].controllerPos, 12345n);
    assert.equal(rt.blocks[1].connectedFrom![0], 67890n);
    console.log('    BlockBuffer round-trip: ok');
  });

  it('BlockBuffer empty', () => {
    const bb = new BlockBuffer([]);
    const rt = BlockBuffer.fromRaw(bb.toRaw());
    assert.equal(rt.blocks.length, 0);
  });
});

// ── SERIALIZABLE 5 : Long2Vector3fMap ────────────────────────────────────────

describe('Long2Vector3fMap (factoryId=5)', function () {

  it('fromRaw → toRaw round-trip exact', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    for (const ser of findAllSer(tag, 5)) {
      const raw1 = (ser.value as RawElement).raw;
      assert.equal(Buffer.from(Long2Vector3fMap.fromRaw(raw1).toRaw()).toString('hex'), Buffer.from(raw1).toString('hex'));
    }
    console.log('    Long2Vector3fMap round-trip: ok');
  });

  it('set / delete / get + round-trip', () => {
    const m = new Long2Vector3fMap([]);
    const k = posToIndex(10, 20, 30);
    const m2 = m.set(k, 1.5, 2.5, 3.5);
    const rt = Long2Vector3fMap.fromRaw(m2.toRaw());
    const entry = rt.get(k);
    assert.isDefined(entry);
    assert.closeTo(entry!.x, 1.5, 0.001);
    const m3 = m2.delete(k);
    assert.equal(m3.entries.length, 0);
    console.log('    Long2Vector3fMap set/delete round-trip: ok');
  });
});

// ── SERIALIZABLE 6 : Long2TransformMap ───────────────────────────────────────

describe('Long2TransformMap (factoryId=6)', function () {

  it('fromRaw → toRaw round-trip exact', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    for (const ser of findAllSer(tag, 6)) {
      const raw1 = (ser.value as RawElement).raw;
      assert.equal(Buffer.from(Long2TransformMap.fromRaw(raw1).toRaw()).toString('hex'), Buffer.from(raw1).toString('hex'));
    }
    console.log('    Long2TransformMap round-trip: ok');
  });

  it('set / delete + round-trip', () => {
    const m = new Long2TransformMap([]);
    const k = 12345n;
    const t = { originX: 1, originY: 2, originZ: 3, m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1 };
    const rt = Long2TransformMap.fromRaw(m.set(k, t).toRaw());
    const e = rt.get(k);
    assert.isDefined(e);
    assert.closeTo(e!.transform.originX, 1, 0.001);
    assert.closeTo(e!.transform.m00, 1, 0.001);
    console.log('    Long2TransformMap set round-trip: ok');
  });
});

// ── decodeSerializable ────────────────────────────────────────────────────────

describe('decodeSerializable — automatic dispatch', function () {
  it('returns the right class for each factoryId', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const sers = findAllSer(tag);
    for (const ser of sers) {
      const elem = ser.value as RawElement;
      const decoded = decodeSerializable(elem);
      console.log('    factoryId=' + elem.factoryId + ' → ' + decoded.constructor.name);
      switch (elem.factoryId) {
        case 0: assert.instanceOf(decoded, ControlElementMapper); break;
        case 1: assert.instanceOf(decoded, ElementCountMap); break;
        case 5: assert.instanceOf(decoded, Long2Vector3fMap); break;
        case 6: assert.instanceOf(decoded, Long2TransformMap); break;
      }
    }
  });
});

// ── PlayerState ───────────────────────────────────────────────────────────────

describe('PlayerState — business object', function () {

  it('parses from ENTITY_PLAYERSTATE_InitSysRev.ent', () => {
    const ps = PlayerState.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_PLAYERSTATE_InitSysRev.ent')));
    assert.typeOf(ps.credits, 'bigint');
    console.log('    PlayerState:', ps.toString());
  });

  it('withCredits + round-trip', () => {
    const ps = PlayerState.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_PLAYERSTATE_InitSysRev.ent')));
    const modified = ps.withCredits(1_000_000n);
    const rt = PlayerState.fromTag(modified.toTag());
    assert.equal(rt.credits, 1_000_000n);
    console.log('    withCredits(1000000): ok');
  });

  it('withCreativeMode + round-trip', () => {
    const ps = PlayerState.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_PLAYERSTATE_InitSysRev.ent')));
    const modified = ps.withCreativeMode(true);
    assert.isTrue(modified.hasCreativeMode);
    const rt = PlayerState.fromTag(modified.toTag());
    assert.isTrue(rt.hasCreativeMode);
    console.log('    withCreativeMode(true): ok');
  });
});

// ── SegmentControllerObject ───────────────────────────────────────────────────

describe('SegmentControllerObject — business object with SERIALIZABLE', function () {

  it('parse Ship + SERIALIZABLE access', () => {
    const ship = SegmentControllerObject.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Traders Homerl110.ent')));
    console.log('    Ship:', ship.toString());
    const cem = ship.controlElementMapper;
    if (cem) console.log('    CEM:', cem.toString());
    const ecm = ship.elementCountMap;
    if (ecm) console.log('    ECM:', ecm.toString());
    const l2v = ship.long2Vector3fMaps;
    const l2t = ship.long2TransformMaps;
    console.log('    Long2Vector3fMap:', l2v.length, 'Long2TransformMap:', l2t.length);
  });

  it('withName + round-trip', () => {
    const ship = SegmentControllerObject.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Traders Homerl110.ent')));
    const modified = ship.withRealName('My New Ship');
    const rt = SegmentControllerObject.fromTag(modified.toTag());
    assert.equal(rt.realName, 'My New Ship');
    console.log('    withRealName round-trip: ok');
  });

  it('parse SpaceStation', () => {
    const station = SegmentControllerObject.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent')));
    console.log('    SpaceStation:', station.toString());
    assert.isString(station.uniqueId);
  });

  it('parse Shop', () => {
    const shop = SegmentControllerObject.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SHOP_1749949195316.ent')));
    console.log('    Shop:', shop.toString());
    assert.isString(shop.uniqueId);
  });
});
