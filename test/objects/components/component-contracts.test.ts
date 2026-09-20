/**
 * @fileoverview Component defaults, mutable-input isolation and typed field contracts.
 * Optional malformed caller-created Tags exercise diagnostic fallback behavior.
 */
import { assert } from 'chai';
import { Tag } from '../../../src/core/Tag.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { TagType } from '../../../src/core/TagType.js';
import { DockingState } from '../../../src/objects/components/DockingState.js';
import { HpState } from '../../../src/objects/components/HpState.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { ManagerContainer } from '../../../src/objects/components/ManagerContainer.js';
import { PowerState, ThrustConfig } from '../../../src/objects/components/PowerAndThrust.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
import { SlotAssignment } from '../../../src/objects/components/SlotAssignment.js';
import { SpawnPoint, SpawnMarker, SpawnController, PlayerSpawnData } from '../../../src/objects/components/SpawnData.js';
import { EntityTransform, SectorPosition } from '../../../src/objects/components/Transform.js';
import * as Slot from '../../../src/objects/EntitySlotObjects.js';

const empty = (): Tag => Tags.struct(null, []);
const bad = (): Tag => new Tag(TagType.STRUCT, null, null);
const slots = (values: Record<number, Tag>): Tag => Tags.struct(null,
  Array.from({ length: Math.max(0, ...Object.keys(values).map(Number)) + 1 }, (_, i) => values[i] ?? Tags.nothing(null)));

describe('Component contracts — defaults and alternative representations', () => {
  it('defaults missing docking, HP, spawn and transform fields', () => {
    const docking = DockingState.fromTag(empty());
    assert.deepEqual(docking, DockingState.UNDOCKED);
    assert.deepEqual(HpState.fromTag(empty()), HpState.EMPTY);
    const hp = HpState.fromTag(slots({ 1: slots({ 0: Tags.string(null, 'not-hp'), 7: Tags.byte(null, 1) }) }));
    assert.equal(hp.hp, 0n); assert.isTrue(hp.rebootRecover);
    assert.equal(hp.toTag().type, TagType.STRUCT);
    assert.deepEqual(SpawnPoint.fromTag(empty()), SpawnPoint.ZERO);
    const point = SpawnPoint.ZERO.with({ entityUID: 'ship', sector: new SectorPosition(1, 2, 3),
      localX: 4, localY: 5, localZ: 6, gravX: 7, gravY: 8, gravZ: 9 });
    assert.deepEqual(SpawnPoint.fromTag(point.toTag()), point);
    assert.deepEqual(point.with({}), point);
    assert.equal(SpawnMarker.fromTag(empty()).lastSpawned, 0n);
    assert.equal(SpawnMarker.fromTag(empty()).sectorX, 0);
    assert.strictEqual(SpawnController.fromTag(empty()), SpawnController.EMPTY);
    assert.lengthOf(SpawnController.fromTag(Tags.struct(null, [Tags.struct(null, [bad(), empty()])])).markers, 1);
    const incomplete = PlayerSpawnData.fromTag(slots({ 0: Tags.byte(null, 1) }));
    assert.isNull(incomplete.preSpecialSector); assert.equal(incomplete.preSpecialOriginX, 0);
    assert.throws(() => EntityTransform.fromMatrix4fList(empty()), TypeError);
    assert.equal(EntityTransform.IDENTITY.with({ originX: 12 }).originX, 12);
  });

  it('round-trips every thrust switch and defaults missing rotation balance', () => {
    for (const value of [true, false]) {
      const thrust = new ThrustConfig(2, value, value, 1, 2, 3, 4, value, value, 5);
      assert.deepEqual(ThrustConfig.fromTag(thrust.toTag()), thrust);
    }
    assert.equal(ThrustConfig.fromTag(slots({ 3: Tags.vector3f(null, 1, 2, 3) })).rotationBalance, 0);
  });

  it('normalizes legacy wrapped slots and incomplete inventory metadata', () => {
    const inventory = (slot: Tag, type: Tag, value: Tag): Inventory => Inventory.fromLegacyTag(Tags.struct(null, [
      Tags.struct(null, [slot]), Tags.struct(null, [type]), Tags.struct(null, [value]),
    ]));
    for (const slot of [Tags.int(null, -1), empty(), Tags.nothing(null)]) assert.equal(inventory(slot, Tags.short(null, 5), Tags.int(null, 2)).size, 0);
    for (const type of [empty(), Tags.nothing(null)]) assert.equal(inventory(Tags.int(null, 0), type, Tags.int(null, 2)).get(0)!.type, 0);
    for (const value of [Tags.nothing(null), empty(), Tags.struct(null, [Tags.string(null, 'not-meta')])]) {
      assert.equal(inventory(Tags.int(null, 0), Tags.short(null, 5), value).get(0)!.count, 1);
    }
    const meta = inventory(Tags.int(null, 0), Tags.short(null, 5), slots({ 0: Tags.int(null, 9), 1: Tags.nothing(null) })).get(0)!;
    assert.equal(meta.count, 1); assert.deepEqual(meta.meta, { id: 9, type: 0, orientation: 0, subId: 0 });
    const item = new ItemStack(0, 5, 2);
    assert.equal(item.withCount(3).count, 3); assert.equal(item.withType(6).type, 6);
    assert.equal(item.count, 2); assert.equal(item.type, 5); assert.notInclude(item.toString(), 'meta=');
  });

  it('ignores malformed text and slot-assignment entries without inventing positions', () => {
    assert.strictEqual(TextBlocks.fromTag(Tags.byte(null, 0)), TextBlocks.EMPTY);
    const text = Tags.struct(null, [Tags.byte(null, 0), empty(), slots({ 0: Tags.int(null, 1), 1: Tags.string(null, 'bad pos') }),
      slots({ 0: Tags.long(null, 2n), 1: Tags.int(null, 3) }), slots({ 0: Tags.long(null, 3n), 1: Tags.string(null, 'ok') })]);
    const result = TextBlocks.fromTag(text);
    assert.equal(result.size, 1); assert.equal(result.get(3n), 'ok');
    const assignment = SlotAssignment.fromTag(Tags.struct(null, [Tags.byte(null, 0), empty(), slots({ 0: Tags.int(null, 0) })]));
    assert.isObject(assignment); assert.equal(assignment.toTag().type, TagType.STRUCT);
  });
});

