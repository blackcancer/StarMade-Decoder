/**
 * @fileoverview Sparse domain components and positional persistence regressions.
 * HP payload positions follow SegmentControllerHpController.toTagStructure at
 * StarMade-Open decf3a1: the ElementCountMap at index six must never be omitted.
 */
import { assert } from 'chai';
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo, readFrom } from '../../src/core/TagParser.js';
import { registerAllFactories, RawElement } from '../../src/serializable/Factories.js';
import { HpState } from '../../src/objects/components/HpState.js';
import { PlayerSpawnData } from '../../src/objects/components/SpawnData.js';
import { SlotAssignment } from '../../src/objects/components/SlotAssignment.js';
import { EntityTransform } from '../../src/objects/components/Transform.js';
import { EntSlotObject, QuarterState, QuarterManagerState, InventoryBackupState } from '../../src/objects/EntitySlotObjects.js';
import { GameEntity } from '../../src/objects/entities/GameEntity.js';
import { NPCFactionNewsEvent } from '../../src/objects/Serializables.js';
import { SegmentControllerObject } from '../../src/objects/SegmentController.js';
import { parseSegmentController } from '../../src/entity/SegmentController.js';
import { parseFactions } from '../../src/entity/Factions.js';

const empty = () => Tags.struct(null, []);

describe('Domain boundaries — sparse and positional records', () => {
  it('retains the HP-match map and the reboot flag when serializing or editing health', () => {
    registerAllFactories();
    const map = new RawElement(1, Buffer.from('0000000100050000000a', 'hex'));
    const state = new HpState(1, 20n, 100n, 0n, 0n, 3n, 4n, true, map);
    for (const current of [state, state.withHp(30n), state.withMaxHp(200n)]) {
      const values = current.toTag().getStruct()[1].getStruct();
      assert.equal(values[6].type, TagType.SERIALIZABLE); assert.equal(values[7].getByte(), 1);
      const decoded = HpState.fromTag(readFrom(writeTo(current.toTag())));
      assert.equal(decoded.rebootRecover, true);
      assert.deepEqual((decoded.currentHPMatch as RawElement).raw, map.raw);
      assert.equal(decoded.hp, current.hp); assert.equal(decoded.maxHp, current.maxHp);
    }
    const blank = HpState.fromTag(readFrom(writeTo(HpState.EMPTY.toTag())));
    assert.equal(blank.currentHPMatch.getFactoryId(), 1); assert.isFalse(blank.rebootRecover);
  });

  it('decodes origin and sector values only when the spawn version carries them', () => {
    const data = PlayerSpawnData.fromTag(Tags.struct(null, [Tags.byte(null, 1), empty(), empty(),
      Tags.vector3f(null, 1, 2, 3), Tags.vector3i(null, 4, 5, 6)]));
    assert.deepEqual(data.preSpecialSector?.toJSON?.() ?? { x: data.preSpecialSector!.x, y: data.preSpecialSector!.y, z: data.preSpecialSector!.z }, { x: 4, y: 5, z: 6 });
    assert.equal(PlayerSpawnData.fromTag(data.toTag()).preSpecialSector!.x, 4);
    assert.equal(EntityTransform.IDENTITY.with({}).originX, 0);
  });

  it('ignores malformed assignment entries and retains a valid slot with a missing position', () => {
    const slots = Tags.struct(null, [Tags.int(null, 9), empty(), Tags.struct(null, [Tags.byte(null, 2)])]);
    const data = SlotAssignment.fromTag(Tags.struct(null, [Tags.byte(null, 0), slots]));
    assert.equal(data.slots.size, 1); assert.equal(data.slots.get(2), 0n);
  });

  it('handles incomplete quarters and invalid optional inventory backups', () => {
    const q = new QuarterState(Tags.byte(null, 0));
    assert.isNull(q.toJSON().extra);
    assert.equal(q.withId(7).id, 7);
    assert.throws(() => new QuarterManagerState(empty()).withQuarter(0, q), RangeError);
    const malformed = new InventoryBackupState(Tags.struct(null, [new Tag(TagType.STRUCT, null, null)]));
    assert.isNull(malformed.mainInventory);
    const future = new EntSlotObject('Future', new Tag(99 as any, null, 1));
    assert.include(JSON.stringify(future.toJSON()), '99');
    const list = new EntSlotObject('List', new Tag(TagType.LIST, null, [Tags.int(null, 1)]));
    assert.equal(list.withFieldValue(0, 2).toTag().listType, TagType.INT);
  });

  it('keeps entity defaults when a present transform contains a non-numeric list', () => {
    const transformable = Tags.struct(null, [Tags.float(null, 1), new Tag(TagType.LIST, null, [Tags.string(null, 'invalid')], TagType.STRING)]);
    const result = (GameEntity as any).parseTransformable(transformable);
    assert.deepEqual(result.transform, EntityTransform.IDENTITY);
    assert.equal(new NPCFactionNewsEvent('FUTURE' as any, 0n, 0).toRaw()[0], 4);
    const faction = parseFactions(Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [Tags.string(null, 'name')])]));
    assert.equal(faction.factions[0].id, 1);
  });

  it('reads legacy unnamed indexed bounds independently from named fields', () => {
    for (const children of [[], [Tags.string('uniqueId', 'id')], [Tags.string('uniqueId', 'id'), Tags.vector3i(null, -1, -2, -3), Tags.vector3i(null, 1, 2, 3)]]) {
      const tag = Tags.struct(null, children);
      const parsed = parseSegmentController(tag);
      const model = SegmentControllerObject.fromTag(tag);
      if (children.length === 3) {
        assert.equal(parsed.minPos!.x, -1); assert.equal(parsed.maxPos!.z, 3);
        assert.equal(model.minPos!.x, -1); assert.equal(model.maxPos!.z, 3);
      } else { assert.isUndefined(parsed.minPos); assert.isNull(model.minPos); }
    }
  });
});
