/** @fileoverview Explicit SMBMM modes and resource limits reject ambiguous legacy data. */
import assert from 'node:assert/strict';
import { parseSmbmm } from '../../src/smd3/SmbmmParser.js';
describe('SmbmmParser validated options',()=>{
  it('rejects unknown modes and oversized legacy collections before allocating mappings',()=>{
    assert.throws(()=>parseSmbmm(Buffer.alloc(0),{mode:'future' as any}),{code:'E_RANGE'});
    assert.throws(()=>parseSmbmm(Buffer.alloc(16),{legacyInt32Pairs:true,maxEntries:1}),{code:'E_LIMIT'});
  });
});
