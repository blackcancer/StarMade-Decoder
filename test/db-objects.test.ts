/**
 * @fileoverview DB business objects — unit tests
 *
 * Tests for FleetCommandObject, FleetRemotesObject, SectorItemsObject,
 * TradePricesObject and StarSystem.
 *
 * @author InitSysRev
 */

import { assert } from 'chai';

import { FleetCommandObject }  from '../src/db/FleetCommandObject.js';
import { FleetRemotesObject }  from '../src/db/FleetRemotesObject.js';
import { SectorItemsObject }   from '../src/db/SectorItemsObject.js';
import { TradePricesObject }   from '../src/db/TradePricesObject.js';
import { StarSystem }          from '../src/db/StarSystemObject.js';
import { SYSTEM_INFOS_SIZE, SECTOR_TYPES } from '../src/db/SystemDb.js';

// ── FleetCommandObject ────────────────────────────────────────────────────────

describe('FleetCommandObject', function () {

  it('fromBytes returns null for null input', function () {
    assert.isNull(FleetCommandObject.fromBytes(null));
  });

  it('create + toBytes + fromBytes round-trips IDLE', function () {
    const obj = FleetCommandObject.create(42n, 'IDLE');
    const obj2 = FleetCommandObject.fromBytes(obj.toBytes());
    assert.isNotNull(obj2);
    assert.strictEqual(obj2!.fleetDbId, 42n);
    assert.strictEqual(obj2!.commandType, 'IDLE');
    assert.strictEqual(obj2!.args.length, 0);
  });

  it('create + toBytes + fromBytes round-trips MOVE_FLEET with vec3i', function () {
    const obj = FleetCommandObject.create(7n, 'MOVE_FLEET', [
      { kind: 'vec3i', x: 10, y: -5, z: 200 },
    ]);
    const obj2 = FleetCommandObject.fromBytes(obj.toBytes());
    assert.isNotNull(obj2);
    assert.strictEqual(obj2!.commandType, 'MOVE_FLEET');
    const v = obj2!.firstVec3iArg;
    assert.deepEqual(v, { x: 10, y: -5, z: 200 });
  });

  it('create + round-trips ACTIVATE_REMOTE with string + boolean', function () {
    const obj = FleetCommandObject.create(1n, 'ACTIVATE_REMOTE', [
      { kind: 'string', value: 'remote_café' },
      { kind: 'boolean', value: true },
    ]);
    const obj2 = FleetCommandObject.fromBytes(obj.toBytes());
    assert.strictEqual(obj2!.firstStringArg, 'remote_café');
  });

  it('toBytes pads to 1024 bytes', function () {
    const obj = FleetCommandObject.create(1n, 'IDLE');
    assert.strictEqual(obj.toBytes().length, 1024);
  });

  it('toBytes respects custom padTo', function () {
    const obj = FleetCommandObject.create(1n, 'IDLE');
    const buf = obj.toBytes(512);
    assert.strictEqual(buf.length, 512);
  });

  it('withFleetDbId is immutable', function () {
    const obj  = FleetCommandObject.create(1n, 'IDLE');
    const obj2 = obj.withFleetDbId(99n);
    assert.strictEqual(obj.fleetDbId, 1n);
    assert.strictEqual(obj2.fleetDbId, 99n);
  });

  it('withCommand is immutable', function () {
    const obj  = FleetCommandObject.create(1n, 'IDLE');
    const obj2 = obj.withCommand('SENTRY');
    assert.strictEqual(obj.commandType, 'IDLE');
    assert.strictEqual(obj2.commandType, 'SENTRY');
  });

  it('withArgs is immutable', function () {
    const obj  = FleetCommandObject.create(1n, 'IDLE');
    const obj2 = obj.withArgs([{ kind: 'string', value: 'x' }]);
    assert.strictEqual(obj.args.length, 0);
    assert.strictEqual(obj2.args.length, 1);
  });

  it('create throws on unknown type', function () {
    assert.throws(() => FleetCommandObject.create(1n, 'UNKNOWN_TYPE' as any), RangeError);
  });

  it('toString contains type and fleet id', function () {
    const s = FleetCommandObject.create(55n, 'ESCORT').toString();
    assert.include(s, 'ESCORT');
    assert.include(s, '55');
  });
});

// ── FleetRemotesObject ────────────────────────────────────────────────────────

