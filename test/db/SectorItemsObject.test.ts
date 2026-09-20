import { assert } from 'chai';
import { SectorItemsObject } from '../../src/db/SectorItemsObject.js';
import { encodeSectorItems, MAX_ITEMS_PER_SECTOR } from '../../src/db/SectorItems.js';

const item = { blockType: -2, count: 4, posX: 1, posY: 2, posZ: 3, metaId: 5 };
describe('SectorItemsObject integrity', () => {
  it('detaches input and returned item records', () => {
    const input = { ...item };
    const model = SectorItemsObject.from([input]);
    input.count = 99;
    model.items[0].count = 98;
    model.byType(-2)[0].metaId = 97;
    assert.deepEqual(model.items, [item]);
  });
  it('preserves non-padding records and metadata through merging', () => {
    const sentinel = { ...item, blockType: 0, count: 0 };
    assert.deepEqual(SectorItemsObject.fromBytes(encodeSectorItems([sentinel])).items, [sentinel]);
    const model = SectorItemsObject.from([item, { ...item, count: 7 }]);
    assert.equal(model.withMerged(-2).items[0].metaId, 5);
    assert.throws(() => model.withItem({ ...item, metaId: 6 }).withMerged(-2));
    assert.equal(model.size, 2);
  });
  it('rejects integer overflow and float coercion at construction', () => {
    assert.throws(() => SectorItemsObject.from([{ ...item, count: 2 ** 31 }]));
    assert.throws(() => SectorItemsObject.from([{ ...item, posX: '1' } as any]));
    assert.throws(() => SectorItemsObject.from([{ ...item, posY: 1e100 }]));
  });
  it('distinguishes padding from type-zero and signed-zero records without applying gameplay filters', () => {
    const zero = { blockType: 0, count: 0, posX: 0, posY: 0, posZ: 0, metaId: 0 };
    const values = [{ ...zero, posX: -0 }, { ...zero, metaId: -1 }, { ...zero, posY: 1 },
      { ...zero, count: 3 }, { ...zero, blockType: -1 }];
    const body = encodeSectorItems(values);
    const model = SectorItemsObject.fromBytes(new Uint8Array(Buffer.concat([Buffer.alloc(22), body, Buffer.alloc(25)])));
    assert.deepEqual(model.items, values);
    assert.deepEqual(model.toBytes(), body);
    assert.throws(() => SectorItemsObject.from([zero]), /padding/);
    assert.throws(() => SectorItemsObject.empty().withItem(zero), /padding/);
    assert.isTrue(SectorItemsObject.fromBytes(Buffer.alloc(44)).isEmpty);
  });

  it('validates all persisted integer widths, capacity and merged count overflow', () => {
    const original = SectorItemsObject.from([item]);
    const before = original.toBytes();
    for (const patch of [{ blockType: 32768 }, { blockType: -32769 }, { count: -2147483649 },
      { metaId: 2147483648 }, { count: 0.5 }, { posZ: null }]) {
      assert.throws(() => original.withItem({ ...item, ...patch } as any));
    }
    const full = Array.from({ length: MAX_ITEMS_PER_SECTOR }, () => ({ ...item }));
    assert.equal(SectorItemsObject.fromBytes(SectorItemsObject.from(full).toBytes()).size, MAX_ITEMS_PER_SECTOR);
    assert.throws(() => SectorItemsObject.from([...full, item]));
    assert.throws(() => SectorItemsObject.fromBytes(Buffer.concat([encodeSectorItems(full), encodeSectorItems([item])])));
    const overflow = SectorItemsObject.from([{ ...item, count: 2147483647 }, { ...item, count: 1 }]);
    assert.throws(() => overflow.withMerged(item.blockType));
    assert.equal(overflow.totalCount(item.blockType), 2147483648);
    const other = { ...item, blockType: 2 };
    const merged = original.withItem(item).withItem(other).withMerged(item.blockType);
    assert.deepEqual(merged.byType(2), [other]);
    assert.deepEqual(merged.byType(item.blockType), [{ ...item, count: 8, posX: 0, posY: 0, posZ: 0 }]);
    assert.deepEqual(original.toBytes(), before);
    assert.throws(() => { (original as any).items = []; }, TypeError);
  });

  it('keeps nonfinite floats explicit in JSON and detaches projections', () => {
    const model = SectorItemsObject.from([{ ...item, posX: Infinity, posY: -Infinity, posZ: NaN }, item]);
    const parsed = SectorItemsObject.fromBytes(model.toBytes());
    assert.deepEqual(parsed.items, model.items);
    const json = JSON.parse(JSON.stringify(parsed));
    assert.deepEqual(json.items[0], { ...item, posX: 'Infinity', posY: '-Infinity', posZ: 'NaN' });
    json.items[1].count = 99;
    assert.equal(parsed.items[1].count, 4);
  });
});
