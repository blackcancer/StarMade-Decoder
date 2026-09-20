/** @fileoverview Position-indexed inventory updates preserve complete manager payloads. */
import { assert } from 'chai';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { readFrom, writeTo } from '../../../src/core/TagParser.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { ManagerContainer, PullPermission } from '../../../src/objects/components/ManagerContainer.js';
import { PowerState } from '../../../src/objects/components/PowerAndThrust.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
import { SlotAssignment } from '../../../src/objects/components/SlotAssignment.js';

/** Named stash with extra metadata that must survive content replacement. */
function stash(count: number): Tag {
  return Tags.struct('stash', [Tags.struct('metadata', [Tags.short('production', 5), Tags.string('name', 'retained')]),
    Inventory.EMPTY.set(new ItemStack(7, 5, count)).toTag(), Tags.long('future-stash', 123n)]);
}
/** Independent wire layout: kind, VECTOR3i position, payload and optional extensions. */
function entry(x: number, count: number, kind = 3): Tag {
  return Tags.struct('entry', [Tags.int('kind', kind), Tags.vector3i('position', x, 16, -17), stash(count), Tags.string('extension', 'entry-data')]);
}
/** Complete manager slot layout with an unmodelled tail. */
function manager(entries: Tag[]): ManagerContainer {
  const parts = Array.from({ length: 19 }, () => Tags.nothing(null));
  parts[0] = Tags.struct('inventories', entries); parts[18] = Tags.byteArray('future-manager', Buffer.from([3, 7, 11]));
  return ManagerContainer.fromTag(Tags.struct('container', parts));
}

