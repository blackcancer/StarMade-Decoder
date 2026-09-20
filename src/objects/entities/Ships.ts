/**
 * @fileoverview Ships
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Ship, SpaceStation, ShopSpaceStation, FloatingRock — SegmentController entities.
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { SegmentController, segmentControllerIndex, type BlockBounds } from './SegmentController.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import { ManagerContainer } from '../components/ManagerContainer.js';

// ── Helper: build from parsed data ─────────────────────────────

/**
 * Builds a value for high-level StarMade entity modelling.
 *
 * @param ctor - Input value for the make operation.
 * @param root - Input value for the make operation.
 * @returns The computed StarMade-Decoder value.
 */
function make<T extends SegmentController>(
  ctor: Function & {readonly prototype:T}, root: Tag, options: TagReadOptions = {}, source?: TagModelFile,
): T {
  const file=source??new TagModelFile(root,options);
  const p = (SegmentController as any)._parse(file.root,file.options);
  const result = Reflect.construct(ctor, [
    p.mass, p.transform, p.sectorPosition, p.factionId, p.owner,
    p.spawnController, p.transformableChildren,
    p.uniqueId, p.realName, p.bounds, p.dockingState, p.controlElementMap,
    p.managerContainer, p.creatorId, p.spawner, p.lastModifier, p.seed,
    p.nonEmptySegments, p.hpState, p.textBlocks, p.scrap, p.vulnerable,
    p.minable, p.factionRights, p.currentOwner, p.lastDockerPlayer,
    p.lastEditBlocks, p.lastDamageTaken, p.tagVersion, p.rootChildren, file.options, file,
  ]) as T;
  return Object.freeze(result);
}

/**
 * Clones while applying overrides directly on properties.
 * GameEntity overrides (factionId, owner, sector, mass) are updated
 * in transformableChildren and rootChildren before rebuilding.
 */
function cloneWith<T extends SegmentController>(
  entity: T,
  ctor: Function & {readonly prototype:T},
  overrides: Partial<{
    mass: number; transform: EntityTransform;
    sectorPosition: SectorPosition; factionId: number;
    owner: string; spawnController: SpawnController;
    // SegmentController-specific overrides
    realName: string;
    vulnerable: boolean;
    minable: boolean;
    scrap: boolean;
    factionRights: number;
    seed: bigint;
    spawner: string;
    lastModifier: string;
    creatorId: number;
    uniqueId: string;
    bounds: BlockBounds;
    nonEmptySegments: number;
    currentOwner: string;
    lastDockerPlayer: string;
    lastEditBlocks: bigint;
    lastDamageTaken: bigint;
    tagVersion: number;
    managerContainer: ManagerContainer | null;
    rootChildren: Tag[];
  }>,
): T {
  const file:TagModelFile=(entity as any).sourceFile,root=file.root,index=segmentControllerIndex(root);
  let sc=index<0?root:root.getStruct()[index];
  if(overrides.rootChildren!==undefined)sc=Tags.struct(sc.name,overrides.rootChildren);
  const put=(slot:number,tag:Tag)=>{sc=replaceTagField(sc,slot,tag);};
  const strings: [keyof typeof overrides,number][]=[['uniqueId',0],['realName',5],['spawner',9],['lastModifier',10],['currentOwner',25],['lastDockerPlayer',26]];
  for(const [key,slot] of strings)if(overrides[key]!==undefined)put(slot,Tags.string(null,overrides[key] as string));
  const integers: [keyof typeof overrides,number][]=[['creatorId',8],['nonEmptySegments',20]];
  for(const [key,slot] of integers)if(overrides[key]!==undefined)put(slot,Tags.int(null,overrides[key] as number));
  const longs: [keyof typeof overrides,number][]=[['seed',11],['lastEditBlocks',37],['lastDamageTaken',38]];
  for(const [key,slot] of longs)if(overrides[key]!==undefined)put(slot,Tags.long(null,overrides[key] as bigint));
  for(const [key,slot] of [['scrap',15],['vulnerable',16],['minable',17]] as const)if(overrides[key]!==undefined){
    if(typeof overrides[key]!=='boolean')throw new DecodeError('E_RANGE','Controller flag must be boolean');
    const originalRoot=file.originalRoot,originalIndex=segmentControllerIndex(originalRoot);
    const original=(originalIndex<0?originalRoot:originalRoot.getStruct()[originalIndex]).getStruct()[slot];
    put(slot,original?.type===TagType.BYTE&&(original.getByte()>0)===overrides[key]?original:Tags.bool(null,overrides[key]));
  }
  for(const [key,slot] of [['factionRights',18],['tagVersion',40]] as const)if(overrides[key]!==undefined){
    const value=overrides[key];if(!Number.isInteger(value)||value < -128||value>127)throw new DecodeError('E_RANGE','Controller byte out of range');
    put(slot,Tags.byte(null,value));
  }
  if(overrides.bounds!==undefined){const value=overrides.bounds;put(1,Tags.vector3i(null,value.minX,value.minY,value.minZ));put(2,Tags.vector3i(null,value.maxX,value.maxY,value.maxZ));}
  if(Object.prototype.hasOwnProperty.call(overrides,'managerContainer')){
    // BYTE is the on-disk absent-manager representation; replacing it is an explicit edit.
    const value=overrides.managerContainer;sc=replaceTagField(sc,7,value?value.toTag():Tags.byte(null,0),[TagType.BYTE,TagType.STRUCT]);
  }
  const gameKeys=['mass','transform','sectorPosition','factionId','owner','spawnController'] as const;
  const game=Object.fromEntries(gameKeys.filter(key=>overrides[key]!==undefined).map(key=>[key,overrides[key]]));
  if(Object.keys(game).length)put(6,(entity as any)._buildTransformableTag(game));
  const edited=index<0?sc:replaceTagField(root,index,sc),next=file.withRoot(edited);
  return make(ctor,edited,next.options,next);
}

