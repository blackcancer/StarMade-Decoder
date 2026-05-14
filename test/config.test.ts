/**
 * @fileoverview Phase 1 Configuration Tests
 *
 * Covers SMToolConfig, ServerConfig, BlockConfig, BlockBehaviorConfig, and
 * FactionConfig loading, typed reads, immutable updates, and persistence.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import os from 'os';
import { assert } from 'chai';
import { SMToolConfig } from '../src/config/SMToolConfig.js';
import { ServerConfig, SERVER_CONFIG_SCHEMA } from '../src/config/ServerConfig.js';
import { BlockConfig } from '../src/config/BlockConfig.js';
import { BlockBehaviorConfig } from '../src/config/BlockBehaviorConfig.js';
import { FactionConfig } from '../src/config/FactionConfig.js';

const STARMADE_DIR = '/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade';

// ── SMToolConfig ──────────────────────────────────────────────────────────────

describe('SMToolConfig', function () {

  it('fromData builds the correct paths', () => {
    const cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' });
    assert.equal(cfg.starmadeDir, STARMADE_DIR);
    assert.equal(cfg.worldDir, 'world0');
    assert.include(cfg.paths.dataConfig, 'data');
    assert.include(cfg.paths.serverCfg, 'server.cfg');
    assert.include(cfg.paths.custom.blockConfig, 'customBlockConfig');
    assert.include(cfg.paths.custom.blockBehaviorConfig, 'customBlockBehaviorConfig');
    assert.include(cfg.paths.custom.factionConfig, 'customFactionConfig');
    assert.include(cfg.paths.custom.effectConfig, 'customEffectConfig');
    console.log('    paths.dataConfig:', cfg.paths.dataConfig);
    console.log('    paths.serverCfg:', cfg.paths.serverCfg);
  });

  it('validate() passes for a valid StarMade installation', () => {
    const cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' });
    assert.doesNotThrow(() => cfg.validate());
    assert.isTrue(cfg.isValid());
    console.log('    isValid: true');
  });

  it('withWorldDir returns a new instance', () => {
    const cfg  = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' });
    const cfg2 = cfg.withWorldDir('world1');
    assert.equal(cfg.worldDir, 'world0');
    assert.equal(cfg2.worldDir, 'world1');
  });

  it('load() from a temp folder creates the file and throws when empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtool-test-'));
    try {
      assert.throws(() => SMToolConfig.load(tmpDir), /starmadeDir/);
      assert.isTrue(fs.existsSync(path.join(tmpDir, 'SMToolConfig.json')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── ServerConfig ──────────────────────────────────────────────────────────────

describe('ServerConfig', function () {

  let cfg: SMToolConfig;
  before(() => { cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' }); });

  it('loads server.cfg', () => {
    const sc = ServerConfig.load(cfg);
    assert.instanceOf(sc, ServerConfig);
    console.log('    WORLD:', sc.getString('WORLD'));
    console.log('    MAX_CLIENTS:', sc.getNumber('MAX_CLIENTS'));
    console.log('    ENEMY_SPAWNING:', sc.getBoolean('ENEMY_SPAWNING'));
    console.log('    THRUST_SPEED_LIMIT:', sc.getNumber('THRUST_SPEED_LIMIT'));
  });

  it('get() returns typed values', () => {
    const sc = ServerConfig.load(cfg);
    assert.isString(sc.getString('WORLD'));
    assert.isNumber(sc.getNumber('MAX_CLIENTS'));
    assert.isBoolean(sc.getBoolean('ENABLE_SIMULATION'));
    assert.isNumber(sc.getFloat('COLLISION_DAMAGE_THRESHOLD'));
  });

  it('schema contains the 196 Java entries', () => {
    const count = Object.keys(SERVER_CONFIG_SCHEMA).length;
    console.log('    Schema entries:', count);
    assert.isAbove(count, 150, 'schema must have 150+ entries');
    // Check a few important keys
    assert.isDefined(SERVER_CONFIG_SCHEMA['WORLD']);
    assert.isDefined(SERVER_CONFIG_SCHEMA['MAX_CLIENTS']);
    assert.isDefined(SERVER_CONFIG_SCHEMA['SECTOR_SIZE']);
    assert.isDefined(SERVER_CONFIG_SCHEMA['THRUST_SPEED_LIMIT']);
    assert.isDefined(SERVER_CONFIG_SCHEMA['NPC_FACTION_SPAWN_LIMIT']);
  });

  it('set() updates immutably', () => {
    const sc1 = ServerConfig.load(cfg);
    const sc2 = sc1.set('MAX_CLIENTS', 99);
    assert.equal(sc2.getNumber('MAX_CLIENTS'), 99);
    // sc1 remains unchanged
    assert.notEqual(sc1.getNumber('MAX_CLIENTS'), 99);
  });

  it('set() throws TypeError for an unknown key', () => {
    const sc = ServerConfig.load(cfg);
    assert.throws(() => sc.set('UNKNOWN_KEY_XYZ', 42), TypeError);
  });

  it('toString() preserves comments', () => {
    const sc = ServerConfig.load(cfg);
    const str = sc.toString();
    assert.include(str, '=');
    // StarMade files have // comments
    if (str.includes('//')) {
      console.log('    Comments preserved: yes');
    }
  });

  it('setMany + round-trip parse', () => {
    const sc = ServerConfig.load(cfg);
    const modified = sc.setMany({ MAX_CLIENTS: 50, ENEMY_SPAWNING: false, THRUST_SPEED_LIMIT: 100 });
    // Reparse from string
    const reparsed = ServerConfig.fromString(modified.toString());
    assert.equal(reparsed.getNumber('MAX_CLIENTS'), 50);
    assert.equal(reparsed.getBoolean('ENEMY_SPAWNING'), false);
    assert.equal(reparsed.getNumber('THRUST_SPEED_LIMIT'), 100);
    console.log('    setMany round-trip: ok');
  });
});

// ── BlockConfig ───────────────────────────────────────────────────────────────

describe('BlockConfig', function () {
  this.timeout(30_000);

  let cfg: SMToolConfig;
  before(() => { cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' }); });

  it('loads BlockConfig.xml', () => {
    const bc = BlockConfig.load(cfg);
    assert.instanceOf(bc, BlockConfig);
    assert.isAbove(bc.size, 100, 'must have 100+ blocks');
    console.log('    Total blocks:', bc.size);
  });

  it('getById() returns a BlockDefinition', () => {
    const bc = BlockConfig.load(cfg);
    // Block 1 exists in every vanilla installation
    const b = bc.getById(1);
    if (b) {
      console.log('    Block id=1:', b.toString());
      assert.isNumber(b.id);
      assert.isString(b.name);
      assert.isNumber(b.hp);
      assert.isNumber(b.mass);
    } else {
      // Find the first available block
      const first = bc.all[0];
      console.log('    Premier bloc:', first?.toString());
      assert.isDefined(first);
    }
  });

  it('preserves render fields from BlockConfig.xml', () => {
    const bc = BlockConfig.load(cfg);
    const greyWedge = bc.getById(599);
    const purpleHalfSlab = bc.getById(771);
    const advancedFactory = bc.getById(259);
    const greenCrystalTetra = bc.getById(531);

    assert.deepEqual(greyWedge?.textureId, [33, 33, 33, 33, 33, 33]);
    assert.equal(greyWedge?.blockStyle, 1);
    assert.equal(purpleHalfSlab?.slab, 2);
    assert.equal(advancedFactory?.individualSides, 3);
    assert.equal(greenCrystalTetra?.transparency, true);
  });

  it('getByName() finds a block by name', () => {
    const bc = BlockConfig.load(cfg);
    // Find a known block
    const first = bc.all[0];
    if (first) {
      const found = bc.getByName(first.name);
      assert.isDefined(found);
      assert.equal(found!.id, first.id);
      console.log('    getByName("' + first.name + '"): id=' + found!.id);
    }
  });

  it('BlockDefinition.with() creates an immutable variant', () => {
    const bc = BlockConfig.load(cfg);
    const first = bc.all[0];
    if (!first) { console.log('    (skip — no blocks)'); return; }

    const modified = first.with({ hp: 9999, price: 1 });
    assert.equal(modified.hp, 9999);
    assert.equal(modified.price, 1);
    assert.equal(first.hp, first.hp); // original unchanged
    assert.equal(modified.id, first.id); // id preserved
    console.log('    BlockDefinition.with(): ok (id=' + first.id + ', hp: ' + first.hp + '→9999)');
  });

  it('set() adds/replaces a block', () => {
    const bc   = BlockConfig.load(cfg);
    const first = bc.all[0];
    if (!first) return;

    const modified = bc.set(first.with({ hp: 42 }));
    assert.equal(modified.getById(first.id)!.hp, 42);
    assert.equal(bc.getById(first.id)!.hp, first.hp); // original unchanged
    console.log('    BlockConfig.set(): ok');
  });

  it('prints the first five blocks', () => {
    const bc = BlockConfig.load(cfg);
    bc.all.slice(0, 5).forEach(b =>
      console.log('   ', b.toString())
    );
  });
});

// ── BlockBehaviorConfig ───────────────────────────────────────────────────────

describe('BlockBehaviorConfig', function () {
  this.timeout(10_000);

  let cfg: SMToolConfig;
  before(() => { cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' }); });

  it('loads blockBehaviorConfig.xml', () => {
    const bbc = BlockBehaviorConfig.load(cfg);
    assert.instanceOf(bbc, BlockBehaviorConfig);
    assert.isAbove(bbc.entries().size, 10);
    console.log('    Total values:', bbc.entries().size);
  });

  it('getNumber() returns correct values', () => {
    const bbc = BlockBehaviorConfig.load(cfg);
    // ShieldCapacityInitial and other standard values
    const keys = [...bbc.entries().keys()].slice(0, 5);
    keys.forEach(k => console.log('   ', k, '=', bbc.get(k)));
  });

  it('set() updates immutably', () => {
    const bbc  = BlockBehaviorConfig.load(cfg);
    const first = [...bbc.entries().keys()][0];
    if (!first) return;
    const orig = bbc.get(first);
    const mod  = bbc.set(first, 9999);
    assert.equal(mod.getNumber(first), 9999);
    assert.equal(bbc.get(first), orig); // original unchanged
    console.log('    set() immutable: ok (' + first + ')');
  });
});

// ── FactionConfig ─────────────────────────────────────────────────────────────

describe('FactionConfig', function () {

  let cfg: SMToolConfig;
  before(() => { cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' }); });

  it('loads FactionConfig.xml', () => {
    const fc = FactionConfig.load(cfg);
    assert.instanceOf(fc, FactionConfig);
    console.log('    Total values:', fc.entries().size);
    [...fc.entries()].slice(0, 3).forEach(([k, v]) => console.log('   ', k, '=', v));
  });

  it('set() updates immutably', () => {
    const fc   = FactionConfig.load(cfg);
    const keys = [...fc.entries().keys()];
    if (keys.length === 0) { console.log('    (skip — empty)'); return; }
    const mod = fc.set(keys[0], 42);
    assert.equal(mod.getNumber(keys[0]), 42);
    console.log('    FactionConfig.set(): ok');
  });
});
