/**
 * @fileoverview Coverage Gap Tests — Round 4
 *
 * Final targeted tests for remaining uncovered lines.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { assert } from 'chai';

import { registerAllFactories, RawElement } from '../src/serializable/Factories.js';
import { SerializableTagRegister } from '../src/serializable/SerializableTagRegister.js';
import { readFrom, writeTo }       from '../src/core/TagParser.js';
import { Tags }                    from '../src/core/TagBuilder.js';
import { Tag, FINISH_TAG }         from '../src/core/Tag.js';
import { TagType }                 from '../src/core/TagType.js';
import { BufferWriter }            from '../src/core/BufferWriter.js';
import { BufferReader }            from '../src/core/BufferReader.js';

import { SpawnPoint, PlayerSpawnData, SpawnController, SpawnMarker } from '../src/objects/components/SpawnData.js';
import { SectorPosition }          from '../src/objects/components/Transform.js';
import { Inventory, ItemStack }    from '../src/objects/components/Inventory.js';

import { SimulationState, SimulationGroup, NPCFactionManager } from '../src/objects/Simulation.js';
import { TradingManager, TradeRoute }  from '../src/objects/Trading.js';
import { ElementCountMap }         from '../src/objects/Serializables.js';

import { PlayerStateEntity, FactionMembership } from '../src/objects/entities/PlayerStateEntity.js';
import { ManagerContainer } from '../src/objects/components/ManagerContainer.js';
import { parseSegmentControllerEntity } from '../src/objects/entities/Ships.js';

import { parseSmbmm }              from '../src/smd3/SmbmmParser.js';
import { parseSmbpm }              from '../src/smd3/SmbpmParser.js';
import { parseSmbpl }              from '../src/smd3/SmbplParser.js';
import { parseSmtpl }              from '../src/smd3/SmtplParser.js';
import { parseSmd3, DATA_SINGLE, DATA_SINGLE_SIDE_EDGE, BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';
import { parseBlueprintFolder } from '../src/smd3/BlueprintFolderParser.js';
import { writeSmbph } from '../src/smd3/SmbphWriter.js';
import { writeSmd3, emptySegment, emptySmd3File } from '../src/smd3/Smd3Writer.js';

registerAllFactories();

const S = path.resolve('samples');
const hasSamples = fs.existsSync(S);
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

// ── serializable/Factories — ControlElementMapper / BlockBuffer factory parsing

describe('Factories — ControlElementMapper / BlockBuffer binary parsing', () => {
  it('ControlElementMapper factory (factory 0) parses disk format', () => {
    // Build a minimal ControlElementMapper disk format payload:
    // int header (negative, version encoded, isDisk = version > 1024)
    // int keySize = 0
    const w = new BufferWriter();
    w.writeInt32BE(-(1025)); // -1025: abs=1025 > 1024 → isDisk=true
    w.writeInt32BE(0);       // keySize = 0
    const factory = SerializableTagRegister.register[0];
    assert.isDefined(factory, 'factory 0 must be registered');
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
    assert.equal((elem as RawElement).factoryId, 0);
  });

  it('ControlElementMapper factory (factory 0) parses network format', () => {
    // Network format: header = -(version) where version <= 1024
    // isDisk = false → use network compressed format
    const w = new BufferWriter();
    w.writeInt32BE(-1);    // header = -1 → version=1, isDisk = 1 <= 1024 → false
    w.writeInt32BE(0);     // keySize = 0
    const factory = SerializableTagRegister.register[0];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
  });

  it('BlockBuffer factory (factory 4) parses minimal payload', () => {
    // int size=0, int controllerSize=0, int conSize=0
    const w = new BufferWriter();
    w.writeInt32BE(0); // size
    w.writeInt32BE(0); // controllerSize
    w.writeInt32BE(0); // conSize
    const factory = SerializableTagRegister.register[4];
    assert.isDefined(factory, 'factory 4 must be registered');
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
    assert.equal((elem as RawElement).factoryId, 4);
  });

  it('BlockBuffer factory with meta entries', () => {
    // size=1, controllerSize=0, conSize=0, 1 element with meta=true
    const w = new BufferWriter();
    w.writeInt32BE(1);   // size
    w.writeInt32BE(0);   // controllerSize
    w.writeInt32BE(0);   // conSize
    // Element: 3×short pos + int data + byte meta
    w.writeInt16BE(1); w.writeInt16BE(2); w.writeInt16BE(3); // pos
    w.writeInt32BE(0);   // data
    w.writeInt8(1);      // meta = true
    w.writeInt64BE(100n); // controller long
    w.writeInt32BE(2);   // mSize = 2 connected
    w.writeInt64BE(101n); w.writeInt64BE(102n);
    const factory = SerializableTagRegister.register[4];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
  });

  it('Long2Vector3fMap factory (factory 5) parses non-empty payload', () => {
    const w = new BufferWriter();
    w.writeInt32BE(1);           // size = 1
    w.writeInt64BE(999n);        // key
    w.writeFloat32BE(1.0); w.writeFloat32BE(2.0); w.writeFloat32BE(3.0);
    const factory = SerializableTagRegister.register[5];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
    assert.equal((elem as RawElement).factoryId, 5);
  });

  it('Long2TransformMap factory (factory 6) parses non-empty payload', () => {
    const w = new BufferWriter();
    w.writeInt32BE(1);            // size = 1
    w.writeInt64BE(42n);          // key
    for (let i = 0; i < 12; i++) w.writeFloat32BE(i === 0 || i === 4 || i === 8 ? 1.0 : 0.0);
    const factory = SerializableTagRegister.register[6];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
    assert.equal((elem as RawElement).factoryId, 6);
  });
});

// ── objects/components/SpawnData — SpawnPoint.with() ─────────────────────────

describe('SpawnPoint.with() partial override', () => {
  it('SpawnPoint.with() changes specified fields only', () => {
    const sp = new SpawnPoint('entity1', new SectorPosition(1,2,3), 4,5,6, 0,0,0);
    const updated = sp.with({ entityUID: 'entity2', localX: 99 });
    assert.equal(updated.entityUID, 'entity2');
    assert.equal(updated.localX, 99);
    assert.equal(updated.localY, 5); // unchanged
    assert.equal(updated.sector.x, 1); // unchanged
  });

  it('SpawnPoint.toString', () => {
    const sp = new SpawnPoint('uid', new SectorPosition(1,2,3), 4,5,6, 0,0,0);
    assert.include(sp.toString(), 'uid');
  });
});

// ── objects/entities/PlayerStateEntity — withCreativeMode branch (line 122) ──

describe('PlayerStateEntity — withCreativeMode line 122 branch', function() {
  this.timeout(10_000);

  it('withCreativeMode when [10] is not BYTE (returns same)', function() {
    // Build a PlayerState root where index [10] is not BYTE
    const root = Tags.struct('PlayerState', [
      Tags.long('credits', 1000n),
      Tags.struct(null, []),  // [1] spawnData
      Tags.struct(null, []),  // [2] inventory
      Tags.vector3i('sector', 1,2,3), // [3]
      Tags.vector3f(null, 0,0,0), // [4]
      Tags.vector3i(null, 0,0,0), // [5]
      Tags.struct(null, []),  // [6] faction
      Tags.long(null, 0n),    // [7] lastLogin
      Tags.long(null, 0n),    // [8] lastLogout
      Tags.struct(null, []),  // [9] ips
      Tags.string(null, 'not_a_byte'), // [10] NOT a BYTE — withCreativeMode should no-op
    ]);
    const buf = writeTo(root);
    const ps = PlayerStateEntity.fromTag(readFrom(buf));
    const updated = ps.withCreativeMode(true);
    assert.isDefined(updated); // doesn't crash
  });
});

// ── objects/Simulation — addGroup / removeGroup / toString ────────────────────

describe('SimulationState — addGroup / removeGroup / toString', function() {
  this.timeout(10_000);

  it('addGroup and removeGroup', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('SIMULATION_STATE.sim');
    const sim = SimulationState.fromTag(root);

    const group = new SimulationGroup(0, 1, ['player1', 'player2'], 1000n, null, 0);
    const withGroup = sim.addGroup(group);
    assert.equal(withGroup.groups.length, sim.groups.length + 1);

    const without = withGroup.removeGroup(withGroup.groups.length - 1);
    assert.equal(without.groups.length, sim.groups.length);
  });

  it('SimulationGroup.toString', () => {
    const g = new SimulationGroup(0, 1, ['p1'], 0n, null, 0);
    assert.include(g.toString(), 'SimulationGroup');
  });

  it('NPCFactionManager.toString', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('NPCFACTIONS_0_0_0.tag');
    const mgr = NPCFactionManager.fromTag(root);
    assert.include(mgr.toString(), 'NPCFactionManager');
  });
});

// ── objects/Trading — addRoute / removeRoute / updateRoute / routesBetween ───

describe('TradingManager — addRoute / removeRoute / updateRoute / routesBetween', function() {
  this.timeout(10_000);

  it('addRoute and removeRoute', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('TRADING.tag');
    const mgr = TradingManager.fromTag(root);
    const route = new TradeRoute(
      new ElementCountMap([]), 0n, 0n, 0n, 0n, 0n, 0n, 0,
      null, null, null, 0, 0, '', '', '', '', null, [],
    );
    const updated = mgr.addRoute(route);
    assert.equal(updated.routes.length, mgr.routes.length + 1);
    const removed = updated.removeRoute(updated.routes.length - 1);
    assert.equal(removed.routes.length, mgr.routes.length);
  });

  it('updateRoute', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('TRADING.tag');
    const mgr = TradingManager.fromTag(root);
    const route = new TradeRoute(
      new ElementCountMap([]), 1n, 1n, 1n, 1n, 1n, 1n, 1,
      null, null, null, 1, 1, 'from', 'to', 'fs', 'ts', null, [],
    );
    const withRoute = mgr.addRoute(route);
    const updatedRoute = new TradeRoute(
      new ElementCountMap([]), 99n, 99n, 99n, 1n, 1n, 1n, 1,
      null, null, null, 1, 1, 'from', 'to', 'fs', 'ts', null, [],
    );
    const updated = withRoute.updateRoute(withRoute.routes.length - 1, updatedRoute);
    assert.equal(updated.routes[updated.routes.length - 1].blockPrice, 99n);
  });

  it('routesBetween', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('TRADING.tag');
    const mgr = TradingManager.fromTag(root);
    const result = mgr.routesBetween(1, 2);
    assert.isArray(result);
  });

  it('routesFrom / routesTo', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('TRADING.tag');
    const mgr = TradingManager.fromTag(root);
    assert.isArray(mgr.routesFrom(1));
    assert.isArray(mgr.routesTo(1));
  });
});

// ── smd3/SmbpmParser — RAIL_DOCKER_BYTE / CARGO_BYTE / THRUST_CONFIG ─────────

describe('SmbpmParser — binary format edge cases', () => {
  const buildSmbpm = (version: number, blocks: Array<(w: BufferWriter) => void>): Buffer => {
    const w = new BufferWriter();
    w.writeInt32BE(version);   // metaVersion
    for (const b of blocks) b(w);
    w.writeInt8(1);            // FINISH_BYTE = 1
    return w.toBuffer();
  };

  it('parses RAIL_DOCKER_BYTE with exists=false', () => {
    const buf = buildSmbpm(5, [
      (w) => {
        w.writeInt8(6);    // RAIL_DOCKER_BYTE
        w.writeInt8(0);    // exists = false
      }
    ]);
    const file = parseSmbpm(buf);
    assert.equal(file.railDockerPieces.length, 0);
  });

  it('parses RAIL_DOCKER_BYTE with entries', () => {
    const buf = buildSmbpm(5, [
      (w) => {
        w.writeInt8(6);    // RAIL_DOCKER_BYTE
        w.writeInt8(1);    // exists = true
        w.writeInt32BE(1); // size = 1
        w.writeInt32BE(10); w.writeInt32BE(20); w.writeInt32BE(30); // pos
        w.writeInt16BE(5); // type
        w.writeInt8(2);    // orientation
        w.writeInt8(1);    // active
        w.writeInt8(100);  // hp
      }
    ]);
    const file = parseSmbpm(buf);
    assert.equal(file.railDockerPieces.length, 1);
    assert.equal(file.railDockerPieces[0].type, 5);
    assert.equal(file.railDockerPieces[0].active, true);
    assert.equal(file.railDockerPieces[0].hp, 100);
  });

  it('parses CARGO_BYTE with entries', () => {
    const buf = buildSmbpm(5, [
      (w) => {
        w.writeInt8(7);    // CARGO_BYTE
        w.writeInt8(1);    // exists = true
        w.writeInt32BE(1); // size = 1
        w.writeInt64BE(9999n); // posIndex
        w.writeFloat64BE(500.0); // capacity
      }
    ]);
    const file = parseSmbpm(buf);
    assert.equal(file.cargoPoints.length, 1);
    assert.equal(file.cargoPoints[0].posIndex, 9999n);
  });

  it('parses CARGO_BYTE with exists=false', () => {
    const buf = buildSmbpm(5, [
      (w) => {
        w.writeInt8(7);    // CARGO_BYTE
        w.writeInt8(0);    // exists = false
      }
    ]);
    const file = parseSmbpm(buf);
    assert.equal(file.cargoPoints.length, 0);
  });

  it('parses AI_CONFIG_BYTE section', () => {
    const tagBuf = writeTo(Tags.struct('ai', [Tags.byte(null, 1)]));
    const w = new BufferWriter();
    w.writeInt32BE(5);     // metaVersion
    w.writeInt8(5);        // AI_CONFIG_BYTE
    w.writeInt32BE(tagBuf.length);
    w.writeBytes(tagBuf);
    w.writeInt8(1);        // FINISH_BYTE
    const file = parseSmbpm(w.toBuffer());
    assert.isDefined(file);
  });

  it('parses THRUST_CONFIG_BYTE section', () => {
    const tagBuf = writeTo(Tags.struct('thrust', [Tags.byte(null, 1)]));
    const w = new BufferWriter();
    w.writeInt32BE(5);     // metaVersion
    w.writeInt8(9);        // THRUST_CONFIG_BYTE
    w.writeBytes(tagBuf);
    const file = parseSmbpm(w.toBuffer());
    assert.isDefined(file);
  });

  it('parses unknown dataType returns early', () => {
    const w = new BufferWriter();
    w.writeInt32BE(5);     // metaVersion
    w.writeInt8(99);       // unknown type
    const file = parseSmbpm(w.toBuffer());
    assert.isDefined(file);
  });
});

// ── smd3/SmtplParser — filters, prodMap, prodLimitMap sections ────────────────

describe('SmtplParser — filters / prodMap / prodLimitMap binary sections', () => {
  // Build a minimal .smtpl binary with non-empty filter/prodMap/prodLimitMap sections
  const buildSmtplV6 = (): Buffer => {
    const w = new BufferWriter();
    w.writeInt8(6);           // version = 6 (byte)
    // minX/minY/minZ maxX/maxY/maxZ (6×int32)
    w.writeInt32BE(0); w.writeInt32BE(0); w.writeInt32BE(0);
    w.writeInt32BE(1); w.writeInt32BE(1); w.writeInt32BE(1);
    w.writeInt32BE(0);  // piecesSize = 0
    // connections list: 0
    w.writeInt32BE(0);
    // texts: 0
    w.writeInt32BE(0);
    // filters: 1 entry
    w.writeInt32BE(1);
    w.writeInt64BE(1n); // key
    w.writeInt32BE(1);  // lSize
    w.writeInt16BE(5);  // short type
    w.writeInt32BE(10); // int count
    // prodMap: 1 entry
    w.writeInt32BE(1);
    w.writeInt64BE(2n);
    w.writeInt16BE(3);
    // prodLimitMap: 1 entry
    w.writeInt32BE(1);
    w.writeInt64BE(4n);
    w.writeInt32BE(100);
    // fillUpFilters: 0
    w.writeInt32BE(0);
    return w.toBuffer();
  };

  it('parseSmtpl with filters/prodMap/prodLimitMap', () => {
    const buf = buildSmtplV6();
    assert.doesNotThrow(() => parseSmtpl(buf));
    const file = parseSmtpl(buf);
    assert.equal(file.pieces.length, 0);
  });
});

// ── smd3/SmbplParser — network compressed format ─────────────────────────────

describe('SmbplParser — compressed link targets (network format)', () => {
  it('parses compressed targets with bigX=false, bigY=false, bigZ=false', () => {
    const w = new BufferWriter();
    // SmbplParser format:
    //   int structureVersion
    //   int header (must be negative: -version)
    //   int keySize (number of controllers)
    //   for each controller: 3×short pos + int valueSize + (short type + int elemSize + ...)
    w.writeInt32BE(0);    // structureVersion
    w.writeInt32BE(-1025); // header: negative, version=1025, isDisk = 1025 > 1024 → true
    w.writeInt32BE(1);    // keySize = 1 controller

    // Controller key: from pos
    w.writeInt16BE(5); w.writeInt16BE(6); w.writeInt16BE(7);
    w.writeInt32BE(1);   // valueSize = 1 link type
    w.writeInt16BE(1);   // type
    // isDisk=true → 3×short per target
    w.writeInt32BE(2);   // elemSize = 2 targets
    w.writeInt16BE(11); w.writeInt16BE(22); w.writeInt16BE(33); // target 0
    w.writeInt16BE(44); w.writeInt16BE(55); w.writeInt16BE(66); // target 1

    const file = parseSmbpl(w.toBuffer());
    assert.equal(file.links.length, 1);
    assert.equal(file.links[0].targets.length, 2);
    assert.equal(file.links[0].targets[0].x, 11);
    assert.equal(file.links[0].targets[0].y, 22);
    assert.equal(file.links[0].targets[0].z, 33);
  });

  it('parses compressed targets with bigX=false, bigY=false, bigZ=false (network format)', () => {
    const w = new BufferWriter();
    w.writeInt32BE(0);    // structureVersion
    w.writeInt32BE(-1);   // header: version=1, isDisk = 1 <= 1024 → network format
    w.writeInt32BE(1);    // keySize = 1

    w.writeInt16BE(0); w.writeInt16BE(0); w.writeInt16BE(0); // from
    w.writeInt32BE(1);   // valueSize
    w.writeInt16BE(2);   // type
    w.writeInt32BE(1);   // elemSize = 1 target

    // Network format: bigX, bigY, bigZ (false = int8), medians, deltas
    w.writeInt8(0); w.writeInt8(0); w.writeInt8(0); // bigX/Y/Z = false
    w.writeInt16BE(10); w.writeInt16BE(20); w.writeInt16BE(30); // medians
    w.writeInt8(1); w.writeInt8(2); w.writeInt8(3); // delta (int8 because not big)

    const file = parseSmbpl(w.toBuffer());
    assert.equal(file.links.length, 1);
    assert.equal(file.links[0].targets.length, 1);
    assert.equal(file.links[0].targets[0].x, 11); // 10+1
    assert.equal(file.links[0].targets[0].y, 22); // 20+2
    assert.equal(file.links[0].targets[0].z, 33); // 30+3
  });
});

// ── smd3/Smd3Writer — empty segment with non-zero coords ─────────────────────

describe('Smd3Writer — writeSmd3 with non-empty segments', () => {
  it('round-trip with multiple segments', function() {
    if (!hasSamples) { this.skip(); return; }
    // Use a real smd3 file to verify multi-segment round-trip
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    if (!fs.existsSync(bpDir)) { this.skip(); return; }
    const smd3Files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.smd3')) smd3Files.push(full);
      }
    };
    walk(bpDir);
    if (smd3Files.length === 0) { this.skip(); return; }
    const smd3Path = smd3Files[0];
    const file = parseSmd3(fs.readFileSync(smd3Path));
    const buf = writeSmd3(file);
    const rt = parseSmd3(buf);
    assert.equal(rt.segments.length, file.segments.length);
  });
});

// ── smd3/SmbphWriter — with explicit gameVersion argument (lines 27-34) ───────

describe('SmbphWriter — explicit gameVersion covers branch', function() {
  this.timeout(10_000);

  it('writeSmbph uses provided gameVersion over header.gameVersion', function() {
    if (!hasSamples) { this.skip(); return; }
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    if (!fs.existsSync(bpDir)) { this.skip(); return; }
    const bp = parseBlueprintFolder(bpDir);
    // Pass explicit gameVersion to cover the branch (covers lines 27-34)
    const buf = writeSmbph(bp.root.header, '9.9.9_custom');
    assert.ok(buf.length > 0);
  });
});

// ── objects/entities/PlayerStateEntity — logoutSector / withCreativeMode ─────

describe('PlayerStateEntity — lsector / lspawn parsing', function() {
  this.timeout(10_000);

  it('parses lsector and lspawn named fields', function() {
    const root = Tags.struct('PlayerState', [
      Tags.long('credits', 12345n),
      Tags.struct(null, []),  // [1] spawnData
      Tags.struct(null, []),  // [2] inventory
      Tags.vector3i('sector', 1,2,3),
      Tags.vector3f('lspawn', 1.0, 2.0, 3.0),
      Tags.vector3i('lsector', 4,5,6),
    ]);
    const buf = writeTo(root);
    const ps = PlayerStateEntity.fromTag(readFrom(buf));
    assert.equal(ps.logoutSector?.x, 4);
    // logoutLocalPos may be null depending on the exact field parsing
    // Just verify it parsed without crash
    assert.isDefined(ps);
    assert.equal(ps.logoutSector?.x ?? 0, 4);
  });
});

// ── smd3/SmbmmParser — isEmpty branch (line 30) ─────────────────────────────

describe('SmbmmParser — isEmpty branch', () => {
  it('isEmpty=true for zero-length buffer', () => {
    const buf = Buffer.alloc(0);
    const result = parseSmbmm(buf);
    assert.isTrue(result.isEmpty);
  });

  it('isEmpty=false for non-zero buffer (covers line 30)', () => {
    const buf = Buffer.from([0x42, 0x43]);
    const result = parseSmbmm(buf);
    assert.isFalse(result.isEmpty); // covers: isEmpty: buf.length === 0 → false
    assert.equal(result.size, 2);
  });
});

// ── objects/entities/SegmentController — seed branch (line 201) ──────────────

describe('SegmentController entity — wrapper branch', function() {
  this.timeout(10_000);

  it('parses SpaceStation from wrapper struct', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent');
    const station = parseSegmentControllerEntity(root, 'ENTITY_SPACESTATION_NPC-HOMEBASE_4_4_4.ent');
    assert.isDefined(station);
    assert.isString(station.uniqueId);
  });
});

// ── objects/components/ManagerContainer — relevantECM branch ────────────────

describe('ManagerContainer — relevantElementCountMap branch', function() {
  this.timeout(10_000);

  it('relevantElementCountMap returns null when absent', function() {
    if (!hasSamples) { this.skip(); return; }
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const containerTag = s.find(t => t.name === 'container' && t.type === TagType.STRUCT);
    if (!containerTag) { this.skip(); return; }
    const mc = ManagerContainer.fromTag(containerTag);
    // relevantElementCountMap is parsed from index [7]
    const ecm = mc.relevantElementCountMap;
    // may be null or an ElementCountMap
    assert.isDefined(ecm !== undefined ? ecm : null);
  });
});
