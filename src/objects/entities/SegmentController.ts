/**
 * @fileoverview Segment Controller
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SegmentController — base class for Ship, SpaceStation, Shop, Planet, FloatingRock.
 *
 * Port of SegmentController.fromTagStructure() Java.
 *
 * Complete subTag map[N] :
 *   [0]  STRING  uniqueId
 *   [1]  VECTOR3i minPos
 *   [2]  VECTOR3i maxPos
 *   [3]  STRUCT  dockingController  → DockingState
 *   [4]  STRUCT  controlElementMap → ControlElementMapper (SERIALIZABLE id=0)
 *   [5]  STRING  realName
 *   [6]  STRUCT  "transformable"   → GameEntity fields
 *   [7]  STRUCT  "container"       → ManagerContainer (si ManagedSegmentController)
 *   [8]  INT     creatorId
 *   [9]  STRING  spawner
 *   [10] STRING  lastModifier
 *   [11] LONG    seed
 *   [12] BYTE    touched
 *   [13] STRUCT  extraTag (opaque)
 *   [14] STRUCT  npcData (opaque)
 *   [15] STRUCT|BYTE textBlocks/scrap
 *   [16] BYTE    vulnerable
 *   [17] BYTE    minable
 *   [18] BYTE    factionRights
 *   [19] STRUCT  railTag (opaque)
 *   [20] INT     nonEmptySegments
 *   [21] STRUCT  hpController → HpState
 *   [22] ...     overheatingTag (opaque)
 *   [23] BYTE    oldPowerFlag
 *   [24] STRUCT  blueprintInfo [STRING path, STRING id]
 *   [25] STRING  currentOwner
 *   [26] STRING  lastDockerPlayer
 *   [27..31] optionnels (classification, itemsToSpawn, etc.)
 *   [32] LONG    lastAsked
 *   [33] LONG    lastAllowed
 *   [34] BYTE    usedOldPower
 *   [35] INT     oldPowerBlocks
 *   [36] SERIALIZABLE blockKillRecorder (optionnel, ManagedUsable)
 *   [37] LONG    lastEditBlocks
 *   [38] LONG    lastDamageTaken
 *   [39] LONG    lastAdminCheckFlag
 *   [40] BYTE    tagVersion
 *   [41] STRUCT  quarterManager (optionnel)
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { readFrom, writeTo } from '../../core/TagParser.js';
import { GameEntity } from './GameEntity.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import { DockingState } from '../components/DockingState.js';
import { HpState } from '../components/HpState.js';
import { TextBlocks } from '../components/TextBlocks.js';
import { ManagerContainer } from '../components/ManagerContainer.js';
import { ControlElementMapper } from '../Serializables.js';
import type { RawElement } from '../../serializable/Factories.js';
import {
  buildEditableEntityFields,
  fieldValueAsBigInt,
  fieldValueAsBoolean,
  fieldValueAsInteger,
  fieldValueAsString,
  SEGMENT_CONTROLLER_FIELD_SCHEMA,
  type EntityField,
} from '../EntityFieldView.js';
import {
  BlueprintInfo,
  CoreTimerState,
  ItemsToSpawnWith,
  NpcDataState,
  QuarterManagerState,
  RailControllerState,
} from '../EntitySlotObjects.js';

// ── Position blocks ─────────────────────────────────────────────────────────

export interface BlockBounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

// ── SegmentController ─────────────────────────────────────────────────────────

export abstract class SegmentController extends GameEntity {
  constructor(
    // GameEntity
    mass: number, transform: EntityTransform,
    sectorPosition: SectorPosition, factionId: number, owner: string,
    spawnController: SpawnController, _transformableChildren: Tag[],

    // SegmentController specifics
    readonly uniqueId: string,
    readonly realName: string,
    readonly bounds: BlockBounds,
    readonly dockingState: DockingState,
    readonly controlElementMap: ControlElementMapper,
    readonly managerContainer: ManagerContainer | null,
    readonly creatorId: number,
    readonly spawner: string,
    readonly lastModifier: string,
    readonly seed: bigint,
    readonly nonEmptySegments: number,
    readonly hpState: HpState,
    readonly textBlocks: TextBlocks,
    readonly scrap: boolean,
    readonly vulnerable: boolean,
    readonly minable: boolean,
    readonly factionRights: number,
    readonly currentOwner: string,
    readonly lastDockerPlayer: string,
    readonly lastEditBlocks: bigint,
    readonly lastDamageTaken: bigint,
    readonly tagVersion: number,
    /** Original root Tag — for faithful round-tripping of opaque fields */
    protected readonly _rootChildren: Tag[],
  ) {
    super(mass, transform, sectorPosition, factionId, owner, spawnController, _transformableChildren);
    Object.defineProperty(this, '_rootChildren', { enumerable: false });
  }

  // Widens _clone to also accept SegmentController-specific overrides
  protected abstract _clone(overrides: Partial<{
    mass: number; transform: EntityTransform;
    sectorPosition: SectorPosition; factionId: number;
    owner: string; spawnController: SpawnController;
    realName: string; vulnerable: boolean; minable: boolean;
    scrap: boolean; factionRights: number; seed: bigint;
    spawner: string; lastModifier: string; creatorId: number;
    uniqueId: string; bounds: BlockBounds; nonEmptySegments: number;
    currentOwner: string; lastDockerPlayer: string;
    lastEditBlocks: bigint; lastDamageTaken: bigint; tagVersion: number;
    managerContainer: ManagerContainer | null;
    rootChildren: Tag[];
  }>): this;

  // ── Accesseurs pratiques ───────────────────────────────────────────────────

  get isDocked(): boolean        { return this.dockingState.isDocked; }
  get isAlive(): boolean         { return this.hpState.isAlive; }
  get hpPercent(): number        { return this.hpState.hpPercent; }

  /** StarMade-Open SegmentController slot view, without raw Tag exposure. */
  get fields(): readonly EntityField<this>[] {
    return buildEditableEntityFields(this._rootChildren, SEGMENT_CONTROLLER_FIELD_SCHEMA, {
      uniqueId: value => this.withUniqueId(fieldValueAsString(value, 'uniqueId')),
      minPos: value => this.withBounds({ ...this.bounds, ...minBoundsFromFieldValue(value, 'minPos') }),
      maxPos: value => this.withBounds({ ...this.bounds, ...maxBoundsFromFieldValue(value, 'maxPos') }),
      realName: value => this.withRealName(fieldValueAsString(value, 'realName')),
      creatorId: value => this.withCreatorId(fieldValueAsInteger(value, 'creatorId')),
      spawner: value => this.withSpawner(fieldValueAsString(value, 'spawner')),
      lastModifier: value => this.withLastModifier(fieldValueAsString(value, 'lastModifier')),
      seed: value => this.withSeed(fieldValueAsBigInt(value, 'seed')),
      npcData: value => this.withNpcData(requireInstance(value, NpcDataState, 'npcData')),
      vulnerable: value => this.withVulnerable(fieldValueAsBoolean(value, 'vulnerable')),
      minable: value => this.withMinable(fieldValueAsBoolean(value, 'minable')),
      factionRights: value => this.withFactionRights(fieldValueAsInteger(value, 'factionRights')),
      railController: value => this.withRailController(requireInstance(value, RailControllerState, 'railController')),
      nonEmptySegments: value => this.withNonEmptySegments(fieldValueAsInteger(value, 'nonEmptySegments')),
      coreTimer: value => this.withCoreTimer(requireInstance(value, CoreTimerState, 'coreTimer')),
      blueprintInfo: value => this.withBlueprintInfo(requireInstance(value, BlueprintInfo, 'blueprintInfo')),
      currentOwnerLowerCase: value => this.withCurrentOwner(fieldValueAsString(value, 'currentOwnerLowerCase')),
      lastDockerPlayerLowerCase: value => this.withLastDockerPlayer(fieldValueAsString(value, 'lastDockerPlayerLowerCase')),
      itemsToSpawnWith: value => this.withItemsToSpawnWith(requireInstance(value, ItemsToSpawnWith, 'itemsToSpawnWith')),
      lastEditBlocks: value => this.withLastEditBlocks(fieldValueAsBigInt(value, 'lastEditBlocks')),
      lastDamageTaken: value => this.withLastDamageTaken(fieldValueAsBigInt(value, 'lastDamageTaken')),
      tagVersion: value => this.withTagVersion(fieldValueAsInteger(value, 'tagVersion')),
      quarterManager: value => this.withQuarterManager(requireInstance(value, QuarterManagerState, 'quarterManager')),
    });
  }

  getField(key: string): EntityField<this> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  get extraTagDataField(): EntityField<this> | null { return this.fields[13] ?? null; }
  get npcDataField(): EntityField<this> | null { return this.fields[14] ?? null; }
  get railControllerField(): EntityField<this> | null { return this.fields[19] ?? null; }
  get coreTimerField(): EntityField<this> | null { return this.fields[22] ?? null; }
  get blueprintInfoField(): EntityField<this> | null { return this.fields[24] ?? null; }
  get itemsToSpawnWithField(): EntityField<this> | null { return this.fields[28] ?? null; }
  get blockKillRecorderField(): EntityField<this> | null { return this.fields[36] ?? null; }
  get quarterManagerField(): EntityField<this> | null { return this.fields[41] ?? null; }

  get npcData(): NpcDataState { return new NpcDataState(this._rootChildren[14]); }
  get railController(): RailControllerState { return new RailControllerState(this._rootChildren[19]); }
  get coreTimer(): CoreTimerState { return new CoreTimerState(this._rootChildren[22]); }
  get blueprintInfo(): BlueprintInfo { return new BlueprintInfo(this._rootChildren[24]); }
  get itemsToSpawnWith(): ItemsToSpawnWith { return new ItemsToSpawnWith(this._rootChildren[28]); }
  get quarterManager(): QuarterManagerState { return new QuarterManagerState(this._rootChildren[41]); }

  // ── SegmentController-specific mutations ─────────────────────────────────

  /** Changes the internal unique id stored in tag field [0]. */
  withUniqueId(uniqueId: string): this {
    return this._clone({ uniqueId });
  }

  /** Changes the block bounding box stored in tag fields [1] and [2]. */
  withBounds(bounds: BlockBounds): this {
    return this._clone({ bounds });
  }

  /** Changes the displayed real name (visible in-game, stored in tag field [5]). */
  withRealName(realName: string): this {
    return this._clone({ realName });
  }

  /** Sets the entity vulnerability flag. */
  withVulnerable(vulnerable: boolean): this {
    return this._clone({ vulnerable });
  }

  /** Sets the entity minability flag. */
  withMinable(minable: boolean): this {
    return this._clone({ minable });
  }

  /** Sets the scrap flag (used for debris/wreckage). */
  withScrap(scrap: boolean): this {
    return this._clone({ scrap });
  }

  /** Sets the faction rights flags. */
  withFactionRights(factionRights: number): this {
    return this._clone({ factionRights });
  }

  /** Sets the entity seed (used for procedural generation). */
  withSeed(seed: bigint): this {
    return this._clone({ seed });
  }

  /** Sets the spawner UID (entity that originally spawned this). */
  withSpawner(spawner: string): this {
    return this._clone({ spawner });
  }

  /** Sets the last modifier player name. */
  withLastModifier(lastModifier: string): this {
    return this._clone({ lastModifier });
  }

  /** Sets the creator DB ID. */
  withCreatorId(creatorId: number): this {
    return this._clone({ creatorId });
  }

  withNonEmptySegments(nonEmptySegments: number): this {
    return this._clone({ nonEmptySegments });
  }

  withCurrentOwner(currentOwner: string): this {
    return this._clone({ currentOwner });
  }

  withLastDockerPlayer(lastDockerPlayer: string): this {
    return this._clone({ lastDockerPlayer });
  }

  withLastEditBlocks(lastEditBlocks: bigint): this {
    return this._clone({ lastEditBlocks });
  }

  withLastDamageTaken(lastDamageTaken: bigint): this {
    return this._clone({ lastDamageTaken });
  }

  withTagVersion(tagVersion: number): this {
    return this._clone({ tagVersion });
  }

  withManagerContainer(managerContainer: ManagerContainer | null): this {
    return this._clone({ managerContainer });
  }

  withNpcData(npcData: NpcDataState): this {
    return this._withRootChild(14, npcData.toTag());
  }

  withRailController(railController: RailControllerState): this {
    return this._withRootChild(19, railController.toTag());
  }

  withCoreTimer(coreTimer: CoreTimerState): this {
    return this._withRootChild(22, coreTimer.toTag());
  }

  withBlueprintInfo(blueprintInfo: BlueprintInfo): this {
    return this._withRootChild(24, blueprintInfo.toTag());
  }

  withItemsToSpawnWith(itemsToSpawnWith: ItemsToSpawnWith): this {
    return this._withRootChild(28, itemsToSpawnWith.toTag());
  }

  withQuarterManager(quarterManager: QuarterManagerState): this {
    return this._withRootChild(41, quarterManager.toTag());
  }

  private _withRootChild(index: number, tag: Tag): this {
    const children = [...this._rootChildren];
    while (children.length <= index) children.push(Tags.nothing(null));
    const current = children[index];
    children[index] = current?.name !== undefined && tag.name === null
      ? new Tag(tag.type, current.name, tag.value, tag.listType ?? undefined)
      : tag;
    return this._clone({ rootChildren: children });
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toTag(): Tag {
    const c = [...this._rootChildren];

    const set = (idx: number, t: Tag) => {
      if (idx < c.length) c[idx] = t;
    };

    // Fields that are always present
    set(0, Tags.string(null, this.uniqueId));
    set(1, Tags.vector3i(null, this.bounds.minX, this.bounds.minY, this.bounds.minZ));
    set(2, Tags.vector3i(null, this.bounds.maxX, this.bounds.maxY, this.bounds.maxZ));
    set(3, this.dockingState.toTag());
    // [4] ControlElementMap — preserved as-is (SERIALIZABLE)
    set(5, Tags.string(null, this.realName));
    set(6, this._buildTransformableTag());
    if (this.managerContainer && c[7]?.type === TagType.STRUCT) {
      set(7, this.managerContainer.toTag());
    }
    set(8, Tags.int(null, this.creatorId));
    set(9, Tags.string(null, this.spawner));
    set(10, Tags.string(null, this.lastModifier));
    if (c[11]?.type === TagType.LONG) set(11, Tags.long(null, this.seed));
    // [12] touched — preserved
    // [13..14] extra/npc — preserved
    if (c[15]?.type === TagType.STRUCT) set(15, this.textBlocks.toTag());
    if (c[16]?.type === TagType.BYTE) set(16, Tags.byte(null, this.vulnerable ? 1 : 0));
    if (c[17]?.type === TagType.BYTE) set(17, Tags.byte(null, this.minable ? 1 : 0));
    if (c[18]?.type === TagType.BYTE) set(18, Tags.byte(null, this.factionRights));
    // [19] railTag — preserved unless replaced through RailControllerState
    if (c[20]?.type === TagType.INT)  set(20, Tags.int(null, this.nonEmptySegments));
    if (c[21]?.type === TagType.STRUCT) set(21, this.hpState.toTag());
    if (c[25]?.type === TagType.STRING) set(25, Tags.string(null, this.currentOwner));
    if (c[26]?.type === TagType.STRING) set(26, Tags.string(null, this.lastDockerPlayer));
    if (c[37]?.type === TagType.LONG)   set(37, Tags.long(null, this.lastEditBlocks));
    if (c[38]?.type === TagType.LONG)   set(38, Tags.long(null, this.lastDamageTaken));
    if (c[40]?.type === TagType.BYTE)   set(40, Tags.byte(null, this.tagVersion));

    return new Tag(TagType.STRUCT, this._rootTag_name(), [...c, FINISH_TAG]);
  }

  protected _rootTag_name(): string | null { return null; }

  toBuffer(): Buffer { return writeTo(this.toTag()); }

  // ── Parse statique ────────────────────────────────────────────────────────

  protected static _parse(root: Tag): {
    // GameEntity
    mass: number; transform: EntityTransform;
    sectorPosition: SectorPosition; factionId: number; owner: string;
    spawnController: SpawnController; transformableChildren: Tag[];
    // SegmentController
    uniqueId: string; realName: string; bounds: BlockBounds;
    dockingState: DockingState; controlElementMap: ControlElementMapper;
    managerContainer: ManagerContainer | null;
    creatorId: number; spawner: string; lastModifier: string; seed: bigint;
    nonEmptySegments: number; hpState: HpState; textBlocks: TextBlocks;
    scrap: boolean; vulnerable: boolean; minable: boolean;
    factionRights: number; currentOwner: string; lastDockerPlayer: string;
    lastEditBlocks: bigint; lastDamageTaken: bigint; tagVersion: number;
    rootChildren: Tag[];
  } {
    // Some files have a wrapper (Shop, SpaceStation with a container)
    let sc = root;
    if (root.type === TagType.STRUCT) {
      const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
      if (!s.some(t => t.name === 'uniqueId' || (t.type === TagType.STRING && s.indexOf(t) === 0))) {
        // Find a child struct containing uniqueId
        const wrapper = s.find(sub =>
          sub.type === TagType.STRUCT &&
          sub.getStruct().some(t => t.name === null && t.type === TagType.STRING)
        );
        if (wrapper) sc = wrapper;
      }
    }

    const s = sc.type === TagType.STRUCT
      ? sc.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const uniqueId    = s[0]?.type === TagType.STRING   ? s[0].getString()   : '';
    const minV        = s[1]?.type === TagType.VECTOR3i ? s[1].getVector3i() : null;
    const maxV        = s[2]?.type === TagType.VECTOR3i ? s[2].getVector3i() : null;
    const bounds: BlockBounds = {
      minX: minV?.x ?? 0, minY: minV?.y ?? 0, minZ: minV?.z ?? 0,
      maxX: maxV?.x ?? 0, maxY: maxV?.y ?? 0, maxZ: maxV?.z ?? 0,
    };

    let dockingState = DockingState.UNDOCKED;
    if (s[3]?.type === TagType.STRUCT) {
      try { dockingState = DockingState.fromTag(s[3]); } catch { /* skip */ }
    }

    // ControlElementMap = SERIALIZABLE id=0
    let controlElementMap = new ControlElementMapper([]);
    if (s[4]?.type === TagType.SERIALIZABLE) {
      const elem = s[4].value as RawElement;
      if (elem.factoryId === 0) {
        try { controlElementMap = ControlElementMapper.fromRaw(elem.raw); } catch { /* skip */ }
      }
    }

    const realName    = s[5]?.type === TagType.STRING   ? s[5].getString()   : '';
    const creatorId   = s[8]?.type === TagType.INT      ? s[8].getInt()      : 0;
    const spawner     = s[9]?.type === TagType.STRING   ? s[9].getString()   : '';
    const lastModifier = s[10]?.type === TagType.STRING ? s[10].getString()  : '';
    const seed        = s[11]?.type === TagType.LONG    ? s[11].getLong()    : 0n;
    const nonEmptySegments = s[20]?.type === TagType.INT ? s[20].getInt()   : 0;
    const factionRights    = s[18]?.type === TagType.BYTE ? s[18].getByte() : 0;
    const scrap       = s[15]?.type === TagType.BYTE    ? s[15].getByte() > 0 : false;
    const vulnerable  = s[16]?.type === TagType.BYTE    ? s[16].getByte() > 0 : true;
    const minable     = s[17]?.type === TagType.BYTE    ? s[17].getByte() > 0 : true;
    const currentOwner     = s[25]?.type === TagType.STRING ? s[25].getString() : '';
    const lastDockerPlayer = s[26]?.type === TagType.STRING ? s[26].getString() : '';
    const lastEditBlocks   = s[37]?.type === TagType.LONG ? s[37].getLong() : 0n;
    const lastDamageTaken  = s[38]?.type === TagType.LONG ? s[38].getLong() : 0n;
    const tagVersion       = s[40]?.type === TagType.BYTE ? s[40].getByte() : 0;

    let hpState = HpState.EMPTY;
    if (s[21]?.type === TagType.STRUCT) {
      try { hpState = HpState.fromTag(s[21]); } catch { /* skip */ }
    }

    let textBlocks = TextBlocks.EMPTY;
    if (s[15]?.type === TagType.STRUCT) {
      try { textBlocks = TextBlocks.fromTag(s[15]); } catch { /* skip */ }
    }

    let managerContainer: ManagerContainer | null = null;
    if (s[7]?.type === TagType.STRUCT) {
      try { managerContainer = ManagerContainer.fromTag(s[7]); } catch { /* skip */ }
    }

    // GameEntity — transformable
    let mass = 0.1, transform = EntityTransform.IDENTITY;
    let sectorPosition = SectorPosition.ZERO, factionId = 0, owner = '';
    let spawnController = SpawnController.EMPTY;
    let transformableChildren: Tag[] = [];

    if (s[6]?.type === TagType.STRUCT) {
      const parsed = GameEntity.parseTransformable(s[6]);
      mass = parsed.mass; transform = parsed.transform;
      sectorPosition = parsed.sectorPosition; factionId = parsed.factionId;
      owner = parsed.owner; spawnController = parsed.spawnController;
      transformableChildren = parsed.children;
    }

    return {
      mass, transform, sectorPosition, factionId, owner, spawnController, transformableChildren,
      uniqueId, realName, bounds, dockingState, controlElementMap, managerContainer,
      creatorId, spawner, lastModifier, seed, nonEmptySegments, hpState, textBlocks,
      scrap, vulnerable, minable, factionRights, currentOwner, lastDockerPlayer,
      lastEditBlocks, lastDamageTaken, tagVersion, rootChildren: s,
    };
  }

  toString(): string {
    return `${this.entityType}(id="${this.uniqueId}", name="${this.realName}", sector=${this.sectorPosition}, hp=${this.hpState.hpPercent}%)`;
  }
}

function vectorFromFieldValue(value: unknown, key: string): { x: number; y: number; z: number } {
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return {
      x: fieldValueAsInteger(candidate.x, `${key}.x`),
      y: fieldValueAsInteger(candidate.y, `${key}.y`),
      z: fieldValueAsInteger(candidate.z, `${key}.z`),
    };
  }
  throw new TypeError(`Entity field "${key}" expects {x,y,z}`);
}

function minBoundsFromFieldValue(value: unknown, key: string): Pick<BlockBounds, 'minX' | 'minY' | 'minZ'> {
  const v = vectorFromFieldValue(value, key);
  return { minX: v.x, minY: v.y, minZ: v.z };
}

function maxBoundsFromFieldValue(value: unknown, key: string): Pick<BlockBounds, 'maxX' | 'maxY' | 'maxZ'> {
  const v = vectorFromFieldValue(value, key);
  return { maxX: v.x, maxY: v.y, maxZ: v.z };
}

function requireInstance<T>(value: unknown, ctor: new (...args: any[]) => T, key: string): T {
  if (value instanceof ctor) return value;
  throw new TypeError(`Entity field "${key}" expects a ${ctor.name} object`);
}
