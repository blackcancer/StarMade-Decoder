/**
 * @fileoverview Coverage Mocking Tests
 *
 * Uses crafted binary payloads and filesystem mocking to cover the
 * remaining uncovered lines and branches that require specific inputs.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { assert } from 'chai';

import { registerAllFactories, RawElement } from '../src/serializable/Factories.js';
import { SerializableTagRegister }  from '../src/serializable/SerializableTagRegister.js';
import { readFrom, writeTo }        from '../src/core/TagParser.js';
import { Tags }                     from '../src/core/TagBuilder.js';
import { Tag, FINISH_TAG }          from '../src/core/Tag.js';
import { TagType }                  from '../src/core/TagType.js';
import { BufferWriter }             from '../src/core/BufferWriter.js';
import { BufferReader }             from '../src/core/BufferReader.js';
import { Matrix4f }                 from '../src/types/Matrices.js';

import { EntityTransform }          from '../src/objects/components/Transform.js';
import { PowerState, ThrustConfig } from '../src/objects/components/PowerAndThrust.js';
import { ManagerContainer }         from '../src/objects/components/ManagerContainer.js';
import { Inventory, ItemStack }     from '../src/objects/components/Inventory.js';

import { parseSmbpm }               from '../src/smd3/SmbpmParser.js';
import { parseSmbmm }               from '../src/smd3/SmbmmParser.js';
import { parseSmbpl }               from '../src/smd3/SmbplParser.js';
import { parseSmtpl }               from '../src/smd3/SmtplParser.js';
import { parseSmd3 }                from '../src/smd3/Smd3Parser.js';
import { writeSmbph }               from '../src/smd3/SmbphWriter.js';
import { parseBlueprintFolder }     from '../src/smd3/BlueprintFolderParser.js';

registerAllFactories();

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const hasSamples = fs.existsSync(S);

// ── core/TagParser — GZIP detection path ─────────────────────────────────────

describe('TagParser — GZIP decompression path', () => {
  it('readFrom decompresses and parses a GZIP-compressed Tag', () => {
    // GZIP format: no leading short version — just the raw _readTag() payload
    // Build the raw tag bytes (prType + name + payload) without the version short
    const w = new BufferWriter();
    // prType = 13 (named STRUCT): positive → named, abs = type ordinal 13
    w.writeInt8(13); // prType = positive STRUCT ordinal
    // name = "Hello" (Java UTF)
    w.writeJavaUTF('Hello');
    // STRUCT payload: children until FINISH
    // Child INT named "x" = 42
    w.writeInt8(3);  // prType = 3 (INT named)
    w.writeJavaUTF('x');
    w.writeInt32BE(42);
    // FINISH
    w.writeInt8(0);
    const rawTag = w.toBuffer();
    const compressed = gzipSync(rawTag);

    const root = readFrom(compressed);
    assert.equal(root.type, TagType.STRUCT);
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    assert.equal(s[0].getInt(), 42);
  });
});

// ── core/TagParser — negative type ordinal / out-of-range ordinal ─────────────

describe('TagParser — unknown type ordinal throws', () => {
  it('throws when type ordinal is out of range (line 74-75)', () => {
    // Build a raw binary with a named tag whose type byte = 99 (invalid)
    const w = new BufferWriter();
    w.writeInt16BE(1);   // version = 1
    w.writeInt8(99);     // prType = 99: positive → named, ordinal = 99 (too high)
    // writeJavaUTF for name "x"
    w.writeUInt16BE(1);
    w.writeBytes(Buffer.from('x', 'utf8'));
    // No payload — reader will try to handle type 99 and fail

    assert.throws(() => readFrom(w.toBuffer()), /Unknown tag type ordinal/);
  });
});

// ── core/TagParser — FINISH tag payload (line 100) ───────────────────────────

describe('TagParser — FINISH tag payload branch', () => {
  it('FINISH sentinel tag returns null value without payload', () => {
    // Build a STRUCT containing a FINISH as the first and only child
    const tag = Tags.struct('S', []);
    const buf = writeTo(tag);
    const rt = readFrom(buf);
    assert.equal(rt.type, TagType.STRUCT);
    // The FINISH_TAG is implicitly in the struct; this exercises line 100
    const children = rt.getStruct();
    assert.isTrue(children.some(t => t.type === TagType.FINISH));
  });
});

// ── core/TagParser — writePayload NOTHING (line 244) ─────────────────────────

describe('TagParser — writePayload NOTHING tag', () => {
  it('writeTo handles NOTHING tag (zero-byte payload)', () => {
    const root = Tags.struct('S', [Tags.nothing('noop')]);
    const buf = writeTo(root);
    const rt = readFrom(buf);
    const s = rt.getStruct().filter(t => t.type !== TagType.FINISH);
    assert.equal(s[0].type, TagType.NOTHING);
    assert.isNull(s[0].value);
  });
});

// ── serializable/Factories — ControlElementMapper header >= 0 throws ─────────

describe('Factories — ControlElementMapper header >= 0 throws', () => {
  it('factory 0 throws when header is positive', () => {
    const w = new BufferWriter();
    w.writeInt32BE(1);   // header = 1 (positive) → throws
    const factory = SerializableTagRegister.register[0];
    const r = BufferReader.from(w.toBuffer());
    assert.throws(() => factory.create(r), /unexpected positive header/);
  });
});

// ── serializable/Factories — ControlElementMapper network format bigX/Y/Z ────

describe('Factories — ControlElementMapper network format bigX/Y/Z=true', () => {
  it('factory 0 network format with bigX=bigY=bigZ=true (int16 deltas)', () => {
    // isDisk = false (version <= 1024) → network format with bigX/Y/Z
    const w = new BufferWriter();
    w.writeInt32BE(-1);   // header: version=1, isDisk = 1 <= 1024 → network
    w.writeInt32BE(1);    // keySize = 1 controller
    // Key: 3×short pos
    w.writeInt16BE(0); w.writeInt16BE(0); w.writeInt16BE(0);
    w.writeInt32BE(1);    // valueSize = 1
    w.writeInt16BE(5);    // type
    w.writeInt32BE(1);    // elemSize = 1 target
    // Network format: bigX=true, bigY=true, bigZ=true → int16 deltas
    w.writeInt8(1); w.writeInt8(1); w.writeInt8(1); // bigX/Y/Z = true
    w.writeInt16BE(10); w.writeInt16BE(20); w.writeInt16BE(30); // medians
    // 1 target: int16 because big
    w.writeInt16BE(100); w.writeInt16BE(200); w.writeInt16BE(300);

    const factory = SerializableTagRegister.register[0];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
  });
});

// ── serializable/Factories — NPCFactionNewsEvent ALLIES / LOST_STATION ────────

describe('Factories — NPCFactionNewsEvent with extra-data subtypes', () => {
  it('factory 2 parses ALLIES (type=3) event with readUTF', () => {
    // NPCFactionNewsEvent format: byte type + long time + int factionId + extra
    // ALLIES(3): extra = readUTF(otherEnt)
    const w = new BufferWriter();
    w.writeUInt8(3);     // eventType = 3 (ALLIES)
    w.writeInt64BE(1000n); // time
    w.writeInt32BE(42);  // factionId
    w.writeJavaUTF('ENTITY_SHIP_Test'); // otherEnt string (readUTF)
    const factory = SerializableTagRegister.register[2];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
    assert.equal((elem as RawElement).factoryId, 2);
  });

  it('factory 2 parses GROWN (type=0) event with Vector3i', () => {
    // GROWN(0): extra = 3×int32 (EventSystem/Vector3i)
    const w = new BufferWriter();
    w.writeUInt8(0);      // eventType = 0 (GROWN)
    w.writeInt64BE(500n); // time
    w.writeInt32BE(1);    // factionId
    w.writeInt32BE(5); w.writeInt32BE(6); w.writeInt32BE(7); // Vector3i
    const factory = SerializableTagRegister.register[2];
    const r = BufferReader.from(w.toBuffer());
    const elem = factory.create(r);
    assert.instanceOf(elem, RawElement);
  });
});

// ── objects/components/Transform — EntityTransform.fromMatrix4fTag ────────────

describe('EntityTransform.fromMatrix4fTag — TAG_MATRIX4f path', () => {
  it('fromMatrix4fTag reads translation from m30/m31/m32 of a TAG_MATRIX4f', () => {
    // Build a Matrix4f where m30=5, m31=6, m32=7 (translation)
    const m = new Matrix4f(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1);
    const tag = Tags.matrix4f('tf', m);
    const et = EntityTransform.fromMatrix4fTag(tag);
    assert.closeTo(et.originX, 5, 0.01);
    assert.closeTo(et.originY, 6, 0.01);
    assert.closeTo(et.originZ, 7, 0.01);
    assert.closeTo(et.m00, 1, 0.01); // rotation identity
  });

  it('fromMatrix4fTag throws on wrong tag type', () => {
    assert.throws(() => EntityTransform.fromMatrix4fTag(Tags.int('x', 1)), TypeError);
  });
});

// ── objects/components/ManagerContainer — inventories / shields / powerState2 ─

describe('ManagerContainer — inventories / initialShields branch', () => {
  it('fromTag with inventory entries (inventories struct)', () => {
    // Build a container tag with an inventory entry
    const invItem = Tags.struct(null, [
      Tags.int(null, 0),       // e[0] = type INT → type=0
      Tags.nothing(null),      // e[1] padding
      Inventory.EMPTY.set(new ItemStack(0, 1, 5)).toTag(), // e[2] = Inventory STRUCT
    ]);
    const invListTag = Tags.struct(null, [invItem]);

    const container = buildContainerTag(invListTag, null, null, null);
    const mc = ManagerContainer.fromTag(container);
    assert.isDefined(mc);
    const inv = mc.mainInventory;
    assert.instanceOf(inv, Inventory);
  });

  it('fromTag with initialShields from DOUBLE tag at index 3', () => {
    const container = buildContainerTag(null, null, Tags.double(null, 5000.0), null);
    const mc = ManagerContainer.fromTag(container);
    assert.closeTo(mc.initialShields, 5000, 1);
  });

  it('fromTag with powerState from index 2 (legacy) when index 15 absent', () => {
    const powerTag = new PowerState(1234, 567).toTag();
    // Put power at index 2 (legacy slot), no index 15
    const mc = ManagerContainer.fromTag(buildContainerTag(null, powerTag, null, null));
    assert.closeTo(mc.powerState.initialPower, 1234, 1);
  });
});

/**
 * Builds a minimal ManagerContainer STRUCT with configurable fields.
 * Indices follow the ManagerContainer spec:
 *   [0] inventories STRUCT
 *   [1] shipMan0 INT
 *   [2] powerTag STRUCT (legacy)
 *   [3] shieldTag DOUBLE
 *   [4-14] optional STRUCTs (opaque)
 *   [15] powerReactorTag STRUCT (new)
 *   [16] pullPermission BYTE
 */
