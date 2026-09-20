/** Historical controller Tags retain their original coordinates and opaque tuple extensions. */
import assert from 'node:assert/strict';
import { ControlElementMapper } from '../../src/objects/Serializables.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { DecodeError } from '../../src/core/DecodeError.js';
import { writeTo } from '../../src/core/TagParser.js';
import { RawElement, registerAllFactories } from '../../src/serializable/Factories.js';
registerAllFactories();

const p = { x: 1, y: -2, z: 3 }, q = { x: -4, y: 5, z: 6 };
const vector = (v: typeof p, name: string | null = null) => Tags.vector3i(name, v.x, v.y, v.z);
const bytes = (v = q, type = -32768) => { const b = Buffer.alloc(14); b.writeInt32BE(v.x); b.writeInt32BE(v.y, 4); b.writeInt32BE(v.z, 8); b.writeInt16BE(type, 12); return b; };
const cs0 = (v = q) => Tags.struct('cs0', [Tags.struct('controller', [vector(p, 'from'), Tags.byteArray('records', bytes(v)), Tags.string('extension', 'keep')]), Tags.struct('empty', [vector(q), Tags.byteArray(null, [])])]);
const ancient = () => Tags.struct('historical-name', [Tags.struct('controller', [vector(p, 'from'), Tags.struct('targets', [Tags.struct('pair', [vector(q, 'target'), Tags.short('kind', -32768), Tags.long('extra', 9n)])]), Tags.string('extension', 'keep')])]);
const same = (a: Tag, b: Tag) => assert.deepEqual(writeTo(a), writeTo(b));
const code = (fn: () => unknown, expected: string) => assert.throws(fn, (e: unknown) => e instanceof DecodeError && e.code === expected);

