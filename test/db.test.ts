/**
 * @fileoverview DB decoders — unit tests
 *
 * Tests for FleetDb, SectorItems, TradeNodeItems and SystemDb decoders/encoders.
 *
 * All tests are self-contained (no real DB required).
 *
 * @author InitSysRev
 */

import { assert } from 'chai';
import { BufferWriter } from '../src/core/BufferWriter.js';

import {
  decodeFleetCommand, encodeFleetCommand,
  decodeFleetRemotes, encodeFleetRemotes,
  FLEET_COMMAND_TYPES, CMD_TYPES,
  type CommandArg,
} from '../src/db/FleetDb.js';

import {
  decodeSectorItems, encodeSectorItems,
  FREE_ITEM_BYTE_SIZE,
  type FreeItem,
} from '../src/db/SectorItems.js';

import {
  decodeTradeNodeItems, encodeTradeNodeItems,
  type TradePrices,
} from '../src/db/TradeNodeItems.js';

import {
  decodeSystemInfos, encodeSystemInfos,
  decodeSystemResources, encodeSystemResources,
  systemCoordsToIndex, systemIndexToCoords,
  SYSTEM_SIZE, SYSTEM_INFOS_SIZE, SECTOR_DATA_SIZE,
  SECTOR_TYPES, PLANET_TYPES, RESOURCE_COUNT,
} from '../src/db/SystemDb.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFleetCommandBuffer(
  fleetDbId: bigint,
  commandOrdinal: number,
  args: CommandArg[],
  padTo = 1024,
): Buffer {
  const w = new BufferWriter();
  w.writeInt64BE(fleetDbId);
  w.writeInt32BE(commandOrdinal);
  // write args manually
  w.writeUInt8(args.length);
  for (const arg of args) {
    if (arg.kind === 'string') {
      w.writeUInt8(CMD_TYPES.STRING);
      w.writeJavaModifiedUTF(arg.value);
    } else if (arg.kind === 'vec3i') {
      w.writeUInt8(CMD_TYPES.VECTOR3i);
      w.writeInt32BE(arg.x); w.writeInt32BE(arg.y); w.writeInt32BE(arg.z);
    } else if (arg.kind === 'boolean') {
      w.writeUInt8(CMD_TYPES.BOOLEAN);
      w.writeUInt8(arg.value ? 1 : 0);
    }
  }
  const buf = w.toBuffer();
  if (buf.length >= padTo) return buf;
  const padded = Buffer.alloc(padTo, 0);
  buf.copy(padded);
  return padded;
}

// ── FleetCommand ──────────────────────────────────────────────────────────────