function buildContainerTag(
  inventories: Tag | null,
  powerLegacy: Tag | null,
  shieldDouble: Tag | null,
  powerReactor: Tag | null,
): Tag {
  const NOTHING = Tags.nothing(null);
  const parts: Tag[] = [
    inventories ?? Tags.struct(null, []),     // [0] inventories
    Tags.int(null, 0),                         // [1] shipMan0
    powerLegacy ?? NOTHING,                   // [2] powerTag legacy
    shieldDouble ?? NOTHING,                  // [3] shieldTag
    Tags.struct(null, []),                     // [4] extraTag
    Tags.struct(null, []),                     // [5] actStateTag
    Tags.struct(null, []),                     // [6] texts
    Tags.struct(null, []),                     // [7] relevantECM
    Tags.struct(null, []),                     // [8] warpGateInfo
    Tags.struct(null, []),                     // [9] moduleTag
    Tags.struct(null, []),                     // [10] aiTag
    Tags.struct(null, []),                     // [11] slotAssignment
    Tags.struct(null, []),                     // [12] raceGateInfo
    Tags.struct(null, []),                     // [13] unloadedDummies
    Tags.struct(null, []),                     // [14] moduleExplosions
    powerReactor ?? NOTHING,                  // [15] powerReactorTag
    Tags.byte(null, 0),                        // [16] pullPermission
  ];
  return Tags.struct('container', parts);
}

