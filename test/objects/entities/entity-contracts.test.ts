/**
 * @fileoverview High-level entity editing, defaults and diagnostic projections.
 * Uses committed save fixtures plus malformed caller-created Tags to check
 * that optional domain views do not compromise immutable edits or parsing.
 */
import fs from 'node:fs';
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { readFrom, writeTo } from '../../../src/core/TagParser.js';
import { RawElement, registerAllFactories } from '../../../src/serializable/Factories.js';
import { GameEntity } from '../../../src/objects/entities/GameEntity.js';
import { Ship, SpaceStation, ShopSpaceStation, FloatingRock } from '../../../src/objects/entities/Ships.js';
import { PlayerCharacterEntity } from '../../../src/objects/entities/PlayerCharacterEntity.js';
import { PlayerStateEntity, FactionMembership } from '../../../src/objects/entities/PlayerStateEntity.js';
import { ManagerContainer } from '../../../src/objects/components/ManagerContainer.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { EntityTransform, SectorPosition } from '../../../src/objects/components/Transform.js';
import { SpawnController } from '../../../src/objects/components/SpawnData.js';
import * as Slot from '../../../src/objects/EntitySlotObjects.js';
import * as Rich from '../../../src/objects/enriched/RichViews.js';
import { BlockRegistry } from '../../../src/config/BlockRegistry.js';
import { BlockConfig } from '../../../src/config/BlockConfig.js';
import { emptySegment, emptySmd3File } from '../../../src/smd3/Smd3Writer.js';

const fixture = (name: string): Buffer => fs.readFileSync(`samples/${name}`);
const ship = (): Ship => Ship.fromBuffer(fixture('ENTITY_SHIP_Traders Homerl110.ent'));
const player = (): PlayerStateEntity => PlayerStateEntity.fromBuffer(fixture('ENTITY_PLAYERSTATE_InitSysRev.ent'));
const character = (): PlayerCharacterEntity => PlayerCharacterEntity.fromBuffer(fixture('ENTITY_PLAYERCHARACTER_InitSysRev.ent'));
const bad = (name: string | null = null): Tag => new Tag(TagType.STRUCT, name, null);
const slots = (values: Record<number, Tag>): Tag => {
  const children = Array.from({ length: Math.max(...Object.keys(values).map(Number), 0) + 1 }, (_, i) => values[i] ?? Tags.nothing(null));
  return Tags.struct(null, children);
};

registerAllFactories();

describe('Entity contracts — defaults and malformed optional data', () => {
  it('rejects missing entities and exposes optional views of valid records', () => {
    for (const root of [Tags.struct(null, []), Tags.byte(null, 0)]) {
      assert.throws(() => Ship.fromTag(root));
      assert.throws(() => PlayerCharacterEntity.fromTag(root));
      assert.throws(() => PlayerStateEntity.fromTag(root));
    }
    const p = player();
    assert.equal(p.withFaction(1).faction.factionId, 1);
    assert.equal(p.withLastLogin(42n).lastLogin, 42n);
    assert.equal(p.withLastLogout(43n).lastLogout, 43n);
    assert.equal(p.withLastEnteredEntity('entity').lastEnteredEntity, 'entity');
    assert.equal(p.withMineAutoArmSecs(12).toTag().getStruct()[30].getInt(), 12);
    assert.isArray(p.savedCoordinates.entries);
    assert.throws(() => FactionMembership.fromTag(Tags.struct(null, [])));
    assert.equal(FactionMembership.fromTag(new FactionMembership(0, 0).toTag()).factionId, 0);
    assert.isNull(p.getField('missing'));
    assert.isNull(character().getField('missing'));
    assert.isNull(ship().getField('missing'));
    assert.isNull(ship().getTransformableField('missing'));
  });

  it('rejects corrupt present entity components instead of replacing them with defaults', () => {
    for (const index of [3,7,15,21]) {
      const root=ship().toTag();root.getStruct()[index]=bad();
      assert.throws(()=>Ship.fromTag(root));
    }
    const malformedMap=ship().toTag();malformedMap.getStruct()[4]=new Tag(TagType.SERIALIZABLE,'cs1',new RawElement(0,new Uint8Array([1])));
    assert.throws(()=>Ship.fromTag(malformedMap));
    for (const index of [1, 2, 16, 17, 18]) {
      assert.throws(() => PlayerStateEntity.fromTag(slots({ [index]: bad() })));
    }
    assert.throws(() => PlayerStateEntity.fromTag(Tags.struct(null, [bad('pFac')])));
    assert.throws(() => GameEntity.parseTransformable(slots({ 1: new Tag(TagType.LIST, null, [], TagType.FLOAT), 6: bad() })));
    const texts = TextBlocks.EMPTY.set(1n, 'sign');
    const textRoot=ship().toTag();textRoot.getStruct()[15]=texts.toTag();const textShip=Ship.fromTag(textRoot);
    assert.equal(Ship.fromTag(textShip.toTag()).textBlocks.size, 1);
  });

  it('keeps optional projected field accessors null-safe', () => {
    // An application may project a model's virtual fields for an inspector.
    const project = (model: any): any => new Proxy(model, {
      get(target, key, receiver) {
        return key === 'fields' || key === 'transformableFields' ? [] : Reflect.get(target, key, receiver);
      },
    });
    assert.isDefined(character().aiConfigurationField);
    assert.isNull(project(character()).aiConfigurationField);
    const ps = project(player());
    for (const key of ['hostHistoryField', 'playerAiManagerField', 'scanHistoryField', 'inventoryBackupField', 'savedCoordinatesField', 'ignoredPlayersField', 'cargoInventoryBlockField']) {
      assert.isNull(ps[key]);
    }
    const sc = project(ship());
    for (const key of ['extraTagDataField', 'npcDataField', 'railControllerField', 'coreTimerField', 'blueprintInfoField', 'itemsToSpawnWithField', 'blockKillRecorderField', 'quarterManagerField']) {
      assert.isNull(sc[key]);
    }
  });
});