describe('decodeFleetCommand', function () {

  it('returns null for null input', function () {
    assert.isNull(decodeFleetCommand(null));
  });

  it('returns null for empty buffer', function () {
    assert.isNull(decodeFleetCommand(Buffer.alloc(0)));
  });

  it('decodes IDLE (no args)', function () {
    const buf = buildFleetCommandBuffer(42n, 0, []);
    const cmd = decodeFleetCommand(buf);
    assert.isNotNull(cmd);
    assert.strictEqual(cmd!.fleetDbId, 42n);
    assert.strictEqual(cmd!.commandOrdinal, 0);
    assert.strictEqual(cmd!.commandType, 'IDLE');
    assert.deepEqual(cmd!.args, []);
  });

  it('decodes MOVE_FLEET with Vector3i arg', function () {
    const args: CommandArg[] = [{ kind: 'vec3i', x: 10, y: -5, z: 200 }];
    const buf = buildFleetCommandBuffer(99n, 1, args);
    const cmd = decodeFleetCommand(buf);
    assert.isNotNull(cmd);
    assert.strictEqual(cmd!.commandType, 'MOVE_FLEET');
    assert.strictEqual(cmd!.args.length, 1);
    const a = cmd!.args[0];
    assert.strictEqual(a.kind, 'vec3i');
    if (a.kind === 'vec3i') {
      assert.strictEqual(a.x, 10);
      assert.strictEqual(a.y, -5);
      assert.strictEqual(a.z, 200);
    }
  });

  it('decodes ACTIVATE_REMOTE with string + boolean args', function () {
    const args: CommandArg[] = [
      { kind: 'string',  value: 'my_remote_éàü' },
      { kind: 'boolean', value: true },
    ];
    const buf = buildFleetCommandBuffer(7n, 19, args);
    const cmd = decodeFleetCommand(buf);
    assert.isNotNull(cmd);
    assert.strictEqual(cmd!.commandType, 'ACTIVATE_REMOTE');
    assert.strictEqual(cmd!.args.length, 2);
    const [s, b] = cmd!.args;
    assert.strictEqual(s.kind, 'string');
    if (s.kind === 'string') assert.strictEqual(s.value, 'my_remote_éàü');
    assert.strictEqual(b.kind, 'boolean');
    if (b.kind === 'boolean') assert.isTrue(b.value);
  });

  it('unknown ordinal yields undefined commandType', function () {
    const buf = buildFleetCommandBuffer(1n, 99, []);
    const cmd = decodeFleetCommand(buf);
    assert.isNotNull(cmd);
    assert.isUndefined(cmd!.commandType);
  });

  it('round-trips PATROL_FLEET (ordinal 2)', function () {
    const args: CommandArg[] = [{ kind: 'vec3i', x: 1, y: 2, z: 3 }];
    const buf = buildFleetCommandBuffer(55n, 2, args);
    const cmd = decodeFleetCommand(buf);
    assert.isNotNull(cmd);
    const re = encodeFleetCommand(cmd!);
    const cmd2 = decodeFleetCommand(re);
    assert.strictEqual(cmd2!.commandType, 'PATROL_FLEET');
    assert.strictEqual(cmd2!.fleetDbId, 55n);
    const a = cmd2!.args[0];
    if (a.kind === 'vec3i') assert.deepEqual([a.x, a.y, a.z], [1, 2, 3]);
  });

  it('encodeFleetCommand pads output to 1024 bytes by default', function () {
    const cmd = decodeFleetCommand(buildFleetCommandBuffer(1n, 0, []))!;
    const out = encodeFleetCommand(cmd);
    assert.strictEqual(out.length, 1024);
  });
});

// ── FleetRemotes ──────────────────────────────────────────────────────────────

describe('decodeFleetRemotes / encodeFleetRemotes', function () {

  it('returns empty map for null input', function () {
    assert.strictEqual(decodeFleetRemotes(null).remotes.size, 0);
  });

  it('returns empty map for empty buffer', function () {
    assert.strictEqual(decodeFleetRemotes(Buffer.alloc(0)).remotes.size, 0);
  });

  it('decodes network format with no remotes (hasRemotes=0)', function () {
    const buf = Buffer.from([0x00]);
    assert.strictEqual(decodeFleetRemotes(buf).remotes.size, 0);
  });

  it('round-trips network format with remotes', function () {
    const original = new Map<string, boolean>([
      ['remote_alpha', true],
      ['remote_beta',  false],
      ['café',         true],
    ]);
    const encoded = encodeFleetRemotes(original);
    const decoded = decodeFleetRemotes(encoded);
    assert.strictEqual(decoded.remotes.size, 3);
    assert.isTrue(decoded.remotes.get('remote_alpha'));
    assert.isFalse(decoded.remotes.get('remote_beta'));
    assert.isTrue(decoded.remotes.get('café'));
  });

  it('encodes empty map as single 0x00 byte', function () {
    const buf = encodeFleetRemotes(new Map());
    assert.strictEqual(buf.length, 1);
    assert.strictEqual(buf[0], 0x00);
  });
});

// ── SectorItems ───────────────────────────────────────────────────────────────