// ── objects/components/PowerAndThrust — ThrustConfig version 0/1 VECTOR4f ───

describe('ThrustConfig — version 0/1 VECTOR4f path', () => {
  it('fromTag version 0 with VECTOR4f balance (lines 121-123)', () => {
    // When version <= 1 and s[3] is VECTOR4f:
    //   s[0]=version, s[1]=autoDamp, s[2]=autoReact, s[3]=VECTOR4f(bx,by,bz,rotBal)
    //   s[4] is used for nothing (skipped — rotBal already from v4.w)
    //   s[5]=autoDampExit, s[6]=thrustShare, s[7]=repulsor
    const tag = Tags.struct(null, [
      Tags.byte(null, 0),                              // [0] version = 0
      Tags.byte(null, 1),                              // [1] automaticDampeners = true
      Tags.byte(null, 0),                              // [2] autoReactivateDampeners = false
      Tags.vector4f(null, 0.3, 0.4, 0.5, 0.7),       // [3] VECTOR4f → covers version<=1 branch
      Tags.nothing(null),                              // [4] unused / rotBal already from v4.w
      Tags.byte(null, 0),                              // [5] automaticDampenersOnExit
      Tags.byte(null, 1),                              // [6] thrustSharing = true
      Tags.float(null, 0.2),                           // [7] repulsorBalance
    ]);
    const tc = ThrustConfig.fromTag(tag);
    assert.equal(tc.version, 0);
    assert.closeTo(tc.thrustBalanceX, 0.3, 0.01);
    assert.closeTo(tc.rotationBalance, 0.7, 0.01); // VECTOR4f.w
    assert.isTrue(tc.thrustSharing); // s[6].getByte() !== 0
  });

  it('ThrustConfig.withThrustSharing (lines 157-161)', () => {
    const tc = ThrustConfig.DEFAULT;
    const updated = tc.withThrustSharing(true);
    assert.isTrue(updated.thrustSharing);
    assert.equal(updated.version, tc.version);
  });

  it('PowerState.withPower (line 76)', () => {
    const ps = new PowerState(100, 50);
    const updated = ps.withPower(9999);
    assert.equal(updated.initialPower, 9999);
    assert.equal(updated.initialBatteryPower, 50);
  });
});

