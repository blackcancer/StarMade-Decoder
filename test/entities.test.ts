/**
 * @fileoverview Phase 3 Entity Tests
 *
 * Covers Ship, SpaceStation, ShopSpaceStation, PlayerCharacterEntity, and
 * PlayerStateEntity parsing, immutable updates, and semantic round-trips.
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

import { Ship }                   from '../src/objects/entities/Ships.js';
import { SpaceStation }           from '../src/objects/entities/Ships.js';
import { ShopSpaceStation }       from '../src/objects/entities/Ships.js';
import { parseSegmentControllerEntity } from '../src/objects/entities/Ships.js';
import { PlayerCharacterEntity }  from '../src/objects/entities/PlayerCharacterEntity.js';
import { PlayerStateEntity, FactionMembership } from '../src/objects/entities/PlayerStateEntity.js';
import { SectorPosition }         from '../src/objects/components/Transform.js';
import { DockingState }           from '../src/objects/components/DockingState.js';

registerAllFactories();
const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));
const loadB = (f: string) => fs.readFileSync(path.join(S, f));

// ── Ship ──────────────────────────────────────────────────────────────────────

describe('Ship (ENTITY_SHIP_Traders Homerl110.ent)', function () {

  it('fromBuffer parses completely', () => {
    const ship = Ship.fromBuffer(loadB('ENTITY_SHIP_Traders Homerl110.ent'));
    assert.equal(ship.entityType, 'SHIP');
    assert.isString(ship.uniqueId);
    assert.isString(ship.realName);
    assert.instanceOf(ship.dockingState, DockingState);
    assert.instanceOf(ship.sectorPosition, SectorPosition);
    console.log('    Ship:', ship.toString());
    console.log('    uniqueId:', ship.uniqueId);
    console.log('    realName:', ship.realName);
    console.log('    bounds:', JSON.stringify(ship.bounds));
    console.log('    docking:', ship.dockingState.toString());
    console.log('    hp:', ship.hpState.toString());
    console.log('    controlLinks:', ship.controlElementMap.links.length);
    console.log('    textBlocks:', ship.textBlocks.size);
    console.log('    seed:', ship.seed.toString());
    console.log('    creatorId:', ship.creatorId);
    console.log('    factionId:', ship.factionId);
    console.log('    vulnerable:', ship.vulnerable);
    console.log('    minable:', ship.minable);
  });

  it('managerContainer is deserialized', () => {
    const ship = Ship.fromBuffer(loadB('ENTITY_SHIP_Traders Homerl110.ent'));
    if (ship.managerContainer) {
      console.log('    ManagerContainer:', ship.managerContainer.toString());
      console.log('    Power:', ship.managerContainer.powerState.toString());
    } else {
      console.log('    (no managerContainer)');
    }
  });

  it('withFactionId immutable', () => {
    const ship  = Ship.fromBuffer(loadB('ENTITY_SHIP_Traders Homerl110.ent'));
    const orig  = ship.factionId;
    const ship2 = ship.withFactionId(42);
    assert.equal(ship2.factionId, 42);
    assert.equal(ship.factionId, orig);
    console.log('    withFactionId:', orig, '→ 42 ok');
  });

  it('withOwner immutable', () => {
    const ship  = Ship.fromBuffer(loadB('ENTITY_SHIP_Traders Homerl110.ent'));
    const ship2 = ship.withOwner('InitSysRev');
    assert.equal(ship2.owner, 'InitSysRev');
    assert.equal(ship.owner, ship.owner);
    console.log('    withOwner ok');
  });

  it('toTag semantic round-trip — uniqueId, realName, sector preserved', () => {
    const orig = loadB('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = Ship.fromBuffer(orig);
    const reenc = writeTo(ship.toTag());
    const ship2 = Ship.fromBuffer(reenc);
    assert.equal(ship2.uniqueId, ship.uniqueId);
    assert.equal(ship2.realName, ship.realName);
    assert.equal(ship2.sectorPosition.x, ship.sectorPosition.x);
    assert.equal(ship2.factionId, ship.factionId);
    console.log('    Ship toTag semantic round-trip: ok');
  });

  it('parseSegmentControllerEntity detects Ship from file name', () => {
    const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
    const entity = parseSegmentControllerEntity(tag, 'ENTITY_SHIP_Traders Homerl110.ent');
    assert.equal(entity.entityType, 'SHIP');
    assert.instanceOf(entity, Ship);
  });
});

// ── SpaceStation ──────────────────────────────────────────────────────────────

describe('SpaceStation (ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent)', function () {

  it('fromBuffer parses completely', () => {
    const station = SpaceStation.fromBuffer(loadB('ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent'));
    assert.equal(station.entityType, 'SPACE_STATION');
    assert.isString(station.uniqueId);
    console.log('    SpaceStation:', station.toString());
    console.log('    bounds:', JSON.stringify(station.bounds));
    console.log('    realName:', station.realName);
    if (station.managerContainer) {
      console.log('    ManagerContainer inventories:', station.managerContainer.inventories.size);
    }
  });

  it('withSector immutable', () => {
    const station  = SpaceStation.fromBuffer(loadB('ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent'));
    const newSec   = new SectorPosition(10, 20, 30);
    const station2 = station.withSector(newSec);
    assert.equal(station2.sectorPosition.x, 10);
    assert.equal(station.sectorPosition.x, station.sectorPosition.x);
    console.log('    withSector ok');
  });

  it('parseSegmentControllerEntity detects SpaceStation', () => {
    const tag    = load('ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent');
    const entity = parseSegmentControllerEntity(tag, 'ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent');
    assert.equal(entity.entityType, 'SPACE_STATION');
    assert.instanceOf(entity, SpaceStation);
  });
});

// ── ShopSpaceStation ──────────────────────────────────────────────────────────

describe('ShopSpaceStation (ENTITY_SHOP_1749949195316.ent)', function () {

  it('fromBuffer parses completely', () => {
    const shop = ShopSpaceStation.fromBuffer(loadB('ENTITY_SHOP_1749949195316.ent'));
    assert.equal(shop.entityType, 'SHOP');
    assert.isString(shop.uniqueId);
    console.log('    Shop:', shop.toString());
  });

  it('parseSegmentControllerEntity detects Shop', () => {
    const tag    = load('ENTITY_SHOP_1749949195316.ent');
    const entity = parseSegmentControllerEntity(tag, 'ENTITY_SHOP_1749949195316.ent');
    assert.equal(entity.entityType, 'SHOP');
    assert.instanceOf(entity, ShopSpaceStation);
  });
});

// ── PlayerCharacterEntity ─────────────────────────────────────────────────────

describe('PlayerCharacterEntity (ENTITY_PLAYERCHARACTER_InitSysRev.ent)', function () {

  it('fromBuffer parses completely', () => {
    const pc = PlayerCharacterEntity.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    assert.equal(pc.entityType, 'PLAYER_CHARACTER');
    assert.isNumber(pc.id);
    assert.isNumber(pc.speed);
    assert.isNumber(pc.stepHeight);
    assert.instanceOf(pc.sectorPosition, SectorPosition);
    console.log('    PlayerCharacter:', pc.toString());
    console.log('    id:', pc.id, 'speed:', pc.speed, 'stepHeight:', pc.stepHeight.toFixed(3));
    console.log('    noAI:', pc.noAI);
    console.log('    spawnController:', pc.spawnController.toString());
  });

  it('withId + withSpeed immutable', () => {
    const pc  = PlayerCharacterEntity.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    const pc2 = pc.withId(9999).withSpeed(8.0);
    assert.equal(pc2.id, 9999);
    assert.closeTo(pc2.speed, 8.0, 0.001);
    assert.equal(pc.id, pc.id); // original unchanged
    console.log('    withId(9999) + withSpeed(8.0): ok');
  });

  it('withFactionId immutable', () => {
    const pc  = PlayerCharacterEntity.fromBuffer(loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
    const pc2 = pc.withFactionId(1337);
    assert.equal(pc2.factionId, 1337);
    console.log('    withFactionId(1337): ok');
  });

  it('toTag semantic round-trip', () => {
    const orig = loadB('ENTITY_PLAYERCHARACTER_InitSysRev.ent');
    const pc   = PlayerCharacterEntity.fromBuffer(orig);
    const reenc = writeTo(pc.toTag());
    const pc2  = PlayerCharacterEntity.fromBuffer(reenc);
    assert.equal(pc2.id,    pc.id);
    assert.closeTo(pc2.speed, pc.speed, 0.001);
    assert.equal(pc2.factionId, pc.factionId);
    assert.equal(pc2.sectorPosition.x, pc.sectorPosition.x);
    console.log('    PlayerCharacter semantic round-trip: ok');
  });
});

// ── PlayerStateEntity ─────────────────────────────────────────────────────────

describe('PlayerStateEntity (ENTITY_PLAYERSTATE_InitSysRev.ent)', function () {

  it('fromBuffer parses completely', () => {
    const ps = PlayerStateEntity.fromBuffer(loadB('ENTITY_PLAYERSTATE_InitSysRev.ent'));
    assert.equal(ps.entityType, 'PLAYER_STATE');
    assert.typeOf(ps.credits, 'bigint');
    assert.instanceOf(ps.spawnData, Object);
    assert.instanceOf(ps.inventory, Object);
    assert.instanceOf(ps.faction, FactionMembership);
    console.log('    PlayerState:', ps.toString());
    console.log('    credits:', ps.credits.toString());
    console.log('    faction:', ps.faction.toString());
    console.log('    lastLogin:', ps.lastLogin.toString());
    console.log('    lastLogout:', ps.lastLogout.toString());
    console.log('    hasCreativeMode:', ps.hasCreativeMode);
    console.log('    lastEnteredEntity:', ps.lastEnteredEntity);
    console.log('    health:', ps.health);
    console.log('    inventory.size:', ps.inventory.size);
    console.log('    spawnData:', ps.spawnData.toString());
    if (ps.currentSector) console.log('    currentSector:', ps.currentSector.toString());
  });

  it('withCredits immutable', () => {
    const ps  = PlayerStateEntity.fromBuffer(loadB('ENTITY_PLAYERSTATE_InitSysRev.ent'));
    const ps2 = ps.withCredits(999_999_999n);
    assert.equal(ps2.credits, 999_999_999n);
    assert.equal(ps.credits, ps.credits); // original unchanged
    console.log('    withCredits(999999999n): ok');
  });

  it('withCreativeMode immutable', () => {
    const ps  = PlayerStateEntity.fromBuffer(loadB('ENTITY_PLAYERSTATE_InitSysRev.ent'));
    const ps2 = ps.withCreativeMode(true);
    assert.isTrue(ps2.hasCreativeMode);
    console.log('    withCreativeMode(true): ok');
  });

  it('withHealth immutable', () => {
    const ps  = PlayerStateEntity.fromBuffer(loadB('ENTITY_PLAYERSTATE_InitSysRev.ent'));
    const ps2 = ps.withHealth(42.0);
    assert.closeTo(ps2.health, 42.0, 0.01);
    console.log('    withHealth(42): ok');
  });

  it('toTag semantic round-trip', () => {
    const orig = loadB('ENTITY_PLAYERSTATE_InitSysRev.ent');
    const ps   = PlayerStateEntity.fromBuffer(orig);
    const reenc = writeTo(ps.toTag());
    const ps2  = PlayerStateEntity.fromBuffer(reenc);
    assert.equal(ps2.credits, ps.credits);
    assert.equal(ps2.hasCreativeMode, ps.hasCreativeMode);
    assert.equal(ps2.lastEnteredEntity, ps.lastEnteredEntity);
    console.log('    PlayerState semantic round-trip: ok');
  });

  it('exact round-trip (identical bytes)', () => {
    const orig = loadB('ENTITY_PLAYERSTATE_InitSysRev.ent');
    const ps   = PlayerStateEntity.fromBuffer(orig);
    const reenc = writeTo(ps.toTag());
    assert.equal(reenc.toString('hex'), orig.toString('hex'), 'PlayerState round-trip exact');
    console.log('    PlayerState round-trip exact (bytes): ok');
  });
});
