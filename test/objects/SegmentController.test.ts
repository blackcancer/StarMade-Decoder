/** @fileoverview Wrapper-preserving controller updates with detached stored transforms. */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { SegmentControllerObject } from '../../src/objects/SegmentController.js';
import { PlayerTransformable } from '../../src/objects/PlayerCharacter.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { Matrix4f } from '../../src/types/Matrices.js';
import { writeTo } from '../../src/core/TagParser.js';

/** Minimal complete represented controller slots with opaque middle/extension records. */
function controller():Tag{return Tags.struct('s3',[Tags.string('uniqueId','id'),Tags.vector3i('minPos',-1,-2,-3),Tags.vector3i('maxPos',1,2,3),
  Tags.struct('docking',[]),Tags.struct('links',[]),Tags.string('realname','Display'),
  new PlayerTransformable(1,Array(16).fill(0),false,{x:1,y:2,z:3},7,'Owner').toTag(),Tags.byte(null,0),Tags.int(null,5),
  Tags.string(null,'Spawner'),Tags.string(null,'Modifier'),Tags.long(null,2n**60n)]);}

describe('SegmentController V2 contracts',()=>{
  it('edits the located controller inside Shop/SpaceStation wrappers without modifying siblings',()=>{
    for(const root of [controller(),Tags.struct('Shop',[Tags.byte('version',0),controller(),Tags.string('opaque','untouched')])]){
      const bytes=gzipSync(writeTo(root).subarray(2)),model=SegmentControllerObject.fromBuffer(bytes);
      const edited=model.withName('new').withRealName('Renamed').withFactionCode(9);
      assert.equal(edited.uniqueId,'new');assert.equal(edited.realName,'Renamed');assert.equal(edited.factionCode,9);assert.equal(edited.owner,'Owner');
      assert.equal(model.factionCode,7);assert.equal(model.uniqueId,'id');assert.deepEqual(model.toBuffer(),bytes);
      assert.deepEqual(edited.withName('id').withRealName('Display').withFactionCode(7).toBuffer(),bytes);
      assert.equal(SegmentControllerObject.fromTag(edited.toTag()).realName,'Renamed');
      assert.equal(JSON.parse(JSON.stringify(model)).seed,(2n**60n).toString());assert.include(model.toString(),'Display');
      assert.equal(model.minPos!.x,-1);assert.equal(model.maxPos!.z,3);assert.equal(model.sectorPosition!.y,2);
      assert.lengthOf(model.transformValues!,16);model.transformValues![0]=99;assert.equal(model.transformValues![0],0);
      assert.deepEqual(model.controlElementMapper!.links,[]);assert.isNull(model.elementCountMap);assert.deepEqual(model.long2Vector3fMaps,[]);assert.deepEqual(model.long2TransformMaps,[]);
    }
  });
  it('supports stored matrix variants and rejects absent edits, invalid fields, cycles and limits',()=>{
    const tag=controller(),matrix=new Matrix4f();matrix.m00=3;tag.getStruct()[6].getStruct()[1]=Tags.matrix4f('transform',matrix);
    const model=SegmentControllerObject.fromTag(tag);matrix.m00=99;assert.equal(model.transform!.m00,3);assert.isNull(model.transformValues);
    assert.throws(()=>{(model.transform as any).m00=55;});assert.deepEqual(model.toBuffer(),writeTo(model.toTag()));
    const sparse=SegmentControllerObject.fromTag(Tags.struct(null,[Tags.string('uniqueId','id')]));assert.isNull(sparse.minPos);assert.isNull(sparse.maxPos);
    assert.isNull(sparse.sectorPosition);assert.equal(sparse.owner,'');assert.equal(sparse.creatorId,0);assert.equal(sparse.nonEmptySegments,0);
    assert.throws(()=>sparse.withRealName('x'));assert.throws(()=>sparse.withFactionCode(4));assert.throws(()=>SegmentControllerObject.fromTag(Tags.struct(null,[])));
    const bad=controller();bad.getStruct()[8]=Tags.string(null,'wrong');assert.throws(()=>SegmentControllerObject.fromTag(bad));
    const short=controller();short.getStruct()[6].getStruct()[1]=Tags.list(null,[Tags.float(null,1)]);assert.throws(()=>SegmentControllerObject.fromTag(short));
    short.getStruct()[6].getStruct()[1]=Tags.string(null,'matrix');assert.throws(()=>SegmentControllerObject.fromTag(short));
    const cycle=controller();cycle.getStruct().splice(4,0,cycle);assert.throws(()=>SegmentControllerObject.fromTag(cycle));
    assert.throws(()=>SegmentControllerObject.fromTag(controller(),{maxNodes:1}));assert.throws(()=>SegmentControllerObject.fromBuffer(model.toBuffer(),{maxInputBytes:1}));
    const named=controller();named.getStruct()[5]=Tags.string('realName','Title');assert.equal(SegmentControllerObject.fromTag(named).withRealName('New').realName,'New');
    const anonymous=controller();anonymous.getStruct()[5]=Tags.string(null,'Anonymous');assert.equal(SegmentControllerObject.fromTag(anonymous).withRealName('New').realName,'New');
  });
});
