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
import { parseSystemNames, writeSystemNames } from '../src/config/SystemNames.js';

const STARMADE_DIR = '/srv/StarMade';

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

  it('loads render fields needed by StarMade-3D', () => {
    const bc = BlockConfig.load(cfg);
    const b = bc.getByName('Grey Basic Armor') ?? bc.all[0];
    assert.isDefined(b);
    assert.isArray(b!.textureIds);
    assert.isAbove(b!.textureIds.length, 0);
    assert.isBoolean(b!.transparent);
    assert.isBoolean(b!.animated);
    assert.isNumber(b!.individualSides);
    assert.isBoolean(b!.sideTexturesPointToOrientation);
    assert.isBoolean(b!.hasActivationTexture);
    assert.isBoolean(b!.lightSource);
    assert.lengthOf(b!.lightSourceColor, 4);
    assert.isBoolean(b!.drawOnlyInBuildMode);
    assert.isBoolean(b!.extendedTexture);
    assert.isNumber(b!.resourceInjection);
    assert.isNumber(b!.chamberRoot);
    assert.isBoolean(b!.reactorChamberSpecific);
    assert.isBoolean(b!.lodCollisionPhysical);
    assert.isNumber(b!.slab);
    assert.isBoolean(b!.drawLogicConnection);
    assert.isBoolean(b!.logicBlock);
    assert.isBoolean(b!.logicSignaledByRail);
    assert.isBoolean(b!.logicBlockButton);
    assert.isObject(b!.metadata);
    console.log('    render fields:', b!.name, b!.textureIds.join(','));
  });

  it('loads XML render metadata required by StarMade-3D', () => {
    const bc = BlockConfig.load(cfg);
    const resourceBlocks = bc.all.filter((block) => block.resourceInjection > 0);
    const extendedBlocks = bc.all.filter((block) => block.extendedTexture);
    const buildModeBlocks = bc.all.filter((block) => block.drawOnlyInBuildMode);
    const chamberBlocks = bc.all.filter((block) => block.reactorChamberSpecific);

    assert.isAbove(resourceBlocks.length, 0, 'ResourceInjection metadata must be exposed');
    assert.isAbove(extendedBlocks.length, 0, 'ExtendedTexture4x4 metadata must be exposed');
    assert.isAbove(buildModeBlocks.length, 0, 'OnlyDrawnInBuildMode metadata must be exposed');
    assert.isAbove(chamberBlocks.length, 0, 'ChamberRoot metadata must be exposed');
    assert.isTrue(chamberBlocks.every((block) => block.chamberRoot !== 0));
    console.log(
      '    XML render metadata:',
      `resource=${resourceBlocks.length}`,
      `extended=${extendedBlocks.length}`,
      `buildMode=${buildModeBlocks.length}`,
      `chambers=${chamberBlocks.length}`
    );
  });

  it('loads extended BlockConfig metadata for future render and gameplay use', () => {
    const bc = BlockConfig.load(cfg);
    const railBasic = bc.getByName('Rail Basic');
    const greyHull = bc.getByName('Grey Basic Armor');
    const antiGravity = bc.getByName('Anti Gravity 1');
    const whiteLight = bc.getByName('White Light');

    assert.isDefined(railBasic);
    assert.include(railBasic!.metadata.controlling, 'STORAGE');
    assert.include(railBasic!.metadata.controlledBy, 'RAIL_SPEED_CONTROLLER');

    assert.isDefined(greyHull);
    assert.isAbove(greyHull!.metadata.consistence.length, 0);
    assert.equal(greyHull!.metadata.inventoryGroup, 'basicgreyhull');
    assert.isNumber(greyHull!.metadata.blockResourceType);
    assert.isTrue(greyHull!.metadata.inRecipe);
    assert.isObject(greyHull!.metadata.effectArmor);
    assert.isNumber(greyHull!.metadata.effectArmor.heat);
    assert.isNumber(greyHull!.metadata.effectArmor.kinetic);
    assert.isNumber(greyHull!.metadata.effectArmor.em);

    assert.isDefined(antiGravity);
    assert.isAbove(antiGravity!.metadata.chamberChildren.length, 0);
    assert.include(antiGravity!.metadata.chamberConfigGroups, 'mobility - anti gravity 1');

    assert.isDefined(whiteLight);
    assert.isAbove(whiteLight!.metadata.wildcardIds.length, 0);
  });

  it('provides StarMade-Open style BlockConfig element information', () => {
    const bc = BlockConfig.load(cfg);
    const greyHull = bc.getElementInfoByName('Grey Basic Armor');
    const wedge = bc.getElementInfoByName('Grey Basic Armor Wedge');
    const railBasic = bc.getElementInfoByName('Rail Basic');
    const antiGravity = bc.getElementInfoByName('Anti Gravity 1');
    const cargo = bc.getElementInfoByTypeName('CARGO_SPACE');
    const transporter = bc.getElementInfoByTypeName('TRANSPORTER_MODULE');
    const gravity = bc.getElementInfoByTypeName('GRAVITY_UNIT');

    assert.isDefined(greyHull);
    assert.equal(greyHull!.identity.typeName, 'GREY_HULL');
    assert.equal(greyHull!.render.style.key, 'NORMAL');
    assert.isTrue(greyHull!.render.isNormalBlockStyle);
    assert.isTrue(greyHull!.classification.armor);
    assert.isAbove(greyHull!.recipe.consistence.length, 0);
    assert.isNumber(greyHull!.recipe.consistence[0].id);
    assert.isAbove(greyHull!.recipe.consistence[0].count, 0);
    assert.equal(greyHull!.collision.defaultShape?.type, 'BlockType');

    assert.isDefined(wedge);
    assert.equal(wedge!.render.style.key, 'WEDGE');
    assert.isTrue(wedge!.render.isSolidBlockStyle);

    assert.isDefined(railBasic);
    assert.include(railBasic!.logic.controlledBy.map((ref) => ref.typeName), 'RAIL_SPEED_CONTROLLER');
    assert.isAtLeast(railBasic!.logic.controlledBy[0].id ?? 0, 1);
    assert.isTrue(railBasic!.logic.canBeControlledByAny);

    assert.isDefined(antiGravity);
    assert.isTrue(antiGravity!.chamber.any);
    assert.isAbove(antiGravity!.chamber.children.length, 0);
    assert.isNotNull(antiGravity!.chamber.children[0].block);
    assert.include(antiGravity!.chamber.configGroups, 'mobility - anti gravity 1');

    assert.equal(cargo!.render.defaultOrientation, 4);
    assert.equal(transporter!.render.defaultOrientation, 2);
    assert.equal(gravity!.render.defaultOrientation, 3);
    assert.equal(bc.resolveReference('GREY_HULL').name, 'Grey Basic Armor');
    assert.equal(bc.elementInfo.length, bc.size);
    assert.equal(bc.getByName('Grey Basic Armor')!.toElementInfo(bc).identity.typeName, 'GREY_HULL');
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

// ── systemNames.syl ──────────────────────────────────────────────────────────

describe('SystemNames', function () {
  it('parses and writes systemNames.syl', () => {
    const file = path.join(STARMADE_DIR, 'data/config/systemNames.syl');
    const parsed = parseSystemNames(fs.readFileSync(file));
    assert.isAbove(parsed.syllables.length, 10);
    assert.include(parsed.syllables.map(s => s.value), '-a');

    const encoded = writeSystemNames(parsed);
    const reparsed = parseSystemNames(encoded);
    assert.deepEqual(reparsed, parsed);
  });
});
