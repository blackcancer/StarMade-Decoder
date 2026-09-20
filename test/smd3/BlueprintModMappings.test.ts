/** @fileoverview Actual namespaced SMBMM wire records and legacy zlib interoperability. */
import { assert } from 'chai';
import { deflateSync, inflateSync } from 'node:zlib';
import { BlueprintModMappings } from '../../src/smd3/BlueprintModMappings.js';
import { parseSmbmm } from '../../src/smd3/SmbmmParser.js';
import { writeSmbmm } from '../../src/smd3/SmbmmWriter.js';

describe('Format models: BlueprintModMappings', () => {
  const mapping={modName:'Example Mod',blockName:'Hull',id:2000};
  it('round-trips actual plain/compressed namespaced text, with indexed immutable edits', () => {
    for (const raw of [Buffer.from('Example Mod~Hull~+2000\r\n'),deflateSync('Example Mod~Hull~2000\n',{level:1})]) {
      const doc=BlueprintModMappings.fromBuffer(raw); assert.equal(doc.size,1); assert.deepEqual(doc.get(2000),mapping);
      assert.equal(doc.idOf('Example Mod','Hull'),2000); assert.isUndefined(doc.get(4)); assert.isUndefined(doc.idOf('X','Y'));
      assert.deepEqual(doc.toBuffer(),raw); assert.deepEqual(writeSmbmm(parseSmbmm(raw)),raw);
      const edited=doc.withMapping({...mapping,id:2001}); assert.equal(edited.idOf('Example Mod','Hull'),2001);
      assert.deepEqual(edited.withMapping(mapping).toBuffer(),raw);
      assert.deepEqual(doc.translationTo(edited),new Map([[2000,2001]]));
      assert.lengthOf(edited.withoutId(2001).mappings,0); assert.equal(edited.withoutId(9).size,1);
      const extra=doc.withMapping({modName:'X',blockName:'Y',id:-1}); assert.equal(extra.size,2);
      assert.throws(() => extra.translationTo(doc));
      const data=doc.toJSON(); data.mappings[0].id=5; assert.equal(doc.get(2000)!.id,2000);
      const file=parseSmbmm(raw); file.namespacedMappings![0].id=3000; assert.equal(parseSmbmm(writeSmbmm(file)).namespacedMappings![0].id,3000);
    }
    const fresh=new BlueprintModMappings([mapping]); assert.equal(fresh.withoutId(2000).toBuffer().length,0);
    assert.equal(new BlueprintModMappings().size,0); assert.equal(BlueprintModMappings.fromBuffer(Buffer.alloc(0)).size,0);
    assert.equal(inflateSync(new BlueprintModMappings([mapping],{compression:'zlib'}).toBuffer()).toString(),'Example Mod~Hull~2000\n');
    assert.equal(writeSmbmm({size:0,isEmpty:false,raw:new Uint8Array(),namespacedMappings:[mapping]}).toString(),'Example Mod~Hull~2000\n');
  });
  it('rejects corrupt records, ambiguous identities, invalid IDs and resource excesses', () => {
    for (const entry of [{...mapping,id:32768},{...mapping,id:-32769},{...mapping,id:1.5},{...mapping,modName:''},{...mapping,blockName:'a~b'},{...mapping,modName:1 as any}]) assert.throws(() => new BlueprintModMappings([entry]));
    assert.throws(() => new BlueprintModMappings([mapping,mapping]));
    assert.throws(() => new BlueprintModMappings([mapping,{...mapping,blockName:'Other'}]));
    assert.throws(() => new BlueprintModMappings([mapping,{...mapping,id:2001}]));
    assert.throws(() => new BlueprintModMappings([],{compression:'bad' as any}));
    assert.throws(() => new BlueprintModMappings([mapping],{maxEntries:0}));
    for (const raw of [Buffer.from('broken'),Buffer.from('A~B~NaN'),Buffer.from('A~B~99999999'),Buffer.from([255]),Buffer.from([0x78,0x9c,0])]) assert.throws(() => BlueprintModMappings.fromBuffer(raw));
    assert.throws(() => BlueprintModMappings.fromBuffer(Buffer.concat([deflateSync('A~B~1\n'),Buffer.from([0])])));
    assert.throws(() => BlueprintModMappings.fromBuffer(Buffer.from('A~B~1\n'),{maxEntries:0}));
    assert.throws(() => BlueprintModMappings.fromBuffer(Buffer.from('A~B~1\n'),{maxBytes:2}));
    assert.throws(() => BlueprintModMappings.fromBuffer(deflateSync('A~B~1\n'.repeat(1000)),{maxBytes:100}));
    assert.throws(() => new BlueprintModMappings([mapping],{maxBytes:1}).toBuffer());
    assert.throws(() => parseSmbmm(Buffer.from([255])));
    assert.equal(parseSmbmm(Buffer.from([255]),{mode:'preserve'}).format,'unknown');
    assert.throws(() => parseSmbmm(deflateSync('A~B~1\n'.repeat(1000)),{mode:'preserve',maxBytes:100}));
  });
});