describe('Component contracts — manager field edits', () => {
  it('edits each typed field and rejects incorrect domain objects', () => {
    const base = ManagerContainer.EMPTY;
    const values = {
      texts: TextBlocks.EMPTY, warpGateInfo: new Slot.WarpGateInfo(), modules: new Slot.ManagerModulesState(),
      aiConfiguration: new Slot.AiConfigurationState(), slotAssignment: SlotAssignment.EMPTY,
      raceGateInfo: new Slot.RaceGateInfo(), unloadedDummies: new Slot.UnloadedDummiesState(),
      moduleExplosions: new Slot.ModuleExplosionsState(), powerReactor: new PowerState(1, 2), modData: new Slot.ModDataState(),
    };
    const properties: Record<string, string> = { powerReactor: 'powerState' };
    for (const [key, value] of Object.entries(values)) {
      const updated = base.getField(key)!.withValue(value);
      assert.instanceOf((updated as any)[properties[key] ?? key], value.constructor, key);
      assert.throws(() => base.getField(key)!.withValue({}), TypeError);
    }
    assert.equal(base.getField('shieldAddOn')!.withValue(7).initialShields, 7);
    assert.equal(base.getField('pullPermission')!.withValue(1).pullPermission, 1);
    assert.isNull(base.getField('missing')); assert.strictEqual(base.getInventory(999), Inventory.EMPTY);
    assert.equal(base.initialShields, 0);
  });

  it('handles malformed optional inventory/power payloads without losing the manager', () => {
    assert.strictEqual(ManagerContainer.fromTag(Tags.byte(null, 0)), ManagerContainer.EMPTY);
    const unserializable = Tags.struct(null, [slots({ 0: Tags.int(null, 0), 2: bad() })]);
    assert.throws(() => ManagerContainer.fromTag(slots({ 0: unserializable })), 'Invalid Tag collection');
    // Malformed inventory semantics remain preservable when the Tag tree itself is valid.
    const inventoryList = Tags.struct(null, [Tags.byte(null, 0), empty(), slots({ 0: Tags.int(null, 0), 2: Tags.struct('inv1', []) })]);
    const manager = ManagerContainer.fromTag(slots({ 0: inventoryList, 15: bad() }));
    assert.equal(manager.inventories.size, 0); assert.deepEqual(manager.powerState, PowerState.EMPTY);
    assert.deepEqual(ManagerContainer.fromTag(slots({ 2: bad() })).powerState, PowerState.EMPTY);
  });
});