describe('decodeSectorItems / encodeSectorItems', function () {

  it('returns empty array for null input', function () {
    assert.deepEqual(decodeSectorItems(null), []);
  });

  it('returns empty array for empty buffer', function () {
    assert.deepEqual(decodeSectorItems(Buffer.alloc(0)), []);
  });

  it('decodes a single FreeItem correctly', function () {
    const w = new BufferWriter(FREE_ITEM_BYTE_SIZE);
    w.writeInt16BE(259);   // blockType
    w.writeInt32BE(100);   // count
    w.writeFloat32BE(1.5); // posX
    w.writeFloat32BE(2.5); // posY
    w.writeFloat32BE(3.5); // posZ
    w.writeInt32BE(-1);    // metaId
    const items = decodeSectorItems(w.toBuffer());
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].blockType, 259);
    assert.strictEqual(items[0].count, 100);
    assert.approximately(items[0].posX, 1.5, 0.001);
    assert.strictEqual(items[0].metaId, -1);
  });

  it('skips zero-blockType/zero-count padding entries', function () {
    const w = new BufferWriter(FREE_ITEM_BYTE_SIZE * 3);
    // valid item
    w.writeInt16BE(100); w.writeInt32BE(5);
    w.writeFloat32BE(0); w.writeFloat32BE(0); w.writeFloat32BE(0);
    w.writeInt32BE(0);
    // padding entry (type=0, count=0)
    w.writeInt16BE(0);  w.writeInt32BE(0);
    w.writeFloat32BE(0); w.writeFloat32BE(0); w.writeFloat32BE(0);
    w.writeInt32BE(0);
    // valid item
    w.writeInt16BE(200); w.writeInt32BE(3);
    w.writeFloat32BE(1); w.writeFloat32BE(2); w.writeFloat32BE(3);
    w.writeInt32BE(1);
    const items = decodeSectorItems(w.toBuffer());
    assert.strictEqual(items.length, 2);
  });

  it('round-trips multiple items', function () {
    const original: FreeItem[] = [
      { blockType: 259, count: 10, posX: 0.5, posY: 1.0, posZ: -1.5, metaId: -1 },
      { blockType: 1,   count: 1,  posX: 8.0, posY: 8.0, posZ:  8.0, metaId:  0 },
    ];
    const decoded = decodeSectorItems(encodeSectorItems(original));
    assert.strictEqual(decoded.length, 2);
    assert.strictEqual(decoded[0].blockType, 259);
    assert.strictEqual(decoded[0].count, 10);
    assert.approximately(decoded[0].posX, 0.5, 0.001);
    assert.approximately(decoded[0].posZ, -1.5, 0.001);
    assert.strictEqual(decoded[1].blockType, 1);
  });
});

// ── TradeNodeItems ────────────────────────────────────────────────────────────

describe('decodeTradeNodeItems / encodeTradeNodeItems', function () {

  it('returns null for null input', function () {
    assert.isNull(decodeTradeNodeItems(null));
  });

  it('returns null for undersized input', function () {
    assert.isNull(decodeTradeNodeItems(Buffer.alloc(4)));
  });

  it('round-trips empty price list', function () {
    const original: TradePrices = { entDbId: 12345n, entries: [] };
    const encoded = encodeTradeNodeItems(original);
    const decoded = decodeTradeNodeItems(encoded);
    assert.isNotNull(decoded);
    assert.strictEqual(decoded!.entDbId, 12345n);
    assert.deepEqual(decoded!.entries, []);
  });

  it('round-trips buy and sell orders', function () {
    const original: TradePrices = {
      entDbId: 999n,
      entries: [
        { type: -259, isBuyOrder: true,  blockType: 259, amount: 100, price: 500,  limit: -1 },
        { type:  259, isBuyOrder: false, blockType: 259, amount:  50, price: 1000, limit: 200 },
        { type: -1,   isBuyOrder: true,  blockType: 1,   amount:   1, price:    1, limit: -1 },
      ],
    };
    const decoded = decodeTradeNodeItems(encodeTradeNodeItems(original));
    assert.isNotNull(decoded);
    assert.strictEqual(decoded!.entDbId, 999n);
    assert.strictEqual(decoded!.entries.length, 3);
    assert.isTrue(decoded!.entries[0].isBuyOrder);
    assert.strictEqual(decoded!.entries[0].blockType, 259);
    assert.strictEqual(decoded!.entries[0].price, 500);
    assert.isFalse(decoded!.entries[1].isBuyOrder);
    assert.strictEqual(decoded!.entries[1].limit, 200);
  });
});

// ── SystemDb ──────────────────────────────────────────────────────────────────

