/**
 * @fileoverview Entity-slot model contracts: immutable updates, default values,
 * malformed optional fields, collection bounds and typed Tag coercion.
 */
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { Matrix3f, Matrix4f } from '../../src/types/Matrices.js';
import { Inventory } from '../../src/objects/components/Inventory.js';
import * as S from '../../src/objects/EntitySlotObjects.js';

const v = { x: 1, y: 2, z: 3 };
const v4 = { ...v, w: 4 };
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1] as const;
const piece = { version: 1, entityUid: 'ship', position: v, type: 5, orientation: 3, active: true, hitpoints: 90 };
const empty = () => Tags.struct(null, []);
/** Tests an immutable setter against an independently supplied expected property. */
function update(original: any, method: string, args: any[], property: string, expected: any): any {
  const originalTag = original.toTag();
  const snapshot = structuredClone(originalTag);
  const result = original[method](...args);
  assert.notStrictEqual(result, original, method);
  assert.deepEqual(result[property], expected, `${method} -> ${property}`);
  assert.deepEqual(structuredClone(originalTag), snapshot, `${method} mutated input`);
  assert.deepEqual(new result.constructor(result.toTag())[property], expected, `${method} reconstruction`);
  return result;
}

describe('Slot model contracts — defaults and field coercion', () => {
  for (const [name, Ctor] of Object.entries(S)) {
    if (typeof Ctor !== 'function' || !(Ctor.prototype instanceof S.EntSlotObject)) continue;
    it(`preserves ${name} defaults and empty optional state on reconstruction`, () => {
      for (const value of [new (Ctor as any)(), new (Ctor as any)(empty()), new (Ctor as any)(Tags.nothing(null))]) {
        assert.deepEqual(new (Ctor as any)(value.toTag()).toJSON(), value.toJSON());
        assert.isNull(value.getField(-1)); assert.isNull(value.getField('absent'));
        assert.isArray(value.fields);
        if (typeof value.clear === 'function') {
          const cleared = value.clear();
          assert.equal(cleared.kind, value.kind);
          assert.equal(cleared.childCount, name === 'CoreTimerState' ? 1 : 0);
        }
      }
    });
  }

  it('coerces editable scalar and vector fields while preserving names and siblings', () => {
    const cases: [Tag, any, any][] = [
      [Tags.byte(null, 0), true, 1], [Tags.byte('byte', 0), false, 0], [Tags.byte(null, 0), '3', 3],
      [Tags.short(null, 0), 7, 7], [Tags.short('short', 0), 7, 7],
      [Tags.int(null, 0), 7, 7], [Tags.int('int', 0), 7, 7],
      [Tags.long(null, 0n), '7', 7n], [Tags.long('long', 0n), 7, 7n],
      [Tags.float(null, 0), 0.5, 0.5], [Tags.float('float', 0), 0.5, 0.5],
      [Tags.double(null, 0), 0.25, 0.25], [Tags.double('double', 0), 0.25, 0.25],
      [Tags.string(null, ''), 7, '7'], [Tags.string('string', ''), 's', 's'],
      [Tags.vector3i(null, 0, 0, 0), v, v], [Tags.vector3i('v', 0, 0, 0), v, v],
      [Tags.vector3f(null, 0, 0, 0), v, v], [Tags.vector3f('v', 0, 0, 0), v, v],
      [Tags.vector4f(null, 0, 0, 0, 0), v4, v4], [Tags.vector4f('v', 0, 0, 0, 0), v4, v4],
      [Tags.byteArray(null, []), [1, 2], { byteLength: 2, hexPreview: '0102' }],
      [Tags.byteArray('bytes', []), new Uint8Array([3]), { byteLength: 1, hexPreview: '03' }],
      [Tags.nothing('nothing'), 1, null],
    ];
    for (const [tag, value, expected] of cases) {
      const original = new S.EntSlotObject('Fields', Tags.struct('container', [tag, Tags.string('sibling', 'keep')]));
      const result = original.fields[0].setValue(value);
      assert.deepEqual(result.fields[0].value, expected);
      assert.equal(result.fields[0].tagName, tag.name);
      assert.equal(result.fields[1].value, 'keep');
      assert.equal(original.fields[1].value, 'keep');
    }
  });

  it('updates list elements and containers by value and rejects incompatible edits', () => {
    for (const listType of [TagType.INT, undefined]) {
      const list = new S.EntSlotObject('List', new Tag(TagType.LIST, null, [Tags.int(null, 1)], listType));
      assert.equal(list.withFieldValue(0, 9).toTag().getList()[0].getInt(), 9);
    }
    const child = new S.EntSlotObject('Child', Tags.struct('other', [Tags.int('i', 2)]));
    for (const name of [null, 'named']) {
      const original = new S.NpcDataState(Tags.struct('root', [Tags.struct(name, [])]));
      const changed = original.withFieldValue(0, child);
      assert.equal(changed.toTag().getStruct()[0].name, name ?? 'other');
    }
    const fields = new S.EntSlotObject('Fields', Tags.struct(null, [Tags.int('n', 1)]));
    assert.equal(fields.withFieldValue('n', 2).fields[0].value, 2);
    assert.throws(() => fields.withFieldValue('absent', 1), RangeError);
    assert.throws(() => fields.withFieldValue(2, 1), RangeError);
    assert.throws(() => new S.EntSlotObject('Empty').withFieldValue(0, 1), TypeError);
    for (const tag of [Tags.struct(null, []), Tags.list(null, []), Tags.byteArray(null, []),
      Tags.byteArray('bytes', []), Tags.matrix3f(null, new Matrix3f()),
      Tags.vector3i(null, 0, 0, 0), Tags.vector4f(null, 0, 0, 0, 0)]) {
      const holder = new S.EntSlotObject('Invalid', Tags.struct(null, [tag]));
      assert.throws(() => holder.withFieldValue(0, null), TypeError);
    }
  });
});

