/** @fileoverview Legacy SMBMM output must be explicitly selected and fit caller limits. */
import assert from 'node:assert/strict';
import { writeSmbmm } from '../../src/smd3/SmbmmWriter.js';
import { parseSmbmm, type SmbmmFile } from '../../src/smd3/SmbmmParser.js';
describe('SmbmmWriter bounded legacy output',()=>{
  it('rejects oversized output and fractional identifiers without lossy conversion',()=>{
    const file:SmbmmFile={raw:new Uint8Array(),isEmpty:false,format:'int32Pairs',mappings:[{from:-2147483648,to:2147483647}]};
    assert.throws(()=>writeSmbmm(file,{maxBytes:7}),{code:'E_LIMIT'});
    assert.deepEqual(parseSmbmm(writeSmbmm(file,{maxBytes:8}),{legacyInt32Pairs:true}).mappings,file.mappings);
    for(const mapping of [{from:.5,to:1},{from:1,to:.5}]) assert.throws(()=>writeSmbmm({...file,mappings:[mapping]}),{code:'E_RANGE'});
  });
});
