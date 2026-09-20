/** @fileoverview Bounded JSON edits preserve source bytes and unrelated persistent classes. */
import { assert } from 'chai';
import { PersistentObjectDocument } from '../../src/db/PersistentObjectDocument.js';

describe('Format models: PersistentObjectDocument', () => {
  it('retains exact source bytes, detached JSON, repeated classes and edit/revert', () => {
    const raw = Buffer.from(' Example\r\n {"id":1, "nested":[true,null,1.5,"x"]} \r\n_end_\r\nOther\r\n3\r\n_end_\r\n');
    const doc = PersistentObjectDocument.fromBuffer(raw); assert.deepEqual(doc.toBuffer(), raw);
    const objects = doc.objectsFor('Example') as any[]; objects[0].nested[0] = false;
    assert.isTrue((doc.objectsFor('Example')[0] as any).nested[0]);
    const edited = doc.withClass('Example', [{id: 9}]); assert.deepEqual(edited.objectsFor('Other'), [3]);
    assert.deepEqual(edited.withClass('Example', doc.objectsFor('Example')).toBuffer(), raw);
    assert.deepEqual(PersistentObjectDocument.fromBuffer(edited.toBuffer()).toJSON(), edited.toJSON());
    assert.lengthOf(doc.withoutClass('Example').entries, 1); assert.deepEqual(doc.withoutClass('missing').toBuffer(), raw);
    assert.deepEqual(new PersistentObjectDocument().withClass('A', [1]).objectsFor('A'), [1]);
    assert.equal(new PersistentObjectDocument().toBuffer().length, 0);
    assert.deepEqual(new PersistentObjectDocument([{className:'A',objects:[1]},{className:'A',objects:[2]}]).objectsFor('A'), [1,2]);
    raw.fill(0); assert.isTrue(doc.toBuffer().includes(Buffer.from('Example')));
  });
  it('rejects non-JSON values, invalid records, cycles and resource excess before unsafe copies', () => {
    const build = (value: unknown) => new PersistentObjectDocument([{className:'A',objects:[value]}]);
    for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER+1, undefined, 1n, () => 1, new Date(), Symbol('x'), [,1]]) assert.throws(() => build(value));
    const extended: any[] = [1]; (extended as any).extra = 2; assert.throws(() => build(extended));
    const cycle: any = {}; cycle.self = cycle; assert.throws(() => build(cycle));
    assert.deepEqual(build(Object.create(null)).objectsFor('A'), [{}]);
    for (const className of ['', ' A', 'A ', 'A\nB', '_end_']) assert.throws(() => new PersistentObjectDocument([{className,objects:[]}]));
    assert.throws(() => new PersistentObjectDocument([{className:'A',objects:{} as any}]));
    const data = [{className:'A',objects:[{x:[1]}]}];
    for (const options of [{maxEntries:0},{maxBytes:0},{maxNodes:0},{maxDepth:0},{maxDepth:257},{maxNodes:1},{maxNodes:2}]) assert.throws(() => new PersistentObjectDocument(data,options));
    assert.throws(() => PersistentObjectDocument.fromBuffer(Buffer.from([255])));
    assert.throws(() => PersistentObjectDocument.fromBuffer('A\n{}\n_end_', {maxBytes:1}));
    assert.throws(() => PersistentObjectDocument.fromBuffer('A\n{bad}\n_end_'));
    assert.throws(() => PersistentObjectDocument.fromBuffer('A\n{}'));
    assert.throws(() => new PersistentObjectDocument([{className:'A',objects:['long text']}],{maxBytes:2}).toBuffer());
  });
});
