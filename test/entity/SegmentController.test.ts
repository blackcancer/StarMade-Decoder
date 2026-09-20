/** @fileoverview Direct and wrapped controller DTOs retain stored types, precise longs and detached transform values. */
import { strict as assert } from 'node:assert';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { writeTo } from '../../src/core/TagParser.js';
import { Matrix4f } from '../../src/types/Matrices.js';
import { parseSegmentController } from '../../src/entity/SegmentController.js';
import { SegmentControllerObject } from '../../src/objects/SegmentController.js';
function record():Tag{return Tags.struct('s3',[Tags.string('uniqueId','ENTITY'),Tags.vector3i(null,-1,-2,-3),Tags.vector3i(null,4,5,6),Tags.struct(null,[]),Tags.struct(null,[]),Tags.string('realname','Display'),
  Tags.struct('transformable',[Tags.float(null,1),Tags.list(null,Array.from({length:16},(_,i)=>Tags.float(null,i+.5))),Tags.byte(null,0),Tags.vector3i(null,7,8,9),Tags.int(null,10),Tags.string(null,'Owner')]),
  Tags.struct(null,[]),Tags.int(null,11),Tags.string(null,'Spawner'),Tags.string(null,'Modifier'),Tags.long(null,9007199254740993n),Tags.byte(null,0),Tags.struct(null,[]),Tags.struct(null,[]),
  Tags.byte(null,1),Tags.byte(null,-1),Tags.byte(null,2),Tags.byte(null,-2),Tags.struct(null,[]),Tags.int(null,12),Tags.struct(null,[]),Tags.struct(null,[]),Tags.byte(null,0),Tags.struct(null,[]),Tags.string(null,'Current'),Tags.string(null,'Docker')]);}
describe('parseSegmentController validated DTO',()=>{
  it('shares direct/wrapped controller discovery and exact scalar projections with the model',()=>{
    for(const tag of [record(),Tags.struct('Shop',[Tags.byte('version',0),record(),Tags.string('sibling','keep')])]){
      const model=SegmentControllerObject.fromTag(tag),dto=parseSegmentController(tag);assert.equal(dto.uniqueId,'ENTITY');assert.equal(dto.realName,'Display');assert.equal(dto.seed,9007199254740993n);
      assert.equal(dto.seed,model.seed);assert.equal(dto.creatorId,11);assert.equal(dto.spawner,'Spawner');assert.equal(dto.lastModifier,'Modifier');assert.equal(dto.currentOwner,'Current');assert.equal(dto.lastDockerPlayer,'Docker');
      assert.equal(dto.scrap,true);assert.equal(dto.vulnerable,false);assert.equal(dto.minable,true);assert.equal(dto.factionRights,-2);assert.equal(dto.nonEmptySegments,12);
      assert.equal(dto.minPos!.x,-1);assert.equal(dto.maxPos!.z,6);assert.equal(dto.sectorPosition!.y,8);assert.equal(dto.factionCode,10);assert.equal(dto.owner,'Owner');
      assert.deepEqual(dto.transformValues,Array.from({length:16},(_,i)=>i+.5));assert.equal(dto.transform,undefined);
    }
    const sparse=parseSegmentController(Tags.struct(null,[Tags.string('uniqueId','id')]));assert.equal(sparse.minPos,undefined);assert.equal(sparse.maxPos,undefined);assert.equal(sparse.sectorPosition,undefined);assert.equal(sparse.transformValues,undefined);assert.equal(sparse.transform,undefined);
    assert.equal(sparse.realName,'');assert.equal(sparse.seed,0n);assert.equal(sparse.factionRights,-2);
  });
  it('keeps MATRIX4f separate from float lists and never shares mutable source payloads',()=>{
    const tag=record(),matrix=new Matrix4f(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16);tag.getStruct()[6].getStruct()[1]=Tags.matrix4f(null,matrix);
    const before=writeTo(tag),dto=parseSegmentController(tag),other=parseSegmentController(tag);assert.ok(dto.transform instanceof Matrix4f);assert.deepEqual(dto.transform,matrix);assert.notEqual(dto.transform,matrix);assert.equal(dto.transformValues,undefined);
    dto.transform!.m30=80;dto.minPos!.x=81;dto.maxPos!.y=82;dto.sectorPosition!.z=83;assert.deepEqual(writeTo(tag),before);
    assert.equal(other.transform!.m30,13);assert.equal(other.minPos!.x,-1);assert.equal(other.maxPos!.y,5);assert.equal(other.sectorPosition!.z,9);
    const list=record(),projected=parseSegmentController(list);projected.transformValues![0]=99;assert.equal(list.getStruct()[6].getStruct()[1].getList()[0].getFloat(),.5);
    matrix.m00=91;assert.equal(other.transform!.m00,1);
  });
  it('rejects malformed shared schemas and retains configurable validation of unknown wrapper data',()=>{
    for(const tag of [Tags.byte(null,0),Tags.struct(null,[]),Tags.struct(null,[Tags.string(null,'not-a-UID')])])assert.throws(()=>parseSegmentController(tag));
    const corrupt=record();corrupt.getStruct()[11]=Tags.int(null,5);assert.throws(()=>parseSegmentController(corrupt));
    const wrongFlag=record();wrongFlag.getStruct()[16]=Tags.string(null,'true');assert.throws(()=>parseSegmentController(wrongFlag));
    const wrongMatrix=record();wrongMatrix.getStruct()[6].getStruct()[1]=Tags.list(null,[Tags.float(null,0)]);assert.throws(()=>parseSegmentController(wrongMatrix));
    let opaque=Tags.string(null,'opaque');for(let i=0;i<80;i++)opaque=Tags.struct(null,[opaque]);const wrapper=Tags.struct('Station',[record(),opaque]);
    assert.throws(()=>parseSegmentController(wrapper),{code:'E_LIMIT'});const sharedNodeBudget={remainingNodes:0},sharedInflationBudget={remainingBytes:0};
    assert.equal(parseSegmentController(wrapper,{maxDepth:100,sharedNodeBudget,sharedInflationBudget}).uniqueId,'ENTITY');assert.equal(sharedNodeBudget.remainingNodes,0);assert.equal(sharedInflationBudget.remainingBytes,0);
    assert.throws(()=>parseSegmentController(record(),{maxNodes:10}),{code:'E_LIMIT'});assert.throws(()=>parseSegmentController(record(),{maxInflatedBytes:100}),{code:'E_LIMIT'});
  });
});
