/** @fileoverview Player character/transformable source retention, snapshots and typed edits. */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { PlayerCharacter,PlayerTransformable } from '../../src/objects/PlayerCharacter.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo } from '../../src/core/TagParser.js';
import { AiConfigurationState } from '../../src/objects/EntitySlotObjects.js';

/** A stored transform list, without any geometry computation. */
function transform():PlayerTransformable{return new PlayerTransformable(5,Array.from({length:16},(_,i)=>i),false,{x:1,y:2,z:3},7,'Owner',[Tags.string('future','kept')]);}

describe('PlayerCharacter V2 contracts',()=>{
  it('retains anonymous fields, unknown root and transformable extras, gzip and edit/revert',()=>{
    const original=new PlayerCharacter(8,4,0.5,transform()).toTag();original.getStruct()[0]=Tags.int(null,8);
    original.getStruct().splice(4,0,Tags.string('root-extra','preserved'));
    const bytes=gzipSync(Buffer.concat([writeTo(original).subarray(2),Buffer.from([77])])),model=PlayerCharacter.fromBuffer(bytes);
    const changed=model.withId(12).withSpeed(8).withStepHeight(1).withOwner('New').withFactionId(9);
    assert.equal(changed.id,12);assert.equal(changed.speed,8);assert.equal(changed.stepHeight,1);assert.equal(changed.owner,'New');assert.equal(changed.factionId,9);
    assert.equal(changed.toTag().getStruct()[0].name,null);assert.equal(changed.toTag().getStruct()[4].getString(),'preserved');
    assert.equal(changed.transformable.toTag().getStruct()[6].getString(),'kept');
    assert.deepEqual(changed.withId(8).withSpeed(4).withStepHeight(.5).withOwner('Owner').withFactionId(7).toBuffer(),bytes);
    assert.deepEqual(model.toBuffer(),bytes);assert.equal(model.sectorPosition.z,3);assert.equal(model.owner,'Owner');
    assert.include(model.toString(),'id=8');assert.equal(JSON.parse(JSON.stringify(model)).transformable.mass,5);
    assert.equal(PlayerCharacter.fromTag(model.toTag()).id,8);
    assert.deepEqual(new PlayerCharacter(8,4,.5,transform()).toBuffer(),writeTo(new PlayerCharacter(8,4,.5,transform()).toTag()));
  });
  it('copies arrays and coordinates and validates full field edits without applying transforms',()=>{
    const tr=transform(),list=tr.transformValues;list[0]=999;assert.equal(tr.transformValues[0],0);
    const changed=tr.with({mass:6,noAI:true,owner:'new',factionId:12,sectorPosition:{x:4,y:5,z:6},transformValues:Array(16).fill(2)});
    assert.equal(changed.mass,6);assert.isTrue(changed.noAI);assert.equal(changed.factionId,12);assert.equal(changed.owner,'new');assert.equal(changed.sectorPosition.x,4);
    assert.deepEqual(changed.transformValues,Array(16).fill(2));assert.equal(tr.mass,5);assert.equal(tr.with({}).owner,'Owner');
    assert.throws(()=>{(tr.sectorPosition as any).x=7;});assert.equal(tr.toJSON().sectorPosition.x,1);
    const partial=Tags.struct(null,tr.toTag().getStruct().slice(0,2)),legacy=PlayerTransformable.fromTag(partial);
    assert.deepEqual(legacy.sectorPosition,{x:0,y:0,z:0});assert.equal(legacy.factionId,0);assert.equal(legacy.owner,'');assert.isFalse(legacy.noAI);
    assert.throws(()=>legacy.with({owner:'x'}));
    for(const index of [2,3,4,5]){
      const invalid=tr.toTag();invalid.getStruct()[index]=Tags.double(null,1);
      assert.throws(()=>PlayerTransformable.fromTag(invalid), /optional player/);
    }
    const encoded=tr.toTag();encoded.getStruct()[2]=Tags.byte('noAI',7);
    const noncanonical=PlayerTransformable.fromTag(encoded);
    assert.deepEqual(writeTo(noncanonical.with({noAI:false}).with({noAI:true}).toTag()),writeTo(encoded));
    assert.isNull(tr.aiConfiguration);assert.isNull(legacy.aiConfiguration);
    const ai=new AiConfigurationState().withSetting(1,'active'),withAI=tr.withAiConfiguration(ai);
    assert.equal(withAI.aiConfiguration!.getSetting(1),'active');
    assert.equal(PlayerTransformable.fromTag(withAI.toTag()).aiConfiguration!.getSetting(1),'active');
    assert.isNull(withAI.withAiConfiguration(null).aiConfiguration);
    assert.deepEqual(writeTo(withAI.withAiConfiguration(null).toTag()),writeTo(tr.toTag()));
    for(const changes of [{mass:NaN},{mass:1e50},{noAI:1},{transformValues:[]},{sectorPosition:{x:2**31,y:0,z:0}},{factionId:2**31}])assert.throws(()=>tr.with(changes as any));
    assert.throws(()=>new PlayerTransformable(1,[],false,{x:0,y:0,z:0},0,''));
    assert.throws(()=>new PlayerTransformable(1,Array(16).fill(0),false,null as any,0,''));
    assert.throws(()=>new PlayerTransformable(1,Array(16).fill(0),1 as any,{x:0,y:0,z:0},0,''));
    assert.throws(()=>PlayerTransformable.fromTag(Tags.struct(null,[])));
    assert.throws(()=>PlayerCharacter.fromTag(Tags.struct(null,[])));
    const pc=new PlayerCharacter(1,4,.5,tr);assert.throws(()=>pc.withSpeed(NaN));assert.throws(()=>pc.withId(2**31));
    assert.throws(()=>PlayerCharacter.fromTag(pc.toTag(),{maxDepth:1}));assert.throws(()=>PlayerCharacter.fromBuffer(pc.toBuffer(),{maxInputBytes:0}));
  });
});
