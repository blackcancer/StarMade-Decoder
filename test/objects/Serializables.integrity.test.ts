/** Source-defined serializable records, immutable edits and strict resource boundaries. */
import assert from 'node:assert/strict';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { DecodeError } from '../../src/core/DecodeError.js';
import { RawElement, registerAllFactories } from '../../src/serializable/Factories.js';
import { BufferReader } from '../../src/core/BufferReader.js';
import { SerializableTagRegister } from '../../src/serializable/SerializableTagRegister.js';
registerAllFactories();
import { ControlElementMapper, ElementCountMap, NPCFactionNewsEvent, LongSet, BlockBuffer,
  Long2Vector3fMap, Long2TransformMap, decodeSerializable, type Transform, type NPCEventType } from '../../src/objects/Serializables.js';

const point = { x: 1, y: 2, z: 3 };
const transform: Transform = { originX: 1, originY: 2, originZ: 3, m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1 };
const bytes = (fn: (writer: BufferWriter) => void): Buffer => { const writer = new BufferWriter(); fn(writer); return writer.toBuffer(); };
const same = (a: Uint8Array, b: Uint8Array): void => assert.deepEqual(Buffer.from(a), Buffer.from(b));
const code = (fn: () => unknown, expected: string): void => assert.throws(fn, (error: unknown) => error instanceof DecodeError && error.code === expected);
const models = () => [
  new ControlElementMapper([{ from: point, type: 42, targets: [{ x: -1, y: -2, z: -3 }] }]),
  new ElementCountMap([{ type: -12, count: -1 }, { type: 32767, count: 0 }]),
  new NPCFactionNewsEvent('WAR', -9223372036854775808n, -2147483648, undefined, ''),
  new LongSet([-9223372036854775808n, 9223372036854775807n]),
  new BlockBuffer([{ ...point, data: -2147483648, hasMeta: true, controllerPos: -1n, connectedFrom: [9223372036854775807n] }]),
  new Long2Vector3fMap([{ key: -1n, x: 1.25, y: -0, z: Infinity }]),
  new Long2TransformMap([{ key: 9223372036854775807n, transform }]),
];
const classes = [ControlElementMapper, ElementCountMap, NPCFactionNewsEvent, LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap];

