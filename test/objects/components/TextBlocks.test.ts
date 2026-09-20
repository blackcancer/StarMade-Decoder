/** @fileoverview Text-map schema, opaque entry retention, detached snapshots and bounded edits. */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { readFrom,writeTo } from '../../../src/core/TagParser.js';
import { DecodeError } from '../../../src/core/DecodeError.js';
import { registerAllFactories } from '../../../src/serializable/Factories.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
registerAllFactories();
const same=(a:Tag,b:Tag)=>assert.deepEqual(writeTo(a),writeTo(b));
const isLimit=(e:unknown)=>e instanceof DecodeError&&e.code==='E_LIMIT';
function row(key=1n,text='stored\0text'):Tag{return Tags.struct('entry',[Tags.long('position',key),Tags.string('text',text),Tags.byteArray('extension',Buffer.from([0,255,7]))]);}
function root():Tag{return Tags.struct('text-map',[row(),row(-1n,'negative')]);}
describe('TextBlocks faithful collection',()=>{
  it('retains exact entry names/extensions and unrelated records through edits and reverts',()=>{
    const tag=root(),model=TextBlocks.fromTag(tag);same(model.toTag(),tag);assert.equal(model.size,2);assert.equal(model.get(1n),'stored\0text');assert.ok(model.has(-1n));assert.equal(model.get(55n),undefined);
    const edit=model.set(1n,'edited');assert.equal(edit.get(1n),'edited');assert.equal(edit.toTag().name,'text-map');assert.equal(edit.toTag().getStruct()[0].getStruct()[1].name,'text');
    same(edit.toTag().getStruct()[0].getStruct()[2],tag.getStruct()[0].getStruct()[2]);same(edit.toTag().getStruct()[1],tag.getStruct()[1]);same(edit.set(1n,'stored\0text').toTag(),tag);
    const add=model.set(3n,'added');assert.equal(add.size,3);assert.equal(model.size,2);assert.equal(add.get(3n),'added');same(add.delete(3n).toTag(),tag);same(model.delete(99n).toTag(),tag);
    assert.equal(model.delete(1n).size,1);assert.equal(model.delete(1n).get(-1n),'negative');assert.equal(model.toString(),'TextBlocks(2 entries)');assert.equal(TextBlocks.EMPTY.size,0);
  });
  it('isolates maps, Tag payloads, decoded positions and JSON output',()=>{
    const tag=root(),expected=writeTo(tag),model=TextBlocks.fromTag(tag);tag.getStruct()[0].getStruct()[2].getByteArray()[0]=4;
    (model.entries() as Map<bigint,string>).set(1n,'mutated');model.toTag().getStruct()[0].getStruct()[2].getByteArray()[0]=5;
    const positions=model.positions();assert.deepEqual(positions[1],{pos:-1n,block:{x:-1,y:-1,z:-1},text:'negative'});positions[0].block.x=100;positions[0].text='changed';
    const json=model.toJSON();assert.deepEqual(json,[{position:'1',text:'stored\0text'},{position:'-1',text:'negative'}]);json[0].text='changed';
    assert.deepEqual(writeTo(model.toTag()),expected);assert.equal(model.positions()[0].block.x,1);assert.ok(Object.isFrozen(model));
  });
  it('rejects malformed and duplicate records instead of silently discarding them',()=>{
    for(const tag of [Tags.byte(null,0),Tags.struct(null,[Tags.byte(null,0)]),Tags.struct(null,[Tags.struct(null,[])]),Tags.struct(null,[Tags.struct(null,[Tags.int(null,1),Tags.string(null,'a')])]),Tags.struct(null,[Tags.struct(null,[Tags.long(null,1n)])]),Tags.struct(null,[Tags.struct(null,[Tags.long(null,1n),Tags.int(null,1)])]),Tags.struct(null,[row(),row()])])assert.throws(()=>TextBlocks.fromTag(tag));
    for(const key of [1,1.5,'1',1n<<63n,-(1n<<63n)-1n])assert.throws(()=>TextBlocks.EMPTY.set(key as bigint,'text'));
    assert.throws(()=>TextBlocks.EMPTY.set(1n,1 as any));assert.throws(()=>TextBlocks.EMPTY.set(1n,'x'.repeat(65536)));
    assert.equal(TextBlocks.EMPTY.set(-(1n<<63n),'minimum').set((1n<<63n)-1n,'maximum').size,2);
  });
  it('retains configured depth and cumulative byte/node limits through revisions',()=>{
    let deep=Tags.byteArray('last',Buffer.from([1]));for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);const tag=Tags.struct('deep-map',[Tags.struct('entry',[Tags.long(null,1n),Tags.string(null,'old'),deep])]);
    assert.throws(()=>TextBlocks.fromTag(tag),isLimit);const options={maxDepth:100,maxNodes:200,maxInflatedBytes:400};const model=TextBlocks.fromTag(tag,options);options.maxDepth=0;
    assert.deepEqual(writeTo(model.set(1n,'new').set(1n,'old').toTag(),{maxDepth:100}),writeTo(tag,{maxDepth:100}));
    const small=TextBlocks.fromTag(Tags.struct(null,[Tags.struct(null,[Tags.long(null,1n),Tags.string(null,'x')])]),{maxNodes:6});assert.throws(()=>small.set(2n,'y'),isLimit);assert.equal(small.set(1n,'z').get(1n),'z');
    const byteBound=TextBlocks.fromTag(root(),{maxInflatedBytes:writeTo(root()).length});assert.throws(()=>byteBound.set(1n,'y'.repeat(100)),isLimit);
  });
  it('round-trips text collections from the actual saved entity corpus',()=>{
    const entity=readFrom(fs.readFileSync('samples/ENTITY_SHIP_Traders Homerl110.ent'));
    const tag=entity.getStruct()[7].getStruct()[6],model=TextBlocks.fromTag(tag);
    same(model.toTag(),tag);
    const edited=model.set(123456789n,'New text');assert.equal(edited.get(123456789n),'New text');same(edited.delete(123456789n).toTag(),tag);
  });
});
