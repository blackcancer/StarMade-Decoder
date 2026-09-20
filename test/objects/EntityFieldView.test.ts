/**
 * @fileoverview Complete field-view conversion and edit-boundary contracts.
 * Covers runtime JavaScript callers as well as typed callers, including unknown
 * future tag types and malformed opaque data used by diagnostic inspectors.
 */
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { RawElement } from '../../src/serializable/Factories.js';
import { Matrix3f, Matrix4f } from '../../src/types/Matrices.js';
import { Vector3b, Vector3f, Vector3i, Vector4f } from '../../src/types/Vectors.js';
import * as F from '../../src/objects/EntityFieldView.js';

describe('Field view contracts — conversions and edits', () => {
  it('distinguishes missing, terminator and real fields and guards read-only edits', () => {
    const fields = F.buildEntityFieldViews([Tags.int('x', 7), FINISH_TAG], [{ key: 'first' }, { key: 'end' }, { key: 'missing' }]);
    assert.deepEqual(fields.map(f => [f.present, f.tagType]), [[true, 'TAG_Int'], [false, 'TAG_End'], [false, 'MISSING']]);
    assert.isFalse(fields[0].canSet);
    assert.throws(() => fields[0].withValue(8), TypeError);
    const writable = F.buildEditableEntityFields([Tags.int(null, 3)], [], { field0: value => ({ stored: value }) });
    assert.equal(writable[0].key, 'field0');
    assert.isTrue(writable[0].toJSON().canSet);
    assert.deepEqual(writable[0].setValue(9), { stored: 9 });
    assert.equal(writable[0].value, 3);
  });

  const cases: [TagType, any, any][] = [
    [TagType.BYTE, -1, -1], [TagType.SHORT, 2, 2], [TagType.INT, 3, 3],
    [TagType.LONG, 4n, 4n], [TagType.FLOAT, 0.5, 0.5], [TagType.DOUBLE, 1.5, 1.5],
    [TagType.STRING, 'text', 'text'],
    [TagType.VECTOR3b, new Vector3b(1, 2, 3), { x: 1, y: 2, z: 3 }],
    [TagType.VECTOR3i, new Vector3i(4, 5, 6), { x: 4, y: 5, z: 6 }],
    [TagType.VECTOR3f, new Vector3f(1, 2, 3), { x: 1, y: 2, z: 3 }],
    [TagType.VECTOR4f, new Vector4f(1, 2, 3, 4), { x: 1, y: 2, z: 3, w: 4 }],
    [TagType.MATRIX3f, new Matrix3f(), new Array(9).fill(0)],
    [TagType.MATRIX4f, new Matrix4f(), new Array(16).fill(0)],
    [TagType.NOTHING, null, null], [TagType.FINISH, null, null],
  ];
  for (const [type, value, expected] of cases) {
    it(`maps ${TagType[type]} fields without changing their values`, () => {
      const tag = new Tag(type, 'field', value);
      assert.deepEqual(F.tagValueToFieldValue(tag), expected);
      assert.strictEqual(tag.value, value);
    });
  }

  it('represents byte previews and nested containers without exposing raw buffers', () => {
    const bytes = Buffer.alloc(70, 0xab);
    assert.deepEqual(F.tagValueToFieldValue(new Tag(TagType.BYTE_ARRAY, null, bytes)), {
      byteLength: 70, hexPreview: 'ab'.repeat(64),
    });
    for (const container of [Tags.struct('s', [Tags.int(null, 1), Tags.string('x', 'x')]),
      new Tag(TagType.LIST, null, [Tags.int(null, 1), Tags.int(null, 2)], TagType.INT)]) {
      assert.lengthOf(F.tagValueToFieldValue(container) as any[], 2);
    }
  });

  it('labels every opaque factory and safely diagnoses truncated payloads', () => {
    const names = ['ControlElementMapper', 'ElementCountMap', 'NPCFactionNewsEvent', 'LongSet', 'BlockBuffer', 'Long2Vector3fMap', 'Long2TransformMap'];
    for (let id = 0; id < names.length; id++) {
      const field = F.tagValueToFieldValue(new Tag(TagType.SERIALIZABLE, null, new RawElement(id, new Uint8Array([0xff])))) as F.SerializableFieldValue;
      assert.equal(field.factoryName, names[id]);
      assert.equal(field.factoryId, id);
      assert.equal(field.byteLength, 1);
      assert.isNull(field.decoded);
    }
    const future = F.tagValueToFieldValue(new Tag(TagType.SERIALIZABLE, null, new RawElement(99, new Uint8Array([1])))) as F.SerializableFieldValue;
    assert.equal(future.factoryName, 'Factory99'); assert.isNull(future.decoded);
    const invalid = F.tagValueToFieldValue(new Tag(TagType.SERIALIZABLE, null, null)) as F.SerializableFieldValue;
    assert.equal(invalid.factoryId, -1);
  });

  it('renders unfamiliar runtime tag values as diagnostics rather than crashing', () => {
    for (const value of [undefined, null, false, 1, 2n, 'future', { toString: () => 'opaque' }]) {
      const tag = new Tag(99 as TagType, null, value as any);
      const expected = value == null ? null : typeof value === 'object' ? 'opaque' : value;
      assert.strictEqual(F.tagValueToFieldValue(tag), expected);
      assert.equal(F.toEntityFieldView(0, { key: 'future' }, tag).tagType, '99');
    }
  });

  for (const [input, expected] of [[1, 1], [2n, 2], [' 3 ', 3]] as const) {
    it(`coerces numeric field ${String(input)}`, () => {
      assert.equal(F.fieldValueAsNumber(input, 'n'), expected);
      assert.equal(F.fieldValueAsInteger(input, 'n'), expected);
    });
  }
  it('rejects invalid numeric and integer fields', () => {
    for (const value of [NaN, Infinity, '', ' ', 'oops', {}, null, false]) {
      assert.throws(() => F.fieldValueAsNumber(value, 'n'), TypeError);
    }
    assert.throws(() => F.fieldValueAsInteger(1.5, 'n'), TypeError);
  });
  it('coerces and rejects bigint fields without losing integer precision', () => {
    for (const value of [7n, 7, ' 7 ']) assert.equal(F.fieldValueAsBigInt(value, 'id'), 7n);
    for (const value of [1.5, '', ' ', null, false, {}]) assert.throws(() => F.fieldValueAsBigInt(value, 'id'), TypeError);
    assert.throws(() => F.fieldValueAsBigInt('invalid', 'id'), SyntaxError);
  });
  it('coerces primitive strings and rejects objects', () => {
    for (const value of ['s', 7, 8n, true]) assert.equal(F.fieldValueAsString(value, 's'), String(value));
    for (const value of [null, {}, undefined]) assert.throws(() => F.fieldValueAsString(value, 's'), TypeError);
  });
  it('recognizes all documented boolean spellings and rejects ambiguity', () => {
    for (const value of [true, 1, 'true', '1', ' YES ', 'on']) assert.isTrue(F.fieldValueAsBoolean(value, 'b'));
    for (const value of [false, 0, 'false', '0', 'NO', 'off']) assert.isFalse(F.fieldValueAsBoolean(value, 'b'));
    for (const value of [null, {}, 'maybe']) assert.throws(() => F.fieldValueAsBoolean(value, 'b'), TypeError);
  });
});
