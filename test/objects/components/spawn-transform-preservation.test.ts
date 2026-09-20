/** @fileoverview Independent wire tuples exercise complete component preservation, validation and immutable edits. */
import { assert } from 'chai';
import { Tag } from '../../../src/core/Tag.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { TagType } from '../../../src/core/TagType.js';
import { writeTo } from '../../../src/core/TagParser.js';
import { Matrix4f } from '../../../src/types/Matrices.js';
import { SectorPosition, EntityTransform } from '../../../src/objects/components/Transform.js';
import { SpawnPoint, PlayerSpawnData, SpawnMarker, SpawnController } from '../../../src/objects/components/SpawnData.js';
import { replace } from '../../helpers/simulation.js';

const same = (a: Tag, b: Tag) => assert.deepEqual(writeTo(a),writeTo(b));
const tail = () => Tags.byteArray('opaque',Buffer.from([0,255,17]));
const point = () => Tags.struct('spawn-point',[
  Tags.string('uid','ship-a'),Tags.vector3i('sector',1,2,3),Tags.vector3f('local',4,5,6),Tags.vector3f('gravity',7,8,9),
  Tags.vector3f('backup',10,11,12),tail(),
]);
const spawner = () => Tags.struct('spawner',[
  Tags.struct('conditions',[Tags.struct('condition',[Tags.int('kind',0),Tags.struct('payload',[Tags.string('future','keep')]),tail()])]),
  Tags.struct('components',[Tags.struct('component',[Tags.int('kind',1),Tags.string('payload','opaque-component')])]),Tags.byte('alive',7),tail(),
]);
const marker = () => Tags.struct('marker',[spawner(),Tags.long('last',123n),Tags.vector3i('position',2,3,4),tail()]);
const controller = () => Tags.struct('controller',[Tags.struct('marker-list',[marker()]),tail()]);