describe('ManagerContainer inventories', () => {
  it('retains every same-kind position and persists changes to exactly one entry', () => {
    const original = manager([entry(1, 10), entry(2, 20)]), first = { x: 1, y: 16, z: -17 }, second = { x: 2, y: 16, z: -17 };
    assert.equal(original.inventoryEntries.length, 2);
    assert.equal(original.getInventoryAt(first)!.countOf(5), 10); assert.equal(original.getInventoryAt(second)!.countOf(5), 20);
    assert.strictEqual(original.getInventoryAt(first), original.getInventoryAt(first));
    assert.throws(() => original.getInventory(3), 'Several'); assert.throws(() => original.withInventory(3, Inventory.EMPTY), 'Several');
    const edited = original.withInventoryAt(first, Inventory.EMPTY.set(new ItemStack(7, 5, 77)));
    const wire = edited.toTag(), parsed = ManagerContainer.fromTag(readFrom(writeTo(wire)));
    assert.equal(parsed.getInventoryAt(first)!.countOf(5), 77); assert.equal(parsed.getInventoryAt(second)!.countOf(5), 20);
    assert.equal(original.getInventoryAt(first)!.countOf(5), 10);
    const rows = wire.getStruct()[0].getStruct();
    assert.equal(rows[0].getStruct()[2].getStruct()[0].getStruct()[1].getString(), 'retained');
    assert.equal(rows[0].getStruct()[2].getStruct()[2].getLong(), 123n);
    assert.equal(rows[0].getStruct()[3].getString(), 'entry-data');
    assert.deepEqual(writeTo(rows[1]), writeTo(original.toTag().getStruct()[0].getStruct()[1]));
    assert.deepEqual(wire.getStruct()[18].getByteArray(), Buffer.from([3, 7, 11]));
    rows[0].getStruct()[2].getStruct()[0].getStruct()[1] = Tags.string('name', 'changed outside');
    assert.equal(edited.toTag().getStruct()[0].getStruct()[0].getStruct()[2].getStruct()[0].getStruct()[1].getString(), 'retained');
  });

  it('adds/removes explicit positions and keeps the compatibility view synchronized', () => {
    const position = { x: -32, y: 16, z: 17 }, contents = Inventory.EMPTY.add(5, 4);
    assert.isUndefined(ManagerContainer.EMPTY.getInventoryAt(position)); assert.deepEqual(ManagerContainer.EMPTY.inventoryEntries, []);
    assert.isNull(ManagerContainer.EMPTY.relevantElementCountMap);
    const created = ManagerContainer.EMPTY.withInventoryAt(position, contents);
    assert.equal(created.inventoryEntries[0].kind, 3); assert.equal(created.getInventory(3).countOf(5), 4);
    const changedKind = created.withInventoryAt(position, contents, 1); assert.equal(changedKind.inventoryEntries[0].kind, 1);
    assert.equal(changedKind.getInventory(1).countOf(5), 4); assert.strictEqual(changedKind.getInventory(3), Inventory.EMPTY);
    assert.equal(changedKind.withoutInventoryAt(position).inventoryEntries.length, 0);
    assert.strictEqual(changedKind.withoutInventoryAt({ x: 0, y: 0, z: 0 }), changedKind);
    assert.throws(() => created.withInventoryAt(position, contents, -1));
    assert.throws(() => created.getInventoryAt({ x: 0.5, y: 0, z: 0 }));
    assert.throws(() => created.withoutInventoryAt({ x: 0, y: NaN, z: 0 }));
    const compatibility = created.withInventory(3, Inventory.EMPTY.add(5, 9));
    assert.equal(ManagerContainer.fromTag(compatibility.toTag()).getInventoryAt(position)!.countOf(5), 9);
    const origin = ManagerContainer.EMPTY.withInventory(3, contents);
    assert.throws(() => origin.withInventory(1, contents), 'Origin');
    assert.throws(() => origin.withInventory(-1, contents));
    const view = origin.inventories as Map<number, Inventory>; view.clear(); assert.equal(origin.getInventory(3).countOf(5), 4);
  });

  it('rejects malformed or duplicate locations without silently dropping entries', () => {
    const malformed = [Tags.byte(null, 1), Tags.struct(null, []),
      Tags.struct(null, [Tags.int(null, 3)]), Tags.struct(null, [Tags.int(null, 3), Tags.vector3i(null, 1, 2, 3)]),
      Tags.struct(null, [Tags.int(null, 3), Tags.vector3i(null, 1, 2, 3), Tags.struct('inv1', [])])];
    for (const tag of malformed) assert.throws(() => manager([tag]).inventoryEntries);
    assert.throws(() => manager([entry(1, 10), entry(1, 20, 1)]).inventoryEntries, 'Duplicate');
    const input = entry(1, 10), inventoryManager = manager([input]);
    input.getStruct()[1] = Tags.vector3i(null, 100, 0, 0);
    assert.equal(inventoryManager.inventoryEntries[0].key, '1,16,-17');
    const entries = inventoryManager.inventoryEntries as unknown[]; entries.length = 0;
    assert.equal(inventoryManager.inventoryEntries.length, 1);
  });

  it('persists explicit compatibility edits while retaining unrelated raw entries', () => {
    const raw = Tags.struct('inventories', [Tags.byte('unrecognized', 7),
      Tags.struct(null, [Tags.string('kind', 'future')]),
      Tags.struct('legacy', [Tags.int(null, 2), Tags.nothing(null), Tags.nothing(null)])]);
    const original = new ManagerContainer(new Map(), 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, PullPermission.ALL, [raw]);
    const edited = original.withInventory(2, Inventory.EMPTY.add(5, 7));
    assert.equal(edited.getInventory(2).countOf(5), 7);
    assert.equal(edited.toTag().getStruct()[0].getStruct()[0].getByte(), 7);
    assert.equal(edited.toTag().getStruct()[0].getStruct()[1].getStruct()[0].getString(), 'future');
    const map = new Map([[2, Inventory.EMPTY]]);
    const snapshot = new ManagerContainer(map, 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, PullPermission.ALL, []);
    map.clear(); assert.equal(snapshot.inventories.size, 1);
  });
});
