/** @fileoverview Immutable spawn records retaining source names, optional slots and opaque extensions. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import type { Vector3f } from '../../types/Vectors.js';
import { SectorPosition } from './Transform.js';

/** Positional fields excluding the structural terminator. */
function parts(tag: Tag): Tag[] { return tag.getStruct().filter(value => value.type !== TagType.FINISH); }
/** Enforces required types without replacing corrupt saved data with defaults. */
function requireTypes(values: Tag[], types: readonly TagType[]): void {
  types.forEach((type,index) => { if (values[index]?.type !== type) throw new DecodeError('E_FORMAT', `Invalid spawn field ${index}`); });
}
/** Finite float32 values used for persisted positions and acceleration. */
function float(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE', 'Spawn coordinate requires finite float32');
  return Math.fround(value);
}
/** Requires the signed long representation before TagBuilder can coerce a JavaScript number. */
function timestamp(value: bigint): bigint {
  if (typeof value !== 'bigint') throw new DecodeError('E_FORMAT', 'Spawn timestamp requires bigint');
  return value;
}
/** Validates three serialized float coordinates, without geometric calculations. */
function vector(value: Vector3f): Vector3f { return {x:float(value.x), y:float(value.y), z:float(value.z)}; }
/** Validates a nullable persisted vector; BYTE zero is the actual absent-value marker. */
function nullable(tag: Tag | undefined, type: TagType): void {
  if (tag && tag.type !== type && !(tag.type === TagType.BYTE && tag.getByte() === 0)) throw new DecodeError('E_FORMAT', 'Invalid nullable spawn coordinate');
}
/** Replaces or extends an optional suffix without discarding its name or later unknown fields. */
function optional(root: Tag, index: number, value: Tag): Tag {
  const children = parts(root);
  while (children.length <= index) children.push(Tags.byte(null,0));
  children[index] = Tags.rename(value, children[index].name); return Tags.struct(root.name,children);
}
/** Editable coordinates and identity of one spawn point. */
export interface SpawnPointChanges {
  entityUID: string; sector: SectorPosition; localX: number; localY: number; localZ: number;
  gravX: number; gravY: number; gravZ: number; absolutePosBackup: Vector3f;
}