// Fixtures mirror the persisted field order in PlayerStateSpawnData, SpawnMarker and DefaultSpawner.
// They exercise serialization only: no game execution or spawn-policy interpretation is claimed.
describe('Spawn and transform preservation', () => {
  it('keeps sector names, int32 boundaries and immutable copies through edits and reverts', () => {
    const source = Tags.vector3i('saved-sector',-2147483648,2147483647,0), value = SectorPosition.fromTag(source);
    source.getVector3i().x = 1; assert.equal(value.x,-2147483648);
    value.toTag().getVector3i().x = 2; assert.equal(value.x,-2147483648);
    assert.throws(() => { (value as any).x = 2; });
    same(value.with({x:2,y:3,z:4}).with({x:-2147483648,y:2147483647,z:0}).toTag(),Tags.vector3i('saved-sector',-2147483648,2147483647,0));
    assert.equal(value.toTag(null).name,null); assert.equal(value.toTag('rename').name,'rename');
    assert.isTrue(value.equals(value.with({}))); assert.isFalse(value.equals(SectorPosition.ZERO));
    assert.isFalse(new SectorPosition(0,1,0).equals(SectorPosition.ZERO)); assert.isFalse(new SectorPosition(0,0,1).equals(SectorPosition.ZERO));
    assert.equal(SectorPosition.fromValues(1,2,3).toString(),'SectorPosition(1, 2, 3)');
    for (const v of [NaN,Infinity,1.5,2147483648,-2147483649]) assert.throws(() => new SectorPosition(v,0,0));
    assert.throws(() => SectorPosition.fromTag(Tags.int(null,0))); assert.throws(() => value.with({z:2147483648}));
    assert.throws(() => SectorPosition.fromValues(1,2,3,{maxInflatedBytes:2}));
  });

  it('retains every matrix float and wire variant through conversion, mutations, partial edits and reverts', () => {
    const numbers = Array.from({length:16},(_,i) => i + .25); numbers[6] = -0;
    const list = Tags.list('matrix-list',numbers.map(n => Tags.float(null,n))), direct = Tags.matrix4f('matrix-direct',new Matrix4f(...numbers));
    for (const source of [list,direct]) {
      const value = source.type === TagType.LIST ? EntityTransform.fromMatrix4fList(source) : EntityTransform.fromMatrix4fTag(source);
      same(value.toTag(),source); same(value.with({}).toTag(),source); assert.isTrue(Object.isFrozen(value));
      assert.deepEqual(value.toMatrix4fList().getList().map(v => v.getFloat()),numbers);
      assert.equal(value.toMatrix4fList('new-list').name,'new-list'); assert.equal(value.toMatrix4fTag('new-matrix').name,'new-matrix');
      assert.equal(value.toTag(null).name,null); assert.equal(value.toTag('renamed').name,'renamed');
      const keys = ['m00','m01','m02','m03','m10','m11','m12','m13','m20','m21','m22','m23','originX','originY','originZ','m33'] as const;
      keys.forEach((key,index) => assert.equal(value[key],numbers[index]));
      const changes = Object.fromEntries(keys.map((key,index) => [key,index + 100]));
      const changed = value.with(changes); assert.equal(changed.toTag().type,source.type); assert.equal(changed.toTag().name,source.name);
      assert.deepEqual(changed.toMatrix4fList().getList().map(v => v.getFloat()),numbers.map((_,i) => i + 100));
      same(changed.with(Object.fromEntries(keys.map((key,index) => [key,numbers[index]]))).toTag(),source);
      const partial = value.with({originX:2}); assert.equal(partial.m03,3.25); assert.equal(partial.m13,7.25); assert.equal(partial.m23,11.25); assert.equal(partial.m33,15.25);
      partial.toMatrix4fTag().getMatrix4f().m03 = 99; assert.equal(partial.m03,3.25);
      partial.toMatrix4fList().getList()[0] = Tags.float(null,99); assert.equal(partial.m00,.25);
      assert.include(partial.toString(),'origin=(2.00'); assert.throws(() => { (partial as any).originX = 99; });
      assert.equal(value.toMatrix4fTag().getMatrix4f().m33,15.25);
    }
    list.getList()[0] = Tags.float(null,900); direct.getMatrix4f().m00 = 900;
    for (const invalid of [Tags.list(null,[]),Tags.list(null,[Tags.int(null,0)]),Tags.list(null,Array.from({length:15},()=>Tags.float(null,0)))]) assert.throws(()=>EntityTransform.fromMatrix4fList(invalid));
    assert.throws(()=>EntityTransform.fromMatrix4fList(direct)); assert.throws(()=>EntityTransform.fromMatrix4fTag(list));
    for (const v of [NaN,Infinity,Number.MAX_VALUE]) {
      assert.throws(()=>EntityTransform.IDENTITY.with({m33:v}));
      assert.throws(()=>new EntityTransform(v,0,0,1,0,0,0,1,0,0,0,1));
      assert.throws(()=>EntityTransform.fromMatrix4fTag(Tags.matrix4f(null,new Matrix4f(v))));
    }
    assert.throws(()=>EntityTransform.fromMatrix4fList(EntityTransform.IDENTITY.toMatrix4fList(),{maxListLength:15}));
  });

  it('retains point backup, child names and unknown suffix after each supported edit', () => {
    const original = point(), value = SpawnPoint.fromTag(original); same(value.toTag(),original);
    original.getStruct()[0] = Tags.string(null,'bad'); value.toTag().getStruct()[0] = Tags.string(null,'bad'); assert.equal(value.entityUID,'ship-a');
    assert.throws(()=>{ (value as any).localX = 0; }); assert.throws(()=>{ (value.sector as any).x = 0; });
    const backup = value.absolutePosBackup!; backup.x = 100; assert.equal(value.absolutePosBackup!.x,10);
    same(value.with({localX:40}).toTag(),replace(point(),2,Tags.vector3f('local',40,5,6)));
    same(value.with({localX:40}).with({localX:4}).toTag(),point()); same(value.with({}).toTag(),point());
    const changed = value.with({entityUID:'b',sector:new SectorPosition(4,5,6),localX:1,localY:2,localZ:3,gravX:4,gravY:5,gravZ:6,absolutePosBackup:{x:7,y:8,z:9}});
    assert.equal(changed.entityUID,'b'); assert.equal(changed.sector.y,5); assert.equal(changed.localZ,3); assert.equal(changed.gravZ,6); assert.deepEqual(changed.absolutePosBackup,{x:7,y:8,z:9});
    assert.equal(changed.toTag().getStruct()[4].name,'backup'); same(changed.toTag().getStruct()[5],tail()); assert.include(changed.toString(),'uid="b"');
    assert.isNull(SpawnPoint.ZERO.absolutePosBackup); assert.deepEqual(SpawnPoint.ZERO.with({absolutePosBackup:{x:1,y:2,z:3}}).absolutePosBackup,{x:1,y:2,z:3});
    for (const invalid of [Tags.struct(null,[]),replace(point(),0,Tags.int(null,0)),replace(point(),4,Tags.int(null,0)),replace(point(),2,Tags.vector3f(null,NaN,0,0))]) assert.throws(()=>SpawnPoint.fromTag(invalid));
    assert.throws(()=>value.with({localY:Infinity})); assert.throws(()=>value.with({absolutePosBackup:{x:Number.MAX_VALUE,y:0,z:0}}));
    assert.throws(()=>new SpawnPoint('',SectorPosition.ZERO,NaN,0,0,0,0,0));
  });

  it('retains version bytes and sparse/null/vector variants independently of version', () => {
    for (const version of [0,1,2]) {
      const original = Tags.struct('player-spawn',[Tags.byte('version',version),point(),point(),Tags.byte('origin',0),Tags.byte('sector',0),tail()]);
      const value = PlayerSpawnData.fromTag(original); assert.equal(value.version,version); assert.isNull(value.preSpecialOrigin); assert.isNull(value.preSpecialSector);
      same(value.with({}).toTag(),original); same(value.withDeathSpawn(value.deathSpawn).withLogoutSpawn(value.logoutSpawn).toTag(),original);
      const edited = value.with({preSpecialOrigin:{x:1,y:2,z:3},preSpecialSector:new SectorPosition(4,5,6)});
      assert.equal(edited.preSpecialOriginY,2); assert.equal(edited.preSpecialOriginZ,3); assert.equal(edited.preSpecialSector!.x,4);
      const origin = edited.preSpecialOrigin!; origin.x = 10; assert.equal(edited.preSpecialOriginX,1);
      same(edited.with({preSpecialOrigin:null,preSpecialSector:null}).toTag(),original); assert.include(value.toString(),`v${version}`);
      same(value.withDeathSpawn(value.deathSpawn.with({localX:40})).toTag().getStruct()[2],point());
    }
    const sparse = Tags.struct('old',[Tags.byte(null,0),point(),point()]), value = PlayerSpawnData.fromTag(sparse);
    assert.isNull(value.preSpecialOrigin); assert.equal(value.preSpecialOriginX,0); assert.isNull(value.preSpecialSector);
    same(value.with({preSpecialSector:new SectorPosition(1,2,3)}).with({preSpecialSector:null}).toTag(),sparse);
    same(value.with({preSpecialOrigin:{x:1,y:2,z:3}}).with({preSpecialOrigin:null}).toTag(),sparse);
    same(value.with({preSpecialOrigin:null,preSpecialSector:null}).toTag(),sparse);
    assert.equal(new PlayerSpawnData(1,SpawnPoint.ZERO,SpawnPoint.ZERO,new SectorPosition(1,2,3),4,5,6).preSpecialSector!.z,3);
    for (const index of [3,4]) for (const wrong of [Tags.string(null,'wrong'),Tags.byte(null,1)]) {
      const values = [Tags.byte(null,1),point(),point(),Tags.byte(null,0),Tags.byte(null,0)]; values[index] = wrong;
      assert.throws(()=>PlayerSpawnData.fromTag(Tags.struct(null,values)));
    }
    assert.throws(()=>PlayerSpawnData.fromTag(replace(sparse,0,Tags.int(null,1)))); for (const version of [128,-129,1.5,NaN]) assert.throws(()=>new PlayerSpawnData(version,SpawnPoint.ZERO,SpawnPoint.ZERO));
  });

  it('preserves spawner payloads, marker names and list/container extensions through edits', () => {
    const original = controller(), value = SpawnController.fromTag(original), first = value.markers[0]; same(value.toTag(),original);
    original.getStruct().pop(); value.toTag().getStruct()[0] = Tags.struct(null,[]); value.markers.length = 0; assert.lengthOf(value.markers,1);
    first.spawner.getStruct()[0] = Tags.struct(null,[]); same(first.spawner,spawner()); assert.throws(()=>{ (first as any).lastSpawned = 0n; });
    const edited = first.with({lastSpawned:999n,sectorX:10}); same(edited.spawner,spawner()); assert.equal(edited.sectorY,3); same(edited.toTag().getStruct()[3],tail());
    same(edited.with({lastSpawned:123n,sectorX:2}).toTag(),marker()); same(first.with({}).toTag(),marker());
    const moved = first.with({sectorX:5,sectorY:6,sectorZ:7,spawner:replace(spawner(),2,Tags.byte('alive',0))}); assert.equal(moved.sectorZ,7); assert.equal(moved.spawner.getStruct()[2].getByte(),0);
    const updated = value.withMarkers([edited]); assert.equal(updated.toTag().getStruct()[0].name,'marker-list'); same(updated.toTag().getStruct()[1],tail());
    same(updated.withMarkers([first]).toTag(),controller()); assert.lengthOf(value.addMarker(new SpawnMarker(0n,0,0,0)).markers,2);
    assert.include(first.toString(),'last=123'); assert.include(value.toString(),'1 markers');
    const fresh = new SpawnMarker(0n,0,0,0); assert.lengthOf(fresh.spawner.getStruct(),4); assert.equal(fresh.spawner.getStruct()[2].getByte(),1);
    for (const invalid of [Tags.struct(null,[]),Tags.struct(null,[Tags.int(null,1)]),Tags.struct(null,[Tags.struct(null,[Tags.int(null,1)])])]) assert.throws(()=>SpawnController.fromTag(invalid));
    for (const invalid of [Tags.struct(null,[]),replace(marker(),1,Tags.int(null,1)),replace(marker(),0,Tags.struct(null,[]))]) assert.throws(()=>SpawnMarker.fromTag(invalid));
    for (const badEntry of [Tags.struct(null,[]),Tags.struct(null,[Tags.int(null,0)]),Tags.struct(null,[Tags.string(null,'bad'),Tags.byte(null,0)]),Tags.int(null,1)]) {
      assert.throws(()=>first.with({spawner:replace(spawner(),0,Tags.struct(null,[badEntry]))}));
    }
    assert.throws(()=>new SpawnMarker(1 as any,0,0,0)); assert.throws(()=>first.with({lastSpawned:1 as any})); assert.throws(()=>first.with({lastSpawned:1n << 63n})); assert.throws(()=>first.with({sectorY:2147483648}));
  });

  it('propagates custom tree limits through getters and edits without aliasing options', () => {
    let deep = Tags.string('leaf','value'); for (let i=0;i<70;i++) deep = Tags.struct('deep',[deep]);
    const options = {maxDepth:100}, source = Tags.struct('controller',[Tags.struct(null,[marker()]),deep]);
    assert.throws(()=>SpawnController.fromTag(source)); const value = SpawnController.fromTag(source,options); options.maxDepth = 1;
    assert.equal(value.addMarker(new SpawnMarker(0n,0,0,0)).toTag().name,'controller');
    const p = point(), pointDeep = Tags.struct(p.name,[...p.getStruct().slice(0,-1),deep]), spawn = SpawnPoint.fromTag(pointDeep,{maxDepth:100});
    assert.equal(spawn.with({localX:1}).toTag().name,'spawn-point');
    const player = PlayerSpawnData.fromTag(Tags.struct(null,[Tags.byte(null,1),pointDeep,pointDeep]),{maxDepth:100});
    assert.equal(player.withDeathSpawn(spawn).withLogoutSpawn(spawn).deathSpawn.toTag().name,'spawn-point');
    const m = SpawnMarker.fromTag(Tags.struct(null,[spawner(),Tags.long(null,1n),Tags.vector3i(null,0,0,0),deep]),{maxDepth:100});
    assert.equal(m.with({lastSpawned:2n}).lastSpawned,2n);
    const limited = SpawnPoint.fromTag(point(),{maxInflatedBytes:writeTo(point()).length + 5}); assert.throws(()=>limited.with({entityUID:'x'.repeat(1000)}));
    const limitedController = SpawnController.fromTag(controller(),{maxNodes:100}); assert.throws(()=>limitedController.withMarkers(Array.from({length:20},()=>new SpawnMarker(0n,0,0,0))));
  });
});
