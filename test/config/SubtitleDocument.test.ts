/** @fileoverview Source-order cue edits, overlap lookup and exact SBV envelope retention. */
import { assert } from 'chai';
import { SubtitleDocument } from '../../src/config/SubtitleDocument.js';

describe('Format models: SubtitleDocument', () => {
  const cue = {startMs:1000,endMs:2000,lines:['Text']};
  it('retains exact original bytes and supports immutable timeline operations', () => {
    const raw = '\ufeff00:00:01.0,00:00:02.00\r\nText\r\n', doc = SubtitleDocument.fromBuffer(raw);
    assert.equal(doc.toBuffer().toString(),raw); assert.deepEqual(doc.at(999),[]); assert.lengthOf(doc.at(1000),1); assert.deepEqual(doc.at(2000),[]);
    assert.equal(doc.shift(1).shift(-1).toBuffer().toString(),raw);
    assert.deepEqual(SubtitleDocument.fromBuffer(doc.shift(500).toBuffer()).cues,[{...cue,startMs:1500,endMs:2500}]);
    const overlap = doc.set(1,{...cue,startMs:500,lines:['Second']}); assert.deepEqual(overlap.at(1500).map(c=>c.lines[0]),['Text','Second']);
    assert.lengthOf(overlap.remove(0).cues,1); assert.equal(overlap.remove(1).toBuffer().toString(),raw);
    const projected=doc.toJSON().cues as any[]; projected[0].lines[0]='mutated'; assert.equal(doc.cues[0].lines[0],'Text');
    const lines=['Input'],created=new SubtitleDocument([{...cue,lines}]); lines[0]='changed'; assert.equal(created.cues[0].lines[0],'Input');
    assert.equal(new SubtitleDocument([cue]).set(0,{...cue,lines:['Other']}).cues[0].lines[0],'Other');
  });
  it('rejects invalid cue values and budget excess without mutating source state', () => {
    assert.throws(() => new SubtitleDocument([]));
    for (const invalid of [{...cue,startMs:-1},{...cue,endMs:0},{...cue,endMs:NaN},{...cue,lines:[]},{...cue,lines:[' ']},{...cue,lines:['a\nb']},{...cue,lines:[1 as any]}]) assert.throws(() => new SubtitleDocument([invalid]));
    assert.throws(() => new SubtitleDocument([cue],{maxEntries:0})); assert.throws(() => new SubtitleDocument([cue],{maxBytes:1}));
    const doc=new SubtitleDocument([cue]); assert.throws(() => doc.at(-1)); assert.throws(() => doc.shift(0.5)); assert.throws(() => doc.shift(-1001));
    assert.throws(() => doc.shift(Number.MAX_SAFE_INTEGER)); assert.throws(() => doc.remove(0)); assert.throws(() => doc.set(2,cue));
    assert.throws(() => SubtitleDocument.fromBuffer(Buffer.from([255]))); assert.deepEqual(doc.cues,[cue]);
  });
});
