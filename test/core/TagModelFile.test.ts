/** @fileoverview Model file envelopes, exact reverts, local budgets and validated positional edits. */
import { strict as assert } from 'node:assert';
import { gzipSync,gunzipSync } from 'node:zlib';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { writeTo,readTagDocument } from '../../src/core/TagParser.js';
import { DecodeError } from '../../src/core/DecodeError.js';
import { TagModelFile,replaceTagField } from '../../src/core/TagModelFile.js';
const root=()=>Tags.struct('root',[Tags.int('number',9),Tags.byte('flag',7),Tags.byteArray('opaque',Buffer.from([0,255,3]))]);
const same=(a:Tag,b:Tag)=>assert.deepEqual(writeTo(a),writeTo(b));
const isLimit=(error:unknown)=>error instanceof DecodeError&&error.code==='E_LIMIT';
describe('TagModelFile source envelopes',()=>{
  it('detaches constructor inputs, tree getters and returned file bytes',()=>{
    const tag=root(),options={maxDepth:10},file=new TagModelFile(tag,options),before=writeTo(tag);options.maxDepth=0;
    tag.getStruct()[2].getByteArray()[0]=9;file.root.getStruct()[2].getByteArray()[0]=8;file.originalRoot.getStruct()[2].getByteArray()[0]=7;
    const bytes=file.toBuffer();bytes.fill(0);assert.deepEqual(file.toBuffer(),before);assert.equal(file.options.maxDepth,10);assert.ok(Object.isFrozen(file));assert.ok(Object.isFrozen(file.options));
    const update=replaceTagField(file.root,0,Tags.int('ignored-name',10));const edited=file.withRoot(update);update.getStruct()[2].getByteArray()[1]=4;
    assert.equal(edited.root.getStruct()[0].getInt(),10);assert.equal(edited.root.getStruct()[0].name,'number');same(edited.originalRoot,root());
    assert.deepEqual(edited.withRoot(edited.originalRoot).toBuffer(),before);assert.deepEqual(file.toBuffer(),before);
  });
  it('preserves gzip metadata, uncompressed versions and trailing bytes across edits and reverts',()=>{
    for(const compressed of [false,true]) {
      const bytes=writeTo(root()),trailing=Buffer.from([0,255,18,73]);bytes.writeInt16BE(-217);
      const input=compressed?gzipSync(Buffer.concat([bytes.subarray(2),trailing]),{level:9}):Buffer.concat([bytes,trailing]);
      if(compressed)input.writeUInt32LE(123456,4);
      const original=Buffer.from(input),file=TagModelFile.fromBuffer(new Uint8Array(input));input.fill(0);assert.deepEqual(file.toBuffer(),original);
      const edited=file.withRoot(replaceTagField(file.root,0,Tags.int(null,10))),out=edited.toBuffer(),doc=readTagDocument(out);
      assert.equal(doc.compressed,compressed);assert.equal(doc.root.getStruct()[0].getInt(),10);assert.deepEqual(doc.trailingData,trailing);
      if(!compressed)assert.equal(doc.version,-217);else assert.deepEqual(gunzipSync(out).subarray(-4),trailing);
      assert.deepEqual(edited.withRoot(edited.originalRoot).toBuffer(),original);
    }
  });
  it('charges file input budgets once and supports exact compressed output ceilings',()=>{
    const tag=Tags.int(null,4),payload=writeTo(tag).subarray(2),input=gzipSync(payload),nodes={remainingNodes:1},inflation={remainingBytes:payload.length};
    const file=TagModelFile.fromBuffer(input,{maxInflatedBytes:payload.length,maxInputBytes:input.length,sharedNodeBudget:nodes,sharedInflationBudget:inflation});
    assert.equal(nodes.remainingNodes,0);assert.equal(inflation.remainingBytes,0);assert.equal(file.options.maxInflatedBytes,payload.length+2);
    same(file.root,tag);same(file.originalRoot,tag);assert.deepEqual(file.toBuffer(),input);assert.equal(file.withRoot(Tags.int(null,5)).root.getInt(),5);
    assert.equal(nodes.remainingNodes,0);assert.equal(inflation.remainingBytes,0);
    assert.throws(()=>file.withRoot(Tags.string(null,'longer')),isLimit);
    assert.throws(()=>TagModelFile.fromBuffer(input,{maxInputBytes:input.length-1}),isLimit);
    const uncompressed=TagModelFile.fromBuffer(writeTo(tag),{maxInflatedBytes:writeTo(tag).length});assert.equal(uncompressed.options.maxInflatedBytes,7);
    assert.deepEqual(TagModelFile.fromBuffer(input).toBuffer(),input);
  });
  it('enforces complete-tree limits after edits and retains deliberately elevated options',()=>{
    let deep=Tags.string(null,'leaf');for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);const tag=Tags.struct('root',[deep]);
    assert.throws(()=>new TagModelFile(tag),isLimit);const file=new TagModelFile(tag,{maxDepth:100,maxNodes:200,maxInflatedBytes:400});
    const edited=file.withRoot(Tags.struct('root',[...file.root.getStruct().slice(0,-1),Tags.int(null,1)]));assert.equal(edited.root.getStruct()[1].getInt(),1);
    same(new TagModelFile(root(),{maxNodes:5}).root,root());
    const limited=new TagModelFile(root(),{maxNodes:5});assert.throws(()=>limited.withRoot(Tags.struct(null,[...root().getStruct().slice(0,-1),Tags.int(null,2)])),isLimit);
  });
  it('validates explicit source envelopes and independently supplied original bytes',()=>{
    const bytes=writeTo(root()),doc=readTagDocument(bytes),file=new TagModelFile(root(),{},doc,bytes);bytes.fill(0);same(file.originalRoot,root());
    const limited=readTagDocument(writeTo(Tags.int(null,1)),{maxInflatedBytes:7});assert.throws(()=>new TagModelFile(Tags.string(null,'large'),{},limited),isLimit);
  });
});
describe('replaceTagField positional validation',()=>{
  it('preserves field names and permits only declared historical type alternatives',()=>{
    const tag=root(),edit=replaceTagField(tag,0,Tags.long('new',10n),[TagType.INT,TagType.LONG]);assert.equal(edit.getStruct()[0].getLong(),10n);assert.equal(edit.getStruct()[0].name,'number');
    assert.equal(tag.getStruct()[0].getInt(),9);assert.equal(edit.name,'root');
    for(const index of [-1,50])assert.throws(()=>replaceTagField(tag,index,Tags.int(null,1)),(error:unknown)=>error instanceof DecodeError&&error.code==='E_FORMAT');
    assert.throws(()=>replaceTagField(tag,0,Tags.string(null,'wrong')));assert.throws(()=>replaceTagField(Tags.int(null,1),0,Tags.int(null,2)));
    // This low-level transformation deliberately accepts detached mutable Tag values;
    // publishing a model revision requires withRoot, which validates and snapshots them.
    const value=Tags.byteArray(null,Buffer.from([1,2])),file=new TagModelFile(tag).withRoot(replaceTagField(tag,2,value));value.getByteArray()[0]=9;assert.equal(file.root.getStruct()[2].getByteArray()[0],1);
  });
});
