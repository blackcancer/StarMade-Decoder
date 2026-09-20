/** @fileoverview Regression contracts for cumulative Tag and SERIALIZABLE read budgets. */
import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { BufferReader } from '../../src/core/BufferReader.js';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { DecodeError } from '../../src/core/DecodeError.js';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { TagType } from '../../src/core/TagType.js';
import { readFrom, readTagDocument, writeTo } from '../../src/core/TagParser.js';
import { RawElement, registerAllFactories } from '../../src/serializable/Factories.js';

/** Builds opaque LongSet payloads independently from the Tag writer's implementation. */
function longSet(values: bigint[]): Tag {
  const payload = Buffer.alloc(4 + values.length * 8);
  payload.writeInt32BE(values.length);
  values.forEach((value, index) => payload.writeBigInt64BE(value, 4 + index * 8));
  return new Tag(TagType.SERIALIZABLE, null, new RawElement(3, payload));
}
const isLimit = (error: unknown): boolean => error instanceof DecodeError && error.code === 'E_LIMIT';

describe('Audit completion: Tag budgets', () => {
  before(() => registerAllFactories());

  it('shares traversal limits across documents without charging envelope validation twice', () => {
    const bytes = writeTo(longSet([1n, 2n]));
    const sharedNodeBudget = { remainingNodes: 6 };
    assert.deepEqual(readTagDocument(bytes, {sharedNodeBudget}).toBuffer(), bytes);
    assert.equal(sharedNodeBudget.remainingNodes, 3);
    readFrom(bytes, {sharedNodeBudget});
    assert.equal(sharedNodeBudget.remainingNodes, 0);
    assert.throws(() => readFrom(bytes, {sharedNodeBudget}), isLimit);
    assert.equal(sharedNodeBudget.remainingNodes, 0);
    assert.throws(() => readFrom(bytes, {sharedNodeBudget: {remainingNodes: -1}}));
  });

  it('bounds SERIALIZABLE collections and shares the node budget across all factories', () => {
    const single = writeTo(longSet([1n, 2n]));
    assert.throws(() => readFrom(single, { maxListLength: 1 }), isLimit);
    assert.throws(() => readFrom(single, { maxNodes: 2 }), isLimit);
    assert.deepEqual(writeTo(readFrom(single, { maxListLength: 2, maxNodes: 3 })), single);
    const combined = writeTo(Tags.struct(null, [longSet([1n]), longSet([2n])]));
    assert.throws(() => readFrom(combined, { maxNodes: 5 }), isLimit);
    assert.deepEqual(writeTo(readFrom(combined, { maxNodes: 6 })), combined);
  });

  it('enforces declared collection limits in each fixed-width SERIALIZABLE factory', () => {
    for (const [id, headerBytes, recordBytes] of [[1, 4, 6], [4, 12, 11], [5, 4, 20], [6, 4, 56]]) {
      const payload = Buffer.alloc(headerBytes + 2 * recordBytes);
      payload.writeInt32BE(2);
      const bytes = writeTo(new Tag(TagType.SERIALIZABLE, null, new RawElement(id, payload)));
      assert.throws(() => readFrom(bytes, { maxListLength: 1 }), isLimit);
      assert.throws(() => readFrom(bytes, { maxNodes: 2 }), isLimit);
      assert.deepEqual(writeTo(readFrom(bytes, { maxListLength: 2, maxNodes: 3 })), bytes);
    }
  });

  it('restores the reader budget after a rejected count without advancing its cursor', () => {
    const reader = BufferReader.from(Buffer.from([0, 0, 0, 2]));
    const budget = { maxListLength: 1, nodesLeft: 3 };
    assert.throws(() => reader.withCollectionBudget(budget, () => reader.readCount()), isLimit);
    assert.equal(reader.offset, 0);
    assert.equal(budget.nodesLeft, 3);
    assert.equal(reader.readCount(), 2);
    assert.throws(() => reader.validateCollectionCount(NaN), RangeError);
  });

  it('counts FINISH sentinels and STRUCT lengths identically when reading and writing', () => {
    const root = Tags.struct(null, [Tags.int(null, 1)]);
    const bytes = writeTo(root);
    for (const options of [{ maxNodes: 2 }, { maxDepth: 0 }, { maxListLength: 1 }]) {
      assert.throws(() => readFrom(bytes, options));
      assert.throws(() => writeTo(root, options));
    }
    const exact = { maxNodes: 3, maxDepth: 1, maxListLength: 2 };
    assert.deepEqual(readTagDocument(bytes, exact).toBuffer(), bytes);
    const finish = writeTo(FINISH_TAG);
    assert.throws(() => readFrom(finish, { maxNodes: 0 }), isLimit);
    assert.deepEqual(readTagDocument(finish, { maxNodes: 1, maxDepth: 0 }).toBuffer(), finish);
  });

  it('applies the same collection budget to legacy and versioned controller counts', () => {
    for (const header of [1, -1026]) {
      const writer = new BufferWriter();
      writer.writeInt32BE(header);
      if (header < 0) writer.writeInt32BE(1);
      writer.writeBytes(Buffer.alloc(6)); writer.writeInt32BE(1);
      writer.writeInt16BE(5); writer.writeInt32BE(1); writer.writeBytes(Buffer.alloc(6));
      const bytes = writeTo(new Tag(TagType.SERIALIZABLE, null, new RawElement(0, writer.toBuffer())));
      assert.throws(() => readFrom(bytes, { maxListLength: 0 }), isLimit);
      assert.throws(() => readFrom(bytes, { maxNodes: 3 }), isLimit);
      assert.deepEqual(writeTo(readFrom(bytes, { maxNodes: 4 })), bytes);
    }
  });

  it('preserves GZIP documents at the exact inflated-byte bound', () => {
    for (const root of [FINISH_TAG, Tags.int(null, 1)]) {
      const payload = writeTo(root).subarray(2);
      const compressed = gzipSync(payload);
      const document = readTagDocument(compressed, { maxInflatedBytes: payload.length });
      assert.deepEqual(document.toBuffer(), compressed);
    }
    const compressed = gzipSync(writeTo(Tags.int(null, 1)).subarray(2));
    const document = readTagDocument(compressed, { maxInflatedBytes: 5 });
    const edited = document.toBuffer(Tags.int(null, 2));
    assert.equal(readFrom(edited, { maxInflatedBytes: 5 }).getInt(), 2);
    assert.throws(() => document.toBuffer(Tags.string(null, '1234')));
  });

  it('shares the remaining GZIP output budget across separately parsed roots', () => {
    const plain = writeTo(Tags.int(null, 1));
    const gzip = gzipSync(plain.subarray(2));
    const sharedInflationBudget = { remainingBytes: 10 };
    const options = { sharedInflationBudget };
    readFrom(plain, options);
    assert.equal(sharedInflationBudget.remainingBytes, 10);
    readFrom(gzip, options); readFrom(gzip, options);
    assert.equal(sharedInflationBudget.remainingBytes, 0);
    assert.throws(() => readFrom(gzip, options), isLimit);
    const tooSmall = { remainingBytes: 4 };
    assert.throws(() => readFrom(gzip, { sharedInflationBudget: tooSmall }), isLimit);
    assert.equal(tooSmall.remainingBytes, 4);
    assert.throws(() => readFrom(gzip, { sharedInflationBudget: { remainingBytes: -1 } }), /remainingBytes/);
    assert.throws(() => readFrom(Buffer.from([0x1f, 0x8b, 0])),
      (error: unknown) => error instanceof DecodeError && error.code === 'E_FORMAT');
  });
});