describe('ControlElementMapper historical Tags', () => {
  it('reads both legacy representations without shifts or filtering and snapshots all exposed trees', () => {
    for (const input of [cs0(), ancient()]) {
      const original = writeTo(input), model = ControlElementMapper.fromTag(input);
      assert.deepEqual(model.links, [{ from: p, type: -32768, targets: [q] }]);
      assert.ok(Object.isFrozen(model)); assert.deepEqual(writeTo(model.toTag()), original);
      input.getStruct().splice(0, 1); model.toTag().getStruct().splice(0, 1); model.links[0].targets[0].x = 0;
      assert.deepEqual(writeTo(model.toTag()), original);
      assert.deepEqual(ControlElementMapper.fromRaw(model.toRaw()).links, model.links);
    }
  });

  it('appends and removes links in the source representation while preserving tuple extensions', () => {
    for (const input of [cs0(), ancient()]) {
      const model = ControlElementMapper.fromTag(input), added = model.addLink(p, 42, p).addLink({ x: 100, y: 0, z: 0 }, 1, q);
      assert.equal(added.toTag().name, input.name); assert.equal(added.toTag().type, TagType.STRUCT);
      assert.equal(added.links.length, 3); same(model.toTag(), input);
      const row = added.toTag().getStruct()[0];
      assert.equal(row.name, 'controller'); assert.equal(row.getStruct()[0].name, 'from');
      assert.equal(row.getStruct()[1].name, input.getStruct()[0].getStruct()[1].name);
      assert.equal(row.getStruct()[2].getString(), 'keep');
      if (input.name !== 'cs0') same(row.getStruct()[1].getStruct()[0], input.getStruct()[0].getStruct()[1].getStruct()[0]);
      const removed = added.removeFrom(p);
      assert.deepEqual(removed.links, [{ from: { x: 100, y: 0, z: 0 }, type: 1, targets: [q] }]);
      same(removed.removeFrom(p).toTag(), removed.toTag());
      same(ControlElementMapper.fromTag(added.toTag()).toTag(), added.toTag());
    }
  });

  it('retains int32 coordinates and rejects a lossy conversion to int16', () => {
    const huge = { x: 2147483647, y: -2147483648, z: 32768 };
    const model = ControlElementMapper.fromTag(cs0(huge)); assert.deepEqual(model.links[0].targets, [huge]);
    code(() => model.toRaw(), 'E_RANGE'); code(() => model.toRawElement(), 'E_RANGE');
    const added = model.addLink(huge, 32767, q); assert.deepEqual(added.links[1].from, huge);
    code(() => added.toRaw(), 'E_RANGE'); assert.equal(added.removeFrom(huge).links.length, 1);
    code(() => added.addLink({ ...p, x: 2147483648 }, 1, q), 'E_RANGE');
    code(() => added.removeFrom({ ...p, z: 1.5 }), 'E_RANGE');
  });

  it('preserves SERIALIZABLE names and payloads while offering canonical Tags for raw models', () => {
    const model = new ControlElementMapper([{ from: p, type: 1, targets: [q] }]);
    const tag = new Tag(TagType.SERIALIZABLE, 'retained-name', model.toRawElement());
    const decoded = ControlElementMapper.fromTag(tag); same(decoded.toTag(), tag);
    assert.equal(decoded.addLink(p, 2, p).toTag().name, 'retained-name');
    assert.equal(decoded.removeFrom(p).toTag().name, 'retained-name');
    assert.equal(model.toTag().name, 'cs1'); assert.equal(ControlElementMapper.fromRaw(model.toRaw()).toTag().type, TagType.SERIALIZABLE);
    code(() => ControlElementMapper.fromTag(new Tag(TagType.SERIALIZABLE, 'cs1', new RawElement(1, Buffer.alloc(4)))), 'E_FORMAT');
  });

  it('rejects malformed tuples and partial packed records instead of returning an empty or partial map', () => {
    const wrap = (fields: Tag[], name = 'old') => Tags.struct(name, [Tags.struct(null, fields)]);
    for (const tag of [Tags.int('wrong', 1), Tags.struct('old', [Tags.int(null, 1)]), wrap([]), wrap([Tags.int(null, 1)]),
      wrap([vector(p)]), wrap([vector(p), Tags.int(null, 1)]), wrap([vector(p)], 'cs0'), wrap([vector(p), Tags.int(null, 1)], 'cs0'),
      wrap([vector(p), Tags.struct(null, [Tags.int(null, 1)])]),
      wrap([vector(p), Tags.struct(null, [Tags.struct(null, [])])]),
      wrap([vector(p), Tags.struct(null, [Tags.struct(null, [vector(q)])])]),
      wrap([vector(p), Tags.struct(null, [Tags.struct(null, [vector(q), Tags.int(null, 1)])])])]) {
      code(() => ControlElementMapper.fromTag(tag), 'E_FORMAT');
    }
    for (const size of [1, 13, 15]) code(() => ControlElementMapper.fromTag(wrap([vector(p), Tags.byteArray(null, Buffer.alloc(size))], 'cs0')), 'E_TRUNCATED');
    const repeated = cs0(); repeated.getStruct().splice(1, 0, repeated.getStruct()[0]);
    const model = ControlElementMapper.fromTag(repeated);
    assert.equal(model.links.length, 2); assert.equal(model.addLink(p, 1, p).links.length, 3);
    assert.equal(model.removeFrom(p).links.length, 0); assert.equal(model.removeFrom(p).toTag().getStruct()[0].name, 'empty');
    assert.equal(ControlElementMapper.fromTag(Tags.struct('old', [])).links.length, 0);
    assert.equal(ControlElementMapper.fromTag(Tags.struct('cs0', [])).links.length, 0);
  });

  it('retains byte, entry and traversal ceilings across source-preserving edits and conversions', () => {
    for (const input of [cs0(), ancient(), new ControlElementMapper([{ from: p, type: 1, targets: [q] }]).toTag()]) {
      const size = writeTo(input).length, maxEntries = input.name === 'cs0' ? 4 : 3;
      const bounded = ControlElementMapper.fromTag(input, { maxBytes: size, maxEntries });
      same(bounded.toTag(), input);
      code(() => ControlElementMapper.fromTag(input, { maxBytes: size - 1 }), 'E_LIMIT');
      code(() => ControlElementMapper.fromTag(input, { maxInflatedBytes: size - 1 }), 'E_LIMIT');
      code(() => ControlElementMapper.fromTag(input, { maxBytes: size + 1, maxInflatedBytes: size - 1 }), 'E_LIMIT');
      code(() => ControlElementMapper.fromTag(input, { maxEntries: maxEntries - 1 }), 'E_LIMIT');
      code(() => bounded.addLink(p, 2, q), 'E_LIMIT'); same(bounded.toTag(), input);
      const byteBounded = ControlElementMapper.fromTag(input, { maxBytes: size });
      code(() => byteBounded.addLink(p, 2, q), 'E_LIMIT');
      assert.equal(bounded.removeFrom(p).links.length, 0);
      code(() => ControlElementMapper.fromTag(input, { maxEntries: 0 }), 'E_LIMIT');
    }
    const raw = cs0(); const entries = raw.getStruct()[0].getStruct();
    let extension = Tags.string('opaque', 'retained'); for (let depth = 0; depth < 70; depth++) extension = Tags.struct(null, [extension]);
    entries.splice(2, 0, extension);
    code(() => ControlElementMapper.fromTag(raw), 'E_LIMIT');
    const sharedNodeBudget = { remainingNodes: 0 }, sharedInflationBudget = { remainingBytes: 0 };
    const options = { maxDepth: 80, maxNodes: 500, maxBytes: 10000, maxInputBytes: 1, sharedNodeBudget, sharedInflationBudget };
    const model = ControlElementMapper.fromTag(raw, options); options.maxDepth = 1; options.maxNodes = 1;
    const edited = model.addLink(p, 1, q); assert.equal(edited.links.length, 2);
    assert.equal(edited.toTag().getStruct()[0].getStruct()[2].type, TagType.STRUCT);
    assert.deepEqual(sharedNodeBudget, { remainingNodes: 0 }); assert.deepEqual(sharedInflationBudget, { remainingBytes: 0 });
    const tight = ControlElementMapper.fromTag(Tags.struct('cs0', []), { maxBytes: 10 });
    assert.equal(tight.toRaw().length, 8);
    code(() => tight.addLink(p, 1, q), 'E_LIMIT');
    code(() => ControlElementMapper.fromTag(cs0(), { maxListLength: 1 }), 'E_LIMIT');
    code(() => ControlElementMapper.fromTag(cs0(), { maxNodes: 1 }), 'E_LIMIT');
    const sameXY = ControlElementMapper.fromTag(cs0());
    assert.equal(sameXY.removeFrom({ ...p, y: 7 }).links.length, 1);
    assert.equal(sameXY.removeFrom({ ...p, z: 7 }).links.length, 1);
  });
});
