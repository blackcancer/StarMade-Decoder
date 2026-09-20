/** @fileoverview Actual archived metadata objects: sector grouping, identifiers, opaque payloads and immutable edits. */
import fs from 'node:fs';
import { strict as assert } from 'node:assert';
import { gzipSync } from 'node:zlib';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { readFrom, writeTo } from '../../src/core/TagParser.js';
import { FloatingItem, FloatingItemSector, FloatingItemsArchive } from '../../src/objects/FloatingItems.js';

const pos = { x: -4, y: 8, z: 12 };
/** Independent record matching MetaObjectManager's archive, with future data at every nesting level. */
function fixture(legacy = false, subtype = true): Tag {
  const item = Tags.struct('record', [Tags.int('identifier', 101), Tags.short('kind', -5),
    Tags.struct('opaque', [Tags.byteArray('bytes', [0, 255, 17]), Tags.string('owner', 'NUL\0🚀')]),
    ...(subtype ? [Tags.short('subtype', 2)] : []), Tags.long('itemExtension', 9001n)]);
  const sectors = [Tags.struct('sector', [Tags.vector3i('position', pos.x, pos.y, pos.z),
    Tags.struct('objects', [item]), Tags.string('sectorExtension', 'keep')])];
  return legacy ? Tags.struct('oldArchive', sectors) : Tags.struct('moi', [Tags.byte('version', 0),
    Tags.int('generator', 200), Tags.struct('floatingItems', sectors), Tags.int('rootExtension', 77)]);
}