describe('decodeSystemInfos / encodeSystemInfos', function () {

  it('returns empty array for null input', function () {
    assert.deepEqual(decodeSystemInfos(null), []);
  });

  it('returns empty array for undersized buffer', function () {
    assert.deepEqual(decodeSystemInfos(Buffer.alloc(100)), []);
  });

  it('all-VOID buffer returns empty array (default)', function () {
    const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07); // 7 = VOID ordinal
    assert.deepEqual(decodeSystemInfos(buf), []);
  });

  it('all-VOID buffer returns all 4096 entries with includeVoid=true', function () {
    const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07);
    const entries = decodeSystemInfos(buf, { includeVoid: true });
    assert.strictEqual(entries.length, SYSTEM_SIZE ** 3);
  });

  it('decodes a single SUN sector at (0,0,0)', function () {
    const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07); // all VOID
    buf[0] = 5; // SUN ordinal
    buf[1] = 0; // metadata
    const entries = decodeSystemInfos(buf);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].sectorType, 'SUN');
    assert.strictEqual(entries[0].x, 0);
    assert.strictEqual(entries[0].y, 0);
    assert.strictEqual(entries[0].z, 0);
  });

  it('decodes PLANET with PlanetType metadata', function () {
    const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07);
    const idx = systemCoordsToIndex(3, 4, 5);
    buf[idx * SECTOR_DATA_SIZE]     = 2; // PLANET ordinal
    buf[idx * SECTOR_DATA_SIZE + 1] = 2; // TERRAN ordinal
    const entries = decodeSystemInfos(buf);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].sectorType, 'PLANET');
    assert.strictEqual(entries[0].planetType, 'TERRAN');
    assert.strictEqual(entries[0].x, 3);
    assert.strictEqual(entries[0].y, 4);
    assert.strictEqual(entries[0].z, 5);
  });

  it('round-trips system with mixed sector types', function () {
    const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07); // all VOID
    buf[0] = 5; // SUN at (0,0,0)
    const idx = systemCoordsToIndex(8, 8, 8);
    buf[idx * SECTOR_DATA_SIZE]     = 2; // PLANET at (8,8,8)
    buf[idx * SECTOR_DATA_SIZE + 1] = 0; // ICE

    const entries = decodeSystemInfos(buf);
    // encodeSystemInfos only writes the non-VOID entries; re-build on all-VOID base
    const re = Buffer.alloc(SYSTEM_INFOS_SIZE, 0x07);
    const written = encodeSystemInfos(entries);
    // encodeSystemInfos writes ALL entries including VOID when given includeVoid
    // The simpler test: decode → encode → decode gives same non-void entries
    const entries2 = decodeSystemInfos(written);

    assert.strictEqual(entries2.length, entries.length);
    assert.isTrue(entries2.some(e => e.sectorType === 'SUN' && e.x === 0 && e.y === 0 && e.z === 0));
    assert.isTrue(entries2.some(e => e.sectorType === 'PLANET' && e.x === 8 && e.planetType === 'ICE'));
  });

  it('systemCoordsToIndex / systemIndexToCoords are inverses', function () {
    for (const [x, y, z] of [[0, 0, 0], [15, 15, 15], [3, 7, 12], [0, 15, 0]]) {
      const idx = systemCoordsToIndex(x, y, z);
      const back = systemIndexToCoords(idx);
      assert.deepEqual(back, { x, y, z }, `round-trip failed for (${x},${y},${z})`);
    }
  });
});

describe('decodeSystemResources / encodeSystemResources', function () {

  it('returns empty for null input', function () {
    assert.deepEqual(decodeSystemResources(null), []);
  });

  it('returns empty for all-zero buffer (default no absent)', function () {
    assert.deepEqual(decodeSystemResources(Buffer.alloc(RESOURCE_COUNT, 0)), []);
  });

  it('returns all 19 entries with includeAbsent=true', function () {
    const res = decodeSystemResources(Buffer.alloc(RESOURCE_COUNT, 0), { includeAbsent: true });
    assert.strictEqual(res.length, RESOURCE_COUNT);
  });

  it('decodes non-zero resources correctly', function () {
    const buf = Buffer.alloc(RESOURCE_COUNT, 0);
    buf[0]  = 80; // Hattel Crystal
    buf[16] = 10; // Quantanium
    const res = decodeSystemResources(buf);
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].name, 'Hattel Crystal');
    assert.strictEqual(res[0].density, 80);
    assert.strictEqual(res[1].name, 'Quantanium');
    assert.strictEqual(res[1].density, 10);
  });

  it('round-trips resource densities', function () {
    const buf = Buffer.alloc(RESOURCE_COUNT, 0);
    buf[2] = 50; buf[15] = 100; buf[18] = 5;
    const res = decodeSystemResources(buf, { includeAbsent: true });
    const re  = encodeSystemResources(res);
    assert.ok(re.equals(buf), 'encoded buffer should match original');
  });
});
