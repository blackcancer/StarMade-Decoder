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
import { writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { GameEntity } from './GameEntity.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import { DockingState } from '../components/DockingState.js';
import { HpState } from '../components/HpState.js';
import { TextBlocks } from '../components/TextBlocks.js';
import { ManagerContainer } from '../components/ManagerContainer.js';
import { ControlElementMapper } from '../Serializables.js';
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

/** Locates a positional controller tuple and rejects ambiguous wrappers. */
export function segmentControllerIndex(root: Tag): number {
  const children=root.getStruct();
  if(children[0]?.type===TagType.STRING)return -1;
  const matches=children.map((tag,index)=>tag.type===TagType.STRUCT&&tag.getStruct()[0]?.type===TagType.STRING?index:-1).filter(index=>index>=0);
  if(matches.length!==1)throw new DecodeError('E_FORMAT','Missing or ambiguous segment-controller wrapper');
  return matches[0];
}

// ── Position blocks ─────────────────────────────────────────────────────────

/**
 * Describes the BlockBounds data shape used by high-level StarMade entity modelling.
 */
export interface BlockBounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

// ── SegmentController ─────────────────────────────────────────────────────────

/**
 * Represents the SegmentController model used by high-level StarMade entity modelling.
 */
export abstract class SegmentController extends GameEntity {
  protected readonly sourceFile: TagModelFile;
  /** Detached controller slots, separate from any enclosing Shop/SpaceStation wrapper. */
  protected get _rootChildren(): Tag[] {
    const root=this.sourceFile.root,index=segmentControllerIndex(root);
    return (index<0?root:root.getStruct()[index]).getStruct().filter(tag=>tag.type!==TagType.FINISH);
  }
  /**
   * Creates a SegmentController instance.
   *
   * @param mass - Input value for the constructor operation.
   * @param transform - Input value for the constructor operation.
   * @param sectorPosition - Input value for the constructor operation.
   * @param factionId - Input value for the constructor operation.
   * @param owner - Input value for the constructor operation.
   * @param spawnController - Input value for the constructor operation.
   * @param _transformableChildren - Input value for the constructor operation.
   * @param uniqueId - Input value for the constructor operation.
   * @param realName - Input value for the constructor operation.
   * @param bounds - Input value for the constructor operation.
   * @param dockingState - Input value for the constructor operation.
   * @param controlElementMap - Input value for the constructor operation.
   * @param managerContainer - Input value for the constructor operation.
   * @param creatorId - Input value for the constructor operation.
   * @param spawner - Input value for the constructor operation.
   * @param lastModifier - Input value for the constructor operation.
   * @param seed - Input value for the constructor operation.
   * @param nonEmptySegments - Input value for the constructor operation.
   * @param hpState - Input value for the constructor operation.
   * @param textBlocks - Input value for the constructor operation.
   * @param scrap - Input value for the constructor operation.
   * @param vulnerable - Input value for the constructor operation.
   * @param minable - Input value for the constructor operation.
   * @param factionRights - Input value for the constructor operation.
   * @param currentOwner - Input value for the constructor operation.
   * @param lastDockerPlayer - Input value for the constructor operation.
   * @param lastEditBlocks - Input value for the constructor operation.
   * @param lastDamageTaken - Input value for the constructor operation.
   * @param tagVersion - Input value for the constructor operation.
   * @param _rootChildren - Input value for the constructor operation.
   */
  protected constructor(
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
    rootChildren: Tag[], options: TagReadOptions, source: TagModelFile,
  ) {
    super(mass, transform, sectorPosition, factionId, owner, spawnController, _transformableChildren, options);
    this.sourceFile=source;
    this.bounds=Object.freeze({...bounds});
    Object.defineProperty(this, 'sourceFile', { enumerable: false });
  }

  // Widens _clone to also accept SegmentController-specific overrides
  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Reports whether isDocked is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isDocked(): boolean        { return this.dockingState.isDocked; }
  /**
   * Reports whether isAlive is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isAlive(): boolean         { return this.hpState.isAlive; }
  /**
   * Handles the hpPercent operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns Field.
   *
   * @param key - Input value for the getField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getField(key: string): EntityField<this> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  /**
   * Handles the extraTagDataField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get extraTagDataField(): EntityField<this> | null { return this.fields[13] ?? null; }
  /**
   * Handles the npcDataField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get npcDataField(): EntityField<this> | null { return this.fields[14] ?? null; }
  /**
   * Handles the railControllerField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get railControllerField(): EntityField<this> | null { return this.fields[19] ?? null; }
  /**
   * Handles the coreTimerField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get coreTimerField(): EntityField<this> | null { return this.fields[22] ?? null; }
  /**
   * Handles the blueprintInfoField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get blueprintInfoField(): EntityField<this> | null { return this.fields[24] ?? null; }
  /**
   * Handles the itemsToSpawnWithField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get itemsToSpawnWithField(): EntityField<this> | null { return this.fields[28] ?? null; }
  /**
   * Handles the blockKillRecorderField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get blockKillRecorderField(): EntityField<this> | null { return this.fields[36] ?? null; }
  /**
   * Handles the quarterManagerField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get quarterManagerField(): EntityField<this> | null { return this.fields[41] ?? null; }

  /**
   * Handles the npcData operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get npcData(): NpcDataState { return new NpcDataState(this._rootChildren[14], this.options); }
  /**
   * Handles the railController operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get railController(): RailControllerState { return new RailControllerState(this._rootChildren[19], this.options); }
  /**
   * Handles the coreTimer operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get coreTimer(): CoreTimerState { return new CoreTimerState(this._rootChildren[22], this.options); }
  /**
   * Handles the blueprintInfo operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get blueprintInfo(): BlueprintInfo { return new BlueprintInfo(this._rootChildren[24], this.options); }
  /**
   * Handles the itemsToSpawnWith operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get itemsToSpawnWith(): ItemsToSpawnWith { return new ItemsToSpawnWith(this._rootChildren[28], this.options); }
  /**
   * Handles the quarterManager operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get quarterManager(): QuarterManagerState { return new QuarterManagerState(this._rootChildren[41], this.options); }

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

  /**
   * Returns a copy updated with NonEmptySegments.
   *
   * @param nonEmptySegments - Input value for the withNonEmptySegments operation.
   * @returns The computed StarMade-Decoder value.
   */
  withNonEmptySegments(nonEmptySegments: number): this {
    return this._clone({ nonEmptySegments });
  }

  /**
   * Returns a copy updated with CurrentOwner.
   *
   * @param currentOwner - Input value for the withCurrentOwner operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCurrentOwner(currentOwner: string): this {
    return this._clone({ currentOwner });
  }

  /**
   * Returns a copy updated with LastDockerPlayer.
   *
   * @param lastDockerPlayer - Input value for the withLastDockerPlayer operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastDockerPlayer(lastDockerPlayer: string): this {
    return this._clone({ lastDockerPlayer });
  }

  /**
   * Returns a copy updated with LastEditBlocks.
   *
   * @param lastEditBlocks - Input value for the withLastEditBlocks operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastEditBlocks(lastEditBlocks: bigint): this {
    return this._clone({ lastEditBlocks });
  }

  /**
   * Returns a copy updated with LastDamageTaken.
   *
   * @param lastDamageTaken - Input value for the withLastDamageTaken operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastDamageTaken(lastDamageTaken: bigint): this {
    return this._clone({ lastDamageTaken });
  }

  /**
   * Returns a copy updated with TagVersion.
   *
   * @param tagVersion - Input value for the withTagVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTagVersion(tagVersion: number): this {
    return this._clone({ tagVersion });
  }

  /**
   * Returns a copy updated with ManagerContainer.
   *
   * @param managerContainer - Input value for the withManagerContainer operation.
   * @returns The computed StarMade-Decoder value.
   */
  withManagerContainer(managerContainer: ManagerContainer | null): this {
    return this._clone({ managerContainer });
  }

  /**
   * Returns a copy updated with NpcData.
   *
   * @param npcData - Input value for the withNpcData operation.
   * @returns The computed StarMade-Decoder value.
   */
  withNpcData(npcData: NpcDataState): this {
    return this._withRootChild(14, npcData.toTag());
  }

  /**
   * Returns a copy updated with RailController.
   *
   * @param railController - Input value for the withRailController operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailController(railController: RailControllerState): this {
    return this._withRootChild(19, railController.toTag());
  }

  /**
   * Returns a copy updated with CoreTimer.
   *
   * @param coreTimer - Input value for the withCoreTimer operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCoreTimer(coreTimer: CoreTimerState): this {
    return this._withRootChild(22, coreTimer.toTag());
  }

  /**
   * Returns a copy updated with BlueprintInfo.
   *
   * @param blueprintInfo - Input value for the withBlueprintInfo operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBlueprintInfo(blueprintInfo: BlueprintInfo): this {
    return this._withRootChild(24, blueprintInfo.toTag());
  }

  /**
   * Returns a copy updated with ItemsToSpawnWith.
   *
   * @param itemsToSpawnWith - Input value for the withItemsToSpawnWith operation.
   * @returns The computed StarMade-Decoder value.
   */
  withItemsToSpawnWith(itemsToSpawnWith: ItemsToSpawnWith): this {
    return this._withRootChild(28, itemsToSpawnWith.toTag());
  }

  /**
   * Returns a copy updated with QuarterManager.
   *
   * @param quarterManager - Input value for the withQuarterManager operation.
   * @returns The computed StarMade-Decoder value.
   */
  withQuarterManager(quarterManager: QuarterManagerState): this {
    return this._withRootChild(41, quarterManager.toTag());
  }

  /**
   * Returns a copy updated with RootChild.
   *
   * @param index - Input value for the _withRootChild operation.
   * @param tag - Input value for the _withRootChild operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _withRootChild(index: number, tag: Tag): this {
    const children = [...this._rootChildren], current = children[index];
    if(!current)throw new DecodeError('E_INCOMPLETE',`Controller field ${index} is absent; a complete source record is required`);
    children[index] = Tags.rename(tag, current.name);
    return this._clone({ rootChildren: children });
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag { return this.sourceFile.root; }

  /** Writes the complete retained file envelope rather than regenerating unrelated component fields. */
  toBuffer(): Buffer { return this.sourceFile.toBuffer(); }

  // ── Parse statique ────────────────────────────────────────────────────────

  /**
   * Parses input data for high-level StarMade entity modelling.
   *
   * @param root - Input value for the _parse operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected static _parse(root: Tag, options: TagReadOptions = {}): {
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
    const file=new TagModelFile(root,options),copy=file.root,index=segmentControllerIndex(copy);
    const sc=index<0?copy:copy.getStruct()[index];
    const s=sc.getStruct().filter(t=>t.type!==TagType.FINISH);
    const required=[TagType.STRING,TagType.VECTOR3i,TagType.VECTOR3i,TagType.STRUCT,null,TagType.STRING,TagType.STRUCT,null,TagType.INT,TagType.STRING,TagType.STRING];
    if(required.some((type,position)=>type!==null&&s[position]?.type!==type))throw new DecodeError('E_FORMAT','Invalid mandatory controller fields');

    const uniqueId=s[0].getString(), minV=s[1].getVector3i(), maxV=s[2].getVector3i();
    const bounds:BlockBounds={minX:minV.x,minY:minV.y,minZ:minV.z,maxX:maxV.x,maxY:maxV.y,maxZ:maxV.z};
    const dockingState=DockingState.fromTag(s[3], options);
    if(![TagType.STRUCT,TagType.BYTE].includes(s[7]?.type))throw new DecodeError('E_FORMAT','Invalid controller manager slot');
    for(const [position,type] of [[11,TagType.LONG],[16,TagType.BYTE],[17,TagType.BYTE],[18,TagType.BYTE],[20,TagType.INT],
      [21,TagType.STRUCT],[25,TagType.STRING],[26,TagType.STRING],[37,TagType.LONG],[38,TagType.LONG],[40,TagType.BYTE]]) {
      if(s[position]&&s[position].type!==TagType.NOTHING&&s[position].type!==type)throw new DecodeError('E_FORMAT',`Invalid controller field ${position}`);
    }
    if(s[15]&&![TagType.BYTE,TagType.STRUCT,TagType.NOTHING].includes(s[15].type))throw new DecodeError('E_FORMAT','Invalid controller text/scrap slot');

    const controlElementMap=ControlElementMapper.fromTag(s[4],options);

    const realName=s[5].getString();
    const creatorId=s[8].getInt();
    const spawner=s[9].getString();
    const lastModifier=s[10].getString();
    const seed        = s[11]?.type === TagType.LONG    ? s[11].getLong()    : 0n;
    const nonEmptySegments = s[20]?.type === TagType.INT ? s[20].getInt()   : 0;
    const factionRights    = s[18]?.type === TagType.BYTE ? s[18].getByte() : -2;
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
      hpState = HpState.fromTag(s[21], options);
    }

    let textBlocks = TextBlocks.EMPTY;
    if (s[15]?.type === TagType.STRUCT) {
      textBlocks = TextBlocks.fromTag(s[15], options);
    }

    let managerContainer: ManagerContainer | null = null;
    if (s[7]?.type === TagType.STRUCT) {
      managerContainer = ManagerContainer.fromTag(s[7], options);
    }

    const parsed=GameEntity.parseTransformable(s[6],options);
    const {mass,transform,sectorPosition,factionId,owner,spawnController}=parsed;
    const transformableChildren=parsed.children;

    return {
      mass, transform, sectorPosition, factionId, owner, spawnController, transformableChildren,
      uniqueId, realName, bounds, dockingState, controlElementMap, managerContainer,
      creatorId, spawner, lastModifier, seed, nonEmptySegments, hpState, textBlocks,
      scrap, vulnerable, minable, factionRights, currentOwner, lastDockerPlayer,
      lastEditBlocks, lastDamageTaken, tagVersion, rootChildren: s,
    };
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `${this.entityType}(id="${this.uniqueId}", name="${this.realName}", sector=${this.sectorPosition}, hp=${this.hpState.hpPercent}%)`;
  }
}

/**
 * Handles the vectorFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the vectorFromFieldValue operation.
 * @param key - Input value for the vectorFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the minBoundsFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the minBoundsFromFieldValue operation.
 * @param key - Input value for the minBoundsFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function minBoundsFromFieldValue(value: unknown, key: string): Pick<BlockBounds, 'minX' | 'minY' | 'minZ'> {
  const v = vectorFromFieldValue(value, key);
  return { minX: v.x, minY: v.y, minZ: v.z };
}

/**
 * Handles the maxBoundsFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the maxBoundsFromFieldValue operation.
 * @param key - Input value for the maxBoundsFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function maxBoundsFromFieldValue(value: unknown, key: string): Pick<BlockBounds, 'maxX' | 'maxY' | 'maxZ'> {
  const v = vectorFromFieldValue(value, key);
  return { maxX: v.x, maxY: v.y, maxZ: v.z };
}

/**
 * Handles the requireInstance operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the requireInstance operation.
 * @param ctor - Input value for the requireInstance operation.
 * @param key - Input value for the requireInstance operation.
 * @returns The computed StarMade-Decoder value.
 */
function requireInstance<T>(value: unknown, ctor: new (...args: any[]) => T, key: string): T {
  if (value instanceof ctor) return value;
  throw new TypeError(`Entity field "${key}" expects a ${ctor.name} object`);
}