// ── smd3/SmbplParser — buf.length < 4 early return (line 49) ─────────────────

describe('SmbplParser — early return paths', () => {
  it('returns empty result when buf.length < 4 (line 49)', () => {
    const buf = Buffer.from([0x00, 0x01]); // only 2 bytes
    const file = parseSmbpl(buf);
    assert.equal(file.links.length, 0);
    assert.equal(file.controllerCount, 0);
  });

  it('returns empty result when exactly 4 bytes (isEOF after version, line 54)', () => {
    const w = new BufferWriter();
    w.writeInt32BE(0); // structureVersion only
    const file = parseSmbpl(w.toBuffer());
    assert.equal(file.structureVersion, 0);
    assert.equal(file.links.length, 0);
  });

  it('returns early result when header >= 0 (line 60-62 old format)', () => {
    const w = new BufferWriter();
    w.writeInt32BE(0); // structureVersion
    w.writeInt32BE(5); // header = 5 (positive) → old format, return early
    const file = parseSmbpl(w.toBuffer());
    assert.equal(file.links.length, 0); // returned early without throwing
  });
});

// ── smd3/SmtplParser — version < 4 path (very old format, lines 123-136) ─────

describe('SmtplParser — version < 4 (very old format)', () => {
  it('parses version 3 smtpl (3-byte pieces, no filters/prod)', () => {
    const w = new BufferWriter();
    w.writeInt8(3);  // version = 3 → falls into the else branch
    // min/max (6×int32)
    w.writeInt32BE(0); w.writeInt32BE(0); w.writeInt32BE(0);
    w.writeInt32BE(2); w.writeInt32BE(2); w.writeInt32BE(2);
    // piecesSize = 1
    w.writeInt32BE(1);
    // piece: x/y/z (3×int32) + b0/b1/b2 (3×int8)
    w.writeInt32BE(1); w.writeInt32BE(1); w.writeInt32BE(1);
    w.writeInt8(0x01); // b0: type bits
    w.writeInt8(0x00); // b1
    w.writeInt8(0x00); // b2
    // connections: 0
    w.writeInt32BE(0);
    // texts: 0
    w.writeInt32BE(0);

    const file = parseSmtpl(w.toBuffer());
    assert.equal(file.version, 3);
    assert.equal(file.pieces.length, 1);
  });

  it('parses version 2 smtpl (very old, no connections)', () => {
    const w = new BufferWriter();
    w.writeInt8(2); // version = 2 → else branch, r.isEOF() check
    // min/max
    w.writeInt32BE(0); w.writeInt32BE(0); w.writeInt32BE(0);
    w.writeInt32BE(1); w.writeInt32BE(1); w.writeInt32BE(1);
    // piecesSize = 0
    w.writeInt32BE(0);
    // EOF immediately → _readConnections and _readTexts not called (isEOF = true)

    const file = parseSmtpl(w.toBuffer());
    assert.equal(file.version, 2);
    assert.equal(file.pieces.length, 0);
    assert.equal(file.connections.length, 0);
  });
});

