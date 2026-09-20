/** @fileoverview Saved slot tuples, configurable edit bounds and exact extension-preserving updates. */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { registerAllFactories } from '../../../src/serializable/Factories.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { readFrom,writeTo } from '../../../src/core/TagParser.js';
import { DecodeError } from '../../../src/core/DecodeError.js';
import { SlotAssignment } from '../../../src/objects/components/SlotAssignment.js';
const same=(a:Tag,b:Tag)=>assert.deepEqual(writeTo(a),writeTo(b));
const isLimit=(e:unknown)=>e instanceof DecodeError&&e.code==='E_LIMIT';
function row(slot=2,pos=1n):Tag{return Tags.struct('slot-row',[Tags.byte('slot',slot),Tags.long('block-key',pos),Tags.byteArray('future',Buffer.from([255,8]))]);}
function root():Tag{return Tags.struct('assignment',[Tags.byte('reserved',-3),Tags.struct('slots',[row(),row(-128,-1n)]),Tags.string('future-root','keep')]);}
describe('SlotAssignment faithful collection',()=>{
  it('preserves reserved bytes, signed slots, extensions, names and unchanged records',()=>{
    const tag=root(),model=SlotAssignment.fromTag(tag);same(model.toTag(),tag);assert.equal(model.version,-3);assert.equal(model.slots.get(-128),-1n);
    const updated=model.assign(2,22n);assert.equal(updated.slots.get(2),22n);assert.equal(updated.toTag().getStruct()[1].name,'slots');assert.equal(updated.toTag().getStruct()[1].getStruct()[0].getStruct()[1].name,'block-key');
    same(updated.toTag().getStruct()[2],tag.getStruct()[2]);same(updated.toTag().getStruct()[1].getStruct()[0].getStruct()[2],tag.getStruct()[1].getStruct()[0].getStruct()[2]);same(updated.assign(2,1n).toTag(),tag);
    const added=model.assign(3,1n);assert.equal(added.slots.size,3);same(added.unassign(3).toTag(),tag);same(model.unassign(99).toTag(),tag);assert.equal(model.unassign(-128).slots.size,1);
    assert.equal(model.toString(),'SlotAssignment(2 slots)');assert.deepEqual(model.toJSON(),{version:-3,slots:[{slot:2,position:'1'},{slot:-128,position:'-1'}]});assert.equal(SlotAssignment.EMPTY.slots.size,0);
  });
  it('takes detached snapshots of maps, Tags and constructor limits',()=>{
    const slots=new Map([[1,5n]]),model=new SlotAssignment(0,slots);slots.set(1,9n);(model.slots as Map<number,bigint>).clear();assert.equal(model.slots.get(1),5n);
    const tag=root(),expected=writeTo(tag),parsed=SlotAssignment.fromTag(tag);tag.getStruct()[1].getStruct()[0].getStruct()[2].getByteArray()[0]=0;
    parsed.toTag().getStruct()[1].getStruct()[0].getStruct()[2].getByteArray()[0]=1;assert.deepEqual(writeTo(parsed.toTag()),expected);assert.ok(Object.isFrozen(model));
    const options={minSlot:-128,maxSlot:127};const custom=SlotAssignment.fromTag(root(),options);options.minSlot=0;assert.equal(custom.assign(-128,9n).slots.get(-128),9n);assert.equal(custom.assign(127,9n).slots.get(127),9n);
    assert.throws(()=>parsed.assign(-128,9n));assert.throws(()=>parsed.assign(10,9n));assert.throws(()=>parsed.assign(.5,9n));
  });
  it('rejects incorrect schemas, duplicate slots and lossy constructor inputs',()=>{
    for(const tag of [Tags.int(null,0),Tags.struct(null,[]),Tags.struct(null,[Tags.byte(null,0)]),Tags.struct(null,[Tags.int(null,0),Tags.struct(null,[])]),Tags.struct(null,[Tags.byte(null,0),Tags.struct(null,[Tags.int(null,0)])]),Tags.struct(null,[Tags.byte(null,0),Tags.struct(null,[Tags.struct(null,[])])]),Tags.struct(null,[Tags.byte(null,0),Tags.struct(null,[Tags.struct(null,[Tags.byte(null,1)])])]),Tags.struct(null,[Tags.byte(null,0),Tags.struct(null,[row(),row()])])])assert.throws(()=>SlotAssignment.fromTag(tag));
    const wrongSlot=root();wrongSlot.getStruct()[1].getStruct()[0].getStruct()[0]=Tags.int(null,2);assert.throws(()=>SlotAssignment.fromTag(wrongSlot));
    const wrongPos=root();wrongPos.getStruct()[1].getStruct()[0].getStruct()[1]=Tags.int(null,2);assert.throws(()=>SlotAssignment.fromTag(wrongPos));
    for(const version of [-129,128,.5])assert.throws(()=>new SlotAssignment(version,new Map()));
    for(const options of [{minSlot:-129},{maxSlot:128},{minSlot:.5},{minSlot:2,maxSlot:1}])assert.throws(()=>new SlotAssignment(0,new Map(),options));
    for(const slot of [-129,128,.5])assert.throws(()=>new SlotAssignment(0,new Map([[slot,1n]])));
    for(const value of [123,1.5,'1',1n<<63n,-(1n<<63n)-1n]){assert.throws(()=>new SlotAssignment(0,new Map([[1,value as bigint]])));assert.throws(()=>SlotAssignment.EMPTY.assign(1,value as bigint));}
    assert.equal(new SlotAssignment(127,new Map([[-128,-(1n<<63n)],[127,(1n<<63n)-1n]])).slots.size,2);
  });
  it('round-trips the saved control mappings of the actual entity sample',()=>{
    registerAllFactories();const entity=readFrom(fs.readFileSync('samples/ENTITY_SHIP_Traders Homerl110.ent'));
    const tag=entity.getStruct()[7].getStruct()[11],model=SlotAssignment.fromTag(tag);same(model.toTag(),tag);
    const previous=model.slots.get(1),edited=model.assign(1,123456789n);assert.equal(edited.slots.get(1),123456789n);
    same((previous===undefined?edited.unassign(1):edited.assign(1,previous)).toTag(),tag);
  });
  it('preserves elevated traversal limits and rejects oversized revisions before publishing them',()=>{
    let deep=Tags.string(null,'leaf');for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);const tag=root();tag.getStruct().splice(2,0,deep);
    assert.throws(()=>SlotAssignment.fromTag(tag),isLimit);const options={maxDepth:100,maxNodes:300,maxInflatedBytes:1000,minSlot:-128,maxSlot:127};const parsed=SlotAssignment.fromTag(tag,options);options.maxDepth=0;
    assert.deepEqual(writeTo(parsed.assign(-128,2n).assign(-128,-1n).toTag(),{maxDepth:100}),writeTo(tag,{maxDepth:100}));
    const limited=new SlotAssignment(0,new Map([[1,2n]]),{maxNodes:9});assert.throws(()=>limited.assign(2,3n),isLimit);assert.equal(limited.assign(1,4n).slots.get(1),4n);
    assert.throws(()=>new SlotAssignment(0,new Map([[1,2n]]),{maxInflatedBytes:8}),isLimit);
    const listLimited=new SlotAssignment(0,new Map(),{maxListLength:3});assert.throws(()=>listLimited.assign(1,1n).assign(2,2n).assign(3,3n),isLimit);
  });
});
