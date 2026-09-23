import { assert } from 'chai';
import { inflateSync } from 'node:zlib';
import { FleetCommandObject } from '../../src/db/FleetCommandObject.js';
import { StarSystem } from '../../src/db/StarSystemObject.js';
import { TradePricesObject } from '../../src/db/TradePricesObject.js';
import { decodeTradeNodeItems, encodeTradeNodeItems } from '../../src/db/TradeNodeItems.js';
import { decodeSystemInfos, decodeSystemResources, encodeSystemResources } from '../../src/db/SystemDb.js';
import { getDatabaseProfile } from '../../src/db/DatabaseProfile.js';

/** Independently recorded wire metadata from Open e5a3b49d8, without game sources. */
describe('Open e5a3b49d8 database compatibility', () => {
  it('rejects an unknown profile instead of guessing its ordinal contract', () => {
    assert.throws(()=>getDatabaseProfile('unknown' as any),RangeError);
  });
  const commands = ['IDLE','MOVE_FLEET','PATROL_FLEET','TRADE_FLEET_NPC','TRADE_FLEET_ACTIVE','TRADE_FLEET_WAITING','FLEET_ATTACK','FLEET_DEFEND','ESCORT','REPAIR','STANDOFF','RECON_FLEET','SENTRY_FORMATION','SENTRY','FLEET_IDLE_FORMATION','CALL_TO_CARRIER','MINE_IN_SECTOR','CLOAK','UNCLOAK','JAM','UNJAM','ACTIVATE_REMOTE','INTERDICT','STOP_INTERDICT'];
  for (const [ordinal, name] of commands.entries()) it(`reads and writes independent command ordinal ${ordinal}: ${name}`, () => {
    const bytes=Buffer.alloc(1024); bytes.writeBigInt64BE(42n); bytes.writeInt32BE(ordinal,8);
    assert.equal(FleetCommandObject.fromBytes(bytes)!.commandType,name);
    assert.deepEqual(FleetCommandObject.create(42n,name as any).toBytes(),bytes);
  });
  it('uses the current sector and planet names and writes VOID as 6', () => {
    const names=['SPACE_STATION','ASTEROID','PLANET','MAIN','SUN','BLACK_HOLE','VOID','LOW_ASTEROID','GIANT','DOUBLE_STAR'];
    const infos=Buffer.alloc(8192); for(let i=0;i<4096;i++) infos[i*2]=6;
    for(const [ordinal,name] of names.entries()) {
      infos[0]=ordinal;
      assert.equal(decodeSystemInfos(infos,{includeVoid:true})[0].sectorType,name);
      assert.equal(StarSystem.empty().withSectorType(0,0,0,name as any).infosToBytes()[0],ordinal);
    }
    infos[0]=2;
    for(const [ordinal,name] of ['MARS','EARTH','DESERT','PURPLE','ICE'].entries()) {
      infos[1]=ordinal;
      assert.equal(decodeSystemInfos(infos)[0].planetType,name);
    }
    assert.equal(StarSystem.empty().infosToBytes()[0],6);
  });
  it('accepts the independent JDK zlib frame and writes a standard zlib payload', () => {
    const bytes=Buffer.from('0000001a00000019789c636000032d2066646406924c40c697ff400000124e0523','hex');
    const expected={entDbId:42n,entries:[{type:259,isBuyOrder:false,blockType:259,amount:2,price:500,limit:-1}]};
    assert.deepEqual(decodeTradeNodeItems(bytes),expected);
    const output=encodeTradeNodeItems(expected);
    assert.equal(output.readInt32BE(),26);
    assert.equal(output.readInt32BE(4),output.length-8);
    assert.deepEqual(inflateSync(output.subarray(8)),Buffer.from('000000000000002a00000001010300000002000001f4ffffffff','hex'));
  });
  it('accepts native 16-byte resources and preserves absence through unrelated edits', () => {
    assert.lengthOf(StarSystem.empty().resourcesToBytes(),16);
    assert.lengthOf(StarSystem.empty('legacy-sdk').resourcesToBytes(),19);
    const extended=StarSystem.empty().withResourceDensity(18,42);
    assert.throws(()=>extended.resourcesToBytes(),/16-byte/);
    assert.equal(extended.resourcesToBytes(19)[18],42);
    assert.throws(()=>encodeSystemResources([],17 as any),/16 or 19/);
    const bytes=Buffer.alloc(16); bytes[6]=42;
    assert.deepEqual(decodeSystemResources(bytes),[{index:6,itemId:486,name:'Parsen Crystal',density:42}]);
    const infos=StarSystem.empty().infosToBytes();
    for(const raw of [null,undefined,Buffer.alloc(0)]) {
      const system=StarSystem.fromBytes(infos,raw)!;
      assert.deepEqual(system.resources,[]);
      assert.deepEqual(system.withSectorType(0,0,0,'SUN').resources,[]);
      assert.equal(system.withResourceDensity(0,7).getResourceDensity(0),7);
    }
  });
  it('preserves explicit legacy command, grid and compression profiles through mutations', () => {
    const fleet=FleetCommandObject.create(42n,'FLEET_ATTACK',[],'legacy-sdk');
    assert.equal(fleet.toBytes().readInt32BE(8),5);
    assert.equal(FleetCommandObject.fromBytes(fleet.toBytes(),'legacy-sdk')!.commandType,'FLEET_ATTACK');
    assert.equal(fleet.withArgs([]).withFleetDbId(43n).withCommand('ACTIVATE_REMOTE').toBytes().readInt32BE(8),19);
    const system=StarSystem.empty('legacy-sdk').withSectorType(1,0,0,'GAS_PLANET',2);
    assert.equal(system.infosToBytes()[0],7);
    assert.equal(system.getSector(1,0,0)!.planetType,'TERRAN');
    const restored=StarSystem.fromBytes(system.infosToBytes(),system.resourcesToBytes(),{profile:'legacy-sdk'})!;
    assert.equal(restored.withResourceDensity(0,8).getSector(1,0,0)!.sectorType,'GAS_PLANET');
    assert.equal(restored.withoutSector(1,0,0).infosToBytes()[2],7);
    const legacy=TradePricesObject.empty(42n,'legacy-sdk').withSellOrder(259,2,500);
    assert.deepEqual(decodeTradeNodeItems(legacy.toBytes(),'legacy-sdk')!.entries,[...legacy.entries]);
    assert.throws(()=>decodeTradeNodeItems(legacy.toBytes()));
    assert.equal(TradePricesObject.fromBytes(legacy.toBytes(),'legacy-sdk')!.withEntDbId(43n).toBytes().subarray(8).readUInt16BE(),legacy.withEntDbId(43n).toBytes().subarray(8).readUInt16BE());
  });
});
