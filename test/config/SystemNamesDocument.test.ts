/** @fileoverview Syllable edits and exact unmodified text retention. */
import { assert } from 'chai';
import { SystemNamesDocument } from '../../src/config/SystemNamesDocument.js';

describe('Format models: SystemNamesDocument', () => {
  it('preserves comments/line endings, edits tokens and isolates input/output arrays', () => {
    const raw = '# names\r\nfoo +c\r\nbar\r\n', doc = SystemNamesDocument.fromBuffer(raw);
    assert.equal(doc.toBuffer().toString(), raw); assert.deepEqual(doc.withFlag('+c'), [{value:'foo',flags:['+c']}]);
    const data = doc.syllables; data[0].flags.push('+x'); assert.lengthOf(doc.syllables[0].flags,1);
    const updated = doc.set(0,{value:'new',flags:[]}); assert.equal(updated.syllables[0].value,'new');
    assert.equal(updated.set(0,doc.syllables[0]).toBuffer().toString(),raw);
    assert.lengthOf(updated.set(2,{value:'third',flags:[]}).remove(0).syllables,2);
    assert.deepEqual(SystemNamesDocument.fromBuffer(updated.toBuffer()).toJSON(),updated.toJSON());
    const input=[{value:'new',flags:['+c']}], fresh = new SystemNamesDocument(input); input[0].flags.push('+d');
    assert.deepEqual(fresh.withFlag('+d'),[]); assert.equal(new SystemNamesDocument().toBuffer().length,0);
    assert.lengthOf(new SystemNamesDocument().set(0,{value:'x',flags:[]}).syllables,1);
  });
  it('rejects unrepresentable tokens, invalid indices and explicit limits', () => {
    for (const value of ['', 'a b', '#comment', null]) assert.throws(() => new SystemNamesDocument([{value:value as string,flags:[]} ]));
    assert.throws(() => new SystemNamesDocument([{value:'x',flags:['bad flag']}]));
    assert.throws(() => new SystemNamesDocument([{value:'x',flags:[]}],{maxEntries:0}));
    assert.throws(() => new SystemNamesDocument([{value:'long',flags:[]}],{maxBytes:1}));
    assert.throws(() => new SystemNamesDocument().remove(0));
    assert.throws(() => new SystemNamesDocument().set(1,{value:'x',flags:[]}));
    assert.throws(() => new SystemNamesDocument([],{maxEntries:-1}));
    assert.throws(() => SystemNamesDocument.fromBuffer(Buffer.from([255])));
  });
});
