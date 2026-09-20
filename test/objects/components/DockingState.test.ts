/** @fileoverview Docking persisted coordinates, legacy slots and quaternion preservation. */
import { assert } from 'chai';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag, FINISH_TAG } from '../../../src/core/Tag.js';
import { writeTo } from '../../../src/core/TagParser.js';
import { DockingState } from '../../../src/objects/components/DockingState.js';
function record(): Tag { return Tags.struct('docking', [Tags.string('host','ENTITY_A'), Tags.vector3i('position',3,-4,5),
  Tags.string('old-landed','ENTITY_OLD'),Tags.vector3i('old-landed-position',8,9,10), Tags.vector3f('old-size',1,2,3),
  Tags.byte('orientation',-1),Tags.vector4f('quaternion',.25,.5,.75,1),Tags.byteArray('extension',Buffer.from([255,8]))]); }
function same(a: Tag,b: Tag): void { assert.deepEqual(writeTo(a),writeTo(b)); }
describe('DockingState faithful component', () => {
  it('retains stored legacy slots, size name, quaternion and extensions through edits', () => {
    const tag=record(), model=DockingState.fromTag(tag); same(model.toTag(),tag);
    assert.deepEqual(model.quaternion,{x:.25,y:.5,z:.75,w:1}); assert.equal(model.sizeX,1);
    const edited=model.dockTo('ENTITY_B',30,40,50,2).toTag();
    for(const i of [2,3,4,6,7]) same(edited.getStruct()[i],tag.getStruct()[i]);
    same(model.dockTo('ENTITY_B',30,40,50,2).dockTo('ENTITY_A',3,-4,5,-1).toTag(),tag);
  });
  it('detaches source trees and constructor quaternion input', () => {
    const tag=record(), model=DockingState.fromTag(tag); tag.getStruct()[6].getVector4f().x=9;
    model.quaternion.x=7; model.toTag().getStruct()[6].getVector4f().x=6;
    assert.equal(model.quaternion.x,.25);
    const q={x:0,y:0,z:0,w:1}; const made=new DockingState('NONE',0,0,0,1,2,3,0,{quaternion:q}); q.x=4;
    assert.equal(made.quaternion.x,0); assert.equal(made.toTag().getStruct()[2].getByte(),0);
  });
  it('validates required coordinates and optional typed fields', () => {
    assert.throws(()=>DockingState.fromTag(Tags.struct(null,[])));
    assert.throws(()=>DockingState.fromTag(Tags.struct(null,[Tags.string(null,'host')])));
    for(const index of [1,4,5,6]) { const tag=record();tag.getStruct()[index]=Tags.string(null,'bad');assert.throws(()=>DockingState.fromTag(tag)); }
  });
});

describe('DockingState validation and historical suffixes',()=>{
  it('preserves short historical NONE records and fills only newly required slots',()=>{
    for(const length of [1,2,3,4,5,6]) {
      const fields=record().getStruct().slice(0,length);fields[0]=Tags.string('host','NONE');const tag=Tags.struct('old',fields),model=DockingState.fromTag(tag);same(model.toTag(),tag);
      const edited=model.with({quaternion:{x:1,y:2,z:3,w:4}}).toTag();assert.equal(edited.getStruct()[6].getVector4f().w,4);
      assert.equal(edited.getStruct()[1].type,10);assert.equal(edited.getStruct()[4].type,9);assert.equal(edited.getStruct()[5].type,1);
      same(model.with({quaternion:{x:1,y:2,z:3,w:4}}).with({quaternion:{x:0,y:0,z:0,w:1}}).toTag(),tag);
    }
    assert.isFalse(DockingState.UNDOCKED.isDocked);assert.isFalse(new DockingState('',0,0,0,0,0,0,0).isDocked);assert.isTrue(DockingState.fromTag(record()).isDocked);
    assert.equal(DockingState.UNDOCKED.toString(),'DockingState(UNDOCKED)');assert.include(DockingState.fromTag(record()).toString(),'ENTITY_A');
    const undocked=DockingState.fromTag(record()).undock();assert.equal(undocked.dockedTo,'NONE');assert.equal(undocked.dockPosY,0);assert.equal(undocked.sizeY,2);assert.equal(undocked.quaternion.w,1);
    assert.equal(DockingState.UNDOCKED.dockTo('host',1,2,3).localOrientation,0);
  });
  it('rejects invalid signed coordinates, bytes and float32 overflow while preserving IEEE values',()=>{
    const make=(patch:Record<string,unknown>)=>{const f={uid:'NONE',x:0,y:0,z:0,sizeX:0,sizeY:0,sizeZ:0,orient:0,options:{},...patch};return new DockingState(f.uid as string,f.x as number,f.y as number,f.z as number,f.sizeX as number,f.sizeY as number,f.sizeZ as number,f.orient as number,f.options);};
    for(const invalid of [{uid:5},{x:1.5},{y:2**31},{z:-(2**31)-1},{orient:128},{orient:-129},{orient:.5},{sizeX:'1'},{sizeY:Number.MAX_VALUE},{options:{quaternion:{x:0,y:0,z:0}}},{options:{legacyLandedTo:FINISH_TAG}},{options:{legacyLandedPosition:FINISH_TAG}}]) assert.throws(()=>make(invalid));
    assert.isNaN(make({sizeX:NaN}).sizeX);assert.equal(make({sizeY:Infinity}).sizeY,Infinity);assert.equal(make({orient:-128}).localOrientation,-128);
    assert.throws(()=>DockingState.fromTag(Tags.string(null,'wrong')));
    const bad=record();bad.getStruct()[0]=Tags.int(null,5);assert.throws(()=>DockingState.fromTag(bad));
  });
  it('detaches legacy payloads and applies configured complete-tree limits to edits',()=>{
    const payload=Tags.byteArray('old',Buffer.from([1,2]));const model=new DockingState('NONE',0,0,0,0,0,0,0,{legacyLandedTo:payload});payload.getByteArray()[0]=9;
    model.legacyLandedTo.getByteArray()[0]=8;model.toTag().getStruct()[2].getByteArray()[0]=7;assert.equal(model.legacyLandedTo.getByteArray()[0],1);
    assert.isTrue(Object.isFrozen(model));same(model.with({legacyLandedTo:Tags.byte(null,3)}).with({legacyLandedTo:model.legacyLandedTo}).toTag(),model.toTag());
    let deep=Tags.string(null,'kept');for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);const tag=record();tag.getStruct().splice(7,0,deep);
    assert.throws(()=>DockingState.fromTag(tag));const options={maxDepth:100};const parsed=DockingState.fromTag(tag,options);options.maxDepth=1;
    assert.deepEqual(writeTo(parsed.dockTo('changed',1,2,3).dockTo('ENTITY_A',3,-4,5,-1).toTag(),{maxDepth:100}),writeTo(tag,{maxDepth:100}));
    assert.throws(()=>DockingState.fromTag(record(),{maxNodes:5}));assert.throws(()=>DockingState.fromTag(record(),{maxInflatedBytes:20}));
  });
});
