/** @fileoverview Actual inventory wire shapes and lossless, validated value editing. */
import { assert } from 'chai';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { writeTo, readFrom } from '../../../src/core/TagParser.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { readInventoryWire, writeInventoryWire } from '../../../src/objects/components/InventoryWire.js';

/** Independently authored inv1 fixture: typed slot/type LISTs and a values STRUCT. */
function inventoryTag(slots = [7, 100], types = [5, 8], values: Tag[] = [Tags.int(null, 12), Tags.int(null, 3)]): Tag {
  return Tags.struct('inv1', [new Tag(TagType.LIST, null, slots.map(slot => Tags.int(null, slot)), TagType.INT),
    new Tag(TagType.LIST, null, types.map(type => Tags.short(null, type)), TagType.SHORT), Tags.struct(null, values)]);
}

describe('Inventory wire', () => {
  it('reads the actual typed lists and writes edits without changing sparse slots or wrappers', () => {
    const source = inventoryTag(), before = writeTo(source), inventory = Inventory.fromTag(readFrom(before));
    assert.equal(inventory.size, 2); assert.equal(inventory.get(7)!.count, 12); assert.equal(inventory.get(100)!.type, 8);
    assert.deepEqual(writeTo(inventory.toTag()), before);
    const edited = inventory.set(new ItemStack(7, 5, 25));
    const decoded = Inventory.fromTag(readFrom(writeTo(edited.toTag())));
    assert.equal(decoded.get(7)!.count, 25); assert.equal(decoded.get(100)!.count, 3);
    assert.equal(edited.toTag().name, 'inv1'); assert.equal(inventory.get(7)!.count, 12);
    const limited = Inventory.fromTag(source, { maxSlots: 2 }); assert.equal(limited.maxSlots, 2);
    assert.throws(() => limited.add(9, 1));
    assert.throws(() => Inventory.fromTag(source, { maxSlots: 1 }));
    assert.throws(() => Inventory.fromTag(source, { maxSlots: -1 }));
  });

  it('preserves named legacy lists, row order, extension fields and nested envelopes', () => {
    for (const name of ['inv', 'inventory', 'inv1']) {
      const inner = Tags.struct(name, [Tags.struct('slots', [Tags.int('a', 100), Tags.int('b', 7)]),
        Tags.struct('types', [Tags.short('x', 5), Tags.short('y', 8)]),
        Tags.struct('values', [Tags.int('first', 4), Tags.int('second', 2)]), Tags.string('extension', 'preserved')]);
      const wrapped = Tags.struct('stash', [Tags.struct('metadata', [Tags.short('production', 9), Tags.string('name', 'Cargo')]), inner, Tags.int('future', 42)]);
      const factory = Tags.struct(null, [Tags.struct(null, [Tags.short(null, 4)]), wrapped]);
      const inventory = Inventory.fromTag(factory);
      assert.deepEqual(writeTo(inventory.toTag()), writeTo(factory));
      const edited = inventory.add(7, 1, 101).add(9, 2, 102).set(new ItemStack(7, 8, 5));
      const out = edited.toTag().getStruct()[1].getStruct();
      assert.equal(out[0].getStruct()[1].getString(), 'Cargo'); assert.equal(out[2].getInt(), 42);
      assert.equal(out[1].getStruct()[3].getString(), 'preserved');
      assert.deepEqual(out[1].getStruct()[0].getStruct().filter(t => t.type !== TagType.FINISH).map(t => t.value), [100, 7, 101, 102]);
      assert.equal(Inventory.fromTag(edited.toTag()).get(7)!.count, 5);
      const cleared = inventory.clear(); assert.equal(Inventory.fromTag(cleared.toTag()).size, 0);
      assert.equal(cleared.toTag().getStruct()[1].getStruct()[0].getStruct()[1].getString(), 'Cargo');
    }
    const anonymous = Tags.rename(inventoryTag(), null);
    assert.deepEqual(writeTo(Inventory.fromTag(anonymous).toTag()), writeTo(anonymous));
    assert.equal(Inventory.EMPTY.toTag().getStruct()[0].listType, TagType.INT);
    assert.equal(Inventory.EMPTY.toTag().getStruct()[1].listType, TagType.SHORT);
    assert.isUndefined(readInventoryWire(Tags.byte(null, 0)));
    assert.isUndefined(readInventoryWire(Tags.struct(null, [])));
  });

  it('preserves opaque metadata payloads and counts special items as exactly one', () => {
    for (const subId of [undefined, -1, 3]) {
      const parts = [Tags.int('id', 123), Tags.short('kind', -5), Tags.byteArray('opaque', Buffer.from([0, 255, 17]))];
      if (subId !== undefined) parts.push(Tags.short('subId', subId), Tags.long('future', 99n));
      const source = inventoryTag([2], [-5], [Tags.struct('special', parts)]);
      const inventory = Inventory.fromTag(source), item = inventory.get(2)!;
      assert.equal(item.count, 1); assert.equal(item.meta!.id, 123); assert.equal(item.meta!.subId, subId ?? -1);
      assert.deepEqual(writeTo(inventory.toTag()), writeTo(source));
      item.meta!.payload!.getByteArray()[0] = 64; assert.equal(item.meta!.payload!.getByteArray()[0], 0);
      const replacement = ItemStack.special(2, { id: 456, type: -5, subId: 4, payload: Tags.long('opaque-long', 9007199254740993n) });
      const output = inventory.set(replacement).toTag();
      assert.equal(Inventory.fromTag(output).get(2)!.meta!.payload!.getLong(), 9007199254740993n);
      assert.include(replacement.toString(), 'meta=');
      const json = JSON.parse(JSON.stringify(replacement));
      assert.equal(readFrom(Buffer.from(json.meta.payloadTagBase64, 'base64')).getLong(), 9007199254740993n);
      if (subId !== undefined) assert.equal(output.getStruct()[2].getStruct()[0].getStruct()[4].getLong(), 99n);
    }
    const created = ItemStack.special(7, { id: 1, type: -9, subId: -1, payload: Tags.byteArray(null, Buffer.from([1])) });
    assert.equal(Inventory.fromTag(Inventory.EMPTY.set(created).toTag()).get(7)!.type, -9);
    const noShort = inventoryTag([2], [-5], [Tags.struct(null, [Tags.int(null, 3), Tags.short(null, -5), Tags.int(null, 99), Tags.string('future', 'retain')])]);
    assert.deepEqual(writeTo(Inventory.fromTag(noShort).toTag()), writeTo(noShort));
  });

  it('preserves multi-type groups, member extensions and bounded aggregate quantities', () => {
    const values = Tags.struct('multi', [Tags.string('group', 'hulls'),
      Tags.struct('first', [Tags.short('type', 5), Tags.int('amount', 7), Tags.string('future', 'keep')]),
      Tags.struct(null, [Tags.short(null, 8), Tags.int(null, 9)])]);
    const source = inventoryTag([9], [-32768], [values]), inventory = Inventory.fromTag(source), item = inventory.get(9)!;
    assert.equal(item.count, 16); assert.equal(inventory.countOf(5), 7); assert.equal(inventory.countOf(8), 9);
    assert.equal(inventory.countOf(-32768), 16); assert.equal(inventory.countOf(10), 0);
    assert.equal(inventory.byType(5)[0].slot, 9); assert.deepEqual(writeTo(inventory.toTag()), writeTo(source));
    item.group!.items[0].count = 99; assert.equal(item.group!.items[0].count, 7);
    const edited = inventory.set(ItemStack.grouped(9, 'hulls', [{ type: 5, count: 2 }, { type: 8, count: 10 }, { type: 9, count: 1 }]));
    const result = edited.toTag(); assert.equal(Inventory.fromTag(result).countOf(9), 1);
    assert.equal(result.getStruct()[2].getStruct()[0].getStruct()[1].getStruct()[2].getString(), 'keep');
    const newlyCreated = Inventory.EMPTY.set(ItemStack.grouped(1, 'hulls', [{ type: 5, count: 0x7fffffff }, { type: 8, count: 1 }]));
    assert.equal(Inventory.fromTag(newlyCreated.toTag()).get(1)!.count, 0x7fffffff);
    const single = ItemStack.grouped(1, 'hulls', [{ type: 5, count: 3 }]); assert.equal(single.type, 5); assert.isUndefined(single.group);
    const priorNormal = Inventory.fromTag(inventoryTag([1], [5], [Tags.int(null, 1)]));
    assert.equal(Inventory.fromTag(priorNormal.set(newlyCreated.get(1)!).toTag()).get(1)!.type, -32768);
    assert.equal(Inventory.fromTag(priorNormal.set(ItemStack.special(1, { id: 2, type: -5, subId: 1, payload: Tags.int(null, 7) })).toTag()).get(1)!.type, -5);
  });

  it('rejects malformed lists, duplicates, invalid metadata and incomplete groups without fallback', () => {
    const malformed: Tag[] = [
      Tags.struct('inv1', []), Tags.struct('stash', []),
      Tags.struct('inv1', [Tags.int(null, 0), Tags.short(null, 0), Tags.int(null, 0)]),
      inventoryTag([0], [], []), inventoryTag([0], [5], []), inventoryTag([0, 0], [5, 8]),
      inventoryTag([-1], [5], [Tags.int(null, 1)]), inventoryTag([0], [0], [Tags.int(null, 1)]),
      inventoryTag([0], [5], [Tags.int(null, 0)]), inventoryTag([0], [5], [Tags.int(null, -1)]),
      inventoryTag([0], [-5], [Tags.int(null, 1)]), inventoryTag([0], [5], [Tags.byte(null, 1)]),
      inventoryTag([0], [-5], [Tags.struct(null, [])]),
      inventoryTag([0], [-5], [Tags.struct(null, [Tags.int(null, 1), Tags.short(null, -6), Tags.int(null, 2)])]),
      inventoryTag([0], [5], [Tags.struct(null, [Tags.int(null, 1), Tags.short(null, -5), Tags.int(null, 2)])]),
      inventoryTag([0], [-5], [Tags.struct(null, [Tags.int(null, 1), Tags.short(null, -5)])]),
      inventoryTag([0], [-5], [Tags.struct(null, [Tags.int(null, -1), Tags.short(null, -5), Tags.int(null, 1)])]),
      inventoryTag([0], [-32768], [Tags.struct(null, [])]),
      inventoryTag([0], [-32768], [Tags.struct(null, [Tags.string(null, 'hull')])]),
      inventoryTag([0], [-32768], [Tags.struct(null, [Tags.string(null, 'hull'), Tags.struct(null, [])])]),
    ];
    for (const member of [Tags.struct(null, [Tags.short(null, 5)]), Tags.struct(null, [Tags.short(null, -5), Tags.int(null, 1)])]) {
      malformed.push(inventoryTag([0], [-32768], [Tags.struct(null, [Tags.string(null, 'hull'), member])]));
    }
    malformed.push(inventoryTag([0], [-32768], [Tags.struct(null, [Tags.string(null, 'hull'),
      Tags.struct(null, [Tags.short(null, 5), Tags.int(null, 1)]), Tags.struct(null, [Tags.short(null, 5), Tags.int(null, 2)])])]));
    for (const input of malformed) assert.throws(() => Inventory.fromTag(input));
    const wrongList = inventoryTag(); wrongList.getStruct()[0] = new Tag(TagType.LIST, null, [Tags.short(null, 0)], TagType.SHORT);
    assert.throws(() => Inventory.fromTag(wrongList));
    const wrongStruct = inventoryTag(); wrongStruct.getStruct()[0] = Tags.struct(null, [Tags.short(null, 0)]);
    assert.throws(() => Inventory.fromTag(wrongStruct));
    let deep = inventoryTag(); for (let i = 0; i < 18; i++) deep = Tags.struct('stash', [Tags.nothing(null), deep]);
    assert.throws(() => Inventory.fromTag(deep, { maxDepth: 16 }));
    assert.equal(Inventory.fromTag(deep, { maxDepth: 80 }).size, 2);
    assert.throws(() => writeInventoryWire([new ItemStack(0, -5, 1)]));
    assert.throws(() => writeInventoryWire([new ItemStack(0, 5, 1, { id: 1, type: 2, subId: 0, orientation: 0 })]));
  });
});