// ── Ship ──────────────────────────────────────────────────────────────────────

/**
 * Represents the Ship model used by high-level StarMade entity modelling.
 */
export class Ship extends SegmentController {
  readonly entityType = 'SHIP';

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag, options: TagReadOptions = {}): Ship        { return make(Ship, root, options); }
  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): Ship { const file=TagModelFile.fromBuffer(data,options); return make(Ship,file.root,file.options,file); }

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _clone(overrides: any): this { return cloneWith(this, Ship, overrides) as unknown as this; }
}

// ── SpaceStation ──────────────────────────────────────────────────────────────

/**
 * Represents the SpaceStation model used by high-level StarMade entity modelling.
 */
export class SpaceStation extends SegmentController {
  readonly entityType = 'SPACE_STATION';

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag, options: TagReadOptions = {}): SpaceStation        { return make(SpaceStation, root, options); }
  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): SpaceStation { const file=TagModelFile.fromBuffer(data,options); return make(SpaceStation,file.root,file.options,file); }

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _clone(overrides: any): this { return cloneWith(this, SpaceStation, overrides) as unknown as this; }
}

// ── ShopSpaceStation ──────────────────────────────────────────────────────────

/**
 * Represents the ShopSpaceStation model used by high-level StarMade entity modelling.
 */
export class ShopSpaceStation extends SegmentController {
  readonly entityType = 'SHOP';

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag, options: TagReadOptions = {}): ShopSpaceStation        { return make(ShopSpaceStation, root, options); }
  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): ShopSpaceStation { const file=TagModelFile.fromBuffer(data,options); return make(ShopSpaceStation,file.root,file.options,file); }

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _clone(overrides: any): this { return cloneWith(this, ShopSpaceStation, overrides) as unknown as this; }
}

// ── FloatingRock ──────────────────────────────────────────────────────────────

/**
 * Represents the FloatingRock model used by high-level StarMade entity modelling.
 */
export class FloatingRock extends SegmentController {
  readonly entityType = 'ASTEROID';

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag, options: TagReadOptions = {}): FloatingRock        { return make(FloatingRock, root, options); }
  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): FloatingRock { const file=TagModelFile.fromBuffer(data,options); return make(FloatingRock,file.root,file.options,file); }

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _clone(overrides: any): this { return cloneWith(this, FloatingRock, overrides) as unknown as this; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Parses SegmentControllerEntity for high-level StarMade entity modelling.
 *
 * @param root - Input value for the parseSegmentControllerEntity operation.
 * @param filename - Input value for the parseSegmentControllerEntity operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSegmentControllerEntity(
  root: Tag, filename = '', options: TagReadOptions = {},
): Ship | SpaceStation | ShopSpaceStation | FloatingRock {
  const f = filename.toUpperCase();
  if (f.includes('ENTITY_SHIP'))         return Ship.fromTag(root,options);
  if (f.includes('ENTITY_SPACESTATION')) return SpaceStation.fromTag(root,options);
  if (f.includes('ENTITY_SHOP'))         return ShopSpaceStation.fromTag(root,options);
  if (f.includes('ENTITY_ASTEROID') || f.includes('ENTITY_FLOATINGROCK'))     return FloatingRock.fromTag(root,options);
  return Ship.fromTag(root,options);
}
