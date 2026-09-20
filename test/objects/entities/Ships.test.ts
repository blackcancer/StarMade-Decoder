/** @fileoverview Faithful direct and wrapped entity files, immutable revisions and retained parser limits. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Tags } from '../../../src/core/TagBuilder.js';
import { TagType } from '../../../src/core/TagType.js';
import { writeTo, readTagDocument } from '../../../src/core/TagParser.js';
import { registerAllFactories } from '../../../src/serializable/Factories.js';
import { Ship, SpaceStation, ShopSpaceStation, FloatingRock, parseSegmentControllerEntity } from '../../../src/objects/entities/Ships.js';
import { SegmentControllerObject } from '../../../src/objects/SegmentController.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
import { NpcDataState, CoreTimerState } from '../../../src/objects/EntitySlotObjects.js';
registerAllFactories();
const original=fs.readFileSync('samples/ENTITY_SHIP_Traders Homerl110.ent');
const direct=()=>Ship.fromBuffer(original).toTag();

describe('Ships V2 source contracts',()=>{
  it('preserves compression, versions, wrapper siblings and exact edit/revert for all controller classes',()=>{
    for(const Ctor of [Ship,SpaceStation,ShopSpaceStation,FloatingRock])for(const wrapper of [false,true]){
      const record=direct(),root=wrapper?Tags.struct('outer',[Tags.byte('version',1),record,Tags.string('extension','keep')]):record;
      root.getStruct().splice(-1,0,Tags.byteArray('future',[1,0,255]));
      const plain=writeTo(root);plain.writeInt16BE(9);
      for(const bytes of [Buffer.concat([plain,Buffer.from([5,255])]),gzipSync(Buffer.concat([plain.subarray(2),Buffer.from([5,255])]))]){
        const model=Ctor.fromBuffer(bytes),before=model.realName,changed=model.withRealName('changed').withMass(model.mass+1);
        assert.deepEqual(model.toBuffer(),bytes);assert.equal(changed.realName,'changed');
        const document=readTagDocument(changed.toBuffer());assert.deepEqual(document.trailingData,Buffer.from([5,255]));
        assert.equal(document.compressed,bytes[0]===0x1f);
        if(wrapper)assert.equal(changed.toTag().getStruct()[2].getString(),'keep');
        assert.equal(changed.getField('realName')!.value,'changed');
        changed.toTag().getStruct().splice(0,1);assert.equal(changed.realName,'changed');
        assert.deepEqual(changed.withRealName(before).withMass(model.mass).toBuffer(),bytes);
        assert.equal(Ctor.fromTag(changed.toTag()).realName,'changed');
      }
    }
  });
  it('retains opaque nested data and configured limits after scalar and typed edits',()=>{
    const root=direct();let extension=Tags.string('value','retained');for(let i=0;i<70;i++)extension=Tags.struct('deep',[extension]);
    root.getStruct().splice(-1,0,extension);const options={maxDepth:90},bytes=writeTo(root,options),model=Ship.fromBuffer(bytes,options);options.maxDepth=1;
    assert.throws(()=>Ship.fromBuffer(bytes),{code:'E_LIMIT'});assert.deepEqual(model.toBuffer(),bytes);
    assert.equal(Ship.fromBuffer(model.withRealName('deep ship').toBuffer(),{maxDepth:90}).realName,'deep ship');
    assert.throws(()=>Ship.fromBuffer(bytes,{maxDepth:90,maxInputBytes:bytes.length-1}),{code:'E_LIMIT'});
    const nested=direct();nested.getStruct()[14]=Tags.struct('npc-original',[extension]);const deep=Ship.fromTag(nested,{maxDepth:90});
    assert.equal(deep.npcData.toTag().name,'npc-original');
    const edited=deep.withNpcData(new NpcDataState(Tags.struct('replacement-name',[Tags.string(null,'changed')])));
    assert.equal(edited.toTag().getStruct()[14].name,'npc-original');
    assert.throws(()=>Ship.fromTag(direct(),{maxNodes:1}),{code:'E_LIMIT'});
    const sized=writeTo(direct()),bounded=Ship.fromBuffer(sized,{maxInflatedBytes:sized.length});
    assert.throws(()=>bounded.withRealName('x'.repeat(sized.length)),{code:'E_LIMIT'});
  });
  it('accepts historical optional suffixes but rejects corrupt present and mandatory fields',()=>{
    const minimal=Tags.struct('s3',direct().getStruct().slice(0,11));minimal.getStruct()[7]=Tags.byte('manager',0);
    const model=Ship.fromTag(minimal);
    assert.equal(model.seed,0n);assert.equal(model.nonEmptySegments,0);assert.equal(model.factionRights,-2);
    assert.equal(model.scrap,false);assert.equal(model.vulnerable,true);assert.equal(model.minable,true);
    assert.equal(model.currentOwner,'');assert.equal(model.lastDockerPlayer,'');assert.equal(model.lastEditBlocks,0n);assert.equal(model.lastDamageTaken,0n);assert.equal(model.tagVersion,0);
    assert.equal(model.hpState.hp,0n);assert.equal(model.textBlocks.size,0);assert.equal(model.managerContainer,null);
    for(const index of [0,1,2,3,5,6,8,9,10]){const invalid=direct();invalid.getStruct()[index]=Tags.byte(null,0);assert.throws(()=>Ship.fromTag(invalid),{code:'E_FORMAT'});}
    for(const index of [7,11,15,16,17,18,20,21,25,26,37,38,40]){const invalid=direct();invalid.getStruct()[index]=Tags.double(null,0);assert.throws(()=>Ship.fromTag(invalid),{code:'E_FORMAT'});}
    for(const invalid of [Tags.struct(null,[]),Tags.struct(null,[direct(),direct()]),Tags.byte(null,0)])assert.throws(()=>Ship.fromTag(invalid));
    const texts=direct();texts.getStruct()[15]=TextBlocks.EMPTY.set(1n,'legacy sign').toTag();const old=Ship.fromTag(texts);
    assert.equal(old.textBlocks.get(1n),'legacy sign');assert.equal(old.scrap,false);assert.throws(()=>old.withScrap(true),{code:'E_FORMAT'});
    assert.equal(SegmentControllerObject.fromTag(texts).scrap,false);
    assert.equal(SegmentControllerObject.fromTag(minimal).controlElementMapper!.links.length,model.controlElementMap.links.length);
    assert.equal(SegmentControllerObject.fromTag(Tags.struct(null,[Tags.string('uniqueId','id')])).controlElementMapper,null);
    assert.throws(()=>model.withCoreTimer(new CoreTimerState()),{code:'E_INCOMPLETE'});
  });
  it('rejects invalid edits and retains the original noncanonical boolean byte after a revert',()=>{
    const root=direct();root.getStruct()[15]=Tags.byte('scrap',7);root.getStruct()[16]=Tags.byte('vulnerable',9);root.getStruct()[17]=Tags.byte('minable',3);
    const bytes=writeTo(root),model=Ship.fromBuffer(bytes);
    assert.deepEqual(model.withScrap(false).withScrap(true).withVulnerable(false).withVulnerable(true).withMinable(false).withMinable(true).toBuffer(),bytes);
    const wrapped=Ship.fromTag(Tags.struct('wrapper',[root]));assert.equal(wrapped.withScrap(false).withScrap(true).toTag().getStruct()[0].getStruct()[15].getByte(),7);
    for(const value of [2,'false',null])assert.throws(()=>model.withScrap(value as any),{code:'E_RANGE'});
    for(const value of [-129,128,.5]){assert.throws(()=>model.withFactionRights(value),{code:'E_RANGE'});assert.throws(()=>model.withTagVersion(value),{code:'E_RANGE'});}
    assert.throws(()=>model.withBounds({minX:.5,minY:0,minZ:0,maxX:1,maxY:1,maxZ:1}));
    assert.equal(parseSegmentControllerEntity(root,'unclassified.ent').entityType,'SHIP');
    assert.ok(parseSegmentControllerEntity(root,'ENTITY_ASTEROID_example.ent') instanceof FloatingRock);
    assert.ok(parseSegmentControllerEntity(root,'ENTITY_FLOATINGROCK_example.ent') instanceof FloatingRock);
    const view=SegmentControllerObject.fromTag(root);assert.equal(view.scrap,true);assert.equal(view.vulnerable,true);assert.equal(view.minable,true);
    assert.equal((view.toJSON() as any).currentOwner,view.currentOwner);
  });
});