/** A spawn point, including its optional backup position and all unknown source fields. */
export class SpawnPoint {
  #file: TagModelFile;
  readonly entityUID: string; readonly sector: SectorPosition;
  readonly localX: number; readonly localY: number; readonly localZ: number;
  readonly gravX: number; readonly gravY: number; readonly gravZ: number;
  /** Creates a four-field legacy-compatible point; source parsing retains any optional backup. */
  constructor(entityUID: string, sector: SectorPosition, localX: number, localY: number, localZ: number,
    gravX: number, gravY: number, gravZ: number, options: TagReadOptions = {}, source?: TagModelFile) {
    this.#file = source ?? new TagModelFile(Tags.struct(null,[Tags.string(null,entityUID),sector.toTag(),
      Tags.vector3f(null,float(localX),float(localY),float(localZ)),Tags.vector3f(null,float(gravX),float(gravY),float(gravZ))]),options);
    const values = parts(this.#file.root); requireTypes(values,[TagType.STRING,TagType.VECTOR3i,TagType.VECTOR3f,TagType.VECTOR3f]);
    if (values[4]) { if (values[4].type !== TagType.VECTOR3f) throw new DecodeError('E_FORMAT','Invalid spawn backup'); vector(values[4].getVector3f()); }
    this.entityUID = values[0].getString(); this.sector = SectorPosition.fromTag(values[1],this.#file.options);
    const local = vector(values[2].getVector3f()), gravity = vector(values[3].getVector3f());
    this.localX = local.x; this.localY = local.y; this.localZ = local.z; this.gravX = gravity.x; this.gravY = gravity.y; this.gravZ = gravity.z;
    Object.freeze(this);
  }
  static readonly ZERO = new SpawnPoint('',SectorPosition.ZERO,0,0,0,0,0,0);
  /** Strictly parses a point and snapshots its entire bounded source tree. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): SpawnPoint { return new SpawnPoint('',SectorPosition.ZERO,0,0,0,0,0,0,options,new TagModelFile(tag,options)); }
  /** Detached optional backup position; its absence is distinct from the zero vector. */
  get absolutePosBackup(): Vector3f | null { const value = parts(this.#file.root)[4]; return value ? value.getVector3f() : null; }
  /** Returns the complete detached source, including names and extensions. */
  toTag(): Tag { return this.#file.root; }
  /** Changes only supplied point fields and retains the backup and unknown suffix. */
  with(changes: Partial<SpawnPointChanges>): SpawnPoint {
    let root = this.#file.root;
    if (changes.entityUID !== undefined) root = replaceTagField(root,0,Tags.string(null,changes.entityUID));
    if (changes.sector !== undefined) root = replaceTagField(root,1,changes.sector.toTag());
    for (const [index,keys] of [[2,['localX','localY','localZ']],[3,['gravX','gravY','gravZ']]] as const) {
      if (keys.some(key => changes[key] !== undefined)) {
        const values = keys.map(key => float(changes[key] === undefined ? this[key] : changes[key]));
        root = replaceTagField(root,index,Tags.vector3f(null,values[0],values[1],values[2]));
      }
    }
    if (changes.absolutePosBackup !== undefined) { const v = vector(changes.absolutePosBackup); root = optional(root,4,Tags.vector3f(null,v.x,v.y,v.z)); }
    return SpawnPoint.fromTag(root,this.#file.options);
  }
  /** Diagnostic representation. */
  toString(): string { return `SpawnPoint(uid="${this.entityUID}", sector=${this.sector}, local=(${this.localX.toFixed(1)},${this.localY.toFixed(1)},${this.localZ.toFixed(1)}))`; }
}

/** Supported persisted player spawn edits; null writes the actual BYTE-zero absence marker. */
export interface PlayerSpawnDataChanges { deathSpawn: SpawnPoint; logoutSpawn: SpawnPoint; preSpecialSector: SectorPosition | null; preSpecialOrigin: Vector3f | null; }
/** PlayerStateSpawnData schema: Java writes version 1 but reads the BYTE without dispatching on its value. */
export class PlayerSpawnData {
  #file: TagModelFile;
  readonly version: number; readonly deathSpawn: SpawnPoint; readonly logoutSpawn: SpawnPoint;
  readonly preSpecialSector: SectorPosition | null;
  readonly preSpecialOriginX: number; readonly preSpecialOriginY: number; readonly preSpecialOriginZ: number;
  /** Creates a complete five-slot record; reading older sparse records preserves their original layout. */
  constructor(version: number, deathSpawn: SpawnPoint, logoutSpawn: SpawnPoint, preSpecialSector: SectorPosition | null = null,
    preSpecialOriginX = 0, preSpecialOriginY = 0, preSpecialOriginZ = 0, options: TagReadOptions = {}, source?: TagModelFile) {
    if (!Number.isInteger(version) || version < -128 || version > 127) throw new DecodeError('E_RANGE','Spawn version requires signed BYTE');
    this.#file = source ?? new TagModelFile(Tags.struct(null,[Tags.byte(null,version),deathSpawn.toTag(),logoutSpawn.toTag(),
      Tags.vector3f(null,float(preSpecialOriginX),float(preSpecialOriginY),float(preSpecialOriginZ)),preSpecialSector ? preSpecialSector.toTag() : Tags.byte(null,0)]),options);
    const values = parts(this.#file.root); requireTypes(values,[TagType.BYTE,TagType.STRUCT,TagType.STRUCT]);
    nullable(values[3],TagType.VECTOR3f); nullable(values[4],TagType.VECTOR3i);
    this.version = values[0].getByte(); this.deathSpawn = SpawnPoint.fromTag(values[1],this.#file.options); this.logoutSpawn = SpawnPoint.fromTag(values[2],this.#file.options);
    this.preSpecialSector = values[4]?.type === TagType.VECTOR3i ? SectorPosition.fromTag(values[4],this.#file.options) : null;
    const origin = values[3]?.type === TagType.VECTOR3f ? vector(values[3].getVector3f()) : {x:0,y:0,z:0};
    this.preSpecialOriginX = origin.x; this.preSpecialOriginY = origin.y; this.preSpecialOriginZ = origin.z; Object.freeze(this);
  }
  static readonly EMPTY = new PlayerSpawnData(0,SpawnPoint.ZERO,SpawnPoint.ZERO);
  /** Reads the common schema while retaining the uninterpreted source version byte and extensions. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): PlayerSpawnData { return new PlayerSpawnData(0,SpawnPoint.ZERO,SpawnPoint.ZERO,null,0,0,0,options,new TagModelFile(tag,options)); }
  /** Distinguishes a missing pre-special origin from an explicitly stored zero vector. */
  get preSpecialOrigin(): Vector3f | null { const value = parts(this.#file.root)[3]; return value?.type === TagType.VECTOR3f ? value.getVector3f() : null; }
  /** Returns the complete detached source tree. */
  toTag(): Tag { return this.#file.root; }
  /** Preserves the original version, point extensions, nullable representations and unrelated slots. */
  with(changes: Partial<PlayerSpawnDataChanges>): PlayerSpawnData {
    let root = this.#file.root;
    if (changes.deathSpawn !== undefined) root = replaceTagField(root,1,changes.deathSpawn.toTag());
    if (changes.logoutSpawn !== undefined) root = replaceTagField(root,2,changes.logoutSpawn.toTag());
    if (changes.preSpecialSector !== undefined) root = optional(root,4,changes.preSpecialSector === null ? Tags.byte(null,0) : changes.preSpecialSector.toTag());
    if (changes.preSpecialOrigin !== undefined) {
      const v = changes.preSpecialOrigin === null ? null : vector(changes.preSpecialOrigin);
      root = optional(root,3,v === null ? Tags.byte(null,0) : Tags.vector3f(null,v.x,v.y,v.z));
    }
    const baseline = parts(this.#file.originalRoot), children = parts(root);
    // Remove only nullable suffix slots introduced by this revision when restoring a sparse source.
    while (children.length > baseline.length && children[children.length - 1].type === TagType.BYTE && children[children.length - 1].getByte() === 0) children.pop();
    return new PlayerSpawnData(0,SpawnPoint.ZERO,SpawnPoint.ZERO,null,0,0,0,this.#file.options,this.#file.withRoot(Tags.struct(root.name,children)));
  }
  /** Changes the death point while preserving the complete player spawn container. */
  withDeathSpawn(spawn: SpawnPoint): PlayerSpawnData { return this.with({deathSpawn:spawn}); }
  /** Changes the logout point while preserving the complete player spawn container. */
  withLogoutSpawn(spawn: SpawnPoint): PlayerSpawnData { return this.with({logoutSpawn:spawn}); }
  /** Diagnostic representation. */
  toString(): string { return `PlayerSpawnData(v${this.version}, death=${this.deathSpawn}, logout=${this.logoutSpawn})`; }
}

/** The actual empty DefaultSpawner state has two empty collections and an alive byte set to one. */
function emptySpawner(): Tag { return Tags.struct(null,[Tags.struct(null,[]),Tags.struct(null,[]),Tags.byte(null,1)]); }
/** Validates the known spawner envelope, preserving condition/component payloads as opaque bounded Tags. */
function validateSpawner(tag: Tag): void {
  const values = parts(tag); requireTypes(values,[TagType.STRUCT,TagType.STRUCT,TagType.BYTE]);
  for (const collection of values.slice(0,2)) for (const entry of parts(collection)) {
    const record = parts(entry);
    if (record[0]?.type !== TagType.INT || !record[1]) throw new DecodeError('E_FORMAT','Invalid spawner entry');
  }
}
/** Fields persisted by SpawnMarker, excluding any game-side spawn decisions. */
export interface SpawnMarkerChanges { lastSpawned: bigint; sectorX: number; sectorY: number; sectorZ: number; spawner: Tag; }
/** Marker retaining the complete DefaultSpawner payload and opaque suffix. */
export class SpawnMarker {
  #file: TagModelFile;
  readonly lastSpawned: bigint; readonly sectorX: number; readonly sectorY: number; readonly sectorZ: number;
  /** Creates a marker with the actual empty DefaultSpawner, or a caller-supplied complete payload. */
  constructor(lastSpawned: bigint, sectorX: number, sectorY: number, sectorZ: number, spawner: Tag = emptySpawner(), options: TagReadOptions = {}, source?: TagModelFile) {
    this.#file = source ?? new TagModelFile(Tags.struct(null,[spawner,Tags.long(null,timestamp(lastSpawned)),Tags.vector3i(null,sectorX,sectorY,sectorZ)]),options);
    const values = parts(this.#file.root); requireTypes(values,[TagType.STRUCT,TagType.LONG,TagType.VECTOR3i]); validateSpawner(values[0]);
    this.lastSpawned = values[1].getLong(); const position = values[2].getVector3i(); this.sectorX = position.x; this.sectorY = position.y; this.sectorZ = position.z; Object.freeze(this);
  }
  /** Parses a strict marker tuple without dropping its spawner or extensions. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): SpawnMarker { return new SpawnMarker(0n,0,0,0,emptySpawner(),options,new TagModelFile(tag,options)); }
  /** Detached spawner metadata, including all condition and component payloads. */
  get spawner(): Tag { return parts(this.#file.root)[0]; }
  /** Complete detached marker tree. */
  toTag(): Tag { return this.#file.root; }
  /** Updates only supplied fields, preserving source names and opaque metadata. */
  with(changes: Partial<SpawnMarkerChanges>): SpawnMarker {
    let root = this.#file.root;
    if (changes.spawner !== undefined) root = replaceTagField(root,0,changes.spawner);
    if (changes.lastSpawned !== undefined) root = replaceTagField(root,1,Tags.long(null,timestamp(changes.lastSpawned)));
    const keys = ['sectorX','sectorY','sectorZ'] as const;
    if (keys.some(key => changes[key] !== undefined)) {
      const values = keys.map(key => changes[key] === undefined ? this[key] : changes[key]); root = replaceTagField(root,2,Tags.vector3i(null,values[0],values[1],values[2]));
    }
    return SpawnMarker.fromTag(root,this.#file.options);
  }
  /** Diagnostic representation. */
  toString(): string { return `SpawnMarker(last=${this.lastSpawned}, pos=(${this.sectorX},${this.sectorY},${this.sectorZ}))`; }
}

/** Immutable ordered marker list retaining container and list names plus container extensions. */
export class SpawnController {
  #file: TagModelFile;
  #markers: readonly SpawnMarker[];
  /** Copies and validates each marker and the bounded complete source tree. */
  constructor(markers: readonly SpawnMarker[], options: TagReadOptions = {}, source?: TagModelFile) {
    this.#file = source ?? new TagModelFile(Tags.struct(null,[Tags.struct(null,markers.map(marker => marker.toTag()))]),options);
    const values = parts(this.#file.root); requireTypes(values,[TagType.STRUCT]);
    this.#markers = Object.freeze(parts(values[0]).map(tag => SpawnMarker.fromTag(tag,this.#file.options))); Object.freeze(this);
  }
  static readonly EMPTY = new SpawnController([]);
  /** Reads all markers strictly; a corrupt element is never silently removed. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): SpawnController { return new SpawnController([],options,new TagModelFile(tag,options)); }
  /** Detached list of immutable marker values. */
  get markers(): SpawnMarker[] { return [...this.#markers]; }
  /** Returns the complete detached source tree. */
  toTag(): Tag { return this.#file.root; }
  /** Replaces the ordered list while retaining its wrapper name and all container extensions. */
  withMarkers(markers: readonly SpawnMarker[]): SpawnController {
    return SpawnController.fromTag(replaceTagField(this.#file.root,0,Tags.struct(null,markers.map(marker => marker.toTag()))),this.#file.options);
  }
  /** Appends a validated immutable marker. */
  addMarker(marker: SpawnMarker): SpawnController { return this.withMarkers([...this.#markers,marker]); }
  /** Diagnostic representation. */
  toString(): string { return `SpawnController(${this.#markers.length} markers)`; }
}
