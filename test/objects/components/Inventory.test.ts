/** @fileoverview Immutable collection operations, ownership and caller-supplied limits. */
import { assert } from 'chai';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { Tags } from '../../../src/core/TagBuilder.js';

describe('Inventory collection', () => {
  it('copies caller-owned maps and stack metadata and applies explicit slot limits', () => {
    const meta = { id: 3, type: 2, subId: 1, orientation: 0 }, stack = new ItemStack(4, 5, 3, meta);
    meta.id = 7; assert.equal(stack.meta!.id, 3); stack.meta!.id = 8; assert.equal(stack.meta!.id, 3);
    const source = new Map([[4, stack]]), inventory = new Inventory(source, 1); source.clear();
    assert.equal(inventory.size, 1); assert.isTrue(inventory.isFull); assert.equal(inventory.maxSlots, 1);
    assert.throws(() => inventory.set(new ItemStack(5, 8, 1))); assert.equal(inventory.size, 1);
    assert.equal(inventory.set(stack.withCount(0)).size, 0);
    assert.isFalse(Inventory.EMPTY.isFull);
    assert.throws(() => new Inventory(new Map([[0, stack]])));
    assert.throws(() => new Inventory(new Map(), -1));
    assert.throws(() => new ItemStack(-1, 1, 1));
    assert.throws(() => new ItemStack(0, 1, -1));
    for (const type of [-32769, 32768, 1.5]) assert.throws(() => new ItemStack(0, type, 1));
    const mixed = Inventory.EMPTY.set(stack).set(new ItemStack(0, 5, 2));
    assert.equal(Inventory.fromLegacyTag(mixed.toLegacyTag()).countOf(5), 5);
    assert.throws(() => Inventory.fromTag(mixed.toLegacyTag()));
    assert.throws(() => mixed.toTag());
    assert.equal(stack.withSlot(8).slot, 8); assert.equal(stack.withCount(2).count, 2); assert.equal(stack.withType(9).type, 9);
    assert.isTrue(Object.isFrozen(stack));
    assert.deepEqual(JSON.parse(JSON.stringify(stack)), { slot: 4, type: 5, count: 3, meta: { id: 3, type: 2, subId: 1, orientation: 0 } });
    assert.equal(JSON.parse(JSON.stringify(inventory)).maxSlots, 1);
    assert.deepEqual(Inventory.EMPTY.toJSON(), { items: [], maxSlots: null });
    assert.deepEqual(new ItemStack(0, 5, 1).toJSON(), { slot: 0, type: 5, count: 1 });
    assert.equal(Inventory.fromLegacyTag(Tags.struct(null, [])).size, 0);
    assert.equal(Inventory.fromLegacyTag(Tags.struct(null, [Tags.byte(null, 0)])).size, 0);
    assert.equal(Inventory.fromLegacyTag(Tags.struct(null, [Tags.struct(null, [Tags.int(null, 0)])])).size, 0);
    assert.equal(Inventory.fromLegacyTag(Tags.struct(null, [Tags.struct(null, [Tags.int(null, 0)]), Tags.struct(null, [Tags.short(null, 5)])])).size, 0);
  });

  it('adds, splits and merges regular values without overflow or partial changes', () => {
    const original = Inventory.EMPTY.add(5, 10), added = original.add(5, 2);
    assert.equal(original.get(0)!.count, 10); assert.equal(added.get(0)!.count, 12);
    const other = added.add(8, 4); assert.equal(other.get(1)!.type, 8);
    const split = other.split(0, 2, 3); assert.equal(split.get(0)!.count, 9); assert.equal(split.get(2)!.count, 3);
    const merged = split.merge(2, 0); assert.equal(merged.get(0)!.count, 12); assert.isFalse(merged.has(2));
    const moved = merged.split(0, 4, 12); assert.isFalse(moved.has(0)); assert.equal(moved.get(4)!.count, 12);
    assert.equal(Inventory.EMPTY.add(5, 0x7fffffff).add(5, 1).size, 2);
    assert.throws(() => Inventory.EMPTY.add(0, 1)); assert.throws(() => Inventory.EMPTY.add(1, 0));
    assert.throws(() => other.add(5, 1, 1)); assert.throws(() => original.add(5, 0x7fffffff, 0));
    assert.throws(() => original.split(0, 0, 1)); assert.throws(() => original.split(99, 1, 1));
    assert.throws(() => original.split(0, 1, 0)); assert.throws(() => original.split(0, 1, 11));
    assert.throws(() => original.split(0, -1, 1)); assert.equal(original.get(0)!.count, 10);
    assert.throws(() => original.merge(0, 0)); assert.throws(() => other.merge(0, 1));
    assert.throws(() => original.merge(0, 99));
    assert.throws(() => Inventory.EMPTY.set(new ItemStack(0, 5, 0x7fffffff)).set(new ItemStack(1, 5, 1)).merge(1, 0));
  });

  it('moves values between immutable inventories and validates the whole destination before returning', () => {
    const original = Inventory.EMPTY.add(5, 10), destination = Inventory.EMPTY.add(5, 2);
    const partial = original.transferTo(destination, 0, 0, 3);
    assert.equal(partial.source.get(0)!.count, 7); assert.equal(partial.target.get(0)!.count, 5);
    assert.equal(original.get(0)!.count, 10); assert.equal(destination.get(0)!.count, 2);
    const complete = original.transferTo(Inventory.EMPTY, 0, 4);
    assert.equal(complete.source.size, 0); assert.equal(complete.target.get(4)!.count, 10);
    const emptyPartial = original.transferTo(Inventory.EMPTY, 0, 7, 2);
    assert.equal(emptyPartial.target.get(7)!.count, 2); assert.equal(emptyPartial.source.get(0)!.count, 8);
    assert.throws(() => original.transferTo(original, 0, 1));
    assert.throws(() => original.transferTo(Inventory.EMPTY.add(8, 1), 0, 0));
    assert.throws(() => original.transferTo(Inventory.EMPTY, 0, 0, 11));
    assert.throws(() => original.transferTo(Inventory.EMPTY, 0, 0, 0));
    assert.throws(() => original.transferTo(new Inventory(new Map(), 0), 0, 0));
    assert.throws(() => original.transferTo(Inventory.EMPTY, 0, 0, 10, { maximum: 19, volumeOf: () => 2 }));
    const limited = original.transferTo(Inventory.EMPTY, 0, 0, 10, { maximum: 20, volumeOf: () => 2 });
    assert.equal(limited.target.usedVolume(() => 2), 20);
    assert.equal(original.get(0)!.count, 10);
  });

  it('keeps metadata and grouped members intact and rejects incompatible mutations', () => {
    const payload = Tags.byteArray(null, Buffer.from([1, 2]));
    const special = ItemStack.special(0, { id: 9, type: -5, subId: 1, payload }); payload.getByteArray()[0] = 9;
    assert.equal(special.meta!.payload!.getByteArray()[0], 1);
    assert.throws(() => special.withCount(2)); assert.throws(() => special.withType(-6));
    assert.throws(() => ItemStack.special(0, { id: -1, type: -5, subId: 1, payload }));
    for (const subId of [-32769, 32768, 0.5]) assert.throws(() => ItemStack.special(0, { id: 1, type: -5, subId, payload }));
    for (const type of [5, -32768]) assert.throws(() => ItemStack.special(0, { id: 1, type, subId: 0, payload }));
    const members = [{ type: 5, count: 3 }, { type: 8, count: 4 }], grouped = ItemStack.grouped(1, 'group', members);
    members[0].count = 99; assert.equal(grouped.group!.items[0].count, 3);
    assert.equal(JSON.parse(JSON.stringify(grouped)).group.items[0].count, 3);
    assert.throws(() => grouped.withCount(1)); assert.throws(() => grouped.withType(5));
    assert.equal(grouped.withCount(7).count, 7); assert.equal(grouped.withType(-32768).type, -32768);
    const inventory = Inventory.EMPTY.set(special).set(grouped);
    assert.throws(() => inventory.toLegacyTag());
    assert.throws(() => Inventory.EMPTY.set(special).toLegacyTag());
    assert.throws(() => inventory.split(0, 3, 1)); assert.throws(() => inventory.split(1, 3, 1));
    assert.throws(() => inventory.transferTo(Inventory.EMPTY, 1, 3, 1));
    const moved = inventory.transferTo(Inventory.EMPTY, 1, 4); assert.equal(moved.target.countOf(8), 4);
    assert.equal(inventory.transferTo(Inventory.EMPTY, 0, 5).target.get(5)!.meta!.id, 9);
    const regular = Inventory.EMPTY.add(5, 2);
    for (const item of [special, grouped, new ItemStack(0, 5, 1, { id: 1, type: 2, subId: 0, orientation: 0 })]) {
      const target = Inventory.EMPTY.set(item.withSlot(0));
      assert.throws(() => regular.transferTo(target, 0, 0));
      assert.throws(() => target.transferTo(regular, 0, 0));
    }
    const legacy = new ItemStack(0, 5, 2, { id: 1, type: 2, subId: 0, orientation: 0 });
    assert.throws(() => Inventory.EMPTY.set(legacy).add(5, 1, 0));
    assert.equal(Inventory.EMPTY.set(legacy).add(5, 1).get(1)!.count, 1);
    for (const [a, b] of [[legacy, new ItemStack(1, 5, 1)], [new ItemStack(0, 5, 1), legacy.withSlot(1)], [grouped.withSlot(0), grouped], [grouped.withSlot(0), new ItemStack(1, -32768, 7)]]) {
      assert.throws(() => Inventory.EMPTY.set(a).set(b).merge(0, 1));
    }
    assert.throws(() => ItemStack.grouped(0, 'empty', []));
    for (const items of [[{ type: 0, count: 1 }], [{ type: 5, count: 0 }], [{ type: 5, count: 1 }, { type: 5, count: 2 }], [{ type: -1, count: 1 }], [{ type: 5, count: -1 }]]) {
      assert.throws(() => ItemStack.grouped(0, 'bad', items));
    }
    assert.throws(() => new ItemStack(0, 5, 1, undefined, { name: 'bad', items: [{ type: 5, count: 1 }] }));
    assert.throws(() => new ItemStack(0, -32768, 1, legacy.meta, { name: 'bad', items: [{ type: 5, count: 1 }] }));
    assert.throws(() => ItemStack.grouped(0, 2 as unknown as string, [{ type: 5, count: 1 }]));
    assert.throws(() => new ItemStack(0, -32768, 2, undefined, { name: 'bad', items: [{ type: 5, count: 1 }] }));
  });

  it('uses explicit volume policies and rejects invalid or overflowing constraints', () => {
    const grouped = ItemStack.grouped(2, 'group', [{ type: 5, count: 3 }, { type: 8, count: 4 }]);
    const inventory = Inventory.EMPTY.add(5, 2).set(grouped);
    const volumeOf = (type: number): number => type === 5 ? 2 : 3;
    assert.equal(inventory.usedVolume(volumeOf), 22);
    assert.strictEqual(inventory.assertCapacity({ maximum: 22, volumeOf }), inventory);
    assert.throws(() => inventory.assertCapacity({ maximum: 21, volumeOf }));
    for (const maximum of [-1, Infinity, NaN]) assert.throws(() => inventory.assertCapacity({ maximum, volumeOf }));
    for (const volume of [-1, Infinity, NaN, Number.MAX_VALUE]) assert.throws(() => inventory.usedVolume(() => volume));
    assert.equal(inventory.usedVolume(() => 0), 0);
    assert.equal(Inventory.EMPTY.usedVolume(volumeOf), 0);
  });
});