describe('Slot model contracts — rails and blueprint state', () => {
  it('updates every piece property without mutating the original', () => {
    const p = S.UniqueSegmentPieceState.from(piece);
    for (const [method, field, value] of [
      ['withEntityUid', 'entityUid', 'other'], ['withPosition', 'position', { x: -1, y: 0, z: 2 }],
      ['withType', 'type', 7], ['withOrientation', 'orientation', 12],
      ['withActive', 'active', false], ['withHitpoints', 'hitpoints', 40],
    ] as const) update(p, method, [value], field, value);
    assert.deepEqual(p.toJSON(), piece);
    assert.equal(new S.UniqueSegmentPieceState(empty()).type, 0);
  });

  it('handles disconnected, empty and complete rail requests with all transform fields', () => {
    const disconnected = new S.RailRequestState();
    assert.isTrue(disconnected.toJSON().disconnect);
    assert.isNull(disconnected.turretTransform); assert.isNull(disconnected.movedTransform);
    assert.isNull(disconnected.railMovingLocalAtDockTransform);
    assert.throws(() => disconnected.withRail(piece), TypeError);
    let r = new S.RailRequestState(empty());
    assert.isNull(r.rail); assert.isNull(r.docked); assert.isFalse(r.didRotationInPlace);
    r = r.withRail(piece).withDocked(S.UniqueSegmentPieceState.from(piece));
    r = r.withRail(S.UniqueSegmentPieceState.from(piece)).withDocked(piece);
    assert.deepEqual(r.rail!.toJSON(), piece); assert.deepEqual(r.docked!.toJSON(), piece);
    for (const [method, property] of [['withTurretTransform', 'turretTransform'], ['withMovedTransform', 'movedTransform'],
      ['withRailMovingLocalAtDockTransform', 'railMovingLocalAtDockTransform']]) update(r, method, [matrix], property, matrix);
    update(r, 'withRailDockerPosOnRail', [v], 'railDockerPosOnRail', v);
    r = update(r, 'withRailMovingToDockerPosOnRail', [v], 'railMovingToDockerPosOnRail', v);
    update(r, 'withRailMovingToDockerPosOnRail', [null], 'railMovingToDockerPosOnRail', null);
    for (const b of [true, false]) r = update(r, 'withDidRotationInPlace', [b], 'didRotationInPlace', b);
    r = update(r, 'withDockingPermission', [3], 'dockingPermission', 3);
    update(r, 'withDockingPermission', [null], 'dockingPermission', null);
    assert.isTrue(r.disconnectRequest().disconnect);
    assert.isFalse(r.toJSON().disconnect);
  });

  it('edits current and expected rail requests and validates removal indices', () => {
    const request = new S.RailRequestState(empty()).withRail(piece);
    const initial = new S.RailControllerState();
    assert.strictEqual(initial.withExpectedRequests([]), initial);
    const active = initial.withCurrentRequest(request);
    assert.equal(active.mode, 'activeRequest'); assert.equal(active.requestCount, 1);
    assert.equal(active.currentRequest!.rail!.entityUid, 'ship');
    assert.equal(active.withCurrentRequest(null).mode, 'none');
    const expected = initial.addExpectedRequest(request).addExpectedRequest(request);
    assert.equal(expected.mode, 'railRoot'); assert.equal(expected.expectedDockCount, 2);
    assert.equal(expected.withCurrentRequest(request).mode, 'railRoot');
    assert.equal(expected.removeExpectedRequest(0).expectedDockCount, 1);
    assert.throws(() => expected.removeExpectedRequest(-1), RangeError);
    assert.throws(() => expected.removeExpectedRequest(2), RangeError);
    for (const [code, mode] of [[0, 'none'], [1, 'docked'], [2, 'railRoot'], [3, 'activeRequest'], [4, 'unknown']] as const) {
      assert.equal(new S.RailControllerState(Tags.byte(null, code)).mode, mode);
    }
    assert.equal(new S.RailControllerState(empty()).modeCode, 0);
    assert.equal(expected.toJSON().expectedDockCount, 2);
  });

  it('updates timers, blueprint identifiers, spawn items and cargo blocks', () => {
    const timer = new S.CoreTimerState();
    assert.isFalse(timer.active);
    assert.isTrue(timer.withTimeLeftMs(0n).active);
    assert.isFalse(timer.withTimeLeftMs(1).clear().active);
    assert.isNull(new S.CoreTimerState(empty()).timeLeftMs);
    const info = new S.BlueprintInfo().withPath('blueprints/ship').withIdentifier('ship');
    assert.equal(info.path, 'blueprints/ship'); assert.equal(info.identifier, 'ship');
    assert.isTrue(info.toJSON().loadedFromBlueprint); assert.isFalse(info.clear().loadedFromBlueprint);
    const spawn = new S.ItemsToSpawnWith().withCount(5, 4).withCount(6, 2);
    assert.equal(spawn.getCount(5), 4); assert.equal(spawn.totalBlocks, 6);
    assert.lengthOf(spawn.counts, 2); assert.equal(spawn.withCount(5, 0).totalBlocks, 2);
    assert.equal(spawn.withCount(5, 0).withCount(6, 0).totalBlocks, 0);
    assert.equal(new S.ItemsToSpawnWith(Tags.byteArray(null, [255])).totalBlocks, 0);
    const cargo = new S.CargoInventoryBlock().withPiece(piece);
    assert.deepEqual(cargo.piece, piece); assert.deepEqual(cargo.toJSON().piece, piece);
    assert.isNull(cargo.clear().piece);
    const bad = Array.from({ length: 7 }, () => Tags.nothing(null));
    assert.isNull(new S.CargoInventoryBlock(Tags.struct(null, bad)).piece);
    bad[2] = Tags.vector3i(null, 1, 2, 3);
    assert.deepEqual(new S.CargoInventoryBlock(Tags.struct(null, bad)).piece, {
      version: 0, entityUid: '', position: v, type: 0, orientation: 0, active: false, hitpoints: 0,
    });
    assert.isFalse(cargo.withPiece({ ...piece, active: false }).piece!.active);
  });
});