describe('FloatingItemsArchive V2 — actual metadata archive', () => {
  it('reads sector/object records and preserves every unknown field without inventing quantities', () => {
    const root = fixture();
    const archive = FloatingItemsArchive.fromTag(root);
    assert.equal(archive.nextId, 200); assert.equal(archive.totalCount, 1);
    assert.deepEqual(archive.sectors[0].position, pos);
    assert.equal(archive.item(101)!.blockType, -5); assert.equal(archive.item(101)!.subObjectId, 2);
    assert.equal(archive.item(101)!.payload.findByName('owner')!.getString(), 'NUL\0🚀');
    assert.deepEqual(writeTo(archive.toTag()), writeTo(root));
    const changed = archive.updateItem(archive.item(101)!.withPayload(Tags.byteArray('newPayload', [1, 2])));
    assert.deepEqual([...changed.item(101)!.payload.getByteArray()], [1, 2]);
    for (const name of ['itemExtension', 'sectorExtension', 'rootExtension']) assert.ok(changed.toTag().findByName(name));
    assert.equal(archive.item(101)!.payload.type, TagType.STRUCT);
  });

  it('creates typed objects, maintains a collision-free identifier counter and removes by identifier', () => {
    const original = FloatingItemsArchive.create(10);
    const item = new FloatingItem(20, -3, Tags.byteArray(null, [1, 2]), 7);
    const added = original.addItem(pos, item).addItem(pos, new FloatingItem(21, -3, Tags.string(null, 'second')));
    assert.equal(original.totalCount, 0); assert.equal(added.nextId, 22);
    assert.equal(added.byType(-3)!.id, 20); assert.equal(added.itemsOfType(-3).length, 2);
    assert.equal(added.sector(pos)!.items.length, 2);
    const decoded = FloatingItemsArchive.fromBuffer(added.toBuffer());
    assert.equal(decoded.item(21)!.payload.getString(), 'second');
    assert.equal(decoded.removeItem(20).item(20), undefined);
    assert.equal(decoded.removeItem(20).item(21)!.id, 21);
    assert.equal(decoded.withNextId(30).nextId, 30);
    assert.equal(decoded.removeSector(pos).totalCount, 0);
    assert.match(decoded.toString(), /nextId=22/); assert.match(item.toString(), /id=20/);
  });

  it('preserves plain/GZIP envelopes and trailing bytes exactly when unchanged', () => {
    const root = fixture(); const plain = writeTo(root); plain.writeInt16BE(17, 0);
    for (const bytes of [Buffer.concat([plain, Buffer.from([0xaa])]), gzipSync(Buffer.concat([plain.subarray(2), Buffer.from([0xbb])]))]) {
      const archive = FloatingItemsArchive.fromBuffer(bytes);
      assert.deepEqual(archive.toBuffer(), bytes);
      const changed = archive.withNextId(300);
      const parsed = FloatingItemsArchive.fromBuffer(changed.toBuffer());
      assert.equal(parsed.nextId, 300); assert.equal(parsed.item(101)!.id, 101);
      assert.deepEqual(archive.toBuffer(), bytes);
    }
    const real = fs.readFileSync('samples/FLOATING_ITEMS_ARCHIVE.ent');
    assert.deepEqual(FloatingItemsArchive.fromBuffer(real).toBuffer(), real);
  });

  it('supports the actual older sector-root format without mistaking old SDK tuples for it', () => {
    const root = fixture(true, false), archive = FloatingItemsArchive.fromTag(root);
    assert.equal(archive.format, 'legacy'); assert.equal(archive.item(101)!.subObjectId, -1);
    assert.deepEqual(writeTo(archive.toTag()), writeTo(root));
    const changed = archive.updateItem(archive.item(101)!.withSubObjectId(4));
    assert.equal(changed.item(101)!.subObjectId, 4);
    assert.equal(changed.toTag().findByName('itemExtension')!.getLong(), 9001n);
    assert.equal(archive.toModern(200).format, 'modern');
    assert.equal(archive.toModern(200).nextId, 200);
    assert.throws(() => archive.withNextId(200), /modern/);
    assert.throws(() => FloatingItemsArchive.fromTag(Tags.struct(null, [Tags.byte(null, 0), Tags.int(null, 9), Tags.struct('floatingItems', [])])));
    assert.throws(() => FloatingItem.fromTag(Tags.struct(null, [Tags.short(null, 5), Tags.int(null, 10)])));
  });

  it('isolates caller collections, sector coordinates, payloads and all returned Tags', () => {
    const payload = Tags.byteArray(null, [1, 2]); const item = new FloatingItem(1, -1, payload);
    const coordinates = { ...pos }, items = [item], sector = new FloatingItemSector(coordinates, items);
    const sectors = [sector], archive = new FloatingItemsArchive(0, 10, sectors);
    coordinates.x = 999; items.length = 0; sectors.length = 0; payload.getByteArray()[0] = 99;
    sector.position.x = 222; sector.items.length = 0; archive.items.length = 0; archive.sectors.length = 0;
    item.payload.getByteArray()[0] = 88; archive.toTag().getStruct().pop();
    assert.deepEqual(archive.sectors[0].position, pos); assert.equal(archive.totalCount, 1);
    assert.deepEqual([...archive.item(1)!.payload.getByteArray()], [1, 2]);
    assert.throws(() => { (item as any).id = 9; }, TypeError);
    assert.throws(() => { (archive as any).nextId = 99; }, TypeError);
  });

  it('edits one object or sector while retaining unrelated records and unknown data', () => {
    const saved = FloatingItemsArchive.fromTag(fixture());
    const otherPosition = { x: 0, y: 0, z: 0 };
    const other = saved.item(101)!.withId(102).withBlockType(-7);
    const archive = saved.addItem(otherPosition, other).addItem(pos, other.withId(103));
    assert.equal(archive.nextId, 200);
    assert.equal(archive.sector(otherPosition)!.items[0].id, 102);
    const replaced = archive.updateItem(new FloatingItem(101, -9, Tags.string(null, 'replacement')));
    assert.equal(replaced.item(101)!.payload.getString(), 'replacement');
    assert.equal(replaced.item(102)!.blockType, -7); assert.equal(replaced.item(103)!.blockType, -7);
    assert.equal(replaced.toTag().findByName('itemExtension')!.getLong(), 9001n);
    const removed = replaced.removeSector(pos);
    assert.equal(removed.totalCount, 1); assert.equal(removed.item(102)!.id, 102);
    assert.equal(removed.sector(pos), undefined); assert.equal(removed.byType(999), undefined);
    assert.equal(removed.itemsOfType(999).length, 0);
    const moved = archive.sector(pos)!.withPosition({ x: 99, y: 8, z: 12 });
    assert.equal(moved.position.x, 99); assert.equal(archive.sector(pos)!.position.x, -4);
    assert.equal(moved.toTag().findByName('sectorExtension')!.getString(), 'keep');
    assert.deepEqual(writeTo(archive.toModern().toTag()), writeTo(archive.toTag()));
  });

  it('handles empty historical archives and absent subtypes without synthesizing saved fields', () => {
    const historical = FloatingItemsArchive.fromBuffer(new Uint8Array(writeTo(Tags.struct(null, []))));
    assert.equal(historical.format, 'legacy'); assert.equal(historical.nextId, 0);
    assert.equal(historical.toModern().format, 'modern'); assert.equal(historical.toModern().nextId, 0);
    assert.equal(FloatingItemsArchive.create().nextId, 100010);
    assert.equal(new FloatingItemsArchive().totalCount, 0);
    const record = Tags.struct(null, [Tags.int(null, 3), Tags.short(null, -2), Tags.nothing(null)]);
    const item = FloatingItem.fromTag(record);
    assert.equal(item.subObjectId, -1); assert.deepEqual(writeTo(item.toTag()), writeTo(record));
    assert.equal(FloatingItem.fromTag(item.withSubObjectId(2).toTag()).subObjectId, 2);
    const root = Tags.struct('moi', [Tags.byte(null, 0), Tags.int(null, 9), Tags.struct(null, [])]);
    assert.deepEqual(writeTo(FloatingItemsArchive.fromTag(root).toTag()), writeTo(root));
  });

  it('rejects malformed records instead of dropping a record or inventing data', () => {
    const badRecords = [Tags.int(null, 1), Tags.struct(null, []),
      Tags.struct(null, [Tags.int(null, 1)]), Tags.struct(null, [Tags.int(null, 1), Tags.int(null, 2)]),
      Tags.struct(null, [Tags.int(null, 1), Tags.short(null, 2)])];
    for (const record of badRecords) assert.throws(() => FloatingItem.fromTag(record), { code: 'E_FORMAT' });
    const badSectors = [Tags.int(null, 1), Tags.struct(null, []),
      Tags.struct(null, [Tags.vector3i(null, 0, 0, 0)]),
      Tags.struct(null, [Tags.vector3i(null, 0, 0, 0), Tags.int(null, 1)])];
    for (const sector of badSectors) assert.throws(() => FloatingItemSector.fromTag(sector), { code: 'E_FORMAT' });
    for (const fields of [[], [Tags.byte(null, 0)], [Tags.byte(null, 0), Tags.int(null, 5)],
      [Tags.int(null, 0), Tags.int(null, 5), Tags.struct(null, [])],
      [Tags.byte(null, 0), Tags.short(null, 5), Tags.struct(null, [])],
      [Tags.byte(null, 0), Tags.int(null, 5), Tags.int(null, 0)]]) {
      assert.throws(() => FloatingItemsArchive.fromTag(Tags.struct('moi', fields)), { code: 'E_FORMAT' });
    }
    const valid = new FloatingItem(1, -2, Tags.nothing(null)).toTag();
    const mixed = Tags.struct('moi', [Tags.byte(null, 0), Tags.int(null, 9), Tags.struct(null, [
      Tags.struct(null, [Tags.vector3i(null, 0, 0, 0), Tags.struct(null, [valid, badRecords[1], valid])])])]);
    assert.throws(() => FloatingItemsArchive.fromTag(mixed), { code: 'E_FORMAT' });
  });

  it('enforces identifiers, binary ranges, supported versions and unique sector membership', () => {
    const payload = Tags.nothing(null), item = new FloatingItem(1, -2, payload);
    for (const id of [-1, 1.5, 0x80000000, NaN]) assert.throws(() => new FloatingItem(id, -2, payload), { code: 'E_RANGE' });
    for (const type of [-32769, 32768, 1.5, NaN]) {
      assert.throws(() => item.withBlockType(type), { code: 'E_RANGE' });
      assert.throws(() => item.withSubObjectId(type), { code: 'E_RANGE' });
    }
    for (const invalid of [null, FINISH_TAG]) assert.throws(() => new FloatingItem(1, 1, invalid as any), { code: 'E_FORMAT' });
    assert.throws(() => new FloatingItemSector(null as any, []), { code: 'E_FORMAT' });
    for (const x of [-2147483649, 2147483648, 1.5, NaN]) assert.throws(() => new FloatingItemSector({ ...pos, x }, []), { code: 'E_RANGE' });
    assert.throws(() => new FloatingItemSector(pos, [null as any]), { code: 'E_FORMAT' });
    assert.throws(() => new FloatingItemSector(pos, [item, item]), { code: 'E_FORMAT' });
    const sector = new FloatingItemSector(pos, [item]);
    assert.throws(() => new FloatingItemsArchive(1), { code: 'E_UNSUPPORTED' });
    assert.throws(() => new FloatingItemsArchive(0, -1), { code: 'E_RANGE' });
    assert.throws(() => new FloatingItemsArchive(0, 10, [null as any]), { code: 'E_FORMAT' });
    assert.throws(() => new FloatingItemsArchive(0, 10, [sector, sector]), { code: 'E_FORMAT' });
    assert.throws(() => new FloatingItemsArchive(0, 10, [sector, sector.withPosition({ x: 0, y: 0, z: 0 })]), { code: 'E_FORMAT' });
    assert.throws(() => new FloatingItemsArchive(0, 1, [sector]), { code: 'E_RANGE' });
    const archive = new FloatingItemsArchive(0, 10, [sector]);
    assert.throws(() => archive.addItem(pos, item), { code: 'E_FORMAT' });
    assert.throws(() => archive.addItem(pos, item.withId(0x7fffffff)), { code: 'E_RANGE' });
    assert.throws(() => archive.updateItem(item.withId(2)), { code: 'E_FORMAT' });
    assert.throws(() => archive.updateItem(null as any), { code: 'E_FORMAT' });
    assert.throws(() => archive.removeItem(-1), { code: 'E_RANGE' });
    assert.throws(() => archive.withNextId(1), { code: 'E_RANGE' });
    assert.equal(archive.totalCount, 1);
  });
});