// ── smd3/SmbpmParser — DOCKING_BYTE with entries / RAIL_BYTE wireless markers ─

describe('SmbpmParser — DOCKING_BYTE entries / RAIL_BYTE wireless markers', () => {
  it('parses DOCKING_BYTE (type=3) with 1 entry (lines 131-137)', () => {
    const w = new BufferWriter();
    w.writeInt32BE(5);   // metaVersion = 5
    w.writeInt8(3);      // DOCKING_BYTE
    w.writeInt32BE(1);   // size = 1
    w.writeJavaUTF('dock1');
    w.writeInt32BE(10); w.writeInt32BE(20); w.writeInt32BE(30); // pos
    w.writeFloat32BE(5.0); w.writeFloat32BE(6.0); w.writeFloat32BE(7.0); // size
    w.writeInt16BE(1);   // style
    w.writeInt8(2);      // orientation
    w.writeInt8(1);      // FINISH_BYTE

    const file = parseSmbpm(w.toBuffer());
    assert.equal(file.dockingEntries.length, 1);
    assert.equal(file.dockingEntries[0].name, 'dock1');
    assert.equal(file.dockingEntries[0].posX, 10);
  });

  it('parses RAIL_BYTE (type=4) with wireless markers (lines 150-153)', () => {
    const tagBuf = writeTo(Tags.struct('child', []));
    const w = new BufferWriter();
    w.writeInt32BE(2);   // metaVersion >= 2 → reads railUID and wireless markers
    w.writeInt8(4);      // RAIL_BYTE

    // railRootMin + railRootMax (6 floats)
    for (let i = 0; i < 6; i++) w.writeFloat32BE(0);

    // metaVersion >= 2: railUID + wirelessSize + markers
    w.writeJavaUTF('rail-uid-001');
    w.writeInt32BE(1);   // wirelessSize = 1 wireless marker
    // _skipWirelessMarker: 3×int32 + long + long + int8
    w.writeInt32BE(1); w.writeInt32BE(2); w.writeInt32BE(3); // pos
    w.writeInt64BE(100n); // fromPos
    w.writeInt64BE(200n); // toPos
    w.writeInt8(0);       // side

    // railChildren: 1 child
    w.writeInt32BE(1);
    w.writeJavaUTF('ATTACHED_0');
    w.writeInt32BE(tagBuf.length);
    w.writeBytes(tagBuf);

    w.writeInt8(1); // FINISH_BYTE

    const file = parseSmbpm(w.toBuffer());
    assert.equal(file.railUID, 'rail-uid-001');
    assert.equal(file.railChildren.length, 1);
    assert.equal(file.railChildren[0].name, 'ATTACHED_0');
  });

  it('parses RAIL_BYTE with metaVersion < 2 (skips wireless section, railUID empty)', () => {
    const w = new BufferWriter();
    w.writeInt32BE(1);   // metaVersion = 1 — old format, no railUID/wireless
    w.writeInt8(4);      // RAIL_BYTE = 4

    // 6 floats: railRootMin (x,y,z) + railRootMax (x,y,z)
    for (let i = 0; i < 6; i++) w.writeFloat32BE(i * 1.0);

    // metaVersion < 2: no railUID, no wireless markers
    // Directly: int railChildren size
    w.writeInt32BE(0);   // 0 rail children
    w.writeInt8(1);      // FINISH_BYTE

    const file = parseSmbpm(w.toBuffer());
    assert.equal(file.railChildren.length, 0);
    // railUID stays '' (default, not written in metaVersion < 2)
    assert.isUndefined(file.railUID); // not set when metaVersion < 2
  });
});

