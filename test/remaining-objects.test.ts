/**
 * @fileoverview Remaining Business Object Tests
 *
 * Covers PlayerCharacter, ChatChannels, Trading, NPCFactions, SimulationState,
 * and FloatingItems business objects.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { PlayerCharacter } from '../src/objects/PlayerCharacter.js';
import { ChatChannelManager, ChatChannel } from '../src/objects/ChatChannels.js';
import { TradingManager, TradeRoute } from '../src/objects/Trading.js';
import { NPCFactionManager, SimulationState, SimulationGroup } from '../src/objects/Simulation.js';
import { FloatingItemsArchive, FloatingItem } from '../src/objects/FloatingItems.js';
import { ElementCountMap } from '../src/objects/Serializables.js';

registerAllFactories();
const S = path.resolve('samples');
const load  = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));
const loadB = (f: string) => fs.readFileSync(path.join(S, f));

// ── PlayerCharacter ───────────────────────────────────────────────────────────

describe('PlayerCharacter — business object', function () {

  it('parses from ENTITY_PLAYERCHARACTER_InitSysRev.ent', () => {
    const pc = PlayerCharacter.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    assert.isNumber(pc.id);
    assert.isNumber(pc.speed);
    assert.isNumber(pc.stepHeight);
    console.log('    PlayerCharacter:', pc.toString());
  });

  it('withId + round-trip', () => {
    const pc = PlayerCharacter.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    const modified = pc.withId(9999);
    const rt = PlayerCharacter.fromTag(modified.toTag());
    assert.equal(rt.id, 9999);
    console.log('    withId(9999): ok');
  });

  it('withSpeed + round-trip', () => {
    const pc = PlayerCharacter.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    const modified = pc.withSpeed(10.0);
    const rt = PlayerCharacter.fromTag(modified.toTag());
    assert.closeTo(rt.speed, 10.0, 0.001);
    console.log('    withSpeed(10.0): ok');
  });

  it('withFactionId + round-trip', () => {
    const pc = PlayerCharacter.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    const modified = pc.withFactionId(42);
    const rt = PlayerCharacter.fromTag(modified.toTag());
    assert.equal(rt.factionId, 42);
    console.log('    withFactionId(42): ok');
  });
});

// ── ChatChannelManager ────────────────────────────────────────────────────────

describe('ChatChannelManager — business object', function () {

  it('parses from chatchannels.tag', () => {
    const cm = ChatChannelManager.fromBuffer(loadB('chatchannels.tag'));
    assert.instanceOf(cm, ChatChannelManager);
    assert.isNumber(cm.version);
    console.log('    ChatChannelManager:', cm.toString());
    cm.channels.forEach(c => console.log('    -', c.toString()));
  });

  it('access: find, permanentChannels, publicChannels', () => {
    const cm = ChatChannelManager.fromBuffer(loadB('chatchannels.tag'));
    console.log('    permanent:', cm.permanentChannels.length, 'public:', cm.publicChannels.length);
    if (cm.channels.length > 0) {
      const uid = cm.channels[0].uid;
      assert.isDefined(cm.find(uid));
    }
  });

  it('addChannel + round-trip', () => {
    const cm = ChatChannelManager.fromBuffer(loadB('chatchannels.tag'));
    const original = cm.channels.length;
    const newCh = new ChatChannel('test-channel', 'secret', true, true, ['admin'], [], []);
    const modified = cm.addChannel(newCh);
    assert.equal(modified.channels.length, original + 1);

    const rt = ChatChannelManager.fromTag(modified.toTag());
    assert.equal(rt.channels.length, original + 1);
    const found = rt.find('test-channel');
    assert.isDefined(found);
    assert.equal(found!.password, 'secret');
    assert.isTrue(found!.isPermanent);
    assert.equal(found!.moderators[0], 'admin');
    console.log('    addChannel round-trip: ok');
  });

  it('removeChannel + round-trip', () => {
    const cm = ChatChannelManager.fromBuffer(loadB('chatchannels.tag'));
    if (cm.channels.length === 0) { console.log('    (skip — no channel)'); return; }
    const uid = cm.channels[0].uid;
    const modified = cm.removeChannel(uid);
    const rt = ChatChannelManager.fromTag(modified.toTag());
    assert.isUndefined(rt.find(uid));
    console.log('    removeChannel:', uid, '→ ok');
  });

  it('updateChannel (change password) + round-trip', () => {
    const cm = ChatChannelManager.fromBuffer(loadB('chatchannels.tag'));
    if (cm.channels.length === 0) { console.log('    (skip)'); return; }
    const ch = cm.channels[0];
    const updated = new ChatChannel(ch.uid, 'newpassword', ch.isPermanent, ch.isPublic, ch.moderators, ch.banned, ch.muted);
    const rt = ChatChannelManager.fromTag(cm.updateChannel(ch.uid, updated).toTag());
    assert.equal(rt.find(ch.uid)!.password, 'newpassword');
    console.log('    updateChannel password: ok');
  });
});

// ── TradingManager ────────────────────────────────────────────────────────────

describe('TradingManager — business object', function () {

  it('parses from TRADING.tag', () => {
    const tm = TradingManager.fromBuffer(loadB('TRADING.tag'));
    assert.instanceOf(tm, TradingManager);
    console.log('    TradingManager:', tm.toString());
    tm.routes.forEach(r => console.log('    -', r.toString()));
  });

  it('filters by faction', () => {
    const tm = TradingManager.fromBuffer(loadB('TRADING.tag'));
    if (tm.routes.length > 0) {
      const fid = tm.routes[0].fromFactionId;
      const routes = tm.routesFrom(fid);
      assert.isAbove(routes.length, 0);
      console.log('    routesFrom(' + fid + '):', routes.length);
    }
  });

  it('round-trip without changes', () => {
    const orig = loadB('TRADING.tag');
    const tm = TradingManager.fromBuffer(orig);
    const reenc = writeTo(tm.toTag());
    assert.equal(reenc.toString('hex'), orig.toString('hex'), 'TradingManager round-trip exact');
    console.log('    TradingManager round-trip exact: ok');
  });

  it('addRoute + round-trip', () => {
    const tm = TradingManager.fromBuffer(loadB('TRADING.tag'));
    const original = tm.routes.length;
    const ecm = new ElementCountMap([{ type: 1, count: 100 }]);
    const newRoute = new TradeRoute(
      ecm,
      5000n, 1000n, BigInt(Date.now()), 1n, 2n, -1n,
      500.0, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 }, 1, 2,
      'Player1', 'Player2', 'ENTITY_SHOP_A', 'ENTITY_SHOP_B',
      { x: 0, y: 0, z: 0 }, [],
    );
    const modified = tm.addRoute(newRoute);
    const rt = TradingManager.fromTag(modified.toTag());
    assert.equal(rt.routes.length, original + 1);
    console.log('    addRoute round-trip: ok (total:', rt.routes.length + ')');
  });
});

// ── NPCFactionManager ─────────────────────────────────────────────────────────

describe('NPCFactionManager — business object', function () {

  it('parses from NPCFACTIONS_0_0_0.tag', () => {
    const npc = NPCFactionManager.fromBuffer(loadB('NPCFACTIONS_0_0_0.tag'));
    assert.instanceOf(npc, NPCFactionManager);
    console.log('    NPCFactionManager:', npc.toString());
  });

  it('round-trip exact', () => {
    const orig = loadB('NPCFACTIONS_0_0_0.tag');
    const npc = NPCFactionManager.fromBuffer(orig);
    const reenc = writeTo(npc.toTag());
    assert.equal(reenc.toString('hex'), orig.toString('hex'));
    console.log('    NPCFactionManager round-trip exact: ok');
  });
});

// ── SimulationState ───────────────────────────────────────────────────────────

describe('SimulationState — business object', function () {

  it('parses from SIMULATION_STATE.sim', () => {
    const sim = SimulationState.fromBuffer(loadB('SIMULATION_STATE.sim'));
    assert.instanceOf(sim, SimulationState);
    console.log('    SimulationState:', sim.toString());
  });

  it('round-trip exact', () => {
    const orig = loadB('SIMULATION_STATE.sim');
    const sim = SimulationState.fromBuffer(orig);
    const reenc = writeTo(sim.toTag());
    assert.equal(reenc.toString('hex'), orig.toString('hex'));
    console.log('    SimulationState round-trip exact: ok');
  });

  it('addGroup + round-trip', () => {
    const sim = SimulationState.fromBuffer(loadB('SIMULATION_STATE.sim'));
    const original = sim.groups.length;
    const newGroup = new SimulationGroup(0, 1, ['Player1', 'Player2'], BigInt(Date.now()), { x: 5, y: 5, z: 5 }, 0);
    const modified = sim.addGroup(newGroup);
    assert.equal(modified.groups.length, original + 1);
    const rt = SimulationState.fromTag(modified.toTag());
    assert.equal(rt.groups.length, original + 1);
    const last = rt.groups[rt.groups.length - 1];
    assert.equal(last.members.length, 2);
    assert.equal(last.members[0], 'Player1');
    console.log('    addGroup round-trip: ok (total:', rt.groups.length + ')');
  });
});

// ── FloatingItemsArchive ──────────────────────────────────────────────────────

describe('FloatingItemsArchive — business object', function () {

  it('parses from FLOATING_ITEMS_ARCHIVE.ent', () => {
    const fia = FloatingItemsArchive.fromBuffer(loadB('FLOATING_ITEMS_ARCHIVE.ent'));
    assert.instanceOf(fia, FloatingItemsArchive);
    console.log('    FloatingItemsArchive:', fia.toString());
  });

  it('round-trip exact', () => {
    const orig = loadB('FLOATING_ITEMS_ARCHIVE.ent');
    const fia = FloatingItemsArchive.fromBuffer(orig);
    const reenc = writeTo(fia.toTag());
    assert.equal(reenc.toString('hex'), orig.toString('hex'));
    console.log('    FloatingItemsArchive round-trip exact: ok');
  });

  it('addItem + round-trip', () => {
    const fia = FloatingItemsArchive.fromBuffer(loadB('FLOATING_ITEMS_ARCHIVE.ent'));
    const original = fia.items.length;
    const modified = fia.addItem(new FloatingItem(999, 42));
    const rt = FloatingItemsArchive.fromTag(modified.toTag());
    assert.equal(rt.items.length, original + 1);
    const found = rt.byType(999);
    assert.isDefined(found);
    assert.equal(found!.count, 42);
    console.log('    addItem round-trip: ok (type=999, count=42)');
  });

  it('removeItem + round-trip', () => {
    const fia = FloatingItemsArchive.fromBuffer(loadB('FLOATING_ITEMS_ARCHIVE.ent'));
    const withItem = fia.addItem(new FloatingItem(888, 10));
    const without = withItem.removeItem(888);
    const rt = FloatingItemsArchive.fromTag(without.toTag());
    assert.isUndefined(rt.byType(888));
    console.log('    removeItem round-trip: ok');
  });
});
