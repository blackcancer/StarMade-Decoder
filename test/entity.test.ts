/**
 * @fileoverview Typed Entity Parser Tests
 *
 * Runs the low-level typed entity parsers against real world0 sample files.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { readFrom } from '../src/core/TagParser.js';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { parsePlayerCharacter } from '../src/entity/PlayerCharacter.js';
import { parsePlayerState } from '../src/entity/PlayerState.js';
import { parseSegmentController } from '../src/entity/SegmentController.js';
import { parseFactions } from '../src/entity/Factions.js';
import { parseCatalog } from '../src/entity/Catalog.js';
import { parseFloatingItems } from '../src/entity/FloatingItems.js';

registerAllFactories();

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

describe('Entity parsers — world0 files', function () {
  this.timeout(10_000);

  // ── PlayerCharacter ────────────────────────────────────────────────────────
  describe('PlayerCharacter (ENTITY_PLAYERCHARACTER_InitSysRev.ent)', () => {
    it('parses without errors', () => {
      const tag = load('ENTITY_PLAYERCHARACTER_InitSysRev.ent');
      const data = parsePlayerCharacter(tag);
      assert.isNumber(data.id);
      assert.isNumber(data.speed);
      assert.isNumber(data.stepHeight);
      console.log('    PlayerCharacter:', JSON.stringify({
        id: data.id, speed: data.speed, stepHeight: data.stepHeight,
        sector: data.sectorPosition ? `(${data.sectorPosition.x},${data.sectorPosition.y},${data.sectorPosition.z})` : null,
        factionCode: data.factionCode, owner: data.owner
      }));
    });
  });

  // ── PlayerState ────────────────────────────────────────────────────────────
  describe('PlayerState (ENTITY_PLAYERSTATE_InitSysRev.ent)', () => {
    it('parses without errors', () => {
      const tag = load('ENTITY_PLAYERSTATE_InitSysRev.ent');
      const data = parsePlayerState(tag);
      assert.typeOf(data.credits, 'bigint');
      console.log('    PlayerState:', JSON.stringify({
        credits: data.credits.toString(),
        sector: data.currentSector ? `(${data.currentSector.x},${data.currentSector.y},${data.currentSector.z})` : null,
        creativeMode: data.hasCreativeMode,
        lastEntered: data.lastEnteredEntity,
        factionId: data.factionId
      }, null, 2));
    });
  });

  // ── Ship ───────────────────────────────────────────────────────────────────
  describe('Ship (ENTITY_SHIP_Traders Homerl110.ent)', () => {
    it('parses without errors', () => {
      const tag = load('ENTITY_SHIP_Traders Homerl110.ent');
      const data = parseSegmentController(tag);
      assert.isString(data.uniqueId);
      assert.isString(data.realName);
      console.log('    Ship:', JSON.stringify({
        uniqueId: data.uniqueId, realName: data.realName,
        minPos: data.minPos, maxPos: data.maxPos,
        sector: data.sectorPosition, factionCode: data.factionCode,
        owner: data.owner, creatorId: data.creatorId,
        nonEmptySegments: data.nonEmptySegments
      }));
    });
  });

  // ── Shop ───────────────────────────────────────────────────────────────────
  describe('Shop (ENTITY_SHOP_1749949195316.ent)', () => {
    it('parses without errors', () => {
      const tag = load('ENTITY_SHOP_1749949195316.ent');
      const data = parseSegmentController(tag);
      assert.isString(data.uniqueId);
      console.log('    Shop: uniqueId=' + data.uniqueId + ' name=' + data.realName);
    });
  });

  // ── SpaceStation ───────────────────────────────────────────────────────────
  describe('SpaceStation (ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent)', () => {
    it('parses without errors', () => {
      const tag = load('ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent');
      const data = parseSegmentController(tag);
      assert.isString(data.uniqueId);
      console.log('    SpaceStation: uniqueId=' + data.uniqueId + ' name=' + data.realName);
    });
  });

  // ── Factions ───────────────────────────────────────────────────────────────
  describe('Factions (FACTIONS.fac)', () => {
    it('parses without errors', () => {
      const tag = load('FACTIONS.fac');
      const data = parseFactions(tag);
      assert.isNumber(data.totalCount);
      assert.isArray(data.factions);
      console.log('    Factions: version=' + data.version + ' count=' + data.totalCount);
      data.factions.slice(0, 3).forEach(f =>
        console.log('      faction:', JSON.stringify({ id: f.id, name: f.name, type: f.factionType, members: f.memberCount }))
      );
    });
  });

  // ── Catalog ────────────────────────────────────────────────────────────────
  describe('Catalog (CATALOG.cat)', () => {
    it('parses without errors', () => {
      const tag = load('CATALOG.cat');
      const data = parseCatalog(tag);
      assert.isNumber(data.totalCount);
      console.log('    Catalog: player=' + data.playerEntries.length + ' system=' + data.systemEntries.length);
      data.playerEntries.slice(0, 2).forEach(e =>
        console.log('      entry:', JSON.stringify({ uid: e.uid, name: e.name }))
      );
    });
  });

  // ── FloatingItems ──────────────────────────────────────────────────────────
  describe('FloatingItems (FLOATING_ITEMS_ARCHIVE.ent)', () => {
    it('parses without errors', () => {
      const tag = load('FLOATING_ITEMS_ARCHIVE.ent');
      const data = parseFloatingItems(tag);
      assert.isNumber(data.version);
      assert.isNumber(data.declaredCount);
      console.log('    FloatingItems: version=' + data.version + ' count=' + data.declaredCount + ' actual=' + data.items.length);
    });
  });
});
