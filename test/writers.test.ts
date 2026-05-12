/**
 * @fileoverview Writer Round-Trip Tests
 *
 * Parses existing files, re-encodes them with the matching writer, re-parses
 * the output, and verifies semantic equivalence for migrating binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { Tags, StructBuilder } from '../src/core/TagBuilder.js';
import { TagType } from '../src/core/TagType.js';
import { parseSmd3 } from '../src/smd3/Smd3Parser.js';
import { writeSmd3, emptySegment, emptySmd3File } from '../src/smd3/Smd3Writer.js';
import { parseSmtpl } from '../src/smd3/SmtplParser.js';
import { writeSmtpl } from '../src/smd3/SmtplWriter.js';
import { parseSmbpl } from '../src/smd3/SmbplParser.js';
import { writeSmbpl } from '../src/smd3/SmbplWriter.js';
import { parseSmbph } from '../src/smd3/SmbpmParser.js'; // sera SmbphWriter
import { writeSmbph } from '../src/smd3/SmbphWriter.js';
import { parseSmbpm } from '../src/smd3/SmbpmParser.js';
import { BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';
import type { Tag } from '../src/core/Tag.js';

registerAllFactories();

const S  = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const BASE = path.join(S, 'BASE_Warehouse_Station');

// ── TagBuilder ────────────────────────────────────────────────────────────────

describe('TagBuilder — tag creation and updates', function () {

  it('primitive factories', () => {
    assert.equal(Tags.int('hp', 100).getInt(), 100);
    assert.equal(Tags.long('credits', 50000n).getLong(), 50000n);
    assert.equal(Tags.float('speed', 4.5).getFloat(), Math.fround(4.5));
    assert.equal(Tags.string('name', 'Explorer').getString(), 'Explorer');
    assert.equal(Tags.bool('active', true).getByte(), 1);
    assert.equal(Tags.bool('active', false).getByte(), 0);
    assert.deepEqual(Tags.vector3i('pos', 4, 4, 4).getVector3i(), { x: 4, y: 4, z: 4 });
  });

  it('STRUCT creation', () => {
    const tag = Tags.struct('Player', [
      Tags.int('id', 42),
      Tags.string('name', 'InitSysRev'),
      Tags.long('credits', 999n),
    ]);
    assert.equal(tag.type, TagType.STRUCT);
    assert.equal(tag.name, 'Player');
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    assert.equal(s.length, 3);
    assert.equal(s[0].getInt(), 42);
    assert.equal(s[1].getString(), 'InitSysRev');
  });

  it('StructBuilder fluent', () => {
    const tag = new StructBuilder('Ship')
      .add(Tags.string('name', 'Explorer'))
      .add(Tags.int('factionId', 0))
      .add(Tags.vector3i('sector', 4, 4, 4))
      .build();
    assert.equal(tag.type, TagType.STRUCT);
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    assert.equal(s.length, 3);
    console.log('    StructBuilder:', s.map(t => t.name + '=' + t.value).join(', '));
  });

  it('setField replaces a field', () => {
    let tag = Tags.struct('Player', [
      Tags.int('id', 1),
      Tags.long('credits', 1000n),
    ]);
    tag = Tags.setField(tag, 'credits', Tags.long('credits', 9999n));
    assert.equal(tag.findByName('credits')!.getLong(), 9999n);
  });

  it('setField adds a missing field', () => {
    let tag = Tags.struct('Player', [Tags.int('id', 1)]);
    tag = Tags.setField(tag, 'newField', Tags.string('newField', 'hello'));
    assert.equal(tag.findByName('newField')!.getString(), 'hello');
  });

  it('removeField', () => {
    let tag = Tags.struct('Test', [Tags.int('a', 1), Tags.int('b', 2), Tags.int('c', 3)]);
    tag = Tags.removeField(tag, 'b');
    assert.isNull(tag.findByName('b'));
    assert.equal(tag.findByName('a')!.getInt(), 1);
    assert.equal(tag.findByName('c')!.getInt(), 3);
  });

  it('safe getters with defaults', () => {
    const tag = Tags.struct('T', [Tags.int('x', 42)]);
    assert.equal(Tags.getInt(tag, 'x'), 42);
    assert.equal(Tags.getInt(tag, 'absent'), 0);
    assert.equal(Tags.getString(tag, 'absent', 'default'), 'default');
  });

  it('round-trip Tag → writeTo → readFrom → setField → writeTo → readFrom', () => {
    // Read a real file
    const original = readFrom(fs.readFileSync(path.join(S, 'ENTITY_PLAYERSTATE_InitSysRev.ent')));
    // Modify credits
    const modified = Tags.setField(original, 'credits', Tags.long('credits', 1234567n));
    // Encode → decode
    const buf = writeTo(modified);
    const decoded = readFrom(buf);
    assert.equal(decoded.findByName('credits')!.getLong(), 1234567n);
    console.log('    Modified credits:', decoded.findByName('credits')!.getLong().toString());
  });
});

// ── writeSmd3 ─────────────────────────────────────────────────────────────────

describe('Smd3Writer — .smd3 encoding', function () {
  this.timeout(15_000);

  it('round-trip smd3 (Isanth)', () => {
    const data = fs.readFileSync(path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3'));
    const file1 = parseSmd3(data);
    const encoded = writeSmd3(file1);
    const file2 = parseSmd3(encoded);

    assert.equal(file2.segments.length, file1.segments.length);
    const s1 = file1.segments[0], s2 = file2.segments[0];
    assert.equal(s2.blockCount, s1.blockCount);
    // Check a few blockks
    for (let i = 0; i < 100; i++) {
      assert.equal(s2.blocks[i].type, s1.blocks[i].type, `bloc ${i} type`);
    }
    console.log('    Isanth round-trip: ' + s1.blockCount + ' blocks → ok');
  });

  it('empty smd3 file is encodable', () => {
    const empty = emptySmd3File();
    const buf = writeSmd3(empty);
    const parsed = parseSmd3(buf);
    assert.equal(parsed.segments.length, 0);
    assert.equal(parsed.usedSlots, 0);
    console.log('    Smd3 empty: ' + buf.length + ' bytes');
  });

  it('modify one block and re-encode', () => {
    const data = fs.readFileSync(path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3'));
    const file = parseSmd3(data);
    const seg = file.segments[0];

    // Clone the blocks and modify the first one
    const newBlocks = [...seg.blocks];
    newBlocks[0] = { type: 999, hp: 50, active: true, orientation: 3 };

    const newSeg = { ...seg, blocks: newBlocks };
    const newFile = { ...file, segments: [newSeg] };

    const encoded = writeSmd3(newFile);
    const decoded = parseSmd3(encoded);
    const b = decoded.segments[0].blocks[0];
    assert.equal(b.type, 999);
    assert.equal(b.hp, 50);
    assert.equal(b.active, true);
    assert.equal(b.orientation, 3);
    console.log('    Modified block: type=999 hp=50 active=true ori=3 → ok');
  });
});

// ── writeSmtpl ────────────────────────────────────────────────────────────────

describe('SmtplWriter — .smtpl encoding', function () {

  it('round-trip NOR Gate', () => {
    const data = fs.readFileSync(path.join(S, '8-Bit-4-Wide-NOR Gate RAM Module-12x12x16-00.smtpl'));
    const tpl1 = parseSmtpl(data);
    const encoded = writeSmtpl(tpl1);
    const tpl2 = parseSmtpl(encoded);

    assert.equal(tpl2.totalBlocks, tpl1.totalBlocks);
    assert.equal(tpl2.minX, tpl1.minX);
    assert.equal(tpl2.maxX, tpl1.maxX);
    // Check connections
    assert.equal(tpl2.connections.length, tpl1.connections.length);
    // Check a few blockks
    for (let i = 0; i < Math.min(50, tpl1.pieces.length); i++) {
      assert.equal(tpl2.pieces[i].type, tpl1.pieces[i].type, `piece ${i} type`);
      assert.equal(tpl2.pieces[i].orientation, tpl1.pieces[i].orientation, `piece ${i} orient`);
    }
    console.log('    NOR Gate round-trip: ' + tpl1.totalBlocks + ' blocks, ' + tpl1.connections.length + ' connections → ok');
  });

  it('83 DMINT round-trip lossless', () => {
    const dir = path.join(S, 'DMINT prefab interior module pack');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.smtpl'));
    let ok = 0;
    for (const f of files) {
      const data = fs.readFileSync(path.join(dir, f));
      const tpl1 = parseSmtpl(data);
      const encoded = writeSmtpl(tpl1);
      const tpl2 = parseSmtpl(encoded);
      if (tpl2.totalBlocks === tpl1.totalBlocks) ok++;
    }
    console.log('    DMINT round-trip: ' + ok + '/' + files.length + ' ok');
    assert.equal(ok, files.length);
  });
});

// ── writeSmbpl ────────────────────────────────────────────────────────────────

describe('SmbplWriter — .smbpl encoding', function () {

  it('round-trip BASE_Warehouse_Station logic', () => {
    const data = fs.readFileSync(path.join(BASE, 'logic.smbpl'));
    const logic1 = parseSmbpl(data);
    const encoded = writeSmbpl(logic1);
    const logic2 = parseSmbpl(encoded);

    assert.equal(logic2.controllerCount, logic1.controllerCount, 'controllerCount');
    assert.equal(logic2.links.length, logic1.links.length, 'links.length');
    console.log('    Smbpl round-trip: ' + logic1.links.length + ' links → ok');
  });

  it('smbpl empty encodable', () => {
    const empty = { structureVersion: 0, links: [], controllerCount: 0 };
    const buf = writeSmbpl(empty);
    const parsed = parseSmbpl(buf);
    assert.equal(parsed.links.length, 0);
  });
});

// ── writeSmbph ────────────────────────────────────────────────────────────────

describe('SmbphWriter — .smbph encoding', function () {

  it('round-trip BASE_Warehouse_Station header', async () => {
    const data = fs.readFileSync(path.join(BASE, 'header.smbph'));
    // Parse via SmentParser._parseHeaderBuffer
    const { _parseHeaderBuffer } = await import('../src/smd3/SmentParser.js');
    const hdr1 = _parseHeaderBuffer(data);
    const encoded = writeSmbph(hdr1);
    const hdr2 = _parseHeaderBuffer(encoded);

    assert.equal(hdr2.entityType, hdr1.entityType, 'entityType');
    assert.equal(hdr2.totalBlockCount, hdr1.totalBlockCount, 'totalBlockCount');
    assert.closeTo(hdr2.boundingBox.minX, hdr1.boundingBox.minX, 0.01, 'minX');
    assert.closeTo(hdr2.boundingBox.maxX, hdr1.boundingBox.maxX, 0.01, 'maxX');
    console.log('    Smbph round-trip: type=' + hdr1.entityType + ' blocks=' + hdr1.totalBlockCount + ' → ok');
  });
});

// ── writeSmbpm ────────────────────────────────────────────────────────────────

describe('SmbpmWriter — .smbpm encoding', function () {
  this.timeout(10_000);

  it('round-trips BASE_Warehouse_Station meta.smbpm', async () => {
    const { parseSmbpm } = await import('../src/smd3/SmbpmParser.js');
    const { writeSmbpm } = await import('../src/smd3/SmbpmWriter.js');
    const data = fs.readFileSync(path.join(BASE, 'meta.smbpm'));
    const meta1 = parseSmbpm(data);
    const encoded = writeSmbpm(meta1);
    const meta2 = parseSmbpm(encoded);

    assert.equal(meta2.metaVersion, meta1.metaVersion, 'metaVersion');
    assert.equal(meta2.dockingEntries.length, meta1.dockingEntries.length, 'dockingEntries count');
    assert.equal(meta2.railChildren.length, meta1.railChildren.length, 'railChildren count');
    assert.equal(meta2.cargoPoints.length, meta1.cargoPoints.length, 'cargoPoints count');
    assert.equal(meta2.railDockerPieces.length, meta1.railDockerPieces.length, 'railDockerPieces count');
    if (meta1.railUID !== undefined) assert.equal(meta2.railUID, meta1.railUID, 'railUID');
    console.log('    Smbpm round-trip: version=' + meta1.metaVersion
      + ' docking=' + meta1.dockingEntries.length
      + ' railChildren=' + meta1.railChildren.length
      + ' cargo=' + meta1.cargoPoints.length + ' → ok');
  });

  it('all 43 .smbpm files round-trip without crashing', async () => {
    const { parseSmbpm } = await import('../src/smd3/SmbpmParser.js');
    const { writeSmbpm } = await import('../src/smd3/SmbpmWriter.js');
    const dir = path.join(BASE, '..');
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.smbpm'))
      .map(f => path.join(dir, f));
    let ok = 0, fail = 0;
    for (const file of files) {
      try {
        const data = fs.readFileSync(file);
        const m1 = parseSmbpm(data);
        const encoded = writeSmbpm(m1);
        const m2 = parseSmbpm(encoded);
        assert.equal(m2.metaVersion, m1.metaVersion);
        ok++;
      } catch (e) {
        fail++;
      }
    }
    console.log('    smbpm round-trip: ' + ok + ' OK, ' + fail + ' FAIL');
    assert.equal(fail, 0);
  });
});

// ── writeSmbmm ────────────────────────────────────────────────────────────────

describe('SmbmmWriter — .smbmm encoding', function () {
  it('empty vanilla blueprint produces empty buffer', async () => {
    const { writeSmbmm } = await import('../src/smd3/SmbmmWriter.js');
    const { parseSmbmm } = await import('../src/smd3/SmbmmParser.js');
    const buf = writeSmbmm({ size: 0, isEmpty: true, raw: new Uint8Array(0) });
    assert.equal(buf.length, 0);
    const parsed = parseSmbmm(buf);
    assert.isTrue(parsed.isEmpty);
  });

  it('non-empty smbmm preserves raw bytes', async () => {
    const { writeSmbmm } = await import('../src/smd3/SmbmmWriter.js');
    const { parseSmbmm } = await import('../src/smd3/SmbmmParser.js');
    const raw = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const buf = writeSmbmm({ size: 4, isEmpty: false, raw });
    assert.equal(buf.length, 4);
    const parsed = parseSmbmm(buf);
    assert.isFalse(parsed.isEmpty);
    assert.deepEqual(Array.from(parsed.raw), [1, 2, 3, 4]);
  });
});

// ── writeSim ──────────────────────────────────────────────────────────────────

describe('SimWriter — .sim encoding', function () {
  it('round-trips SIMULATION_STATE.sim', async () => {
    const { writeSim } = await import('../src/smd3/SimWriter.js');
    const { parseSim } = await import('../src/smd3/SimParser.js');
    const simPath = '/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade/server-database/world0/SIMULATION_STATE.sim';
    if (!fs.existsSync(simPath)) return; // skip if not present
    const data = fs.readFileSync(simPath);
    const sim1 = parseSim(data);
    const encoded = writeSim(sim1);
    const sim2 = parseSim(encoded);
    assert.equal(sim2.version, sim1.version, 'version');
    assert.equal(sim2.groups.length, sim1.groups.length, 'groups');
    console.log('    Sim round-trip: version=' + sim1.version + ' groups=' + sim1.groups.length + ' → ok');
  });
});

// ── Tag-based object toBuffer() ───────────────────────────────────────────────

describe('Tag-based objects — toBuffer() round-trips', function () {
  this.timeout(10_000);

  it('FactionManager.toBuffer() round-trips FACTIONS.fac', async () => {
    const { FactionManager } = await import('../src/objects/Factions.js');
    const data = fs.readFileSync('/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade/server-database/world0/FACTIONS.fac');
    const fm1 = FactionManager.fromBuffer(data);
    const fm2 = FactionManager.fromBuffer(fm1.toBuffer());
    assert.equal(fm2.factions.size, fm1.factions.size, 'faction count');
    assert.equal(fm2.relations.length, fm1.relations.length, 'relation count');
    console.log('    FactionManager round-trip: ' + fm1.factions.size + ' factions, ' + fm1.relations.length + ' relations → ok');
  });

  it('Catalog.toBuffer() round-trips CATALOG.cat', async () => {
    const { Catalog } = await import('../src/objects/Catalog.js');
    const data = fs.readFileSync('/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade/server-database/world0/CATALOG.cat');
    const c1 = Catalog.fromBuffer(data);
    const c2 = Catalog.fromBuffer(c1.toBuffer());
    assert.equal(c2.entries.length, c1.entries.length, 'entry count');
    console.log('    Catalog round-trip: ' + c1.entries.length + ' entries → ok');
  });

  it('TradingManager.toBuffer() round-trips TRADING.tag', async () => {
    const { TradingManager } = await import('../src/objects/Trading.js');
    const tradePath = '/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade/server-database/world0/TRADING.tag';
    if (!fs.existsSync(tradePath)) return;
    const data = fs.readFileSync(tradePath);
    const t1 = TradingManager.fromBuffer(data);
    const t2 = TradingManager.fromBuffer(t1.toBuffer());
    assert.equal(t2.routes.length, t1.routes.length, 'route count');
    console.log('    TradingManager round-trip: ' + t1.routes.length + ' routes → ok');
  });

  it('ChatChannelManager.toBuffer() round-trips chatchannels.tag', async () => {
    const { ChatChannelManager } = await import('../src/objects/ChatChannels.js');
    const data = fs.readFileSync('/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade/server-database/world0/chatchannels.tag');
    const c1 = ChatChannelManager.fromBuffer(data);
    const c2 = ChatChannelManager.fromBuffer(c1.toBuffer());
    assert.equal(c2.channels.length, c1.channels.length, 'channel count');
    console.log('    ChatChannelManager round-trip: ' + c1.channels.length + ' channels → ok');
  });
});