describe('Entity contracts — immutable field edits', () => {
  it('edits every scalar segment field and preserves the original entity', () => {
    const original = ship(), before = writeTo(original.toTag());
    const values: Record<string, [unknown, string]> = {
      uniqueId: ['new-id', 'uniqueId'], realName: ['New name', 'realName'], creatorId: [7, 'creatorId'],
      spawner: ['spawn', 'spawner'], lastModifier: ['modifier', 'lastModifier'], seed: [999n, 'seed'],
      vulnerable: [false, 'vulnerable'], minable: [false, 'minable'], factionRights: [5, 'factionRights'],
      nonEmptySegments: [12, 'nonEmptySegments'], currentOwnerLowerCase: ['owner', 'currentOwner'],
      lastDockerPlayerLowerCase: ['docker', 'lastDockerPlayer'], lastEditBlocks: [20n, 'lastEditBlocks'],
      lastDamageTaken: [21n, 'lastDamageTaken'], tagVersion: [3, 'tagVersion'],
    };
    for (const [key, [value, property]] of Object.entries(values)) {
      const next = original.getField(key)!.withValue(value);
      assert.strictEqual((next as any)[property], value, key);
      assert.deepEqual(writeTo(original.toTag()), before);
      assert.strictEqual((Ship.fromTag(next.toTag()) as any)[property], value, `${key} serialization`);
    }
    const min = original.getField('minPos')!.withValue({ x: -1, y: -2, z: -3 });
    const max = original.getField('maxPos')!.withValue({ x: 4, y: 5, z: 6 });
    assert.equal(min.bounds.minY, -2); assert.equal(max.bounds.maxZ, 6);
    assert.throws(() => original.getField('minPos')!.withValue(null), TypeError);
    assert.isTrue(original.withScrap(true).scrap);
    assert.isFalse(original.withScrap(false).scrap);
    assert.isNull(original.withManagerContainer(null).managerContainer);
  });

  it('edits typed segment fields and rejects the wrong domain object', () => {
    const original = ship();
    const fields = {
      npcData: new Slot.NpcDataState(), railController: new Slot.RailControllerState(),
      coreTimer: new Slot.CoreTimerState(), blueprintInfo: new Slot.BlueprintInfo(),
      itemsToSpawnWith: new Slot.ItemsToSpawnWith(), quarterManager: new Slot.QuarterManagerState(),
    };
    for (const [key, value] of Object.entries(fields)) {
      const next = original.getField(key)!.withValue(value);
      assert.instanceOf((next as any)[key], value.constructor);
      assert.throws(() => original.getField(key)!.withValue({}), TypeError);
    }
    const empty = Ship.fromTag(Tags.struct('s3', ship().toTag().getStruct().slice(0,11)));
    const namedNpc = new Slot.NpcDataState(Tags.struct('custom-npc', []));
    assert.throws(() => empty.withNpcData(namedNpc), /complete source record/);
    assert.throws(() => empty.withQuarterManager(new Slot.QuarterManagerState()), /complete source record/);
    for (const Ctor of [SpaceStation, ShopSpaceStation, FloatingRock]) {
      const entity = Ctor.fromTag(original.toTag());
      assert.equal(entity.withUniqueId('other').uniqueId, 'other');
      assert.equal(Ctor.fromBuffer(entity.toBuffer()).uniqueId, original.uniqueId);
    }
  });

  it('edits all transformable values using typed and plain representations', () => {
    const original = character();
    const transform = new EntityTransform(1, 2, 3, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    const array = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
    for (const value of [transform, array, { ...transform }]) {
      const next = original.getTransformableField('transform')!.withValue(value);
      assert.equal(next.transform.originX, 1);
      assert.equal(PlayerCharacterEntity.fromTag(next.toTag()).transform.originZ, 3);
    }
    assert.throws(() => original.getTransformableField('transform')!.withValue(null), TypeError);
    for (const value of [new SectorPosition(4, 5, 6), { x: 4, y: 5, z: 6 }]) {
      assert.equal(original.getTransformableField('sectorPosition')!.withValue(value).sectorPosition.y, 5);
    }
    assert.throws(() => original.getTransformableField('sectorPosition')!.withValue(false), TypeError);
    assert.deepEqual(original.getTransformableField('spawnController')!.withValue(SpawnController.EMPTY).spawnController, SpawnController.EMPTY);
    assert.throws(() => original.getTransformableField('spawnController')!.withValue({}), TypeError);
    for (const [key, value] of [['mass', 3], ['factionId', -1], ['owner', 'owner']] as const) {
      assert.strictEqual((original.getTransformableField(key)!.withValue(value) as any)[key], value);
    }
    assert.include(GameEntity.prototype.toString.call(original), 'PLAYER_CHARACTER');
  });

  it('edits player fields, membership shapes and portable domain values', () => {
    const original = player();
    for (const value of [new FactionMembership(7, 2), { factionId: 7, rank: 2 }, { factionId: 7 }]) {
      const next = original.getField('factionMembership')!.withValue(value);
      assert.equal(next.faction.factionId, 7);
      assert.equal(next.faction.rank, 'rank' in value ? value.rank : 0);
    }
    assert.throws(() => original.getField('factionMembership')!.withValue(false), TypeError);
    const values = {
      inventory: Inventory.EMPTY, hostHistory: new Slot.PlayerInfoHistoryList(), scanHistory: new Slot.ScanHistory(),
      inventoryBackup: new Slot.InventoryBackupState(), savedCoordinates: new Slot.SavedCoordinates(),
      ignoredPlayers: new Slot.IgnoredPlayers(), cargoInventoryBlock: new Slot.CargoInventoryBlock(),
    };
    for (const [key, value] of Object.entries(values)) {
      const next = original.getField(key)!.withValue(value);
      assert.instanceOf((next as any)[key], value.constructor);
      assert.throws(() => original.getField(key)!.withValue({}), TypeError);
    }
    for (const [key, value, property] of [
      ['lastLogin', 100n, 'lastLogin'], ['lastLogout', 101n, 'lastLogout'],
      ['lastEnteredEntity', 'ship', 'lastEnteredEntity'], ['creativeMode', false, 'hasCreativeMode'],
      ['health', 20, 'health'], ['credits', 999n, 'credits'],
    ] as const) assert.strictEqual((original.getField(key)!.withValue(value) as any)[property], value);
    assert.equal(original.getField('mineAutoArmSecs')!.withValue(12).toTag().getStruct()[30].getInt(), 12);
  });
});

describe('Entity contracts — enriched statistics', () => {
  afterEach(() => BlockRegistry.reset());
  it('computes known and unknown block statistics without requiring an installation', () => {
    const config = BlockConfig.fromXml('<Config><Block type="5" name="Hull"><Hitpoints>100</Hitpoints><Mass>2</Mass><Price>7</Price></Block></Config>');
    BlockRegistry.init(config);
    const seg = emptySegment(); seg.blocks[0].type = 5; seg.blocks[1].type = 5; seg.blocks[2].type = 999; seg.blockCount = 3;
    const stats = Rich.getSegmentStats(seg);
    assert.equal(stats.totalMass, 4); assert.equal(stats.totalBlocks, 3); assert.equal(stats.uniqueTypes, 2);
    assert.equal(stats.topTypes[0].name, 'Hull'); assert.equal(stats.topTypes[1].name, 'block#999');
    assert.equal(Rich.enrichSegment(seg)[2].blockDef, null);
    assert.equal(Rich.getSegmentStats(emptySegment()).totalBlocks, 0);
    const inventory = Inventory.EMPTY.set(new ItemStack(0, 5, 2)).set(new ItemStack(1, 999, 1));
    const items = Rich.enrichInventory(inventory);
    assert.equal(items[0].totalMass, 4); assert.equal(items[0].totalPrice, 14);
    assert.equal(items[1].blockName, 'block#999'); assert.equal(items[1].totalPrice, 0);
    const rich = new Rich.RichSegmentController(ship());
    assert.equal(rich.summary().uniqueId, ship().uniqueId);
    assert.isAbove(rich.summary().topControlTypes.length, 0);
    assert.deepEqual(rich.analyzeSmd3({ ...emptySmd3File(), segments: [seg] }), [stats]);
    assert.isNull(new Rich.RichSegmentController(ship().withManagerContainer(null)).blockStats);
    assert.isNull(new Rich.RichSegmentController(ship().withManagerContainer(ManagerContainer.EMPTY)).blockStats);
  });
});