describe('Slot model contracts — collections and scanner data', () => {
  it('creates, changes and removes quarters, including optional fields', () => {
    const q = S.QuarterState.create({ type: 0, min: v, max: v, id: 2 });
    assert.equal(q.typeName, 'BRIDGE'); assert.equal(q.status, 'NORMAL');
    const extra = new S.EntSlotObject('extra', Tags.struct(null, [Tags.int('value', 7)]));
    const complete = S.QuarterState.create({ type: 3, min: v, max: v, id: 4,
      status: 'DAMAGED', integrity: 0.5, priority: 2, index: 10n, childIds: [2, 3], extra });
    assert.equal(complete.typeName, 'GUARD'); assert.lengthOf(complete.toJSON().childIds, 2);
    for (const [method, field, value] of [
      ['withType', 'type', 99], ['withId', 'id', 9], ['withStatus', 'status', 'READY'],
      ['withIntegrity', 'integrity', 0.25], ['withPriority', 'priority', 8],
      ['withIndex', 'index', 11n], ['withChildIds', 'childIds', [1, 2]],
    ] as const) update(q, method, [value], field, value);
    assert.equal(q.withType(99).typeName, 'UNKNOWN_99');
    assert.deepEqual(q.withBounds(v, { x: 9, y: 8, z: 7 }).max, { x: 9, y: 8, z: 7 });
    assert.isNotNull(q.withExtra(extra).extra); assert.isNull(complete.withExtra(null).extra);
    assert.equal(new S.QuarterState(empty()).id, 0);
    let manager = new S.QuarterManagerState().addQuarter(q);
    assert.equal(manager.withQuarter(0, complete).quarters[0].id, 4);
    assert.equal(manager.withVersion(3).version, 3);
    assert.throws(() => manager.withQuarter(-1, q), RangeError);
    assert.throws(() => manager.withQuarter(1, q), RangeError);
    assert.lengthOf(manager.clearQuarters().quarters, 0);
    assert.lengthOf(new S.QuarterManagerState(empty()).addQuarter(q).quarters, 1);
  });

  it('edits history, coordinate and explosion lists immutably with index validation', () => {
    const h = S.PlayerInfoHistoryEntry.create(7, '127.0.0.1');
    assert.equal(h.withTime(8n).time, 8n); assert.equal(h.withTime(8).time, 8n);
    assert.equal(h.withIp('::1').ip, '::1'); assert.equal(h.withStarmadeName('Pilot').starmadeName, 'Pilot');
    assert.equal(S.PlayerInfoHistoryEntry.create(7n, '::1', 'Pilot').starmadeName, 'Pilot');
    assert.equal(S.PlayerInfoHistoryEntry.fromTag(empty()).time, 0n);
    const coordinate = S.SavedCoordinateEntry.create(v, 'Home');
    assert.equal(coordinate.withName('Base').name, 'Base');
    assert.deepEqual(coordinate.withSector({ x: 3, y: 2, z: 1 }).sector, { x: 3, y: 2, z: 1 });
    assert.deepEqual(coordinate.withColor(v4).color, v4); assert.equal(coordinate.withIcon(4).icon, 4);
    assert.equal(S.SavedCoordinateEntry.fromTag(empty()).name, '');
    const scan = S.ScanDataRecord.create({ origin: v, time: 10n, range: 32 });
    const explosion = S.ModuleExplosionState.create();
    const collections = [
      [new S.PlayerInfoHistoryList(), h, 'addEntry', 'withEntry', 'removeEntry', 'entries'],
      [new S.SavedCoordinates(), coordinate, 'add', 'withEntry', 'remove', 'entries'],
      [new S.ScanHistory(), scan, 'addScan', 'withScan', 'removeScan', 'scans'],
      [new S.ModuleExplosionsState(), explosion, 'addExplosion', 'withExplosion', 'removeExplosion', 'explosions'],
    ] as const;
    for (const [base, value, add, replace, remove, property] of collections) {
      const b = base as any;
      const withOne = b[add](value), withTwo = withOne[add](value);
      assert.lengthOf(b[property], 0); assert.lengthOf(withTwo[property], 2);
      assert.lengthOf(withTwo[replace](0, value)[property], 2);
      assert.lengthOf(withTwo[remove](0)[property], 1);
      assert.lengthOf(withTwo.clear()[property], 0);
      assert.throws(() => withOne[replace](-1, value), RangeError);
      assert.throws(() => withOne[replace](1, value), RangeError);
      assert.throws(() => withOne[remove](-1), RangeError);
      assert.throws(() => withOne[remove](1), RangeError);
      assert.isObject(withTwo.toJSON());
    }
    const ignored = new S.IgnoredPlayers().add('Pilot').add('Other');
    assert.strictEqual(ignored.add('Pilot'), ignored);
    assert.deepEqual(ignored.remove('Pilot').names, ['Other']);
    assert.deepEqual(ignored.clear().toJSON().names, []);
  });

  it('preserves scanner entities and both resource encodings including defaults', () => {
    const entity = { name: 'ship', sector: v, factionId: 2, controllerInfo: 'SHIP' };
    const resource = { name: 'asteroid', type: 'rock', sector: v, canViewGenerationData: true,
      resourceInfo: 'iron', resourceCaps: '20', resourceAmounts: '10' };
    const scan = S.ScanDataRecord.create({ origin: v, time: 2, range: 3,
      systemOwnershipType: 4, entityData: [entity], resourceData: [resource, { type: 5, resourceQuantity: 0.5 }] });
    assert.deepEqual(scan.entityData, [entity]); assert.deepEqual(scan.resourceData[0], resource);
    assert.deepEqual(scan.resourceData[1], { type: 5, resourceQuantity: 0.5 });
    assert.deepEqual(scan.withOrigin({ x: 0, y: 0, z: 0 }).origin, { x: 0, y: 0, z: 0 });
    assert.equal(scan.withTime(9n).time, 9n); assert.equal(scan.withRange(16).range, 16);
    assert.equal(scan.withSystemOwnershipType(7).systemOwnershipType, 7);
    assert.lengthOf(scan.addEntityData(entity).entityData, 2);
    assert.lengthOf(scan.addResourceData({ type: 2 }).resourceData, 3);
    assert.equal(scan.withResourceData([{ type: 'unknown' }]).resourceData[0].name, '');
    const fields = Array.from({ length: 6 }, () => Tags.nothing(null));
    fields[4] = Tags.struct(null, [empty()]);
    fields[5] = Tags.struct(null, [empty(), Tags.struct(null, [Tags.short(null, 7)])]);
    const incomplete = new S.ScanDataRecord(Tags.struct(null, fields));
    assert.equal(incomplete.entityData[0].name, '');
    assert.deepEqual(incomplete.resourceData[1], { type: 7, resourceQuantity: 0 });
    assert.equal(incomplete.time, 0n); assert.equal(incomplete.range, 0);
  });
});

