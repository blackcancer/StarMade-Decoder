/** @fileoverview Typed projections of actual metadata archive sectors and opaque object payloads. */
import { strict as assert } from 'node:assert';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo } from '../../src/core/TagParser.js';
import { FloatingItem, FloatingItemsArchive } from '../../src/objects/FloatingItems.js';
import { parseFloatingItems } from '../../src/entity/FloatingItems.js';

describe('parseFloatingItems — actual metadata projection', () => {
  it('exposes identifiers, next-id counter, sectors and detached opaque payloads', () => {
    const position = { x: -3, y: 0, z: 99 };
    const root = FloatingItemsArchive.create(25)
      .addItem(position, new FloatingItem(3, -7, Tags.byteArray('payload', [1, 2]), 8))
      .addItem(position, new FloatingItem(4, -7, Tags.string(null, 'other'))).toTag();
    const before = writeTo(root), parsed = parseFloatingItems(root);
    assert.equal(parsed.version, 0); assert.equal(parsed.nextId, 25); assert.equal(parsed.format, 'modern');
    assert.deepEqual(parsed.sectors[0].position, position); assert.equal(parsed.sectors.length, 1);
    assert.equal(parsed.items.length, 2); assert.equal(parsed.sectors[0].items.length, 2);
    assert.deepEqual(parsed.items[0].sector, position); assert.equal(parsed.items[0].id, 3);
    assert.equal(parsed.items[0].type, -7); assert.equal(parsed.items[0].subObjectId, 8);
    assert.deepEqual([...parsed.items[0].payload.getByteArray()], [1, 2]);
    assert.equal(parsed.items[1].payload.getString(), 'other');
    parsed.items[0].payload.getByteArray()[0] = 99;
    parsed.sectors[0].position.x = 123; parsed.items[0].sector.x = 456;
    assert.deepEqual(writeTo(root), before);
  });
  it('supports empty historical roots and rejects the false type/count tuples', () => {
    assert.deepEqual(parseFloatingItems(Tags.struct(null, [])), {
      version: 0, nextId: 0, format: 'legacy', sectors: [], items: [],
    });
    assert.throws(() => parseFloatingItems(Tags.int(null, 1)), TypeError);
    assert.throws(() => parseFloatingItems(Tags.struct('moi', [Tags.byte(null, 0), Tags.int(null, 8),
      Tags.struct('floatingItems', [Tags.struct(null, [Tags.short(null, 7), Tags.int(null, 3)])])])), { code: 'E_FORMAT' });
  });
});
