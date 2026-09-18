/** @fileoverview Independent malformed-Tag fixtures and writer invariant regressions. */
import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { Tag, FINISH_TAG } from '../src/core/Tag.js';
import { TagType } from '../src/core/TagType.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { Tags } from '../src/core/TagBuilder.js';

describe('Audit: Tag parser budgets and writer invariants', () => {
  it('rejects negative counts and invalid element types even for empty lists', () => {
    for (const hex of ['0000f403ffffffff', '0000f4ff00000000', '0000f4117fffffff']) {
      assert.throws(() => readFrom(Buffer.from(hex, 'hex')), /list|budget/);
    }
  });
  it('bounds recursively nested structures before exhausting the JS stack', () => {
    const bytes = Buffer.concat([Buffer.from([0, 0]), Buffer.alloc(40, 0xf3), Buffer.alloc(41)]);
    assert.throws(() => readFrom(bytes, { maxDepth: 16 }), /depth/);
  });
  it('caps nodes, input bytes, inflated bytes and byte-array allocations', () => {
    const root = Tags.struct('root', [Tags.int('x', 42)]);
    const bytes = writeTo(root);
    assert.throws(() => readFrom(bytes, { maxInputBytes: 2 }), /budget/);
    assert.throws(() => readFrom(bytes, { maxTags: 1 }), /budget/);
    assert.throws(() => readFrom(gzipSync(bytes.subarray(2)), { maxInflatedBytes: 3 }));
    const array = Buffer.from('0000f90000000401020304', 'hex');
    assert.throws(() => readFrom(array, { maxByteArrayBytes: 3 }), /array length/);
  });
  it('supports explicit standalone-document trailing-byte rejection', () => {
    const bytes = Buffer.concat([writeTo(Tags.int(null, 42)), Buffer.from([99])]);
    assert.equal(readFrom(bytes).getInt(), 42);
    assert.throws(() => readFrom(bytes, { rejectTrailingBytes: true }), /Trailing/);
  });
  it('rejects missing or misplaced FINISH, heterogeneous lists and cycles', () => {
    assert.throws(() => writeTo(new Tag(TagType.STRUCT, null, [])), /FINISH/);
    assert.throws(() => writeTo(new Tag(TagType.STRUCT, null, [FINISH_TAG, Tags.int(null, 1)])), /FINISH/);
    const list = new Tag(TagType.LIST, null, [Tags.string(null, 'x')], TagType.INT);
    assert.throws(() => writeTo(list), /homogeneous/);
    const children: Tag[] = [];
    const cyclic = new Tag(TagType.STRUCT, null, children);
    children.push(cyclic, FINISH_TAG);
    assert.throws(() => writeTo(cyclic), /Cyclic/);
  });
});
