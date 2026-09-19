/**
 * @fileoverview Database wire shapes, immutable collections and boundary cases.
 * Synthetic values are checked independently of the installed game database.
 * Java stream fragments characterize the existing diagnostic fallback only;
 * they are not an ObjectOutputStream interoperability certification.
 */
import { assert } from 'chai';
import { BufferWriter } from '../src/core/BufferWriter.js';
import * as Fleet from '../src/db/FleetDb.js';
import { FleetCommandObject } from '../src/db/FleetCommandObject.js';
import { FleetRemotesObject } from '../src/db/FleetRemotesObject.js';
import { SectorItemsObject } from '../src/db/SectorItemsObject.js';
import { decodeSectorItems, MAX_ITEMS_PER_SECTOR } from '../src/db/SectorItems.js';
import { TradePricesObject } from '../src/db/TradePricesObject.js';
import { decodeTradeNodeItems } from '../src/db/TradeNodeItems.js';
import { StarSystem } from '../src/db/StarSystemObject.js';
import * as System from '../src/db/SystemDb.js';
import { parseWorldSeed, writeWorldSeed } from '../src/db/WorldSeed.js';
import { parsePersistentObjects, writePersistentObjects } from '../src/db/PersistentObjects.js';
import { RawSerializableTagElement } from '../src/serializable/RawSerializableTagElement.js';

const item = { blockType: 5, count: 3, posX: 1, posY: 2, posZ: 3, metaId: -1 };

describe('Database contracts — complete command arguments', () => {
  it('preserves all argument types, recursion, flags and supplementary strings', () => {
    const args: Fleet.CommandArg[] = [
      { kind: 'int', value: -2147483648 }, { kind: 'long', value: 9223372036854775807n },
      { kind: 'float', value: 0.5 }, { kind: 'string', value: '\u0000\ud83d\ude80' },
      { kind: 'boolean', value: true }, { kind: 'boolean', value: false },
      { kind: 'byte', value: -128 }, { kind: 'short', value: -32768 },
      { kind: 'bytes', value: new Uint8Array([0, 255, 128]) },
      { kind: 'struct', value: [{ kind: 'struct', value: [] }, { kind: 'int', value: 3 }] },
      { kind: 'vec3i', x: -1, y: 2, z: 3 }, { kind: 'vec3f', x: 0.5, y: 1.5, z: 2.5 },
      { kind: 'vec4f', x: 0.5, y: 1.5, z: 2.5, w: 3.5 },
    ];
    const command = { fleetDbId: -7n, commandOrdinal: 19, commandType: 'ACTIVATE_REMOTE' as const, args };
    const wire = Fleet.encodeFleetCommand(command, 0);
    assert.isBelow(wire.length, 1024);
    assert.deepEqual(Fleet.decodeFleetCommand(new Uint8Array(wire)), command);
    assert.equal(Fleet.encodeFleetCommand(command, 1024).length, 1024);
    assert.throws(() => Fleet.encodeFleetCommand({ ...command, args: Array(256).fill(args[0]) }), RangeError);
  });

  it('rejects underflow, unknown types and negative byte-array lengths', () => {
    for (const suffix of [Buffer.from([1, 99]), Buffer.from([1, 8, 255, 255, 255, 255]), Buffer.from([1, 2, 0])]) {
      assert.isNull(Fleet.decodeFleetCommand(Buffer.concat([Buffer.alloc(12), suffix])));
    }
    assert.isNull(Fleet.decodeFleetCommand(new Uint8Array([0])));
    const ordinary = FleetCommandObject.create(4n, 'IDLE');
    assert.throws(() => ordinary.withCommand('UNKNOWN' as any), RangeError);
    assert.include(ordinary.toString(), 'type=IDLE');
    const v = ordinary.withArgs([{ kind: 'vec3i', x: 1, y: 2, z: 3 }]);
    assert.include(v.toString(), 'arg=(1,2,3)');
    assert.include(v.withArgs([{ kind: 'string', value: 'target' }]).toString(), 'arg=target');
    assert.notInclude(v.withArgs([{ kind: 'string', value: '' }]).toString(), 'arg=');
    const unknown = FleetCommandObject.fromBytes(Fleet.encodeFleetCommand({ fleetDbId: 1n, commandOrdinal: 999, commandType: undefined, args: [] }, 0))!;
    assert.include(unknown.toString(), '#999');
  });

  it('distinguishes malformed remote bytes, missing values and both network states', () => {
    for (const b of [Buffer.from([1]), Buffer.from([0xac, 0])]) {
      const decoded = Fleet.decodeFleetRemotes(new Uint8Array(b));
      assert.equal(decoded.remotes.size, 0); assert.deepEqual(decoded.raw, b);
      assert.deepEqual(FleetRemotesObject.fromBytes(b).raw, b);
    }
    const empty = FleetRemotesObject.empty();
    assert.isFalse(empty.isActive('missing')); assert.equal(empty.toString(), 'FleetRemotes(empty)');
    const states = new Map([['on', true], ['off', false]]);
    assert.deepEqual(Fleet.decodeFleetRemotes(new Uint8Array(Fleet.encodeFleetRemotes(states))).remotes, states);
  });

  it('bounds diagnostic Java-stream scanning around incomplete tokens and descriptors', () => {
    const string = (s: string): Buffer => {
      const w = new BufferWriter(); w.writeUInt8(0x74); w.writeJavaUTF(s); return w.toBuffer();
    };
    const magic = Buffer.from([0xac, 0xed, 0, 5]);
    const boolean = (v: number): Buffer => Buffer.concat([Buffer.from([0x73]), Buffer.from('java.lang.Booleanvalue'), Buffer.from([v])]);
    const diagnostic = Buffer.concat([magic, string('alpha'), string('beta'), string('class.name'), string('path/name'), string('value'), boolean(1), boolean(0)]);
    assert.deepEqual(Fleet.decodeFleetRemotes(diagnostic).remotes, new Map([['alpha', true], ['beta', false]]));
    for (const fragment of [
      Buffer.from([0x74, 255, 255, 0]), Buffer.from([0x73]),
      Buffer.concat([Buffer.from([0x73]), Buffer.alloc(35), Buffer.from('java.lang.Boolean')]),
      Buffer.concat([Buffer.from([0x73]), Buffer.from('java.lang.Boolean')]),
      Buffer.concat([Buffer.from([0x73]), Buffer.from('java.lang.Boolean'), Buffer.alloc(65), Buffer.from('value')]),
      boolean(2),
    ]) assert.equal(Fleet.decodeFleetRemotes(Buffer.concat([magic, fragment])).remotes.size, 0);
  });
});

