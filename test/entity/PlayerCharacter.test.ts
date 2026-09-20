/** @fileoverview Character DTOs expose the actual saved float list without inventing or applying transforms. */
import { strict as assert } from 'node:assert';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { writeTo } from '../../src/core/TagParser.js';
import { Matrix4f } from '../../src/types/Matrices.js';
import { parsePlayerCharacter } from '../../src/entity/PlayerCharacter.js';
import { PlayerCharacter } from '../../src/objects/PlayerCharacter.js';
function record():Tag{return Tags.struct('character',[Tags.int(null,42),Tags.float('other-speed-name',3.5),Tags.float(null,.5),
  Tags.struct('other-transform-name',[Tags.float(null,1),Tags.list('stored-transform',Array.from({length:16},(_,i)=>Tags.float(null,i+.25))),Tags.byte(null,1),
    Tags.vector3i('sector',4,5,6),Tags.int('faction',9),Tags.string('owner','Ada'),Tags.byteArray('extension',Buffer.from([0,255]))]),Tags.string('future','keep')]);}
describe('parsePlayerCharacter validated DTO',()=>{
  it('uses positional fields and returns all sixteen floats in their original order',()=>{
    const root=record(),dto=parsePlayerCharacter(root),model=PlayerCharacter.fromTag(root);
    assert.equal(dto.id,42);assert.equal(dto.speed,3.5);assert.equal(dto.stepHeight,.5);assert.equal(dto.factionCode,9);assert.equal(dto.owner,'Ada');
    assert.equal(dto.sectorPosition!.z,6);assert.deepEqual(dto.transformValues,Array.from({length:16},(_,i)=>i+.25));assert.deepEqual(dto.transformValues,model.transformable.transformValues);
    assert.equal(dto.transform,undefined);
    const legacy=record();legacy.getStruct()[3]=Tags.struct(null,legacy.getStruct()[3].getStruct().slice(0,2));const sparse=parsePlayerCharacter(legacy);
    assert.equal(sparse.sectorPosition!.x,0);assert.equal(sparse.factionCode,0);assert.equal(sparse.owner,'');assert.equal(sparse.transformValues.length,16);
  });
  it('detaches output arrays and coordinates from source Tags and other results',()=>{
    const root=record(),before=writeTo(root),dto=parsePlayerCharacter(root),other=parsePlayerCharacter(root);
    dto.transformValues[12]=777;dto.sectorPosition!.x=99;assert.deepEqual(writeTo(root),before);assert.equal(other.transformValues[12],12.25);assert.equal(other.sectorPosition!.x,4);
    root.getStruct()[3].getStruct()[3].getVector3i().y=90;root.getStruct()[3].getStruct()[1].getList()[0]=Tags.float(null,10);assert.equal(other.sectorPosition!.y,5);assert.equal(other.transformValues[0],.25);
  });
  it('rejects incomplete, mistyped and fictitious matrix records and applies caller tree limits',()=>{
    for(const root of [Tags.byte(null,0),Tags.struct(null,[])])assert.throws(()=>parsePlayerCharacter(root));
    const incomplete=record();incomplete.getStruct()[3].getStruct()[1]=Tags.list(null,[Tags.float(null,1)]);assert.throws(()=>parsePlayerCharacter(incomplete));
    const matrix=record();matrix.getStruct()[3].getStruct()[1]=Tags.matrix4f(null,new Matrix4f());assert.throws(()=>parsePlayerCharacter(matrix));
    const wrong=record();wrong.getStruct()[0]=Tags.string('id','42');assert.throws(()=>parsePlayerCharacter(wrong));
    let extra=Tags.string(null,'opaque');for(let i=0;i<80;i++)extra=Tags.struct(null,[extra]);const deep=record();deep.getStruct().splice(-1,0,extra);
    assert.throws(()=>parsePlayerCharacter(deep),{code:'E_LIMIT'});const sharedNodeBudget={remainingNodes:0},sharedInflationBudget={remainingBytes:0};
    assert.equal(parsePlayerCharacter(deep,{maxDepth:100,sharedNodeBudget,sharedInflationBudget}).id,42);assert.equal(sharedNodeBudget.remainingNodes,0);assert.equal(sharedInflationBudget.remainingBytes,0);
    assert.throws(()=>parsePlayerCharacter(record(),{maxNodes:4}),{code:'E_LIMIT'});assert.throws(()=>parsePlayerCharacter(record(),{maxInflatedBytes:10}),{code:'E_LIMIT'});
  });
});