// ── smd3/SmbphWriter — gameVersion branch: provided vs header.gameVersion ─────

describe('SmbphWriter — gameVersion branch coverage', function() {
  this.timeout(10_000);

  it('writeSmbph uses header.gameVersion when no explicit arg', function() {
    if (!hasSamples) { this.skip(); return; }
    const bpDir = path.join(S, 'BASE_Warehouse_Station');
    if (!fs.existsSync(bpDir)) { this.skip(); return; }
    const bp = parseBlueprintFolder(bpDir);
    // No explicit gameVersion → uses header.gameVersion ?? default (covers line 27 left branch)
    const buf1 = writeSmbph(bp.root.header);
    assert.ok(buf1.length > 0);
    // Explicit gameVersion → covers right branch of ??(null coalescing)
    const buf2 = writeSmbph(bp.root.header, '0.0.0_test');
    assert.ok(buf2.length > 0);
  });

  it('writeSmbph with header.gameVersion = undefined uses default', () => {
    const header = {
      headerVersion: 5,
      entityType: 'SHIP',
      gameVersion: undefined as any,
      boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      blockCountByType: [{ type: 1, count: 5 }],
      totalBlockCount: 5,
      classification: 0,
    };
    // No header.gameVersion, no explicit arg → uses the default parameter
    const buf = writeSmbph(header as any);
    assert.ok(buf.length > 0);
  });
});

// ── smd3/BlueprintFolderParser — _emptyHeader path (no header.smbph) ──────────

describe('BlueprintFolderParser — _emptyHeader fallback (lines 59-60, 92-100)', () => {
  it('parseBlueprintFolder works when header.smbph is missing (falls back to _emptyHeader)', () => {
    // Create a minimal blueprint folder structure without a header.smbph
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bptest-'));
    try {
      // Create root folder with no header.smbph
      const rootDir = path.join(tmp, 'ROOT');
      fs.mkdirSync(rootDir);
      // No header.smbph → _emptyHeader() is called (lines 58-60, 92-100)

      const result = parseBlueprintFolder(rootDir);
      assert.isDefined(result);
      assert.equal(result.root.header.entityType, 'UNKNOWN'); // _emptyHeader returns UNKNOWN
      assert.equal(result.root.header.totalBlockCount, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('_emptyHeader structure has correct defaults', () => {
    // Indirectly verify by parsing a folder without a header
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bptest-'));
    try {
      fs.mkdirSync(path.join(tmp, 'MyBP'));
      const result = parseBlueprintFolder(path.join(tmp, 'MyBP'));
      assert.equal(result.root.header.headerVersion, -1);
      assert.deepEqual(result.root.header.boundingBox, { minX:0, minY:0, minZ:0, maxX:0, maxY:0, maxZ:0 });
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

// ── smd3/SmbmmParser — branch: isEmpty: buf.length === 0 ─────────────────────

describe('SmbmmParser — isEmpty ternary branch', () => {
  it('parseSmbmm returns isEmpty=true for 0-byte buffer', () => {
    const result = parseSmbmm(Buffer.alloc(0));
    assert.isTrue(result.isEmpty);
    assert.equal(result.size, 0);
  });

  it('parseSmbmm returns isEmpty=false for non-empty buffer', () => {
    const result = parseSmbmm(Buffer.from([0xFF]));
    assert.isFalse(result.isEmpty);
    assert.equal(result.size, 1);
  });
});