describe('Serializables integrity', () => {
  it('round-trips every type with detached bytes and preserves caller limits through dispatch', () => {
    for (const [id, model] of models().entries()) {
      const raw = model.toRaw(), expected = Buffer.from(raw);
      const decoded = decodeSerializable(new RawElement(id, raw), { maxBytes: raw.length });
      assert.ok(decoded instanceof classes[id]); same((decoded as any).toRaw(), expected);
      raw.fill(0); const exposed = (decoded as any).toRaw(); exposed.fill(0); same((decoded as any).toRaw(), expected);
      assert.equal(model.toRawElement().factoryId, id); assert.equal(model.toRawElement().getFactoryId(), id); assert.equal(typeof model.toRawElement().toString(), 'string'); assert.equal(typeof model.toString(), 'string');
      const wireReader = BufferReader.from(expected); same((SerializableTagRegister.register[id]!.create(wireReader) as RawElement).raw, expected); assert.ok(wireReader.isEOF());
      assert.doesNotThrow(() => JSON.stringify(model));
      code(() => decodeSerializable(new RawElement(id, expected), { maxBytes: expected.length - 1 }), 'E_LIMIT');
      code(() => decodeSerializable(new RawElement(id, expected), { maxEntries: 0 }), 'E_LIMIT');
      code(() => (classes[id] as any).fromRaw(Buffer.concat([expected, Buffer.from([0])])), 'E_FORMAT');
      for (let end = 0; end < expected.length; end++) code(() => (classes[id] as any).fromRaw(expected.subarray(0, end)), 'E_TRUNCATED');
    }
    const opaque = new RawElement(100, Uint8Array.of(1, 2)), decoded = decodeSerializable(opaque) as RawElement;
    opaque.raw[0] = 0; assert.equal(decoded.raw[0], 1);
    code(() => decodeSerializable(opaque, { maxBytes: 1 }), 'E_LIMIT');
  });

  it('rejects negative, excess and incomplete declared counts instead of returning partial objects', () => {
    for (const Ctor of [ElementCountMap, LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap]) {
      code(() => Ctor.fromRaw(bytes(w => w.writeInt32BE(-1))), 'E_FORMAT');
      code(() => Ctor.fromRaw(bytes(w => w.writeInt32BE(100001))), 'E_LIMIT');
      code(() => Ctor.fromRaw(bytes(w => w.writeInt32BE(1))), 'E_TRUNCATED');
      const empty = new (Ctor as any)([]); same((Ctor as any).fromRaw(empty.toRaw()).toRaw(), empty.toRaw());
      code(() => new (Ctor as any)([], { maxBytes: 0 }), 'E_LIMIT');
      code(() => new (Ctor as any)([], { maxEntries: -1 }), 'E_RANGE');
    }
    code(() => new ElementCountMap(null as any), 'E_FORMAT');
    code(() => new ElementCountMap(new Array(1)), 'E_FORMAT');
    code(() => new ElementCountMap(new Array(2147483648)), 'E_RANGE');
  });

  it('preserves every count row while effective lookup, totals and replacement use the final duplicate', () => {
    const input = [{ type: -32768, count: -2147483648 }, { type: 5, count: 5 }, { type: 5, count: 2147483647 }, { type: 6, count: 0 }];
    const model = new ElementCountMap(input), before = model.toRaw(); input[0].count = 1; model.counts[1].type = 99;
    assert.equal(model.getCount(-32768), -2147483648); assert.equal(model.getCount(5), 2147483647); assert.equal(model.getCount(8), 0);
    assert.equal(model.totalBlocksBigInt, -1n); assert.equal(model.totalBlocks, -1);
    assert.deepEqual(ElementCountMap.fromRaw(before).counts, model.counts); same(model.toRaw(), before);
    const edited = model.setCount(5, 0).setCount(6, -1).removeType(-32768);
    assert.deepEqual(edited.counts, [{ type: 5, count: 0 }, { type: 6, count: -1 }]); assert.equal(edited.totalBlocks, -1); same(model.toRaw(), before);
    assert.equal(new ElementCountMap([]).totalBlocks, 0);
    const full = new ElementCountMap(Array.from({ length: 65536 }, (_, i) => ({ type: i - 32768, count: -2147483648 })));
    assert.equal(full.totalBlocks, -(2 ** 47)); assert.equal(full.totalBlocksBigInt, -(1n << 47n));
    assert.deepEqual(JSON.parse(JSON.stringify(edited)), { counts: edited.counts });
    code(() => new ElementCountMap([{ type: 32768, count: 0 }]), 'E_RANGE');
    code(() => model.setCount(2, 2147483648), 'E_RANGE');
    code(() => model.getCount(1.5), 'E_RANGE'); code(() => model.removeType(NaN), 'E_RANGE');
    const bounded = ElementCountMap.fromRaw(new ElementCountMap([{ type: 1, count: 0 }]).toRaw(), { maxEntries: 1, maxBytes: 10 });
    code(() => bounded.setCount(2, 1), 'E_LIMIT'); assert.equal(bounded.setCount(1, -1).getCount(1), -1);
  });

  it('snapshots int64 sets, validates position widths, and carries budgets across edits', () => {
    const values = [1n, 1n, -1n], model = new LongSet(values, { maxEntries: 4, maxBytes: 36 });
    values[0] = 3n; model.values[0] = 4n; assert.deepEqual(model.values, [1n, 1n, -1n]);
    assert.equal(model.has(-1n), true); assert.equal(model.has(4n), false);
    assert.deepEqual(model.remove(1n).values, [-1n]); assert.deepEqual(model.add(2n).values, [1n, 1n, -1n, 2n]);
    code(() => model.add(2n).add(3n), 'E_LIMIT');
    assert.deepEqual(new LongSet([]).addPos(-32768, 32767, -1).positions, [{ x: -32768, y: 32767, z: -1 }]);
    code(() => model.addPos(32768, 0, 0), 'E_RANGE'); code(() => model.addPos(-32769, 0, 0), 'E_RANGE');
    for (const value of [1 as any, 1n << 63n, -(1n << 63n) - 1n]) code(() => model.add(value), 'E_RANGE');
    assert.deepEqual(JSON.parse(JSON.stringify(model)), { values: ['1', '1', '-1'] });
    code(() => LongSet.fromRaw(new LongSet([1n]).toRaw(), { maxBytes: 12 }).add(2n), 'E_LIMIT');
  });

  it('snapshots copied block metadata and retains original allocation hints and boolean encodings', () => {
    const input = [{ ...point, data: 123, hasMeta: true, controllerPos: 9n, connectedFrom: [1n] }, { ...point, data: -1, hasMeta: false }];
    const model = new BlockBuffer(input); input[0].connectedFrom![0] = 7n; model.blocks[0].connectedFrom![0] = 8n;
    assert.equal(model.blocks[0].connectedFrom![0], 1n); assert.equal(model.blockCount, 2);
    const raw = Buffer.from(model.toRaw()); raw.writeInt32BE(99, 4); raw.writeInt32BE(0, 8); raw[22] = 255;
    const parsed = BlockBuffer.fromRaw(raw); same(parsed.toRaw(), raw); assert.equal(parsed.blocks[0].hasMeta, true);
    assert.deepEqual(JSON.parse(JSON.stringify(model)).blocks[0].connectedFrom, ['1']);
    const defaults = new BlockBuffer([{ ...point, data: 0, hasMeta: true }]).blocks[0]; assert.equal(defaults.controllerPos, 0n); assert.deepEqual(defaults.connectedFrom, []);
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: false, controllerPos: 0n }]), 'E_FORMAT');
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: false, connectedFrom: [] }]), 'E_FORMAT');
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: 1 as any }]), 'E_FORMAT');
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: true, connectedFrom: [1n, 2n] }], { maxEntries: 2 }), 'E_LIMIT');
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: false }], { maxBytes: 22 }), 'E_LIMIT');
    code(() => new BlockBuffer([{ ...point, data: 0, hasMeta: true }], { maxBytes: 23 }), 'E_LIMIT');
    const invalidHint = Buffer.from(model.toRaw()); invalidHint.writeInt32BE(-1, 4); code(() => BlockBuffer.fromRaw(invalidHint), 'E_FORMAT');
    const negativeNested = Buffer.from(model.toRaw()); negativeNested.writeInt32BE(-1, 31); code(() => BlockBuffer.fromRaw(negativeNested), 'E_FORMAT');
  });

  it('preserves float32 specials and nested snapshots for both keyed maps, with last-row lookup', () => {
    const vectors = [{ key: 1n, x: 0.1, y: Infinity, z: -Infinity }, { key: 1n, x: 2, y: NaN, z: -0 }];
    const map = new Long2Vector3fMap(vectors); vectors[1].x = 4; map.entries[1].x = 5; map.get(1n)!.x = 6;
    assert.equal(map.get(1n)!.x, 2); assert.equal(map.entries[0].x, Math.fround(0.1)); assert.equal(map.get(2n), undefined);
    const changed = map.set(1n, 5, 6, 7).set(2n, 8, 9, 10).delete(1n); assert.equal(changed.get(2n)!.x, 8); assert.equal(map.entries.length, 2);
    assert.equal(JSON.parse(JSON.stringify(map)).entries[1].y, 'NaN');
    for (const value of [1e100, '1' as any]) code(() => map.set(1n, value, 0, 0), 'E_RANGE');
    const t = structuredClone(transform), transforms = new Long2TransformMap([{ key: 1n, transform: t }, { key: 1n, transform: { ...t, originX: 7 } }]);
    t.m00 = 9; transforms.entries[0].transform.m00 = 8; transforms.get(1n)!.transform.originX = 3;
    assert.equal(transforms.entries[0].transform.m00, 1); assert.equal(transforms.get(1n)!.transform.originX, 7); assert.equal(transforms.get(2n), undefined);
    const updated = transforms.set(2n, t).delete(1n); t.m00 = 2; assert.equal(updated.get(2n)!.transform.m00, 9);
    assert.equal(JSON.parse(JSON.stringify(transforms)).entries[0].key, '1');
    for (const Ctor of [Long2Vector3fMap, Long2TransformMap]) {
      const original = Ctor === Long2Vector3fMap ? map : transforms, raw = Buffer.from(original.toRaw());
      raw.writeUInt32BE(0x7fa12345, 12); const parsed = Ctor.fromRaw(raw); assert.ok(Number.isNaN(Ctor === Long2Vector3fMap ? (parsed as Long2Vector3fMap).entries[0].x : (parsed as Long2TransformMap).entries[0].transform.originX)); same(parsed.toRaw(), raw);
      const bounded = (Ctor as any).fromRaw(raw, { maxEntries: 2 }); code(() => bounded.set(3n, ...(Ctor === Long2Vector3fMap ? [1, 2, 3] : [transform])), 'E_LIMIT');
    }
  });

  it('retains empty and repeated controller records, migrates legacy positions only on edits and bounds nested counts', () => {
    const legacy = bytes(w => { w.writeInt32BE(2); for (const x of [32767, -32768]) { w.writeInt16BE(x); w.writeInt16BE(0); w.writeInt16BE(0); w.writeInt32BE(0); } });
    const factoryReader = BufferReader.from(legacy); same((SerializableTagRegister.register[0]!.create(factoryReader) as RawElement).raw, legacy); assert.ok(factoryReader.isEOF());
    const original = ControlElementMapper.fromRaw(legacy, { maxBytes: 128, maxEntries: 10 }); same(original.toRaw(), legacy); assert.deepEqual(original.links, []);
    const added = original.addLink(point, -1, point), raw = Buffer.from(added.toRaw()); assert.equal(raw.readInt32BE(4), 3);
    assert.equal(raw.readInt16BE(8), -32761); assert.equal(raw.readInt16BE(18), -32760); assert.equal(added.links[0].type, -1);
    assert.equal(Buffer.from(added.removeFrom(point).toRaw()).readInt32BE(4), 2);
    const links = [{ from: { ...point }, type: 1, targets: [{ ...point }] }, { from: { ...point }, type: 2, targets: [] }];
    const model = new ControlElementMapper(links); links[0].from.x = 9; links[0].targets[0].y = 8; model.links[0].targets[0].z = 7;
    assert.deepEqual(model.links[0].from, point); assert.deepEqual(model.links[0].targets[0], point);
    assert.equal(model.addLink(point, 3, point).links.length, 3); assert.equal(model.removeFrom({ x: 1, y: 9, z: 3 }).links.length, 2); assert.equal(model.removeFrom({ x: 1, y: 2, z: 9 }).links.length, 2);
    code(() => new ControlElementMapper(links, { maxEntries: 3 }), 'E_LIMIT');
    code(() => new ControlElementMapper(links, { maxBytes: 8 }), 'E_LIMIT');
    code(() => new ControlElementMapper([{ from: point, type: 1, targets: null as any }]), 'E_FORMAT');
    code(() => ControlElementMapper.fromRaw(bytes(w => w.writeInt32BE(1))), 'E_TRUNCATED');
    code(() => ControlElementMapper.fromRaw(bytes(w => w.writeInt32BE(100001))), 'E_LIMIT');
    code(() => SerializableTagRegister.register[0]!.create(BufferReader.from(bytes(w => w.writeInt32BE(1000001)))), 'E_LIMIT');
    code(() => SerializableTagRegister.register[0]!.create(BufferReader.from(bytes(w => w.writeInt32BE(1)))), 'E_TRUNCATED');
    const negative = Buffer.from(model.toRaw()); negative.writeInt32BE(-1, 14); code(() => ControlElementMapper.fromRaw(negative), 'E_FORMAT');
    code(() => ControlElementMapper.fromRaw(model.toRaw(), { maxEntries: 3 }), 'E_LIMIT');
    assert.equal((original.toJSON() as any[]).length, 2);
  });

  it('decodes every compact-coordinate width mask and preserves exact network bytes', () => {
    for (const version of [1, 2]) for (let mask = 0; mask < 8; mask++) {
      const raw = bytes(w => {
        w.writeInt32BE(-version); w.writeInt32BE(1); for (let i = 0; i < 3; i++) w.writeInt16BE(0);
        w.writeInt32BE(1); w.writeInt16BE(1); w.writeInt32BE(1);
        for (let i = 0; i < 3; i++) w.writeInt8((mask >> i) & 1);
        for (let i = 0; i < 3; i++) w.writeInt16BE(32767);
        for (let i = 0; i < 3; i++) (mask & (1 << i)) ? w.writeInt16BE(i + 1) : w.writeInt8(i + 1);
      });
      const model = ControlElementMapper.fromRaw(raw, { maxBytes: raw.length }); same(model.toRaw(), raw);
      const factoryReader = BufferReader.from(raw); same((SerializableTagRegister.register[0]!.create(factoryReader) as RawElement).raw, raw); assert.ok(factoryReader.isEOF());
      const shift = version === 1 ? 8 : 0; assert.deepEqual(model.links[0].targets[0], { x: -32768 + shift, y: -32767 + shift, z: -32766 + shift });
    }
    same(ControlElementMapper.fromRaw(Buffer.alloc(4), { maxBytes: 4 }).toRaw(), Buffer.alloc(4));
  });

  it('enforces NPC subtype shapes, defensive routes and explicit unsupported values', () => {
    const route = { from: { ...point }, to: { x: -2147483648, y: 2147483647, z: 0 } }, system = { ...point };
    const trading = new NPCFactionNewsEvent('TRADING', 9223372036854775807n, 3, undefined, undefined, route);
    route.from.x = 9; trading.route!.to.z = 4; assert.equal(trading.route!.from.x, 1); assert.equal(trading.route!.to.z, 0);
    const grown = new NPCFactionNewsEvent('GROWN', 1n, 1, system); system.x = 4; grown.system!.x = 9; assert.equal(grown.system!.x, 1);
    assert.equal(trading.system, undefined); assert.equal(grown.route, undefined); assert.equal(trading.eventTypeName, 'TRADING');
    assert.equal(JSON.parse(JSON.stringify(trading)).time, '9223372036854775807');
    for (const event of ['WAR', 'PEACE', 'ALLIES', 'LOST_STATION'] as NPCEventType[]) {
      for (const other of ['', 'ASCIIé', '\0🚀\ud800']) { const model = new NPCFactionNewsEvent(event, 0n, 0, undefined, other); assert.equal(NPCFactionNewsEvent.fromRaw(model.toRaw()).otherEnt, other); }
    }
    const lost = new NPCFactionNewsEvent('LOST_TERRITORY', 0n, 0, point); assert.deepEqual(NPCFactionNewsEvent.fromRaw(lost.toRaw()).system, point);
    assert.deepEqual(NPCFactionNewsEvent.fromRaw(trading.toRaw()).route, trading.route);
    code(() => new NPCFactionNewsEvent('FUTURE' as any, 0n, 0), 'E_UNSUPPORTED'); code(() => NPCFactionNewsEvent.fromRaw(Uint8Array.of(255)), 'E_UNSUPPORTED');
    code(() => new NPCFactionNewsEvent('GROWN', 0n, 0), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('GROWN', 0n, 0, point, ''), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('GROWN', 0n, 0, point, undefined, route), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('TRADING', 0n, 0), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('TRADING', 0n, 0, point, undefined, route), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('TRADING', 0n, 0, undefined, '', route), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('WAR', 0n, 0), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('WAR', 0n, 0, point, ''), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('WAR', 0n, 0, undefined, '', route), 'E_FORMAT');
    code(() => new NPCFactionNewsEvent('WAR', 0n, 0, undefined, '', undefined, { maxBytes: 14 }), 'E_LIMIT');
    assert.throws(() => new NPCFactionNewsEvent('WAR', 0n, 0, undefined, '\0'.repeat(32768)));
  });
});
