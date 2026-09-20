/** @fileoverview Complete graph snapshots, semantic reverts and cumulative limits for private model helpers. */
import { strict as assert } from 'node:assert';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { writeTo } from '../../src/core/TagParser.js';
import { DecodeError } from '../../src/core/DecodeError.js';
import { copyTagModel,tagModelOptions,rememberTagModel,inheritTagModel,renderTagModel } from '../../src/core/TagModel.js';
import { RawElement,registerAllFactories } from '../../src/serializable/Factories.js';
registerAllFactories();
const empty=()=>Tags.struct('fallback',[]);
const same=(a:Tag,b:Tag)=>assert.deepEqual(writeTo(a),writeTo(b));
const isLimit=(error:unknown)=>error instanceof DecodeError&&error.code==='E_LIMIT';
function source():Tag{return Tags.struct('root',[Tags.byte('flag',7),Tags.int('legacy-number',9),Tags.byteArray('unknown',Buffer.from([1,255]))]);}
function semantic(flag=true,value=9n):Map<number,Tag>{return new Map([[0,Tags.bool(null,flag)],[1,Tags.long(null,value)]]);}
describe('TagModel snapshot and edit helpers',()=>{
  it('retains source names, historical types and noncanonical boolean bytes until fields change',()=>{
    const model={},tag=source(),fields=semantic();rememberTagModel(model,tag,fields);
    same(renderTagModel(model,semantic(),empty()),tag);
    const next=inheritTagModel(model,{}),edited=renderTagModel(next,semantic(false,10n),empty());
    assert.equal(edited.name,'root');assert.equal(edited.getStruct()[0].getByte(),0);
    assert.equal(edited.getStruct()[1].getLong(),10n);assert.equal(edited.getStruct()[1].name,'legacy-number');same(edited.getStruct()[2],tag.getStruct()[2]);
    same(renderTagModel(inheritTagModel(next,{}),semantic(),empty()),tag);
    tag.getStruct()[2].getByteArray()[0]=77;fields.set(0,Tags.bool(null,false));
    same(renderTagModel(model,semantic(),empty()),source());assert.equal(JSON.stringify(model),'{}');
  });
  it('detaches both newly supplied field payloads and unmodelled fields of a fresh initial tree',()=>{
    const initial=source(),value=Tags.byteArray('caller-name',Buffer.from([4,5])),fields=new Map([[1,value]]),target={};
    assert.equal(inheritTagModel({},target),target);
    const rendered=renderTagModel(target,fields,initial);assert.equal(rendered.getStruct()[1].name,'legacy-number');
    rendered.getStruct()[1].getByteArray()[0]=8;rendered.getStruct()[2].getByteArray()[0]=9;
    assert.equal(value.getByteArray()[0],4);assert.equal(initial.getStruct()[2].getByteArray()[0],1);
    value.getByteArray()[1]=11;initial.getStruct()[2].getByteArray()[1]=12;
    assert.equal(rendered.getStruct()[1].getByteArray()[1],5);assert.equal(rendered.getStruct()[2].getByteArray()[1],255);
  });
  it('fills newly added positional slots without changing existing slot identities',()=>{
    const model={};rememberTagModel(model,empty(),new Map());
    const result=renderTagModel(model,new Map([[2,Tags.string('new-name','value')]]),empty());
    assert.equal(result.getStruct()[0].type,TagType.NOTHING);assert.equal(result.getStruct()[1].type,TagType.NOTHING);
    assert.equal(result.getStruct()[2].name,null);assert.equal(result.getStruct()[2].getString(),'value');assert.equal(result.getStruct().at(-1)?.type,TagType.FINISH);
  });
  it('copies opaque serializable bytes and never reuses public mutable objects',()=>{
    const raw=new RawElement(1,Buffer.from([0,0,0,1,0,5,0,0,0,3]));const tag=Tags.struct('payload',[new Tag(TagType.SERIALIZABLE,'ecm',raw)]);
    const copied=copyTagModel(tag);(copied.getStruct()[0].getSerializable() as RawElement).raw[9]=8;assert.equal(raw.raw[9],3);
    const model={};rememberTagModel(model,tag,new Map());raw.raw[9]=7;
    const first=renderTagModel(model,new Map(),empty());(first.getStruct()[0].getSerializable() as RawElement).raw[9]=9;
    assert.equal((renderTagModel(model,new Map(),empty()).getStruct()[0].getSerializable() as RawElement).raw[9],3);
    same(copyTagModel(FINISH_TAG),FINISH_TAG);
  });
  it('preserves elevated local limits without charging shared external counters',()=>{
    let deep=Tags.byteArray('leaf',Buffer.from([1]));for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);
    const tag=Tags.struct('deep',[deep]),budget={remainingNodes:0},inflation={remainingBytes:0};
    const opts={maxDepth:100,maxNodes:200,maxInputBytes:1,maxInflatedBytes:500,sharedNodeBudget:budget,sharedInflationBudget:inflation};
    assert.throws(()=>copyTagModel(tag),isLimit);const local=tagModelOptions(opts);
    assert.equal(local.maxInputBytes,500);assert.equal(local.sharedNodeBudget,undefined);assert.equal(local.sharedInflationBudget,undefined);
    const clone=copyTagModel(tag,opts),model={};rememberTagModel(model,clone,new Map([[0,deep]]),opts);opts.maxDepth=1;
    assert.deepEqual(writeTo(renderTagModel(model,new Map([[0,deep]]),empty()),{maxDepth:100}),writeTo(tag,{maxDepth:100}));
    assert.deepEqual(writeTo(renderTagModel({},new Map([[0,deep]]),Tags.struct(null,[]),{maxDepth:100}),{maxDepth:100}),writeTo(Tags.struct(null,[deep]),{maxDepth:100}));
    assert.equal(budget.remainingNodes,0);assert.equal(inflation.remainingBytes,0);assert.equal(tagModelOptions().maxDepth,undefined);
  });
  it('rejects invalid positional indexes and interior FINISH before constructing an invalid tree',()=>{
    for(const index of [-1,.5,Infinity]) assert.throws(()=>renderTagModel({},new Map([[index,Tags.int(null,1)]]),empty()),(e:unknown)=>e instanceof DecodeError&&e.code==='E_RANGE');
    assert.throws(()=>renderTagModel({},new Map([[0,FINISH_TAG]]),empty()),(e:unknown)=>e instanceof DecodeError&&e.code==='E_FORMAT');
    assert.throws(()=>renderTagModel({},new Map([[10,Tags.int(null,1)]]),empty(),{maxNodes:3}),isLimit);
    const invalid=new Tag(TagType.STRUCT,null,[FINISH_TAG,Tags.int(null,2),FINISH_TAG]);assert.throws(()=>renderTagModel({},new Map(),invalid));
  });
  it('enforces complete output size and cumulative collection/depth/node limits after patching',()=>{
    const fields=new Map([[0,Tags.string(null,'12345678')],[1,Tags.string(null,'abcdefgh')]]);
    assert.throws(()=>renderTagModel({},fields,Tags.struct(null,[]),{maxInflatedBytes:20}),isLimit);
    assert.throws(()=>renderTagModel({},new Map([[4,Tags.int(null,2)]]),Tags.struct(null,[]),{maxListLength:3}),isLimit);
    assert.throws(()=>renderTagModel({},new Map([[0,Tags.struct(null,[Tags.int(null,2)])]]),Tags.struct(null,[]),{maxDepth:1}),isLimit);
    const data=new RawElement(3,Buffer.from([0,0,0,1,0,0,0,0,0,0,0,1]));
    const serial=new Tag(TagType.SERIALIZABLE,null,data);
    assert.throws(()=>renderTagModel({},new Map([[0,serial],[1,serial]]),Tags.struct(null,[]),{maxNodes:5}),isLimit);
  });
});