describe('Slot model contracts — modules and inventories', () => {
  it('stores optional inventories independently and exposes their sizes', () => {
    const base = new S.InventoryBackupState();
    assert.isFalse(base.hasBackup);
    for (const [method, property] of [['withMainInventory', 'mainInventory'], ['withCapsuleInventory', 'capsuleInventory'],
      ['withMicroInventory', 'microInventory'], ['withMacroInventory', 'macroInventory']]) {
      const next = (base as any)[method](Inventory.EMPTY);
      assert.equal(next[property].size, 0); assert.isTrue(next.hasBackup);
      assert.isNull((base as any)[property]);
    }
    const all = base.withInventories({ mainInventory: Inventory.EMPTY, capsuleInventory: Inventory.EMPTY,
      microInventory: Inventory.EMPTY, macroInventory: Inventory.EMPTY });
    assert.equal(all.toJSON().macroInventorySize, 0);
    assert.isFalse(all.clear().hasBackup);
  });

  it('classifies all module identifiers and updates entries and payloads', () => {
    const identifiers: Record<string, string> = { A: 'docking', ACD: 'activationDestination', INTR: 'interdiction',
      J: 'jumpDrive', JAO: 'jumpAddOn', JP: 'jumpInhibitor', LSC: 'longRangeScanner', RBST: 'reactorBoost',
      RSCN: 'scanAddOn', RSTLTH: 'stealth', SC: 'structureScanner', SSC: 'structureScanner', SYRD: 'shipyard',
      TR: 'transporter', TRM: 'tractorBeam', EF1: 'effect', other: 'module', '': 'unknown' };
    for (const [id, kind] of Object.entries(identifiers)) {
      assert.equal(new S.ManagerModuleState(Tags.struct(id, [])).moduleKind, kind);
    }
    const entry = new S.ManagerModuleEntryState(empty());
    assert.isNull(entry.chargeState); assert.isNull(entry.transporterTarget);
    const charged = entry.withChargeState(0.5, true, true);
    assert.deepEqual(charged.chargeState, { encodedCharge: 0.5, autoCharge: true, active: true });
    assert.deepEqual(charged.withChargeState(0.25).chargeState, { encodedCharge: 0.25, autoCharge: true, active: true });
    assert.deepEqual(entry.withChargeState(0).chargeState, { encodedCharge: 0, autoCharge: false, active: false });
    assert.deepEqual(charged.withPosition(v).position, v);
    assert.equal(entry.withPositionIndex(7n).positionIndex, 7n);
    const byVector = new S.ManagerModuleEntryState(Tags.struct(null, [Tags.vector3i(null, 1, 2, 3)]));
    assert.deepEqual(byVector.position, v); assert.isObject(byVector.toJSON().payload);
    for (const tail of [[], [Tags.byte(null, 3)]]) {
      const target = entry.withPayload(new S.EntSlotObject('Target', Tags.struct(null, [Tags.string(null, 'gate'),
        Tags.string(null, 'ship'), Tags.vector3i(null, 1, 2, 3), ...tail])));
      assert.deepEqual(target.transporterTarget!.destinationBlock, v);
      assert.equal(target.transporterTarget!.publicAccess, tail.length ? 3 : 0);
    }
    assert.isNull(entry.withPayload(new S.EntSlotObject('Bad', Tags.struct(null, [Tags.string(null, 'x'), Tags.string(null, 'y')]))).transporterTarget);
    assert.deepEqual(entry.withPayload(new S.EntSlotObject('Charge', Tags.struct(null, [Tags.float(null, 1)]))).chargeState,
      { encodedCharge: 1, autoCharge: false, active: false });
    let module = new S.ManagerModuleState(Tags.struct('J', [])).addEntry(entry);
    assert.equal(module.withEntry(0, charged).entries[0].chargeState!.encodedCharge, 0.5);
    assert.equal(module.metadataCount, 1); assert.lengthOf(module.removeEntry(0).entries, 0);
    assert.lengthOf(module.clearEntries().entries, 0);
    for (const i of [-1, 1]) {
      assert.throws(() => module.withEntry(i, entry), RangeError); assert.throws(() => module.removeEntry(i), RangeError);
    }
    const all = new S.ManagerModulesState().withModule('J', module);
    assert.equal(all.getModule('J')!.tagId, 'J'); assert.isNull(all.getModule('missing'));
    assert.lengthOf(all.getModules('J'), 1);
    assert.equal(all.withModule('J', module.clearEntries()).getModule('J')!.metadataCount, 0);
    assert.deepEqual(new S.ManagerModulesState(Tags.struct(null, [Tags.struct(null, [])])).moduleIds, ['']);
    assert.deepEqual(all.toJSON().moduleIds, ['J']);
  });

  it('adds and replaces AI settings including absent optional fields', () => {
    const ai = new S.AiConfigurationState(Tags.struct(null, [empty()]));
    assert.deepEqual(ai.settings, [{ id: 0, value: '' }]);
    assert.isNull(ai.getSetting(9));
    const next = ai.withSetting(1, true).withSetting(1, 'off').withSetting(2, 7);
    assert.equal(next.getSetting(1), 'off'); assert.equal(next.getSetting(2), '7');
    assert.lengthOf(next.clear().settings, 0); assert.lengthOf(next.toJSON().settings as any[], 3);
  });

  it('edits all explosion properties and handles signed positions and malformed lists', () => {
    const base = S.ModuleExplosionState.create();
    const complete = S.ModuleExplosionState.create({ created: 1n, lastExplosion: 2n, explosionDelay: 3n,
      moduleId: 4n, radius: 5, damage: 6, min: v, max: v, explosionPositions: [-1n, 2], chain: true, cause: 3 });
    assert.equal(complete.toJSON().explosionPositionCount, 2);
    for (const [method, property, value] of [
      ['withCreated', 'created', 9n], ['withLastExplosion', 'lastExplosion', 8n],
      ['withExplosionDelay', 'explosionDelay', 7n], ['withModuleId', 'moduleId', 6n],
      ['withRadius', 'radius', 5], ['withDamage', 'damage', 4], ['withCause', 'cause', 3],
      ['withChain', 'chain', true], ['withChain', 'chain', false],
      ['withExplosionPositions', 'explosionPositions', [-2n, 3n]],
    ] as const) update(base, method, [value], property, value);
    assert.deepEqual(base.withBounds(v, v).min, v); assert.deepEqual(base.withBounds(v, v).max, v);
    const added = base.addExplosionPosition(-1n).addExplosionPosition(2);
    assert.deepEqual(added.explosionPositions, [-1n, 2n]);
    assert.deepEqual(added.removeExplosionPosition(0).explosionPositions, [2n]);
    assert.throws(() => added.removeExplosionPosition(-1), RangeError);
    assert.throws(() => added.removeExplosionPosition(2), RangeError);
    const invalid = new S.ModuleExplosionState(empty());
    assert.equal(invalid.version, 0); assert.isNull(invalid.min); assert.equal(invalid.cause, 0);
    const fields = Array.from({ length: 10 }, () => Tags.nothing(null));
    fields[9] = Tags.byteArray(null, [255, 255, 255, 255]);
    assert.deepEqual(new S.ModuleExplosionState(Tags.struct(null, fields)).explosionPositions, []);
  });
});
