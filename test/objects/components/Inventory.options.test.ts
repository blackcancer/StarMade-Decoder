/** Caller limits across inventory snapshots, metadata and immutable edits. */
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { readFrom, writeTo, type TagReadOptions } from '../../../src/core/TagParser.js';
import { DecodeError } from '../../../src/core/DecodeError.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { copyInventoryTag, inventoryTagBytes, readInventoryWire, writeInventoryWire } from '../../../src/objects/components/InventoryWire.js';

/** Independently constructs the actual inv1 field layout. */
function inventory(value: Tag, type = -5): Tag {
  return Tags.struct('inv1', [new Tag(TagType.LIST, 'slots', [Tags.int(null, 2)], TagType.INT),
    new Tag(TagType.LIST, 'types', [Tags.short(null, type)], TagType.SHORT), Tags.struct('values', [value])]);
}
/** Depth beyond the default tests both read and write option propagation. */
function deepPayload(): Tag {
  let tag = Tags.long('leaf', 9007199254740993n);
  for (let i = 0; i < 70; i++) tag = Tags.struct(null, [tag]);
  return tag;
}
/** Payload remains opaque to the inventory reader. */
function special(payload: Tag): Tag { return Tags.struct('special', [Tags.int('id', 1), Tags.short('type', -5), payload, Tags.short('subid', 0)]); }
const limit = (fn: () => unknown): void => assert.throws(fn, (e: unknown) => e instanceof DecodeError && e.code === 'E_LIMIT');

