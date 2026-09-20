/** @fileoverview Real versioned trade tuple, preservation, immutable updates and limits. */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { TradingManager, TradeRoute } from '../../src/objects/Trading.js';
import { ElementCountMap } from '../../src/objects/Serializables.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { RawElement } from '../../src/serializable/Factories.js';
import { readFrom, writeTo } from '../../src/core/TagParser.js';

const position = {x:1,y:2,z:3};
/** Complete explicit route, including zero and negative persisted counters. */
function route(): TradeRoute { return new TradeRoute(new ElementCountMap([{type:1,count:0},{type:2,count:-1},{type:3,count:4}]),
  2n**60n, 4n, 9n, 10n, 11n, -1n, 5.5, position, position, position, 1, 2, 'A', 'B', 'SA', 'SB', position, [position]); }

describe('Trading V2 contracts',()=>{
  it('preserves actual tuple fields, names, unknown slots, gzip/trailer and edit/revert',()=>{
    const tag=route().toTag(),p=tag.getStruct()[1].getStruct();p[1]=Tags.long('price',2n**60n);
    p.splice(p.length-1,0,Tags.string('unknown','kept'));tag.getStruct().splice(2,0,Tags.int('outer',7));
    const root=Tags.struct('TradeManager',[Tags.byte('version',0),Tags.struct('routes',[tag]),Tags.string('extra','future')]);
    const body=Buffer.concat([writeTo(root).subarray(2),Buffer.from([88,99])]),bytes=gzipSync(body);
    const model=TradingManager.fromBuffer(bytes);assert.deepEqual(model.toBuffer(),bytes);
    assert.deepEqual(model.routes[0].blocks.counts,route().blocks.counts);
    const changed=model.updateRoute(0,model.routes[0].with({blockPrice:999n}));
    const after=readFrom(changed.toBuffer()),record=after.getStruct()[1].getStruct()[0],payload=record.getStruct()[1].getStruct();
    assert.equal(payload[1].getLong(),999n);assert.equal(payload[1].name,'price');assert.equal(payload[19].getString(),'kept');
    assert.equal(record.getStruct()[2].getInt(),7);assert.equal(after.getStruct()[2].getString(),'future');
    assert.deepEqual(changed.updateRoute(0,changed.routes[0].with({blockPrice:2n**60n})).toBuffer(),bytes);
    const plain=writeTo(root);plain.writeInt16BE(7);assert.deepEqual(TradingManager.fromBuffer(plain).toBuffer(),plain);
    assert.equal(TradingManager.fromTag(changed.toTag()).routes[0].blockPrice,999n);
    const json=JSON.parse(JSON.stringify(model));assert.equal(json.routes[0].blockPrice,(2n**60n).toString());
    assert.include(model.toString(),'1 routes');assert.include(model.routes[0].toString(),'SA→SB');
  });
  it('isolates values and validates collection edits and explicit resource budgets',()=>{
    const a=route(),b=a.with({fromFactionId:2,toFactionId:1}),c=a.with({fromFactionId:3,toFactionId:4});
    const records=[a,b,c],manager=new TradingManager(0,records);records.length=0;
    assert.deepEqual(manager.routesBetween(1,2),[a,b]);assert.deepEqual(manager.routesFrom(1),[a]);assert.deepEqual(manager.routesTo(1),[b]);
    const exposed=manager.routes;exposed.length=0;assert.lengthOf(manager.routes,3);
    const blocks=a.blocks;blocks.counts[0].count=88;assert.equal(a.blocks.counts[0].count,0);
    const points=a.sectorWayPoints;points[0].x=99;assert.equal(a.sectorWayPoints[0].x,1);
    assert.throws(()=>{(a.startSector as any).x=999;});assert.equal(a.startSector.x,1);
    assert.equal(manager.removeRoute(1).routes.length,2);assert.equal(manager.addRoute(a).routes.length,4);
    assert.equal(manager.updateRoute(1,a).routes[1],a);
    assert.equal(TradingManager.fromBuffer(manager.toBuffer()).routes.length,3);
    for(const index of [-1,0.5,3,NaN]) {assert.throws(()=>manager.removeRoute(index));assert.throws(()=>manager.updateRoute(index,a));}
    for(const changes of [{volume:NaN},{blockPrice:2n**63n},{startSector:null},{fromFactionId:2**31},{startSystem:{x:0.5,y:0,z:0}},
      {blocks:{counts:[{type:1.5,count:1}]}},{blocks:{counts:[{type:1,count:1.5}]}}]) assert.throws(()=>a.with(changes as any));
    assert.throws(()=>new TradingManager(1,[]));assert.throws(()=>new TradingManager(0,[a],{maxNodes:3}));
    assert.throws(()=>TradingManager.fromBuffer(manager.toBuffer(),{maxInputBytes:1}));
    assert.throws(()=>TradingManager.fromTag(manager.toTag(),{maxDepth:1}));
    assert.throws(()=>TradeRoute.fromTag(a.toTag(),{maxNodes:2}));
  });
  it('rejects corrupt schemas and unsupported versions without dropping neighbors',()=>{
    assert.throws(()=>TradeRoute.fromTag(Tags.struct(null,[])));assert.throws(()=>TradingManager.fromTag(Tags.struct(null,[])));
    const source=route().toTag();source.getStruct()[0]=Tags.byte(null,99);assert.throws(()=>TradeRoute.fromTag(source));
    source.getStruct()[0]=Tags.byte(null,0);const payload=source.getStruct()[1].getStruct();
    payload[1]=Tags.int(null,10);assert.throws(()=>TradeRoute.fromTag(source));payload[1]=Tags.long(null,10n);
    payload[18]=Tags.struct(null,[Tags.string(null,'wrong')]);assert.throws(()=>TradeRoute.fromTag(source));payload[18]=Tags.struct(null,[]);
    payload[0]=new Tag(TagType.SERIALIZABLE,null,new RawElement(3,Buffer.from([0,0,0,0])));assert.throws(()=>TradeRoute.fromTag(source));
    const root=new TradingManager(0,[route()]).toTag();root.getStruct()[1].getStruct().splice(0,0,Tags.struct(null,[]));assert.throws(()=>TradingManager.fromTag(root));
    for(const bytes of [Buffer.alloc(0),Buffer.from([255,255,255,255]),Buffer.from([0,0,0,1])]) {
      payload[0]=new Tag(TagType.SERIALIZABLE,null,new RawElement(1,bytes));assert.throws(()=>TradeRoute.fromTag(source));
    }
  });
  it('retains waypoint names when coordinates change and restores their original bytes',()=>{
    const source=route().toTag(),payload=source.getStruct()[1].getStruct();
    payload[18]=Tags.struct('waypoints',[Tags.vector3i('first',1,2,3),Tags.vector3i('second',4,5,6)]);
    const value=TradeRoute.fromTag(source),changed=value.with({sectorWayPoints:[{x:1,y:2,z:3},{x:7,y:8,z:9}]});
    const points=changed.toTag().getStruct()[1].getStruct()[18];
    assert.equal(points.name,'waypoints'); assert.deepEqual(points.getStruct().slice(0,-1).map(t=>t.name),['first','second']);
    assert.deepEqual(writeTo(points.getStruct()[0]),writeTo(payload[18].getStruct()[0]));
    assert.deepEqual(writeTo(changed.with({sectorWayPoints:value.sectorWayPoints}).toTag()),writeTo(source));
    assert.equal(changed.with({sectorWayPoints:[...changed.sectorWayPoints,{x:10,y:11,z:12}]}).toTag().getStruct()[1].getStruct()[18].getStruct()[2].name,null);
  });
  it('accepts exact gzip payload budgets and rejects lossy number-to-bigint coercion',()=>{
    const plain=new TradingManager(0,[route()]).toBuffer(), body=plain.subarray(2), bytes=gzipSync(body);
    const options={maxInflatedBytes:body.length,sharedNodeBudget:{remainingNodes:1000},sharedInflationBudget:{remainingBytes:body.length}};
    const value=TradingManager.fromBuffer(bytes,options), remaining=options.sharedNodeBudget.remainingNodes;
    assert.deepEqual(value.toBuffer(),bytes);assert.equal(options.sharedInflationBudget.remainingBytes,0);
    const changed=value.updateRoute(0,value.routes[0].with({fromFactionId:9}));
    assert.equal(options.sharedNodeBudget.remainingNodes,remaining);
    assert.deepEqual(changed.updateRoute(0,changed.routes[0].with({fromFactionId:1})).toBuffer(),bytes);
    assert.throws(()=>TradingManager.fromBuffer(bytes,{maxInflatedBytes:body.length-1}));
    for (const key of ['blockPrice','deliveryPrice','startTime','fromId','toId','fleetId']) assert.throws(()=>route().with({[key]:123} as any));
  });

  it('carries explicit Tag collection limits into complete ElementCountMap projections',()=>{
    const counts=Array.from({length:100001},(_,index)=>({type:index%32768,count:index===100000?-1:0}));
    const blocks=new ElementCountMap(counts,{maxEntries:counts.length}),model=TradeRoute.create({...route(),blocks,sectorWayPoints:[]},{maxNodes:200000});
    assert.deepEqual(model.blocks.counts,counts);
    const parsed=TradeRoute.fromTag(model.toTag(),{maxNodes:200000});assert.deepEqual(parsed.blocks.counts,counts);
    assert.deepEqual(parsed.with({volume:9}).blocks.counts,counts);
    assert.throws(()=>TradeRoute.fromTag(model.toTag(),{maxNodes:100000}));
  });

  it('retains deep source extensions and isolated block/vector snapshots under custom limits',()=>{
    let deep=Tags.string('leaf','retained');for(let i=0;i<70;i++) deep=Tags.struct('deep',[deep]);
    const tag=route().toTag();tag.getStruct()[1].getStruct().splice(19,0,deep);tag.getStruct().splice(2,0,Tags.string('outer-extra','keep'));
    const source=Tags.struct('manager',[Tags.byte(null,0),Tags.struct('routes',[tag]),deep]), bytes=writeTo(source,{maxDepth:100});
    const options={maxDepth:100},value=TradingManager.fromBuffer(bytes,options);options.maxDepth=1;
    const changed=value.updateRoute(0,value.routes[0].with({blockPrice:-1n}));
    assert.deepEqual(writeTo(changed.toTag().getStruct()[2],{maxDepth:100}),writeTo(deep,{maxDepth:100}));
    assert.deepEqual(changed.updateRoute(0,changed.routes[0].with({blockPrice:2n**60n})).toBuffer(),bytes);
    source.getStruct().length=0;value.toBuffer().fill(0);value.toTag().getStruct().length=0;assert.deepEqual(value.toBuffer(),bytes);
    const raw=value.routes[0].toTag().getStruct()[1].getStruct()[0].value as RawElement;raw.raw.fill(0);assert.equal(value.routes[0].blocks.counts[2].count,4);
    const coordinate={x:7,y:8,z:9},points=[coordinate],model=route().with({startSystem:coordinate,sectorWayPoints:points});coordinate.x=99;points.length=0;
    assert.equal(model.startSystem.x,7);assert.equal(model.sectorWayPoints[0].x,7);
    assert.throws(()=>TradingManager.fromBuffer(bytes));
    const bounded=TradeRoute.fromTag(route().toTag(),{maxInflatedBytes:writeTo(route().toTag()).length+1});
    assert.throws(()=>bounded.with({fromStation:'s'.repeat(1000)}));
  });

});
