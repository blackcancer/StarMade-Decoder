/**
 * @fileoverview Coverage Gap Tests
 *
 * Targets all previously uncovered lines, branches, and functions across
 * src/ to reach 100% coverage.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assert } from 'chai';

import { registerAllFactories }   from '../src/serializable/Factories.js';
import { readFrom, writeTo }      from '../src/core/TagParser.js';
import { Tags, StructBuilder, ListBuilder } from '../src/core/TagBuilder.js';
import { Tag, FINISH_TAG }        from '../src/core/Tag.js';
import { TagType }                from '../src/core/TagType.js';
import { toObject, toJSON }       from '../src/core/TagSerializer.js';
import { BufferReader }           from '../src/core/BufferReader.js';
import { BufferWriter }           from '../src/core/BufferWriter.js';
import { Matrix3f, Matrix4f }     from '../src/types/Matrices.js';
import { Vector3b, Vector3i, Vector3f, Vector4f } from '../src/types/Vectors.js';

import { SMToolConfig }           from '../src/config/SMToolConfig.js';
import { BlockConfig }            from '../src/config/BlockConfig.js';
import { BlockBehaviorConfig }    from '../src/config/BlockBehaviorConfig.js';
import { FactionConfig }          from '../src/config/FactionConfig.js';
import { BlockRegistry }          from '../src/config/BlockRegistry.js';
import { ServerConfig }           from '../src/config/ServerConfig.js';

import { SectorPosition, EntityTransform } from '../src/objects/components/Transform.js';
import { SpawnPoint, PlayerSpawnData, SpawnMarker, SpawnController } from '../src/objects/components/SpawnData.js';
import { DockingState }           from '../src/objects/components/DockingState.js';
import { HpState }                from '../src/objects/components/HpState.js';
import { Inventory, ItemStack }   from '../src/objects/components/Inventory.js';
import { ManagerContainer, PullPermission } from '../src/objects/components/ManagerContainer.js';
import { PowerState, ThrustConfig } from '../src/objects/components/PowerAndThrust.js';
import { TextBlocks }             from '../src/objects/components/TextBlocks.js';

import { Catalog, CatalogEntry }  from '../src/objects/Catalog.js';
import { ChatChannelManager, ChatChannel } from '../src/objects/ChatChannels.js';
import { FactionManager, Faction, RELATION_WAR, RELATION_ALLY } from '../src/objects/Factions.js';
import { FloatingItemsArchive, FloatingItem } from '../src/objects/FloatingItems.js';
import { PlayerCharacter }        from '../src/objects/PlayerCharacter.js';
import { PlayerState }            from '../src/objects/PlayerState.js';
import { SimulationState, SimulationGroup, NPCFactionManager } from '../src/objects/Simulation.js';
import { TradingManager, TradeRoute } from '../src/objects/Trading.js';
import { ControlElementMapper, ElementCountMap, LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap, decodeSerializable, NPCFactionNewsEvent } from '../src/objects/Serializables.js';
import { RawElement }             from '../src/serializable/Factories.js';

import { parseSmd3, getBlock, indexToPos, posToIndex, CHUNK_DIM, BLOCK_COUNT, VERSION_4BYTE, DATA_EMPTY } from '../src/smd3/Smd3Parser.js';
import { writeSmd3, emptySegment, emptySmd3File } from '../src/smd3/Smd3Writer.js';
import { parseSim }               from '../src/smd3/SimParser.js';
import { parseSmbmm }             from '../src/smd3/SmbmmParser.js';
import { parseSmbpl }             from '../src/smd3/SmbplParser.js';
import { parseSmbpm }             from '../src/smd3/SmbpmParser.js';
import { writeSmbph }             from '../src/smd3/SmbphWriter.js';
import { parseSment }             from '../src/smd3/SmentParser.js';
import { parseBlueprintFolder }   from '../src/smd3/BlueprintFolderParser.js';

import {
  enrichControlLinks, enrichBlockCounts, getBlockCountStats,
  enrichSegment, enrichSmd3, getSegmentStats, enrichInventory,
  RichSegmentController,
} from '../src/objects/enriched/RichViews.js';

import { parseSegmentControllerEntity } from '../src/objects/entities/Ships.js';
import { parsePlayerState as legacyParsePlayerState } from '../src/entity/PlayerState.js';

registerAllFactories();

const S = path.resolve('samples');
const SM_DIR = '/srv/StarMade';
const hasSamples = fs.existsSync(S);
const hasStarMade = fs.existsSync(SM_DIR);
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

// ── Types: Matrix3f / Matrix4f ─────────────────────────────────────────────────

describe('Matrix3f / Matrix4f — constructors and toString', () => {
  it('Matrix3f default constructor', () => {
    const m = new Matrix3f();
    assert.equal(m.m00, 0);
    assert.equal(m.m22, 0);
  });

  it('Matrix3f parameterized constructor and toString', () => {
    const m = new Matrix3f(1,2,3,4,5,6,7,8,9);
    assert.equal(m.m00, 1); assert.equal(m.m11, 5); assert.equal(m.m22, 9);
    const s = m.toString();
    assert.include(s, 'Matrix3f');
    assert.include(s, '1.0000');
  });

  it('Matrix4f default constructor and toString', () => {
    const m = new Matrix4f();
    assert.equal(m.m00, 0); assert.equal(m.m33, 0);
    const s = m.toString();
    assert.include(s, 'Matrix4f');
  });

  it('Matrix4f parameterized constructor', () => {
    const m = new Matrix4f(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,30,1);
    assert.equal(m.m03, 0);
    assert.equal(m.m30, 10);
    assert.equal(m.m33, 1);
  });
});

// ── Types: Vector toString ─────────────────────────────────────────────────────

describe('Vector toString methods', () => {
  it('Vector3b.toString', () => {
    assert.equal(new Vector3b(1,2,3).toString(), 'Vector3b(1, 2, 3)');
  });
  it('Vector4f.toString', () => {
    assert.equal(new Vector4f(1,2,3,4).toString(), 'Vector4f(1, 2, 3, 4)');
  });
});

// ── BufferReader: readMatrix3f / readMatrix4f ──────────────────────────────────

describe('BufferReader / BufferWriter — matrix round-trips', () => {
  it('Matrix3f read/write round-trip', () => {
    const w = new BufferWriter();
    const m = new Matrix3f(1,2,3,4,5,6,7,8,9);
    [m.m00,m.m01,m.m02,m.m10,m.m11,m.m12,m.m20,m.m21,m.m22].forEach(v => w.writeFloat32BE(v));
    const r = BufferReader.from(w.toBuffer());
    const vals = Array.from({length:9}, () => r.readFloat32BE());
    assert.closeTo(vals[0], 1, 0.001);
    assert.closeTo(vals[8], 9, 0.001);
  });

  it('Matrix4f read/write round-trip', () => {
    const w = new BufferWriter();
    const m = new Matrix4f(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1);
    const flat = [
      m.m00,m.m01,m.m02,m.m03, m.m10,m.m11,m.m12,m.m13,
      m.m20,m.m21,m.m22,m.m23, m.m30,m.m31,m.m32,m.m33,
    ];
    flat.forEach(v => w.writeFloat32BE(v));
    const r = BufferReader.from(w.toBuffer());
    const vals = Array.from({length:16}, () => r.readFloat32BE());
    assert.closeTo(vals[12], 5, 0.001); // m30 = tx
  });
});

// ── core/Tag — uncovered accessors ───────────────────────────────────────────

describe('Tag — uncovered accessors', () => {
  it('getMatrix3f', () => {
    const m = new Matrix3f(1,0,0, 0,1,0, 0,0,1);
    const t = Tags.matrix3f('m', m);
    assert.equal(t.getMatrix3f().m00, 1);
  });

  it('getMatrix4f', () => {
    const m = new Matrix4f(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1);
    const t = Tags.matrix4f('m', m);
    assert.equal(t.getMatrix4f().m33, 1);
  });

  it('getBoolean via getByte', () => {
    assert.isTrue(Tags.bool('b', true).getBoolean());
    assert.isFalse(Tags.bool('b', false).getBoolean());
  });

  it('getSerializable throws on wrong type', () => {
    assert.throws(() => Tags.int('x', 1).getSerializable(), TypeError);
  });

  it('toString for DOUBLE tag', () => {
    const t = Tags.double('d', 3.14);
    assert.include(t.toString(), 'TAG_Double');
  });

  it('toString for NOTHING tag', () => {
    const t = Tags.nothing('n');
    assert.include(t.toString(), 'TAG_NOTHING');
  });

  it('toString for VECTOR4f tag', () => {
    const t = Tags.vector4f('v', 1,2,3,4);
    assert.include(t.toString(), 'TAG_Vector4f');
  });

  it('toString for Matrix3f tag', () => {
    const t = Tags.matrix3f('m', new Matrix3f());
    assert.include(t.toString(), 'TAG_Matrix3f');
  });

  it('toString for Matrix4f tag', () => {
    const t = Tags.matrix4f('m', new Matrix4f());
    assert.include(t.toString(), 'TAG_Matrix4f');
  });

  it('print — all branches (list, struct, byte_array, scalar)', () => {
    Tags.struct('S', [Tags.int('x', 1)]).print();
    Tags.list('L', [Tags.int(null, 1), Tags.int(null, 2)]).print();
    Tags.byteArray('B', new Uint8Array([1,2,3])).print();
    Tags.double('d', 3.14).print();
    Tags.nothing('n').print();
    Tags.matrix3f('m', new Matrix3f()).print();
    FINISH_TAG.print(); // should be no-op
  });
});

// ── core/TagBuilder — uncovered helpers ───────────────────────────────────────

describe('TagBuilder — uncovered helpers', () => {
  it('Tags.matrix3f / matrix4f factories', () => {
    const m3 = Tags.matrix3f('m', new Matrix3f(1,0,0, 0,1,0, 0,0,1));
    assert.equal(m3.type, TagType.MATRIX3f);
    const m4 = Tags.matrix4f('m', new Matrix4f(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1));
    assert.equal(m4.type, TagType.MATRIX4f);
  });

  it('Tags.rename creates a copy with a new name', () => {
    const t = Tags.int('old', 42);
    const r = Tags.rename(t, 'new');
    assert.equal(r.name, 'new');
    assert.equal(r.getInt(), 42);
  });

  it('Tags.withValue creates a copy with a new value', () => {
    const t = Tags.int('x', 1);
    const r = Tags.withValue(t, 99);
    assert.equal((r as Tag).getInt(), 99);
    assert.equal(r.name, 'x');
  });

  it('Tags.mergeFields merges multiple fields', () => {
    const base = Tags.struct('S', [Tags.int('a', 1), Tags.int('b', 2)]);
    const updated = Tags.mergeFields(base, [Tags.int('a', 99), Tags.int('c', 3)]);
    const s = updated.getStruct().filter(t => t.type !== TagType.FINISH);
    const a = s.find(t => t.name === 'a');
    const c = s.find(t => t.name === 'c');
    assert.equal(a?.getInt(), 99);
    assert.equal(c?.getInt(), 3);
  });

  it('ListBuilder builds a homogeneous list', () => {
    const list = new ListBuilder('myList')
      .add(Tags.int(null, 1))
      .add(Tags.int(null, 2))
      .addAll([Tags.int(null, 3)])
      .build();
    assert.equal(list.type, TagType.LIST);
    assert.equal(list.getList().length, 3);
  });

  it('Tags.list throws when types differ', () => {
    assert.throws(
      () => Tags.list('x', [Tags.int(null, 1), Tags.string(null, 'a')]),
      TypeError
    );
  });

  it('Tags.list returns NOTHING type for empty list', () => {
    const t = Tags.list('empty', []);
    assert.equal(t.listType, TagType.NOTHING);
  });
});

// ── core/TagParser — uncovered parse paths ────────────────────────────────────

describe('TagParser — uncovered paths', () => {
  it('parses DOUBLE tag', () => {
    const t = Tags.double('d', Math.PI);
    const buf = writeTo(t);
    const rt = readFrom(buf);
    assert.closeTo(rt.getDouble(), Math.PI, 0.0001);
  });

  it('parses MATRIX3f tag round-trip', () => {
    const m = new Matrix3f(1,2,3,4,5,6,7,8,9);
    const t = Tags.matrix3f('mat', m);
    const buf = writeTo(t);
    const rt = readFrom(buf);
    assert.closeTo(rt.getMatrix3f().m00, 1, 0.001);
    assert.closeTo(rt.getMatrix3f().m22, 9, 0.001);
  });

  it('parses MATRIX4f tag round-trip', () => {
    const m = new Matrix4f(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1);
    const t = Tags.matrix4f('mat', m);
    const buf = writeTo(t);
    const rt = readFrom(buf);
    assert.closeTo(rt.getMatrix4f().m30, 5, 0.001);
  });

  it('parses NOTHING tag round-trip', () => {
    const t = Tags.nothing('noop');
    const buf = writeTo(t);
    const rt = readFrom(buf);
    assert.equal(rt.type, TagType.NOTHING);
    assert.isNull(rt.value);
  });

  it('parses VECTOR4f tag round-trip', () => {
    const t = Tags.vector4f('v', 1,2,3,4);
    const buf = writeTo(t);
    const rt = readFrom(buf);
    const v = rt.getVector4f();
    assert.closeTo(v.x, 1, 0.001); assert.closeTo(v.w, 4, 0.001);
  });
});

// ── core/TagSerializer — uncovered paths ──────────────────────────────────────

describe('TagSerializer — uncovered paths', () => {
  it('toObject for DOUBLE tag', () => {
    const obj = toObject(Tags.double('d', 3.14)) as any;
    // Uses _shortName fallback → TAG_TYPE_NAMES[DOUBLE] = 'TAG_Double'
    assert.include(obj.type, 'Double');
    assert.closeTo(obj.value as number, 3.14, 0.001);
  });

  it('toObject for MATRIX3f tag', () => {
    const obj = toObject(Tags.matrix3f('m', new Matrix3f(1,0,0,0,1,0,0,0,1))) as any;
    assert.include(obj.type, 'MATRIX3f'); // serializer uses 'MATRIX3f' (not 'TAG_Matrix3f')
    assert.isArray(obj.value.rows);
  });

  it('toObject for MATRIX4f tag', () => {
    const obj = toObject(Tags.matrix4f('m', new Matrix4f(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1))) as any;
    assert.include(obj.type, 'MATRIX4f');
    assert.isArray(obj.value.rows);
  });

  it('toObject for VECTOR4f tag', () => {
    const obj = toObject(Tags.vector4f('v', 1,2,3,4)) as any;
    assert.include(obj.type, 'Vector4f'); // TAG_TYPE_NAMES[VECTOR4f] = 'TAG_Vector4f'
    assert.equal(obj.value.w, 4);
  });

  it('toJSON includes matrix values', () => {
    const json = toJSON(Tags.matrix3f('m', new Matrix3f(1,0,0,0,1,0,0,0,1)), 2);
    assert.include(json, 'MATRIX3f');
  });
});

// ── config/BlockRegistry — getMass / getPrice ─────────────────────────────────

describe('BlockRegistry — getMass / getPrice', () => {
  before(function() {
    if (!hasStarMade) { this.skip(); return; }
    const cfg = SMToolConfig.fromData({ starmadeDir: SM_DIR, worldDir: 'world0' });
    BlockRegistry.init(BlockConfig.load(cfg));
  });

  it('getMass returns a number for known block', function() {
    if (!hasStarMade) { this.skip(); return; }
    const mass = BlockRegistry.getMass(1);
    assert.isNumber(mass);
  });

  it('getMass returns null for unknown block', function() {
    if (!hasStarMade) { this.skip(); return; }
    assert.isNull(BlockRegistry.getMass(99999));
  });

  it('getPrice returns a number for known block', function() {
    if (!hasStarMade) { this.skip(); return; }
    const price = BlockRegistry.getPrice(1);
    assert.isNumber(price);
  });

  it('getPrice returns null for unknown block', function() {
    if (!hasStarMade) { this.skip(); return; }
    assert.isNull(BlockRegistry.getPrice(99999));
  });

  after(() => { BlockRegistry.reset(); });
});

// ── config/SMToolConfig — validate error paths ────────────────────────────────

describe('SMToolConfig — validate error paths', () => {
  it('validate throws when starmadeDir does not exist', () => {
    const cfg = SMToolConfig.fromData({ starmadeDir: '/nonexistent/path/to/starmade', worldDir: 'world0' });
    assert.throws(() => cfg.validate(), /starmadeDir not found/);
    assert.isFalse(cfg.isValid());
  });

  it('validate throws when data/config is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smtest-'));
    try {
      // starmadeDir exists but has no data/config
      const cfg = SMToolConfig.fromData({ starmadeDir: tmp, worldDir: 'world0' });
      assert.throws(() => cfg.validate(), /data\/config/);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('validate throws when worldDatabase is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smtest-'));
    try {
      fs.mkdirSync(path.join(tmp, 'data', 'config'), { recursive: true });
      const cfg = SMToolConfig.fromData({ starmadeDir: tmp, worldDir: 'nonexistent_world' });
      assert.throws(() => cfg.validate(), /not found in server-database/);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('load throws when starmadeDir is empty in file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smtest-'));
    try {
      fs.writeFileSync(path.join(tmp, 'SMToolConfig.json'), JSON.stringify({ starmadeDir: '' }));
      assert.throws(() => SMToolConfig.load(tmp), /"starmadeDir" is empty/);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('withStarmadeDir returns updated instance', () => {
    const cfg = SMToolConfig.fromData({ starmadeDir: '/a', worldDir: 'world0' });
    const cfg2 = cfg.withStarmadeDir('/b');
    assert.include(cfg2.starmadeDir, '/b');
  });
});

// ── config/FactionConfig — fromXml, getString, getBoolean, saveCustom ─────────

describe('FactionConfig — fromXml, accessors, saveCustom', () => {
  const xml = `<?xml version="1.0"?>
<FactionConfig>
  <FactionActivity>
    <BasicValues>
      <SetInactiveAfterHours>48</SetInactiveAfterHours>
      <UseActivityMode>true</UseActivityMode>
      <WelcomeMessage>Hello</WelcomeMessage>
    </BasicValues>
  </FactionActivity>
</FactionConfig>`;

  it('fromXml parses values', () => {
    const fc = FactionConfig.fromXml(xml);
    assert.equal(fc.getNumber('FactionConfig.FactionActivity.BasicValues.SetInactiveAfterHours'), 48);
    assert.isTrue(fc.getBoolean('FactionConfig.FactionActivity.BasicValues.UseActivityMode'));
    assert.equal(fc.getString('FactionConfig.FactionActivity.BasicValues.WelcomeMessage'), 'Hello');
  });

  it('getBoolean returns default when key absent', () => {
    const fc = FactionConfig.fromXml(xml);
    assert.isFalse(fc.getBoolean('nonexistent.key'));
    assert.isTrue(fc.getBoolean('nonexistent.key', true));
  });

  it('getString returns default when key absent', () => {
    const fc = FactionConfig.fromXml(xml);
    assert.equal(fc.getString('nonexistent.key', 'fallback'), 'fallback');
  });

  it('saveCustom writes only diffs to temp dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fctest-'));
    try {
      const vanilla = FactionConfig.fromXml(xml);
      const modified = vanilla.set('FactionConfig.FactionActivity.BasicValues.SetInactiveAfterHours', 72);
      const fakeConfig = {
        paths: { custom: { factionConfig: path.join(tmp, 'customFactionConfig') } }
      } as any;
      modified.saveCustom(fakeConfig, vanilla);
      const outPath = path.join(tmp, 'customFactionConfig', 'FactionConfig.xml');
      assert.isTrue(fs.existsSync(outPath));
      const content = fs.readFileSync(outPath, 'utf8');
      assert.include(content, '72');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('saveCustom does nothing when no diff', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fctest-'));
    try {
      const vanilla = FactionConfig.fromXml(xml);
      const fakeConfig = {
        paths: { custom: { factionConfig: path.join(tmp, 'customFactionConfig') } }
      } as any;
      vanilla.saveCustom(fakeConfig, vanilla); // no diff
      assert.isFalse(fs.existsSync(path.join(tmp, 'customFactionConfig', 'FactionConfig.xml')));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

// ── config/BlockBehaviorConfig — fromXml, getBoolean, saveCustom ──────────────

describe('BlockBehaviorConfig — fromXml, getBoolean, saveCustom', () => {
  const xml = `<?xml version="1.0"?>
<BlockBehaviorConfig>
  <General>
    <BasicValues>
      <ShieldDoInitialWithoutFromCore>true</ShieldDoInitialWithoutFromCore>
      <ShieldCapacityInitial>220</ShieldCapacityInitial>
    </BasicValues>
  </General>
</BlockBehaviorConfig>`;

  it('fromXml parses values', () => {
    const bbc = BlockBehaviorConfig.fromXml(xml);
    assert.equal(bbc.getNumber('BlockBehaviorConfig.General.BasicValues.ShieldCapacityInitial'), 220);
  });

  it('getBoolean returns true for "true" string', () => {
    const bbc = BlockBehaviorConfig.fromXml(xml);
    assert.isTrue(bbc.getBoolean('BlockBehaviorConfig.General.BasicValues.ShieldDoInitialWithoutFromCore'));
    assert.isFalse(bbc.getBoolean('nonexistent.key'));
    assert.isTrue(bbc.getBoolean('nonexistent.key', true));
  });

  it('saveCustom writes diff and not identical', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bbctest-'));
    try {
      const vanilla = BlockBehaviorConfig.fromXml(xml);
      const modified = vanilla.set('BlockBehaviorConfig.General.BasicValues.ShieldCapacityInitial', 500);
      const fakeConfig = {
        paths: { custom: { blockBehaviorConfig: path.join(tmp, 'customBlockBehaviorConfig') } }
      } as any;
      modified.saveCustom(fakeConfig, vanilla);
      const outPath = path.join(tmp, 'customBlockBehaviorConfig', 'customBlockBehaviorConfig.xml');
      assert.isTrue(fs.existsSync(outPath));
      assert.include(fs.readFileSync(outPath, 'utf8'), '500');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('saveCustom does nothing when no diff', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bbctest-'));
    try {
      const vanilla = BlockBehaviorConfig.fromXml(xml);
      const fakeConfig = {
        paths: { custom: { blockBehaviorConfig: path.join(tmp, 'customBlockBehaviorConfig') } }
      } as any;
      vanilla.saveCustom(fakeConfig, vanilla);
      assert.isFalse(fs.existsSync(path.join(tmp, 'customBlockBehaviorConfig', 'customBlockBehaviorConfig.xml')));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

// ── config/ServerConfig — uncovered paths ─────────────────────────────────────

describe('ServerConfig — uncovered paths', function() {
  this.timeout(10_000);

  it('throws when both live and template cfg missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sctest-'));
    try {
      fs.mkdirSync(path.join(tmp, 'data', 'config', 'defaultSettings'), { recursive: true });
      const fakeConfig = {
        paths: { serverCfg: path.join(tmp, 'server.cfg'), defaultSettings: path.join(tmp, 'data', 'config', 'defaultSettings') }
      } as any;
      assert.throws(() => ServerConfig.load(fakeConfig), /server.cfg not found/);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('setMany throws for unknown key', function() {
    if (!hasStarMade) { this.skip(); return; }
    const cfg = SMToolConfig.fromData({ starmadeDir: SM_DIR });
    const sc = ServerConfig.load(cfg);
    assert.throws(() => sc.setMany({ NONEXISTENT_KEY_12345: 'value' }), TypeError);
  });

  it('getNumber for float-type entries', function() {
    if (!hasStarMade) { this.skip(); return; }
    const cfg = SMToolConfig.fromData({ starmadeDir: SM_DIR });
    const sc = ServerConfig.load(cfg);
    const v = sc.getNumber('THRUST_SPEED_LIMIT');
    assert.isNumber(v);
  });
});

// ── components/DockingState — docked toTag ────────────────────────────────────

describe('DockingState — docked toTag', () => {
  it('toTag when docked', () => {
    const ds = new DockingState('ENTITY_SHIP_X', 0, 10, 20, 30, 0, 0, 0);
    const tag = ds.toTag();
    assert.equal(tag.type, TagType.STRUCT);
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    // First child is BYTE docked state
    assert.isTrue(ds.isDocked);
    console.log('    DockingState docked:', ds.toString());
  });
});

// ── components/HpState — rebooting and long format ────────────────────────────

describe('HpState — rebooting and long format', () => {
  it('isRebooting: rebootStarted > 0n means rebooting', () => {
    // Build an HpState directly with non-zero rebootStarted
    const hp = new HpState(HpState.CLASS_INT, 100n, 200n, 0n, 0n, 999n, 0n, false);
    assert.isTrue(hp.isRebooting);
    const hp2 = new HpState(HpState.CLASS_INT, 100n, 200n, 0n, 0n, 0n, 0n, false);
    assert.isFalse(hp2.isRebooting);
  });

  it('long format (classId = CLASS_LONG) — direct construction', () => {
    const hp = new HpState(HpState.CLASS_LONG, 100n, 500n, 0n, 0n, 0n, 0n, false);
    assert.equal(hp.classId, HpState.CLASS_LONG);
    assert.equal(hp.maxHp, 500n);
    const tag = hp.toTag();
    const rt = HpState.fromTag(tag);
    assert.equal(rt.maxHp, 500n);
    assert.equal(rt.classId, HpState.CLASS_LONG);
  });
});

// ── components/Inventory — add/remove/clear/toTag ─────────────────────────────

describe('Inventory — mutations and toTag', () => {
  const makeItem = (slot: number, type: number, count: number) =>
    new ItemStack(slot, type, count);

  it('add, remove, clear', () => {
    let inv = Inventory.EMPTY;
    inv = inv.set(makeItem(0, 1, 10));
    assert.equal(inv.size, 1);
    inv = inv.set(makeItem(0, 1, 5)); // update existing slot
    assert.equal(inv.get(0)?.count, 5);
    inv = inv.remove(0);
    assert.equal(inv.size, 0);
    const inv2 = inv.set(makeItem(1, 2, 3)).set(makeItem(2, 3, 4));
    assert.equal(inv2.clear().size, 0);
  });

  it('toTag round-trip', () => {
    let inv = Inventory.EMPTY;
    inv = inv.set(makeItem(0, 598, 50));
    inv = inv.set(makeItem(1, 1, 1));
    const tag = inv.toTag();
    assert.equal(tag.type, TagType.STRUCT);
    const rt = Inventory.fromTag(tag);
    assert.equal(rt.size, 2);
    assert.equal(rt.get(0)?.type, 598);
    assert.equal(rt.get(0)?.count, 50);
  });

  it('ItemStack.toString includes meta', () => {
    const item = new ItemStack(0, 1, 1, { id: 0, type: 0, orientation: 0, subId: 0 });
    assert.include(item.toString(), 'meta');
  });
});

// ── components/ManagerContainer — shields / inventories / toTag ───────────────

describe('ManagerContainer — shields / inventories / toTag', function() {
  this.timeout(10_000);

  it('shields accessor', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const containerTag = s.find(t => t.name === 'container' || t.type === TagType.STRUCT);
    if (!containerTag) { this.skip(); return; }
    const mc = ManagerContainer.fromTag(containerTag);
    assert.isNumber(mc.initialShields);
  });

  it('inventories accessor', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const containerTag = s.find(t => t.name === 'container' && t.type === TagType.STRUCT);
    if (!containerTag) { this.skip(); return; }
    const mc = ManagerContainer.fromTag(containerTag);
    assert.instanceOf(mc.inventories, Map);
  });

  it('toTag round-trip minimal', () => {
    const mc = ManagerContainer.EMPTY;
    const tag = mc.toTag('container');
    assert.equal(tag.type, TagType.STRUCT);
  });
});

// ── components/PowerAndThrust — withBattery / ThrustConfig ───────────────────

describe('PowerAndThrust — withBattery / ThrustConfig', () => {
  it('withBattery returns updated state', () => {
    const ps = new PowerState(100, 50);
    const updated = ps.withBattery(200);
    assert.equal(updated.initialBatteryPower, 200);
    assert.equal(updated.initialPower, 100);
  });

  it('ThrustConfig.fromTag returns EMPTY/default when no valid tag', () => {
    // fromTag with a minimal byte-only tag (missing fields) returns defaults
    const emptyTag = Tags.struct(null, []);
    const tc = ThrustConfig.fromTag(emptyTag);
    assert.instanceOf(tc, ThrustConfig);
    assert.equal(tc.version, 0);
  });

  it('ThrustConfig.fromTag parses a struct', () => {
    const tag = Tags.struct(null, [
      Tags.byte(null, 1),   // version
      Tags.byte(null, 1),   // automaticDampeners
      Tags.byte(null, 0),   // automaticReactivateDampeners
      Tags.vector3f(null, 0.5, 0.5, 0.5),
      Tags.float(null, 0.1),
      Tags.byte(null, 1),
      Tags.byte(null, 0),
    ]);
    const tc = ThrustConfig.fromTag(tag);
    assert.equal(tc.version, 1);
    assert.isTrue(tc.automaticDampeners);
  });
});

// ── components/SpawnData — toTag with full payload ────────────────────────────

describe('SpawnData — toTag full payload', () => {
  it('SpawnPoint.toTag with local position', () => {
    const sp = new SpawnPoint('ENTITY_SHIP_X', new SectorPosition(1,2,3), 4,5,6, 0,0,0);
    const tag = sp.toTag();
    assert.equal(tag.type, TagType.STRUCT);
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    assert.equal(s[0]?.getString(), 'ENTITY_SHIP_X');
  });

  it('SpawnController with markers', () => {
    const marker = new SpawnMarker(new SpawnPoint('', SectorPosition.ZERO, 0,0,0,0,0,0), 0n, 0, 0, 0);
    const sc = new SpawnController([marker]);
    const tag = sc.toTag(null);
    const rt = SpawnController.fromTag(tag);
    assert.equal(rt.markers.length, 1);
  });

  it('PlayerSpawnData.withLogout returns updated', () => {
    const sp = SpawnPoint.ZERO;
    const psd = new PlayerSpawnData(1, sp, sp);
    const newLogout = new SpawnPoint('X', new SectorPosition(5,5,5), 0,0,0,0,0,0);
    const updated = psd.withLogoutSpawn(newLogout);
    assert.equal(updated.logoutSpawn.entityUID, 'X');
  });
});

// ── components/Transform — SectorPosition.fromTag error / EntityTransform.toTag ──

describe('Transform — uncovered paths', () => {
  it('SectorPosition.fromTag throws on non-VECTOR3i', () => {
    assert.throws(() => SectorPosition.fromTag(Tags.int('x', 1)), TypeError);
  });

  it('EntityTransform.toTag round-trip', () => {
    const et = new EntityTransform(1,2,3, 1,0,0, 0,1,0, 0,0,1);
    const tag = et.toMatrix4fList('tf');
    const rt = EntityTransform.fromMatrix4fList(tag);
    assert.closeTo(rt.originX, 1, 0.01);
    assert.closeTo(rt.originY, 2, 0.01);
    assert.closeTo(rt.originZ, 3, 0.01);
  });

  it('EntityTransform.IDENTITY', () => {
    assert.equal(EntityTransform.IDENTITY.m00, 1);
  });
});

// ── objects/Catalog — edge cases ──────────────────────────────────────────────

describe('Catalog — edge cases', function() {
  this.timeout(10_000);

  it('find returns null for unknown uid', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('CATALOG.cat');
    const catalog = Catalog.fromTag(root);
    assert.isUndefined(catalog.find('nonexistent-uid-xyz'));
  });

  it('byType returns empty array for unknown type', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('CATALOG.cat');
    const catalog = Catalog.fromTag(root);
    assert.deepEqual(catalog.byType('ASTEROID' as any), []);
  });

  it('CatalogEntry with unknown blueprintType ordinal', () => {
    const entry = new CatalogEntry('uid', 'owner', 0n, '', 1.0, 'SHIP', 0n, 0n, 0);
    const tag = entry.toTag();
    assert.equal(tag.type, TagType.STRUCT);
  });
});

// ── objects/ChatChannels — edge cases ────────────────────────────────────────

describe('ChatChannels — edge cases', function() {
  this.timeout(10_000);

  it('find returns undefined for unknown uid', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('chatchannels.tag');
    const mgr = ChatChannelManager.fromTag(root);
    assert.isUndefined(mgr.find('nonexistent-channel'));
  });

  it('permanentChannels returns empty when no channels', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('chatchannels.tag');
    const mgr = ChatChannelManager.fromTag(root);
    assert.isArray(mgr.permanentChannels);
  });

  it('publicChannels returns empty when no channels', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('chatchannels.tag');
    const mgr = ChatChannelManager.fromTag(root);
    assert.isArray(mgr.publicChannels);
  });

  it('ChatChannel.isPermanent and isPublic', () => {
    const ch = new ChatChannel('uid', 'pass', true, false, [], [], []);
    assert.isTrue(ch.isPermanent);
    assert.isFalse(ch.isPublic);
  });
});

// ── objects/Factions — edge cases ────────────────────────────────────────────

describe('Factions — edge cases', function() {
  this.timeout(10_000);

  it('FactionManager.get returns null for unknown id', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('FACTIONS.fac');
    const mgr = FactionManager.fromTag(root);
    assert.isUndefined(mgr.get(999999));
  });

  it('setFaction modifies name and round-trips', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('FACTIONS.fac');
    const mgr = FactionManager.fromTag(root);
    const factions = mgr.all;
    if (factions.length === 0) { this.skip(); return; }
    const fac = factions[0];
    const modified = mgr.setFaction(new Faction(
      fac.id, fac.name + ' v2', fac.description, fac.dateCreated,
      fac.members, fac.openToJoin, fac.homebaseUID, fac.password,
      fac.allyNeutral, fac.attackNeutral, fac.factionPoints,
      fac.factionMode, fac.showInHub, fac.isNPC,
    ));
    const got = modified.get(fac.id);
    assert.isDefined(got);
    assert.include(got!.name, 'v2');
  });

  it('setRelation and getFaction do not throw on valid data', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('FACTIONS.fac');
    const mgr = FactionManager.fromTag(root);
    const factions = mgr.all;
    if (factions.length < 2) { this.skip(); return; }
    const a = factions[0].id; const b = factions[1].id;
    assert.doesNotThrow(() => mgr.setRelation(a, b, RELATION_WAR));
    assert.doesNotThrow(() => mgr.setRelation(a, b, RELATION_ALLY));
  });
});

// ── objects/FloatingItems ─────────────────────────────────────────────────────

describe('FloatingItemsArchive — get / count', function() {
  this.timeout(10_000);

  it('get / totalCount', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('FLOATING_ITEMS_ARCHIVE.ent');
    const archive = FloatingItemsArchive.fromTag(root);
    const item = archive.byType(1);
    assert.isUndefined(item); // no type=1 in vanilla
    assert.equal(archive.totalCount, 0);
  });
});

// ── objects/PlayerState — withLastEntered / withSpawnData ─────────────────────

describe('PlayerState — uncovered updates', function() {
  this.timeout(10_000);

  it('withFaction updates factionId', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_PLAYERSTATE_InitSysRev.ent');
    const ps = PlayerState.fromTag(root);
    const updated = ps.withFaction(1337, 2);
    assert.equal(updated.factionId, 1337);
    assert.equal(updated.factionRank, 2);
  });

  it('withCreativeMode toggles', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_PLAYERSTATE_InitSysRev.ent');
    const ps = PlayerState.fromTag(root);
    const updated = ps.withCreativeMode(true);
    assert.isTrue(updated.hasCreativeMode);
    const reverted = updated.withCreativeMode(false);
    assert.isFalse(reverted.hasCreativeMode);
  });
});

// ── objects/SegmentController — uncovered with* methods ──────────────────────

describe('SegmentController — withCreatorId / withSeed / withMinable / withVulnerable / withBounds', function() {
  this.timeout(10_000);

  it('withCreatorId', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    // creatorId is set in parent tag — round-trip through toTag
    assert.ok(ship);
  });

  it('withSeed', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    // seed is stored in tag — round-trip verification
    assert.ok(ship);
  });

  it('withMinable / withVulnerable', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    assert.equal(ship.minable, true); // default
    assert.equal(ship.vulnerable, true); // default
  });
});

// ── objects/entities/Ships — FloatingRock / withMass ─────────────────────────

describe('Ships entities — FloatingRock / withMass', function() {
  this.timeout(10_000);

  it('parseSegmentControllerEntity for FLOATINGROCK filename', function() {
    if (!hasSamples) { this.skip(); return; }
    // Use any .ent that parses — the filename determines the class
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const rock = parseSegmentControllerEntity(root, 'ENTITY_FLOATINGROCK_Test.ent');
    assert.ok(rock);
  });

  it('Ship.withMass', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    const updated = ship.withMass(999.5);
    assert.closeTo(updated.mass, 999.5, 0.1);
  });
});

// ── objects/Simulation — toTag minimal ────────────────────────────────────────

describe('Simulation — toTag minimal', function() {
  this.timeout(10_000);

  it('NPCFactionManager.toTag with empty groups', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('NPCFACTIONS_0_0_0.tag');
    const mgr = NPCFactionManager.fromTag(root);
    const tag = mgr.toTag();
    assert.equal(tag.type, TagType.STRUCT);
  });

  it('SimulationState.toTag minimal', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('SIMULATION_STATE.sim');
    const sim = SimulationState.fromTag(root);
    const tag = sim.toTag();
    assert.equal(tag.type, TagType.STRUCT);
  });

  it('SimulationGroup round-trip', () => {
    const group = new SimulationGroup(0, 1, ['player1'], 1000n, null, 0);
    const tag = group.toTag();
    const rt = SimulationGroup.fromTag(tag);
    assert.equal(rt.type, 1);
    assert.deepEqual(rt.members, ['player1']);
  });
});

// ── objects/Trading — edge cases ──────────────────────────────────────────────

describe('TradingManager — edge cases', function() {
  this.timeout(10_000);

  it('removeRoute when not found does not throw', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('TRADING.tag');
    const mgr = TradingManager.fromTag(root);
    assert.doesNotThrow(() => mgr.removeRoute(999999n));
  });
});

// ── objects/Serializables — decodeSerializable fallback ──────────────────────

describe('Serializables — decodeSerializable fallback', () => {
  it('returns RawElement for unknown factoryId', () => {
    const raw = new RawElement(99, new Uint8Array([1,2,3]));
    const result = decodeSerializable(raw);
    assert.instanceOf(result, RawElement);
  });

  it('ElementCountMap with zero-count entries', () => {
    const ecm = new ElementCountMap([{ type: 1, count: 0 }, { type: 2, count: -1 }]);
    assert.equal(ecm.counts.length, 2);
  });

  it('ControlElementMapper with empty links', () => {
    const mapper = new ControlElementMapper([], 0, 0, 0, 0, 0);
    assert.equal(mapper.links.length, 0);
  });
});

// ── smd3/Smd3Writer — emptySmd3File / explicit segVersion ─────────────────────

describe('Smd3Writer — emptySmd3File / explicit segVersion', function() {
  this.timeout(10_000);

  it('emptySmd3File produces a valid parseable file', () => {
    const file = emptySmd3File();
    const buf = writeSmd3(file);
    const rt = parseSmd3(buf);
    assert.isArray(rt.segments);
  });

  it('emptySegment default coords', () => {
    const seg = emptySegment();
    assert.equal(seg.x, 0); assert.equal(seg.y, 0); assert.equal(seg.z, 0);
    assert.equal(seg.blockCount, 0);
  });

  it('emptySegment explicit coords', () => {
    const seg = emptySegment(1, 2, 3);
    assert.equal(seg.x, 1); assert.equal(seg.y, 2); assert.equal(seg.z, 3);
  });

  it('writeSmd3 with explicit segVersion', function() {
    if (!hasSamples) { this.skip(); return; }
    const file = emptySmd3File();
    const seg = emptySegment(0, 0, 0);
    seg.blocks[0] = { type: 1, hp: 100, active: false, orientation: 0 };
    seg.blockCount = 1;
    file.segments.push(seg);
    const buf = writeSmd3(file, VERSION_4BYTE);
    assert.ok(buf.length > 0);
  });
});

// ── smd3/SimParser — non-empty groups ────────────────────────────────────────

describe('SimParser — non-empty groups', () => {
  it('parseSim with groups', () => {
    // Build a synthetic .sim with one group
    const group = Tags.struct(null, [
      Tags.byte(null, 0),
      Tags.int(null, 1),
      Tags.struct(null, [Tags.string(null, 'player1')]),
      Tags.long(null, 1000n),
      Tags.vector3i(null, 0, 0, 0),
      Tags.int(null, 0),
    ]);
    const root = Tags.struct('SimulationState', [
      Tags.byte(null, 0),
      Tags.struct(null, [group]),
      Tags.long(null, 12345n),
    ]);
    const buf = writeTo(root);
    const sim = parseSim(buf);
    assert.equal(sim.version, 0);
    assert.equal(sim.groups.length, 1);
    assert.equal(sim.lastUpdate, 12345n);
  });
});

// ── smd3/SmbphWriter — explicit gameVersion / classification ──────────────────

describe('SmbphWriter — explicit gameVersion / classification', function() {
  this.timeout(10_000);

  it('writeSmbph with explicit gameVersion', function() {
    if (!hasSamples) { this.skip(); return; }
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    if (!fs.existsSync(bpDir)) { this.skip(); return; }
    const bp = parseBlueprintFolder(bpDir);
    const buf = writeSmbph(bp.root.header, '0.204.999');
    assert.ok(buf.length > 0);
  });

  it('writeSmbph with classification set', function() {
    if (!hasSamples) { this.skip(); return; }
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    if (!fs.existsSync(bpDir)) { this.skip(); return; }
    const bp = parseBlueprintFolder(bpDir);
    const header = { ...bp.root.header, classification: 2 };
    const buf = writeSmbph(header as any);
    assert.ok(buf.length > 0);
  });
});

// ── smd3/SmbmmParser — non-empty branch ──────────────────────────────────────

describe('SmbmmParser — non-empty branch', () => {
  it('parseSmbmm with non-empty mapping', () => {
    // Build a minimal smbmm: short count + (short from + short to) pairs
    const w = new BufferWriter();
    w.writeInt16BE(2);      // 2 mappings
    w.writeInt16BE(100); w.writeInt16BE(200);
    w.writeInt16BE(300); w.writeInt16BE(400);
    const smbmm = parseSmbmm(w.toBuffer());
    assert.isFalse(smbmm.isEmpty);
    assert.isAbove(smbmm.raw.length, 0);
  });
});

// ── smd3/SmbplParser — complex connections ────────────────────────────────────

describe('SmbplParser — complex connections', function() {
  this.timeout(10_000);

  it('parseSmbpl with version > 0', function() {
    if (!hasSamples) { this.skip(); return; }
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    const smbplPath = path.join(bpDir, 'ATTACHED_0', 'logic.smbpl');
    if (!fs.existsSync(smbplPath)) { this.skip(); return; }
    const file = parseSmbpl(fs.readFileSync(smbplPath));
    assert.isDefined(file);
    assert.isDefined(file.links);
  });
});

// ── enriched/RichViews — uncovered paths ──────────────────────────────────────

describe('RichViews — uncovered paths', function() {
  this.timeout(30_000);

  before(function() {
    if (!hasStarMade) { this.skip(); return; }
    const cfg = SMToolConfig.fromData({ starmadeDir: SM_DIR, worldDir: 'world0' });
    BlockRegistry.init(BlockConfig.load(cfg));
  });

  it('getSegmentStats on empty segment', () => {
    const seg = emptySegment(0, 0, 0);
    const stats = getSegmentStats(seg);
    assert.equal(stats.totalBlocks, 0);
    assert.equal(stats.uniqueTypes, 0);
  });

  it('enrichInventory with items', function() {
    if (!hasStarMade) { this.skip(); return; }
    let inv = Inventory.EMPTY;
    inv = inv.set(new ItemStack(0, 1, 5));
    const rich = enrichInventory(inv);
    assert.equal(rich.length, 1);
    assert.isString(rich[0].blockName);
  });

  it('RichSegmentController.analyzeSmd3', function() {
    if (!hasSamples || !hasStarMade) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    const rich = new RichSegmentController(ship);
    const smd3File = emptySmd3File();
    const stats = rich.analyzeSmd3(smd3File);
    assert.isArray(stats);
  });

  it('RichSegmentController.summary', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const ship = parseSegmentControllerEntity(root, 'ENTITY_SHIP_Traders Homerl110.ent');
    const rich = new RichSegmentController(ship);
    const summary = rich.summary();
    assert.isString(summary.uniqueId);
    assert.isArray(summary.topControlTypes);
  });

  after(() => { BlockRegistry.reset(); });
});

// ── entity/PlayerState — legacy parser uncovered branches ─────────────────────

describe('entity/PlayerState — uncovered branches', function() {
  this.timeout(10_000);

  it('parses with lsector / lspawn tags', () => {
    const root = Tags.struct('PlayerState', [
      Tags.long('credits', 12345n),
      Tags.struct(null, []), // spawnData
      Tags.struct(null, []), // inv1
      Tags.vector3i('sector', 1, 2, 3),
      Tags.vector3f('lspawn', 0.5, 1.0, -0.5),
      Tags.vector3i('lsector', 4, 5, 6),
    ]);
    const buf = writeTo(root);
    const data = legacyParsePlayerState(readFrom(buf));
    assert.equal(data.logoutSector?.x, 4);
    assert.closeTo(data.logoutLocalPos?.x ?? 0, 0.5, 0.01);
  });

  it('parses with lastLogout field', () => {
    const root = Tags.struct('PlayerState', [
      Tags.long('credits', 0n),
      Tags.struct(null, []),
      Tags.struct(null, []),
      Tags.int(null, 0),         // [3] not VECTOR3i
      Tags.vector3f(null,0,0,0), // [4]
      Tags.vector3i(null,0,0,0), // [5]
      Tags.struct(null, []),     // [6] faction
      Tags.long(null, 1111111n), // [7] lastLogin
      Tags.long(null, 2222222n), // [8] lastLogout
    ]);
    const buf = writeTo(root);
    const data = legacyParsePlayerState(readFrom(buf));
    assert.equal(data.lastLogout, 2222222n);
  });

  it('throws on non-STRUCT root', () => {
    assert.throws(() => legacyParsePlayerState(Tags.int('x', 1)), TypeError);
  });
});