describe('FleetRemotesObject', function () {

  it('empty() has no remotes', function () {
    assert.strictEqual(FleetRemotesObject.empty().size, 0);
  });

  it('fromBytes(null) returns empty', function () {
    assert.strictEqual(FleetRemotesObject.fromBytes(null).size, 0);
  });

  it('from() + toBytes() + fromBytes() round-trips', function () {
    const obj  = FleetRemotesObject.from({ alpha: true, beta: false });
    const obj2 = FleetRemotesObject.fromBytes(obj.toBytes());
    assert.isTrue(obj2.isActive('alpha'));
    assert.isFalse(obj2.isActive('beta'));
    assert.strictEqual(obj2.size, 2);
  });

  it('withRemote is immutable', function () {
    const obj  = FleetRemotesObject.empty();
    const obj2 = obj.withRemote('x', true);
    assert.strictEqual(obj.size, 0);
    assert.isTrue(obj2.isActive('x'));
  });

  it('withToggle flips active state', function () {
    const obj = FleetRemotesObject.from({ x: true });
    assert.isFalse(obj.withToggle('x').isActive('x'));
    assert.isTrue(obj.withToggle('x').withToggle('x').isActive('x'));
  });

  it('withToggle adds new remote as active', function () {
    const obj = FleetRemotesObject.empty().withToggle('new_remote');
    assert.isTrue(obj.isActive('new_remote'));
  });

  it('withoutRemote removes entry', function () {
    const obj = FleetRemotesObject.from({ a: true, b: false }).withoutRemote('a');
    assert.isFalse(obj.has('a'));
    assert.isTrue(obj.has('b'));
  });

  it('activeNames returns only active remotes', function () {
    const obj = FleetRemotesObject.from({ a: true, b: false, c: true });
    assert.sameMembers(obj.activeNames, ['a', 'c']);
  });

  it('toString reflects content', function () {
    const s = FleetRemotesObject.from({ door: true }).toString();
    assert.include(s, 'door');
    assert.include(s, 'true');
  });
});

// ── SectorItemsObject ─────────────────────────────────────────────────────────

describe('SectorItemsObject', function () {

  it('empty() has no items', function () {
    assert.isTrue(SectorItemsObject.empty().isEmpty);
  });

  it('fromBytes(null) returns empty', function () {
    assert.isTrue(SectorItemsObject.fromBytes(null).isEmpty);
  });

  it('from() + toBytes() + fromBytes() round-trips', function () {
    const obj = SectorItemsObject.from([
      { blockType: 259, count: 10, posX: 1, posY: 2, posZ: 3, metaId: -1 },
      { blockType: 1,   count:  5, posX: 0, posY: 0, posZ: 0, metaId:  0 },
    ]);
    const obj2 = SectorItemsObject.fromBytes(obj.toBytes());
    assert.strictEqual(obj2.size, 2);
    assert.strictEqual(obj2.totalCount(259), 10);
    assert.strictEqual(obj2.totalCount(1), 5);
  });

  it('byType returns correct items', function () {
    const obj = SectorItemsObject.from([
      { blockType: 100, count: 3, posX: 0, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 100, count: 7, posX: 1, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 200, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1 },
    ]);
    assert.strictEqual(obj.byType(100).length, 2);
    assert.strictEqual(obj.totalCount(100), 10);
  });

  it('withItem is immutable', function () {
    const obj  = SectorItemsObject.empty();
    const obj2 = obj.withItem({ blockType: 1, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1 });
    assert.strictEqual(obj.size, 0);
    assert.strictEqual(obj2.size, 1);
  });

  it('withoutType removes all stacks of that type', function () {
    const obj = SectorItemsObject.from([
      { blockType: 1, count: 5, posX: 0, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 2, count: 3, posX: 0, posY: 0, posZ: 0, metaId: -1 },
    ]).withoutType(1);
    assert.strictEqual(obj.size, 1);
    assert.strictEqual(obj.types[0], 2);
  });

  it('withMerged consolidates stacks', function () {
    const obj = SectorItemsObject.from([
      { blockType: 5, count: 10, posX: 1, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 5, count: 20, posX: 2, posY: 0, posZ: 0, metaId: -1 },
    ]).withMerged(5);
    assert.strictEqual(obj.size, 1);
    assert.strictEqual(obj.totalCount(5), 30);
    assert.strictEqual(obj.items[0].posX, 0);
  });

  it('cleared() empties collection', function () {
    const obj = SectorItemsObject.from([
      { blockType: 1, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1 },
    ]).cleared();
    assert.isTrue(obj.isEmpty);
  });

  it('types returns distinct block types', function () {
    const obj = SectorItemsObject.from([
      { blockType: 10, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 10, count: 2, posX: 0, posY: 0, posZ: 0, metaId: -1 },
      { blockType: 20, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1 },
    ]);
    assert.sameMembers(obj.types, [10, 20]);
  });
});