describe('Inventory caller budgets', () => {
  it('supports depth80 metadata through creation, snapshots, editing, JSON and serialization', () => {
    const options = { maxDepth: 80 }, payload = deepPayload(), tag = inventory(special(payload)), original = writeTo(tag, options);
    limit(() => Inventory.fromTag(tag)); limit(() => ItemStack.special(2, { id: 1, type: -5, subId: 0, payload }));
    const model = Inventory.fromTag(tag, options); options.maxDepth = 1;
    assert.deepEqual(writeTo(model.toTag(), { maxDepth: 80 }), original);
    const stack = model.get(2)!, metadata = stack.meta!; metadata.payload!.getStruct().length = 0;
    assert.deepEqual(inventoryTagBytes(stack.meta!.payload!, { maxDepth: 80 }), writeTo(payload, { maxDepth: 80 }));
    const moved = stack.withSlot(4).withCount(1).withType(-5);
    assert.equal(moved.slot, 4); assert.equal(moved.meta!.type, -5);
    const json = moved.toJSON(); assert.deepEqual(Buffer.from(json.meta!.payloadTagBase64!, 'base64'), writeTo(payload, { maxDepth: 80 }));
    const replacement = ItemStack.special(2, { id: 2, type: -5, subId: 0, payload }, { maxDepth: 80 });
    const updated = model.set(replacement); assert.equal(Inventory.fromTag(updated.toTag(), { maxDepth: 80 }).get(2)!.meta!.id, 2);
    assert.equal(model.get(2)!.meta!.id, 1); assert.equal(model.remove(2).size, 0); assert.equal(model.clear().size, 0);
    const destination = new Inventory(new Map(), 1, undefined, { maxDepth: 80 });
    assert.equal(destination.withContents(model).get(2)!.meta!.id, 1);
    assert.equal(model.transferTo(destination, 2, 9).target.get(9)!.slot, 9);
    limit(() => Inventory.EMPTY.set(replacement));
    assert.ok(Object.isFrozen(model));
  });

  it('does not debit shared read counters again while copying a parsed compressed inventory', () => {
    const source = inventory(special(deepPayload())), raw = writeTo(source, { maxDepth: 80 }), compressed = gzipSync(raw.subarray(2));
    const sharedNodeBudget = { remainingNodes: 1000 }, sharedInflationBudget = { remainingBytes: raw.length - 2 };
    const options: TagReadOptions = { maxDepth: 80, maxInputBytes: compressed.length, maxInflatedBytes: raw.length,
      sharedNodeBudget, sharedInflationBudget };
    const tag = readFrom(compressed, options), remaining = sharedNodeBudget.remainingNodes;
    assert.equal(sharedInflationBudget.remainingBytes, 0); assert.ok(remaining < 1000);
    const model = Inventory.fromTag(tag, { ...options, maxSlots: 1 });
    const copied = copyInventoryTag(tag, options); assert.deepEqual(writeTo(copied, options), raw);
    assert.deepEqual(writeTo(model.toTag(), options), raw); assert.doesNotThrow(() => model.get(2)!.toJSON());
    assert.equal(sharedNodeBudget.remainingNodes, remaining); assert.equal(sharedInflationBudget.remainingBytes, 0);
    const edited = model.set(model.get(2)!.withSlot(2)); assert.deepEqual(writeTo(edited.toTag(), options), raw);
    assert.equal(sharedNodeBudget.remainingNodes, remaining); assert.equal(sharedInflationBudget.remainingBytes, 0);
    limit(() => model.set(new ItemStack(3, 5, 1)));
    sharedNodeBudget.remainingNodes = 0;
    assert.doesNotThrow(() => model.get(2)!.meta); assert.doesNotThrow(() => model.clear().toTag());
    limit(() => readFrom(compressed, options));
  });

  it('applies all relevant traversal and output budgets on reads and on generated inventories', () => {
    const source = inventory(Tags.int(null, 1), 5), raw = writeTo(source);
    for (const opts of [{ maxDepth: 1 }, { maxNodes: 2 }, { maxListLength: 1 }, { maxInflatedBytes: 3 }]) {
      limit(() => Inventory.fromTag(source, opts)); limit(() => readInventoryWire(source, Infinity, opts));
      limit(() => writeInventoryWire([new ItemStack(2, 5, 1)], undefined, opts));
    }
    assert.deepEqual(writeTo(Inventory.fromTag(source, { maxInflatedBytes: raw.length }).toTag()), raw);
    const limited = Inventory.fromTag(source, { maxInflatedBytes: raw.length });
    limit(() => limited.add(6, 2, 3).toTag()); assert.equal(limited.size, 1);
    limit(() => copyInventoryTag(source, { maxNodes: 1 }));
    limit(() => inventoryTagBytes(source, { maxInflatedBytes: 3 }));
    assert.deepEqual(writeTo(Inventory.fromTag(source, { maxInputBytes: 1 }).toTag()), raw);
    const template = readInventoryWire(source)!.template;
    limit(() => writeInventoryWire([new ItemStack(2, 5, 1)], template, { maxDepth: 1 }));
    assert.throws(() => Inventory.fromTag(source, { maxDepth: -1 }));
    const forged = { slot: 2, type: 5, count: 1 } as ItemStack;
    assert.throws(() => new Inventory(new Map([[2, forged]])), /ItemStack/);
    assert.throws(() => Inventory.EMPTY.set(forged), /ItemStack/);
    assert.equal(Inventory.EMPTY.size, 0);
  });

  it('preserves output budgets and occupied-slot constraints in explicit legacy operations', () => {
    const old = new Inventory(new Map([[0, new ItemStack(0, 5, 1)]])).toLegacyTag();
    const model = Inventory.fromLegacyTag(old, { maxSlots: 1, maxDepth: 8 });
    assert.deepEqual(writeTo(model.toLegacyTag()), writeTo(old)); limit(() => model.add(6, 1));
    limit(() => Inventory.fromLegacyTag(old, { maxNodes: 1 }));
    const bounded = new Inventory(new Map([[0, new ItemStack(0, 5, 1)]]), Infinity, undefined, { maxNodes: 1 });
    limit(() => bounded.toLegacyTag());
    const group = ItemStack.grouped(2, 'group', [{ type: 5, count: 1 }], { maxDepth: 80 });
    assert.equal(group.type, 5); assert.equal(group.count, 1);
  });

  it('inserts a newly requested subtype without overwriting an unknown metadata extension', () => {
    const opaque = Tags.long('opaque', 9007199254740993n), extension = Tags.string('future', 'keep');
    const original = inventory(Tags.struct('special', [Tags.int('id', 4), Tags.short('type', -5), opaque, extension]));
    const model = Inventory.fromTag(original);
    const changed = model.set(ItemStack.special(2, { id: 5, type: -5, subId: 7, payload: opaque }));
    const record = changed.toTag().getStruct()[2].getStruct()[0].getStruct();
    assert.equal(record[3].getShort(), 7); assert.equal(record[4].name, 'future'); assert.equal(record[4].getString(), 'keep');
    assert.equal(Inventory.fromTag(changed.toTag()).get(2)!.meta!.subId, 7);
    assert.deepEqual(writeTo(model.toTag()), writeTo(original));
  });
  it('rejects metadata fields that cannot survive either wire representation', () => {
    const metadata = { id: 1, type: -5, orientation: 0, subId: 0 };
    for (const payload of [undefined, Tags.int(null, 9)]) {
      assert.throws(() => new ItemStack(0, -5, 1, { ...metadata, orientation: 1, payload }), (e: unknown) => e instanceof DecodeError && e.code === 'E_UNSUPPORTED');
      for (const id of [0.5, -2147483649, 2147483648]) assert.throws(() => new ItemStack(0, -5, 1, { ...metadata, id, payload }));
      for (const type of [0.5, -32769, 32768]) assert.throws(() => new ItemStack(0, -5, 1, { ...metadata, type, payload }));
    }
    const legacy = new ItemStack(0, 5, 1, { id: -2147483648, type: -32768, subId: 32767, orientation: 0 });
    const roundTrip = Inventory.fromLegacyTag(new Inventory(new Map([[0, legacy]])).toLegacyTag()).get(0)!;
    assert.deepEqual(roundTrip.meta, legacy.meta);
  });

  it('keeps historical fallback behavior confined to the explicitly named legacy API', () => {
    const empty = Tags.struct(null, []);
    const tuple = (slot: Tag, type: Tag, value: Tag): Tag => Tags.struct(null, [Tags.struct(null, [slot]), Tags.struct(null, [type]), Tags.struct(null, [value])]);
    for (const slot of [Tags.int(null, -1), empty, Tags.nothing(null)]) {
      const input = tuple(slot, Tags.short(null, 5), Tags.int(null, 2));
      assert.equal(Inventory.fromLegacyTag(input).size, 0); assert.throws(() => Inventory.fromTag(input), /fromLegacyTag/);
    }
    for (const type of [empty, Tags.nothing(null)]) assert.equal(Inventory.fromLegacyTag(tuple(Tags.int(null, 0), type, Tags.int(null, 2))).get(0)!.type, 0);
    for (const value of [Tags.nothing(null), empty, Tags.struct(null, [Tags.string(null, 'legacy-unknown')])]) {
      assert.equal(Inventory.fromLegacyTag(tuple(Tags.int(null, 0), Tags.short(null, 5), value)).get(0)!.count, 1);
    }
    const wrapped = Inventory.fromLegacyTag(tuple(Tags.struct(null, [Tags.int(null, 2)]), Tags.struct(null, [Tags.short(null, 5)]), Tags.struct(null, [Tags.int(null, 4)])));
    assert.equal(wrapped.get(2)!.count, 4); assert.equal(wrapped.get(2)!.type, 5);
    const metadata = Inventory.fromLegacyTag(tuple(Tags.int(null, 0), Tags.short(null, 5), Tags.struct(null, [Tags.int(null, 9), Tags.nothing(null)]))).get(0)!;
    assert.deepEqual(metadata.meta, { id: 9, type: 0, orientation: 0, subId: 0 }); assert.equal(metadata.count, 1);
    assert.match(wrapped.toString(), /Inventory/); assert.match(wrapped.get(2)!.toString(), /count=4/);
  });

});
