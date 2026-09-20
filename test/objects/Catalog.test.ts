/** @fileoverview Actual catalog permissions/ratings, bounded snapshots and non-lossy edits. */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { Catalog,CatalogEntry } from '../../src/objects/Catalog.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo,readFrom,readTagDocument } from '../../src/core/TagParser.js';
import { TagType } from '../../src/core/TagType.js';
import { parseCatalog } from '../../src/entity/Catalog.js';

/** A real minimal entry with explicit permission flags and an opaque wave. */
function entry(uid='Ship'):CatalogEntry { return new CatalogEntry(uid,'Owner',100n,'description',1.5,'SHIP',0n,12,0,5,[Tags.struct('wave',[Tags.int('future',7)])]); }

describe('Catalog V2 contracts',()=>{
  it('reads actual INT flags/spawn count and keeps source names, variants, waves and root extensions',()=>{
    const tag=entry().toTag(),p=tag.getStruct();p[3]=Tags.int('price',100);p[0]=Tags.string('uid','Ship');p.splice(p.length-1,0,Tags.string('unknown','001'));
    const vote=Tags.struct('vote',[Tags.string('user','Alice'),Tags.byte('rating',3),Tags.long('extra',999n)]);
    const root=Tags.struct('cv0',[Tags.struct('extension',[Tags.int('value',9)]),Tags.struct('pv0',[tag]),Tags.struct('r0',[Tags.struct('Ship',[vote])])]);
    const bytes=writeTo(root),model=Catalog.fromBuffer(bytes);
    assert.deepEqual(model.toBuffer(),bytes);assert.equal(model.find('Ship')!.permission,5);assert.equal(model.find('Ship')!.timesSpawned,12);
    const edited=model.updateEntry('Ship',model.find('Ship')!.with({price:999n}));
    const after=readFrom(edited.toBuffer()).getStruct();assert.deepEqual(writeTo(after[0]),writeTo(root.getStruct()[0]));
    assert.deepEqual(writeTo(after[2]),writeTo(root.getStruct()[2]));
    const result=Catalog.fromTag(readFrom(edited.toBuffer()));assert.equal(result.find('Ship')!.price,999n);assert.equal(result.find('Ship')!.permission,5);
    assert.deepEqual(result.find('Ship')!.wavePermissions.map(writeTo),entry().wavePermissions.map(writeTo));
    assert.deepEqual(edited.updateEntry('Ship',model.find('Ship')!).toBuffer(),bytes);
    const rated=model.withRating('Ship','Alice',4),r=readFrom(rated.toBuffer()).getStruct()[2].getStruct()[0].getStruct()[0];
    assert.equal(r.name,'vote');assert.equal(r.getStruct()[1].name,'rating');assert.equal(r.getStruct()[2].getLong(),999n);
    assert.equal(rated.withRating('Other','Bob',1).ratings.get('Other')!.get('Bob'),1);
    const compressed=gzipSync(bytes.subarray(2));assert.deepEqual(Catalog.fromBuffer(compressed).toBuffer(),compressed);
    const detached=model.ratings as Map<string,Map<string,number>>;detached.get('Ship')!.set('Alice',99);assert.equal(model.ratings.get('Ship')!.get('Alice'),3);
    const json=JSON.parse(JSON.stringify(model));assert.equal(json.entries[0].price,'100');assert.equal(json.ratings.Ship.Alice,3);
    const plain=parseCatalog(root);assert.equal(plain.totalCount,1);assert.equal(plain.entries[0].permission,5);assert.equal(plain.ratings.Ship.Alice,3);
  });
  it('creates, updates and validates entries and collections without silent substitution',()=>{
    const a=entry('A'),b=entry('B'),doc=new Catalog([a]);
    assert.deepEqual(doc.byOwner('OWNER'),[a]);assert.deepEqual(doc.byType('UNKNOWN'),[]);assert.isUndefined(doc.find('missing'));
    assert.equal(doc.addEntry(b).removeEntry('A').all[0].uid,'B');assert.include(doc.toString(),'1 entries');
    assert.equal(a.with({blueprintType:'UNKNOWN(127)'}).toTag().getStruct()[8].getInt(),127);
    assert.equal(CatalogEntry.fromTag(a.with({blueprintType:'UNKNOWN(127)'}).toTag()).blueprintType,'UNKNOWN(127)');
    const sparse=Tags.struct(null,a.toTag().getStruct().slice(0,7));assert.equal(CatalogEntry.fromTag(sparse).mass,0);assert.equal(CatalogEntry.fromTag(sparse).classification,0);
    assert.equal(a.timeSpawned,12n);assert.equal(Catalog.fromTag(doc.toTag()).entries.length,1);
    assert.equal(new Catalog().entries.length,0);assert.equal(new Catalog().toJSON().entries.length,0);
    const waves=a.wavePermissions;waves[0].getStruct()[0]=Tags.int('future',99);assert.equal(a.wavePermissions[0].getStruct()[0].getInt(),7);
    for(const changes of [{blueprintType:'bad'},{permission:2**31},{timesSpawned:2**31},{price:2n**63n},{mass:NaN},{mass:1e99},{classification:999}]) assert.throws(()=>a.with(changes));
    assert.throws(()=>new Catalog([a,a]));assert.throws(()=>new Catalog([a],[] as any));assert.throws(()=>doc.updateEntry('missing',b));
    assert.throws(()=>new Catalog([a],new Map(),{maxEntries:0}));assert.throws(()=>new Catalog([],new Map([['A',new Map([['User',128]])]])));
    assert.throws(()=>new Catalog([],new Map([['A',new Map([['User',1]])]]),{maxEntries:1}));
    assert.throws(()=>CatalogEntry.fromTag(Tags.struct(null,[])));assert.throws(()=>Catalog.fromTag(Tags.struct('cv0',[])));
    const bad=doc.toTag();bad.getStruct()[1]=Tags.struct('r0',[Tags.struct(null,[])]);assert.throws(()=>Catalog.fromTag(bad));
    bad.getStruct()[1]=Tags.struct('r0',[Tags.struct('A',[]),Tags.struct('A',[])]);assert.throws(()=>Catalog.fromTag(bad));
    bad.getStruct()[1]=Tags.struct('r0',[Tags.struct('A',[Tags.struct(null,[Tags.int(null,1)])])]);assert.throws(()=>Catalog.fromTag(bad));
    bad.getStruct()[1]=Tags.struct('r0',[Tags.struct('A',[Tags.struct(null,[Tags.string(null,'u'),Tags.byte(null,1)]),Tags.struct(null,[Tags.string(null,'u'),Tags.byte(null,2)])])]);assert.throws(()=>Catalog.fromTag(bad));
    assert.throws(()=>Catalog.fromBuffer(doc.toBuffer(),{maxBytes:1}));assert.throws(()=>Catalog.fromBuffer(doc.toBuffer(),{maxNodes:1}));
  });
  it('rejects wrong optional field types and scalar coercions while retaining real sparse variants',()=>{
    for (const index of [8,9,10]) {
      const tag=entry().toTag(); tag.getStruct()[index]=Tags.string('corrupt','wrong');
      assert.throws(()=>CatalogEntry.fromTag(tag),/Invalid optional catalog field/);
    }
    for (const changes of [{price:123},{dateCreated:123},{timesSpawned:'12'},{timesSpawned:true}]) assert.throws(()=>entry().with(changes as any));
    for (const count of [12n,-2147483648n,2147483647n]) assert.equal(new CatalogEntry('a','b',0n,'',0,'SHIP',0n,count,0).timesSpawned,Number(count));
    const source=entry().toTag(); source.getStruct()[7]=Tags.byte('old-mass-placeholder',0);
    const value=CatalogEntry.fromTag(source); assert.equal(value.mass,0); assert.deepEqual(writeTo(value.with({}).toTag()),writeTo(source));
  });
  it('applies byte ceilings to the actual compressed file and preserves its envelope on bounded edits',()=>{
    const root=new Catalog([entry().with({description:'x'.repeat(2000)})]).toTag(), plain=writeTo(root), body=plain.subarray(2), bytes=gzipSync(body);
    const value=Catalog.fromBuffer(bytes,{maxBytes:bytes.length,maxInflatedBytes:body.length});
    assert.deepEqual(value.toBuffer(),bytes);
    const renamed=value.updateEntry('Ship',value.find('Ship')!.with({ownerUID:'Other'}));
    assert.isAtMost(renamed.toBuffer().length,bytes.length);
    assert.deepEqual(renamed.updateEntry('Ship',renamed.find('Ship')!.with({ownerUID:'Owner'})).toBuffer(),bytes);
    assert.throws(()=>value.addEntry(entry('Other')));
    assert.throws(()=>Catalog.fromBuffer(bytes,{maxBytes:bytes.length-1}));
    assert.throws(()=>Catalog.fromBuffer(bytes,{maxInflatedBytes:body.length-1}));
  });
  it('preserves neighboring entries and snapshots every caller-owned collection and Tag',()=>{
    const a=entry('A'),b=entry('B'),items=[a,b],votes=new Map([['A',new Map([['Alice',1]])]]),value=new Catalog(items,votes);
    items.length=0;votes.get('A')!.set('Alice',9);value.entries.length=0;
    assert.deepEqual(value.entries,[a,b]);assert.equal(value.ratings.get('A')!.get('Alice'),1);
    assert.equal(value.updateEntry('A',a.with({description:'changed'})).entries[1],b);
    assert.throws(()=>value.updateEntry('A',b));assert.throws(()=>{(a as any).uid='other';});
    const source=value.toTag(), parsed=Catalog.fromTag(source), before=parsed.toBuffer();
    source.getStruct().length=0;parsed.toTag().getStruct().length=0;parsed.toBuffer().fill(0);
    assert.deepEqual(parsed.toBuffer(),before);
    const changed=parsed.withRating('A','Alice',2);changed.toTag().getStruct()[1].getStruct().length=0;
    assert.equal(changed.ratings.get('A')!.get('Alice'),2);assert.deepEqual(changed.withRating('A','Alice',1).toBuffer(),before);
  });

  it('keeps deep extensions, waveform snapshots and caller limits through edit/revert and gzip trailers',()=>{
    let deep=Tags.string('leaf','retained');for(let i=0;i<70;i++) deep=Tags.struct('nested',[deep]);
    const wave=Tags.struct('wave',[deep]), options={maxDepth:100}, fields={...entry(),wavePermissions:[wave]};
    const value=CatalogEntry.create(fields,options); options.maxDepth=1;wave.getStruct().length=0;
    assert.equal(value.wavePermissions[0].getStruct()[0].name,'nested');
    const entryTag=value.toTag();entryTag.getStruct().splice(entryTag.getStruct().length-1,0,deep);
    const source=Tags.struct('original-catalog',[Tags.struct('r0',[]),deep,Tags.struct('pv0',[entryTag])]);
    const plain=writeTo(source,{maxDepth:100});plain.writeInt16BE(17);const trailer=Buffer.from([255,7,9]);
    for(const bytes of [Buffer.concat([plain,trailer]),gzipSync(Buffer.concat([plain.subarray(2),trailer]))]) {
      const limits={maxDepth:100,sharedNodeBudget:{remainingNodes:10000},sharedInflationBudget:{remainingBytes:100000}};
      const model=Catalog.fromBuffer(bytes,limits), nodes=limits.sharedNodeBudget.remainingNodes, inflation=limits.sharedInflationBudget.remainingBytes;
      limits.maxDepth=1;const changed=model.updateEntry('Ship',model.find('Ship')!.with({description:'changed'}));
      const document=readTagDocument(changed.toBuffer(),{maxDepth:100});assert.deepEqual(document.trailingData,trailer);
      assert.deepEqual(writeTo(document.root.getStruct()[1],{maxDepth:100}),writeTo(deep,{maxDepth:100}));
      assert.deepEqual(changed.updateEntry('Ship',changed.find('Ship')!.with({description:'description'})).toBuffer(),bytes);
      assert.equal(limits.sharedNodeBudget.remainingNodes,nodes);assert.equal(limits.sharedInflationBudget.remainingBytes,inflation);
    }
    assert.throws(()=>Catalog.fromTag(source));
    const limited=CatalogEntry.fromTag(entry().toTag(),{maxInflatedBytes:writeTo(entry().toTag()).length+10});
    assert.throws(()=>limited.with({description:'x'.repeat(1000)}));
    const changed=entry().with({wavePermissions:[Tags.struct('new-wave',[Tags.int('value',1)])]});
    changed.toTag().getStruct()[9].getStruct()[0].getStruct()[0]=Tags.int('value',999);
    assert.equal(changed.wavePermissions[0].getStruct()[0].getInt(),1);
  });

});