// ── TradePricesObject ─────────────────────────────────────────────────────────

describe('TradePricesObject', function () {

  it('empty() has no entries', function () {
    assert.isTrue(TradePricesObject.empty(1n).isEmpty);
  });

  it('fromBytes(null) returns null', function () {
    assert.isNull(TradePricesObject.fromBytes(null));
  });

  it('withBuyOrder + toBytes() + fromBytes() round-trips', function () {
    const obj = TradePricesObject.empty(42n)
      .withBuyOrder(259, 100, 500)
      .withSellOrder(259, 50, 1000, 200);
    const obj2 = TradePricesObject.fromBytes(obj.toBytes());
    assert.isNotNull(obj2);
    assert.strictEqual(obj2!.entDbId, 42n);
    assert.strictEqual(obj2!.buyOrders.length, 1);
    assert.strictEqual(obj2!.sellOrders.length, 1);
    assert.strictEqual(obj2!.getBuyOrder(259)!.amount, 100);
    assert.strictEqual(obj2!.getSellOrder(259)!.price, 1000);
    assert.strictEqual(obj2!.getSellOrder(259)!.limit, 200);
  });

  it('withBuyOrder stores type as negative', function () {
    const obj = TradePricesObject.empty(1n).withBuyOrder(259, 1, 1);
    assert.strictEqual(obj.entries[0].type, -259);
    assert.isTrue(obj.entries[0].isBuyOrder);
  });

  it('withSellOrder stores type as positive', function () {
    const obj = TradePricesObject.empty(1n).withSellOrder(259, 1, 1);
    assert.strictEqual(obj.entries[0].type, 259);
    assert.isFalse(obj.entries[0].isBuyOrder);
  });

  it('withBuyOrder replaces existing buy order', function () {
    const obj = TradePricesObject.empty(1n)
      .withBuyOrder(100, 10, 50)
      .withBuyOrder(100, 20, 60);
    assert.strictEqual(obj.buyOrders.length, 1);
    assert.strictEqual(obj.getBuyOrder(100)!.amount, 20);
  });

  it('withoutBlock removes both buy and sell', function () {
    const obj = TradePricesObject.empty(1n)
      .withBuyOrder(100, 1, 1)
      .withSellOrder(100, 1, 1)
      .withoutBlock(100);
    assert.isTrue(obj.isEmpty);
  });

  it('withoutBuyOrder keeps sell order', function () {
    const obj = TradePricesObject.empty(1n)
      .withBuyOrder(100, 1, 1)
      .withSellOrder(100, 1, 1)
      .withoutBuyOrder(100);
    assert.strictEqual(obj.size, 1);
    assert.isFalse(obj.entries[0].isBuyOrder);
  });

  it('withEntDbId is immutable', function () {
    const obj  = TradePricesObject.empty(1n);
    const obj2 = obj.withEntDbId(99n);
    assert.strictEqual(obj.entDbId, 1n);
    assert.strictEqual(obj2.entDbId, 99n);
  });

  it('blockTypes returns distinct types', function () {
    const obj = TradePricesObject.empty(1n)
      .withBuyOrder(100, 1, 1)
      .withSellOrder(200, 1, 1);
    assert.sameMembers(obj.blockTypes, [100, 200]);
  });

  it('cleared() empties collection', function () {
    const obj = TradePricesObject.empty(1n).withBuyOrder(1, 1, 1).cleared();
    assert.isTrue(obj.isEmpty);
  });

  it('toString reflects counts', function () {
    const s = TradePricesObject.empty(7n).withBuyOrder(1, 1, 1).toString();
    assert.include(s, 'buy=1');
    assert.include(s, 'sell=0');
    assert.include(s, '7');
  });
});

// ── StarSystem ────────────────────────────────────────────────────────────────

