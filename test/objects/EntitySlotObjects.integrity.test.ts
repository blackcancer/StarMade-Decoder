/** @fileoverview Detached nested entity records, persisted extension fields and retained resource limits. */
import assert from 'node:assert/strict';
import { Tags } from '../../src/core/TagBuilder.js';
import { TagType } from '../../src/core/TagType.js';
import { Tag } from '../../src/core/Tag.js';
import { writeTo } from '../../src/core/TagParser.js';
import { fieldValueAsBigInt, fieldValueAsNumber, fieldValueAsInteger } from '../../src/objects/EntityFieldView.js';
import { Inventory } from '../../src/objects/components/Inventory.js';
import * as S from '../../src/objects/EntitySlotObjects.js';

describe('Entity slot integrity', () => {
  it('detaches the input, output and option objects uniformly for every Tag-backed view', () => {
    const records = [S.UniqueSegmentPieceState, S.RailRequestState, S.QuarterState, S.ScanDataRecord, S.ManagerModuleEntryState, S.ModuleExplosionState];
    const derived = Object.values(S).filter(value => typeof value === 'function' && value.prototype instanceof S.EntSlotObject);
    for (const Ctor of [...records, ...derived]) {
      let extension = Tags.string('value', 'retained');
      for (let level = 0; level < 70; level++) extension = Tags.struct('extension', [extension]);
      const source = Tags.struct('record', [extension]), options = { maxDepth: 80 };
      const model = new (Ctor as any)(source, options), original = writeTo(source, options);
      options.maxDepth = 1; source.getStruct()[0] = Tags.byte(null, 1);
      model.toTag().getStruct()[0] = Tags.byte(null, 2);
      assert.deepEqual(writeTo(model.toTag(), { maxDepth: 80 }), original, Ctor.name);
      assert.ok(Object.isFrozen(model), Ctor.name);
      assert.throws(() => new (Ctor as any)(model.toTag()), { code: 'E_LIMIT' }, Ctor.name);
    }
    const source = Tags.struct(null, [Tags.string('editable', 'before')]);
    const model = new S.EntSlotObject('Generic', source, { maxInflatedBytes: 100 });
    const next = model.withFieldValue(0, 'after'); source.getStruct()[0] = Tags.byte(null, 1);
    next.toTag().getStruct()[0].value = 'outside';
    assert.equal(next.getField(0)!.value, 'after'); assert.equal(model.getField(0)!.value, 'before');
    assert.throws(() => next.withFieldValue(0, 'x'.repeat(200)), /limit|budget/i);
    for (const index of [.5, NaN, Infinity]) assert.throws(() => model.withFieldValue(index, 'invalid'), RangeError);
  });

  it('retains piece extensions and names through each immutable field edit', () => {
    const initial = S.UniqueSegmentPieceState.from({ version: 1, entityUid: 'ship', position: { x: 1, y: 2, z: 3 }, type: 5, orientation: 2, active: true, hitpoints: 99 }).toTag();
    initial.getStruct().splice(-1, 0, Tags.struct('future', [Tags.byteArray('payload', [1, 0, 255])]));
    initial.getStruct()[1] = Tags.string('original-uid', 'ship');
    const model = new S.UniqueSegmentPieceState(initial), next = model.withEntityUid('changed').withPosition({ x: -1, y: 0, z: 1 }).withType(8).withOrientation(4).withActive(false).withHitpoints(70);
    assert.equal(next.toTag().getStruct()[1].name, 'original-uid');
    assert.deepEqual(writeTo(next.toTag().getStruct()[7]), writeTo(initial.getStruct()[7]));
    assert.throws(() => { (model.position as any).x = 99; }, TypeError);
    assert.equal(model.entityUid, 'ship');
    assert.equal(S.UniqueSegmentPieceState.from({ ...model.toJSON(), active: false }).active, false);
    const partial = new S.QuarterState(Tags.struct(null, []));
    assert.equal(partial.toJSON().extra, null);
    assert.throws(() => new S.QuarterManagerState(Tags.struct(null, [])).withQuarter(0, partial), RangeError);
  });

  it('preserves history and saved-coordinate extensions with exact numeric widths', () => {
    const history = Tags.struct('history', [Tags.long('when', 9223372036854775807n), Tags.string('address', '::1'), Tags.string('player', 'Ada'), Tags.int('future', 9)]);
    const model = S.PlayerInfoHistoryEntry.fromTag(history, { maxInflatedBytes: 160 });
    history.getStruct()[3].value = 1;
    const changed = model.withTime(-9223372036854775808n).withIp('127.0.0.1').withStarmadeName('Lin');
    assert.equal(changed.toTag().name, 'history'); assert.equal(changed.toTag().getStruct()[0].name, 'when');
    assert.equal(changed.toTag().getStruct()[3].getInt(), 9); assert.equal(model.time, 9223372036854775807n);
    changed.toTag().getStruct()[3].value = 7; assert.equal(changed.toTag().getStruct()[3].getInt(), 9);
    assert.throws(() => changed.withStarmadeName('x'.repeat(200)), /limit|budget/i);
    assert.throws(() => S.PlayerInfoHistoryEntry.create(Number.MAX_SAFE_INTEGER + 1, 'ip'), TypeError);
    const sector = { x: 1, y: 2, z: 3 }, color = { x: .1, y: .2, z: .3, w: .4 };
    const coordinate = new S.SavedCoordinateEntry(sector, 'Home', color); sector.x = 5; color.w = 1;
    assert.equal(coordinate.sector.x, 1); assert.equal(coordinate.color.w, Math.fround(.4));
    const source = coordinate.toTag(); source.getStruct().splice(-1, 0, Tags.string('future', 'keep'));
    const saved = S.SavedCoordinateEntry.fromTag(source, { maxInflatedBytes: 150 });
    assert.equal(saved.withName('Base').withIcon(2).toTag().getStruct()[4].getString(), 'keep');
    assert.throws(() => saved.withName('x'.repeat(200)), /limit|budget/i);
    const old = Tags.struct('old', [Tags.vector3i('sector', 0, 0, 0), Tags.string('name', 'old')]);
    const legacy = S.SavedCoordinateEntry.fromTag(old);
    assert.deepEqual(writeTo(legacy.withName('old').toTag()), writeTo(old));
    assert.equal(legacy.withColor({ x: 1, y: 0, z: 0, w: 1 }).toTag().getStruct()[3].getInt(), 0);
    assert.deepEqual(legacy.withIcon(7).color, { x: 1, y: 1, z: 1, w: 1 });
    assert.throws(() => S.SavedCoordinateEntry.fromTag(Tags.struct(null, [...old.getStruct().slice(0, 2), Tags.vector4f(null, 1, 1, 1, 1)])), /complete optional/);
    assert.throws(() => S.SavedCoordinateEntry.fromTag(Tags.byte(null, 0)), /Coordinates require/);
    assert.throws(() => S.PlayerInfoHistoryEntry.fromTag(Tags.byte(null, 0)), /History records/);
  });

  it('preserves unknown inventory-backup slots and rejects corrupt present payloads', () => {
    const source = Tags.struct('backup', [...Array.from({ length: 4 }, (_, index) => Tags.rename(Inventory.EMPTY.toTag(), `inventory-${index}`)), Tags.string('future', 'keep')]);
    const model = new S.InventoryBackupState(source);
    const next = model.withMainInventory(Inventory.EMPTY).withInventories({ mainInventory: Inventory.EMPTY, capsuleInventory: Inventory.EMPTY, microInventory: Inventory.EMPTY, macroInventory: Inventory.EMPTY });
    assert.deepEqual(writeTo(next.toTag()), writeTo(source));
    assert.throws(() => new S.InventoryBackupState(Tags.struct(null, [Tags.struct(null, [Tags.int(null, 1)])])).mainInventory);
    assert.throws(() => new S.ItemsToSpawnWith(Tags.byteArray(null, [0, 0, 0, 1])));
  });

  it('rejects incomplete lists and unsafe integer coercion while accepting fractional float vectors', () => {
    assert.throws(() => new S.EntSlotObject('invalid', new Tag(TagType.LIST, null, [Tags.int(null, 1)])), /declared type/);
    const holder = new S.EntSlotObject('floats', Tags.struct(null, [Tags.vector3f('direction', 0, 0, 0)]));
    assert.deepEqual(holder.withFieldValue(0, { x: .5, y: -.25, z: .125 }).fields[0].value, { x: .5, y: -.25, z: .125 });
    for (const value of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => Tags.long(null, value), RangeError); assert.throws(() => fieldValueAsBigInt(value, 'value'), TypeError);
    }
    assert.throws(() => fieldValueAsInteger(Number.MAX_SAFE_INTEGER + 1, 'value'), TypeError);
    assert.throws(() => fieldValueAsNumber(10n ** 1000n, 'value'), TypeError);
    for (const value of [9223372036854775808n, -9223372036854775809n, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => S.ModuleExplosionState.create({ explosionPositions: [value] }));
    const source = S.ModuleExplosionState.create().toTag();
    for (const raw of [[], [0, 0, 0, 1], [255, 255, 255, 255], [0, 0, 0, 0, 1]]) {
      source.getStruct()[9] = Tags.byteArray(null, raw);
      assert.throws(() => new S.ModuleExplosionState(source).explosionPositions, /position/);
    }
  });
});
