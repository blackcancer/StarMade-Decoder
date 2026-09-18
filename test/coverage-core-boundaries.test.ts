/**
 * @fileoverview Remaining primitive, Tag-envelope and diagnostic boundary contracts.
 * Includes malicious mutable SERIALIZABLE callbacks: preflight validation must
 * not allow later invalid sibling payloads to be silently serialized.
 */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { BufferReader } from '../src/core/BufferReader.js';
import { BufferWriter } from '../src/core/BufferWriter.js';
import { DecodeError, reportDecodeFailure } from '../src/core/DecodeError.js';
import { Tag, FINISH_TAG } from '../src/core/Tag.js';
import { Tags } from '../src/core/TagBuilder.js';
import { TagType } from '../src/core/TagType.js';
import { readFrom, writeTo, readTagDocument } from '../src/core/TagParser.js';
import { toObject } from '../src/core/TagSerializer.js';
import { Matrix3f } from '../src/types/Matrices.js';

describe('Core boundaries — invalid arguments and diagnostic representations', () => {
  it('reads unsigned short values and validates collection bounds transactionally', () => {
    const r = BufferReader.from(new Uint8Array([255, 255]));
    assert.equal(r.readUInt16BE(), 65535); assert.isTrue(r.isEOF());
    for (const [width, max] of [[-1, 0], [0, -1], [NaN, 1], [0, Infinity]]) {
      const reader = BufferReader.from(Buffer.alloc(4));
      assert.throws(() => reader.readCount(width, max), RangeError); assert.equal(reader.offset, 0);
    }
  });

  it('rejects invalid short, unsigned-int, string and internal length values without writes', () => {
    const w = new BufferWriter();
    for (const v of [-32769, 32768, 1.5]) assert.throws(() => w.writeInt16BE(v), RangeError);
    for (const v of [-1, 65536, NaN]) assert.throws(() => w.writeUInt16BE(v), RangeError);
    for (const v of [-1, 4294967296, Infinity]) assert.throws(() => w.writeUInt32BE(v), RangeError);
    assert.throws(() => w.writeJavaUTF(null as any), TypeError);
    assert.throws(() => (w as any)._ensure(-1), RangeError);
    assert.equal(w.position, 0);
  });

  it('reports thrown primitive values and nested lookup results consistently', () => {
    const diagnostics: any[] = [];
    reportDecodeFailure('bad input', 'recover', diagnostics);
    assert.equal(diagnostics[0].message, 'bad input');
    assert.throws(() => reportDecodeFailure(new DecodeError('E_LIMIT', 'limit'), 'recover', []), /limit/);
    const nested = Tags.struct(null, [Tags.struct(null, [Tags.int('inner', 3)])]);
    assert.equal(nested.findByName('inner')!.getInt(), 3);
    assert.isNull(new Tag(TagType.INT, 'null', 1).name);
    assert.include(nested.toString(), 'STRUCT/LIST');
    assert.include(Tags.byteArray(null, [1, 2]).toString(), '[2 bytes]');
    assert.include(Tags.int(null, 3).toString(), '("")');
    assert.throws(() => Tags.int(null, 3).getString(), /Expected/);
    assert.throws(() => Tags.int('name', 3).getString(), /name/);
    const lines: string[] = [], original = console.log;
    try { console.log = value => { lines.push(String(value)); }; new Tag(TagType.LIST, null, []).print(); }
    finally { console.log = original; }
    assert.include(lines[0], 'type ?');
  });

  it('serializes unnamed, missing-list-type and opaque diagnostics', () => {
    assert.equal((toObject(new Tag(TagType.LIST, null, [])) as any).elementType, 'NOTHING');
    const opaque = toObject(new Tag(TagType.SERIALIZABLE, null, { factoryId: 99 } as any)) as any;
    assert.equal(opaque.factoryName, 'Unknown(99)'); assert.equal(opaque.bytes, 0);
    assert.deepEqual((toObject(Tags.vector3b(null, 1, 2, 3)) as any).value, { x: 1, y: 2, z: 3 });
    assert.equal((toObject(new Tag(TagType.MATRIX3f, null, new Matrix3f())) as any).value.rows.length, 3);
    assert.deepEqual(toObject(Tags.nothing(null)), { type: 'NOTHING', value: null });
  });

  it('covers list builder aliases, signed bytes, absent getters and wrong containers', () => {
    assert.equal(Tags.byte(null, 255).getByte(), -1);
    const empty = Tags.struct(null, []);
    assert.equal(Tags.getLong(empty, 'missing', 9n), 9n);
    assert.equal(Tags.getLong(Tags.struct(null, [Tags.long('x', 8n)]), 'x'), 8n);
    assert.equal(Tags.getString(Tags.struct(null, [Tags.string('s', 'text')]), 's'), 'text');
    assert.throws(() => Tags.setField(Tags.int(null, 1), 'x', Tags.int('x', 2)), TypeError);
    assert.throws(() => Tags.removeField(Tags.int(null, 1), 'x'), TypeError);
    assert.deepEqual(Tags.listOfStructs('x', [Tags.struct(null, [Tags.int('n', 1)])]).getList().map(t => t.findByName('n')!.getInt()), [1]);
  });

  it('enforces envelope output, list-node and malformed-tree bounds', () => {
    const plain = writeTo(Tags.int(null, 1));
    assert.throws(() => readFrom(gzipSync(plain.subarray(2)), { maxInflatedBytes: 0 }), /inflation/);
    const bytes = Buffer.concat([plain, Buffer.alloc(16)]);
    const doc = readTagDocument(bytes, { maxInflatedBytes: bytes.length });
    assert.throws(() => doc.toBuffer(Tags.string(null, '1234567890')), /document output/);
    assert.throws(() => writeTo(Tags.int(null, 1), { maxInflatedBytes: 2 }), /too small/);
    for (const bad of [null, new Tag(99 as any, null, 0), new Tag(TagType.STRUCT, null, null)]) {
      assert.throws(() => writeTo(bad as any));
    }
    const list = new Tag(TagType.LIST, null, [Tags.nothing(null), Tags.nothing(null)], TagType.NOTHING);
    assert.throws(() => readFrom(writeTo(list), { maxNodes: 2 }), /list/);
    assert.throws(() => writeTo(list, { maxNodes: 2 }), /node budget/);
    const unspecified = new Tag(TagType.LIST, null, [Tags.nothing(null)]);
    assert.equal(readFrom(writeTo(unspecified)).getList()[0].type, TagType.NOTHING);
    const sentinelList = new Tag(TagType.LIST, null, [FINISH_TAG], TagType.FINISH);
    assert.equal(readFrom(writeTo(sentinelList)).getList()[0].type, TagType.FINISH);
  });

  it('refuses a SERIALIZABLE callback that changes a later payload to an invalid type', () => {
    const sibling = Tags.int(null, 1);
    const mutator = new Tag(TagType.SERIALIZABLE, null, {
      getFactoryId: () => 0,
      writeToTag: () => { (sibling as any).type = 99; },
    });
    assert.throws(() => writeTo(Tags.struct(null, [mutator, sibling])), /Unhandled tag type/);
  });
});