describe('Database contracts — collections and alternate byte arrays', () => {
  it('guards sector capacity, reports counts and leaves absent merges unchanged', () => {
    const empty = SectorItemsObject.empty();
    assert.equal(empty.toString(), 'SectorItems(empty)');
    assert.strictEqual(empty.withMerged(5), empty);
    const full = SectorItemsObject.from(Array.from({ length: MAX_ITEMS_PER_SECTOR }, () => ({ ...item })));
    assert.throws(() => full.withItem(item), RangeError);
    const model = SectorItemsObject.from([item, { ...item, count: 2 }]);
    assert.include(model.toString(), 'type5×5');
    assert.deepEqual(decodeSectorItems(new Uint8Array(model.toBytes())), model.items);
  });

  it('updates one sell order without removing buy orders or other blocks', () => {
    const original = TradePricesObject.empty(3n).withBuyOrder(5, 1, 2).withSellOrder(5, 3, 4).withSellOrder(6, 5, 6);
    const changed = original.withSellOrder(5, 7, 8);
    assert.equal(changed.getSellOrder(5)!.amount, 7);
    assert.equal(original.getSellOrder(5)!.amount, 3);
    assert.isUndefined(changed.withoutSellOrder(5).getSellOrder(5));
    assert.isDefined(changed.withoutSellOrder(5).getBuyOrder(5));
    assert.isDefined(changed.withoutSellOrder(5).getSellOrder(6));
    assert.deepEqual(decodeTradeNodeItems(new Uint8Array(changed.toBytes()))!.entries, changed.entries);
  });

  it('handles unknown sector types and missing resources explicitly', () => {
    const empty = StarSystem.empty();
    assert.include(empty.toString(), 'none');
    assert.equal(empty.getResourceDensity(-1), 0);
    assert.equal(empty.getResourceDensityById(-1), 0);
    assert.throws(() => empty.withResourceDensityById(-1, 1), RangeError);
    const planet = empty.withSectorType(0, 0, 0, 'PLANET', -1);
    assert.equal(planet.getSectorByIndex(0)!.planetType, 'UNKNOWN');
    assert.isUndefined(planet.getSectorByIndex(1));
    const bytes = empty.infosToBytes(); bytes[0] = 255; bytes[2] = 2; bytes[3] = 255;
    const entries = System.decodeSystemInfos(new Uint8Array(bytes));
    assert.equal(entries[0].sectorType, 'UNKNOWN');
    assert.equal(entries[1].planetType, 'BARREN');
    assert.equal(System.decodeSystemResources(new Uint8Array(System.RESOURCE_COUNT), { includeAbsent: true }).length, System.RESOURCE_COUNT);
  });

  it('round-trips signed world seeds and persistent object delimiters', () => {
    for (const value of [-1n, 7, { seed: 9223372036854775807n }]) {
      const wire = writeWorldSeed(value);
      assert.equal(parseWorldSeed(new Uint8Array(wire)).seed, typeof value === 'object' ? value.seed : BigInt(value));
    }
    assert.equal(writePersistentObjects({ entries: [] }).length, 0);
    for (const malformed of ['ClassName', 'ClassName\n{}']) assert.throws(() => parsePersistentObjects(malformed), /Unterminated/);
    const file = { entries: [{ className: 'Test', objects: [{ a: 1 }] }] };
    assert.deepEqual(parsePersistentObjects(writePersistentObjects(file)), file);
  });

  it('writes raw serializable elements without changing their factory identity', () => {
    const raw = new RawSerializableTagElement(7, new Uint8Array([1, 2, 3]));
    const w = new BufferWriter(); raw.writeToTag(w);
    assert.equal(raw.getFactoryId(), 7);
    assert.equal(raw.toString(), 'RawSerializable(factoryId=7, 3 bytes)');
    assert.deepEqual(w.toBuffer(), Buffer.from([1, 2, 3]));
  });
});