describe('StarSystem', function () {

  it('empty() has no sectors and zero resources', function () {
    const sys = StarSystem.empty();
    assert.strictEqual(sys.sectors.length, 0);
    assert.strictEqual(sys.presentResources.length, 0);
  });

  it('fromBytes with all-VOID infos + zero resources', function () {
    const VOID_ORDINAL = SECTOR_TYPES.indexOf('VOID');
    const infos = Buffer.alloc(SYSTEM_INFOS_SIZE, VOID_ORDINAL);
    const resources = Buffer.alloc(19, 0);
    const sys = StarSystem.fromBytes(infos, resources);
    assert.isNotNull(sys);
    assert.strictEqual(sys!.sectors.length, 0);
  });

  it('fromBytes returns null for undersized infos', function () {
    assert.isNull(StarSystem.fromBytes(Buffer.alloc(100), Buffer.alloc(19)));
  });

  it('withSectorType + getSector + infosToBytes round-trips', function () {
    const sys  = StarSystem.empty().withSectorType(8, 8, 8, 'SUN');
    const sys2 = StarSystem.fromBytes(sys.infosToBytes(), sys.resourcesToBytes());
    assert.isNotNull(sys2);
    const s = sys2!.getSector(8, 8, 8);
    assert.isDefined(s);
    assert.strictEqual(s!.sectorType, 'SUN');
  });

  it('withSectorType PLANET sets planetType from metadata', function () {
    const TERRAN = 2; // PLANET_TYPES[2]
    const sys = StarSystem.empty().withSectorType(3, 4, 5, 'PLANET', TERRAN);
    const p = sys.getSector(3, 4, 5);
    assert.strictEqual(p!.planetType, 'TERRAN');
  });

  it('withoutSector removes sector', function () {
    const sys = StarSystem.empty()
      .withSectorType(1, 1, 1, 'SUN')
      .withoutSector(1, 1, 1);
    assert.strictEqual(sys.sectors.length, 0);
  });

  it('withSectorType VOID removes sector (same as withoutSector)', function () {
    const sys = StarSystem.empty()
      .withSectorType(2, 2, 2, 'ASTEROID')
      .withSectorType(2, 2, 2, 'VOID');
    assert.isUndefined(sys.getSector(2, 2, 2));
  });

  it('planets / sunSectors accessors work', function () {
    const sys = StarSystem.empty()
      .withSectorType(8, 8, 8, 'SUN')
      .withSectorType(5, 5, 5, 'PLANET', 0)
      .withSectorType(6, 6, 6, 'PLANET', 1);
    assert.strictEqual(sys.sunSectors.length, 1);
    assert.strictEqual(sys.planets.length, 2);
  });

  it('withResourceDensity + resourcesToBytes round-trips', function () {
    const sys  = StarSystem.empty().withResourceDensity(0, 80);
    const sys2 = StarSystem.fromBytes(sys.infosToBytes(), sys.resourcesToBytes());
    assert.isNotNull(sys2);
    assert.strictEqual(sys2!.getResourceDensity(0), 80);
  });

  it('withResourceDensityById works by item ID', function () {
    // Hattel Crystal = ID 480, index 0
    const sys = StarSystem.empty().withResourceDensityById(480, 50);
    assert.strictEqual(sys.getResourceDensity(0), 50);
    assert.strictEqual(sys.getResourceDensityById(480), 50);
  });

  it('presentResources returns only non-zero', function () {
    const sys = StarSystem.empty()
      .withResourceDensity(0, 80)
      .withResourceDensity(16, 10);
    assert.strictEqual(sys.presentResources.length, 2);
    assert.isTrue(sys.presentResources.some(r => r.name === 'Hattel Crystal'));
    assert.isTrue(sys.presentResources.some(r => r.name === 'Quantanium'));
  });

  it('withResourceDensity clamps to 0–255', function () {
    const sys = StarSystem.empty()
      .withResourceDensity(0, 999)
      .withResourceDensity(1, -5);
    assert.strictEqual(sys.getResourceDensity(0), 255);
    assert.strictEqual(sys.getResourceDensity(1), 0);
  });

  it('withSectorType throws on unknown type', function () {
    assert.throws(() => StarSystem.empty().withSectorType(0, 0, 0, 'INVALID' as any), RangeError);
  });

  it('withResourceDensity throws on out-of-range index', function () {
    assert.throws(() => StarSystem.empty().withResourceDensity(99, 1), RangeError);
  });

  it('toString is informative', function () {
    const s = StarSystem.empty()
      .withSectorType(8, 8, 8, 'SUN')
      .withResourceDensity(0, 50)
      .toString();
    assert.include(s, 'sun=1');
    assert.include(s, 'Hattel Crystal');
  });
});
