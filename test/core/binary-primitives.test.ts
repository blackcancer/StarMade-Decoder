/**
 * @fileoverview Regression tests for Java UTF interoperability and bounded I/O.
 * Fixtures below use DataOutputStream.writeUTF byte layouts, not SDK output.
 * @author InitSysRev
 */
import { strict as assert } from 'node:assert';
import { BufferReader } from '../../src/core/BufferReader.js';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { readFrom, writeTo } from '../../src/core/TagParser.js';
import { Tags } from '../../src/core/TagBuilder.js';

/** Independent Java wire examples including NUL, supplementary and lone surrogate characters. */
const cases: [string, string][] = [
  ['\0', '0002c080'],
  ['\ud83d\ude80', '0006eda0bdedba80'],
  ['\ud800', '0003eda080'],
  ['é', '0002c3a9'],
];

describe('Audit: binary primitives', () => {
  for (const [value, hex] of cases) {
    it(`matches Java UTF bytes ${hex} in save-file primitives`, () => {
      assert.equal(BufferReader.from(Buffer.from(hex, 'hex')).readJavaUTF(), value);
      const writer = new BufferWriter(0);
      writer.writeJavaUTF(value);
      assert.equal(writer.toBuffer().toString('hex'), hex);
    });
    it(`matches Java UTF bytes ${hex} through TagParser`, () => {
      const fixture = Buffer.concat([Buffer.from([0, 0, 8]), Buffer.from(hex, 'hex'), Buffer.from(hex, 'hex')]);
      const tag = readFrom(fixture);
      assert.equal(tag.name, value);
      assert.equal(tag.getString(), value);
      assert.deepEqual(writeTo(Tags.string(value, value)), fixture);
    });
  }
  it('rejects invalid byte counts without moving the reader', () => {
    const reader = BufferReader.from(Buffer.alloc(8));
    reader.readInt32BE();
    for (const count of [-2, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => reader.readBytes(count), RangeError);
      assert.equal(reader.offset, 4);
    }
  });
  it('rejects invalid UTF continuations transactionally', () => {
    for (const hex of ['0002c241', '0003e08041', '0003e04180', '0001c2']) {
      const reader = BufferReader.from(Buffer.from(hex, 'hex'));
      assert.throws(() => reader.readJavaModifiedUTF());
      assert.equal(reader.offset, 0);
    }
  });
  it('rejects invalid snapshot ranges', () => {
    const reader = BufferReader.from(Buffer.alloc(8));
    assert.throws(() => reader.snapshot(-1, 2), RangeError);
    assert.throws(() => reader.snapshot(4, 3), RangeError);
    assert.throws(() => reader.snapshot(0, 9), RangeError);
  });
  it('grows a zero-capacity writer and returns independent snapshots', () => {
    const writer = new BufferWriter(0);
    writer.writeInt8(1);
    const snapshot = writer.toBuffer();
    snapshot[0] = 99;
    assert.equal(writer.toBuffer()[0], 1);
    assert.throws(() => writer.writeInt8(999));
    assert.equal(writer.position, 1);
  });
  it('rejects invalid initial capacities', () => {
    for (const capacity of [-1, 0.5, Infinity, NaN]) {
      assert.throws(() => new BufferWriter(capacity), RangeError);
    }
  });
});
