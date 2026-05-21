/**
 * @fileoverview Spawn Data
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SpawnData — player spawn data (death, logout, special sector).
 *
 * Port of PlayerStateSpawnData.java + SpawnMarker.java + SpawnController.java
 *
 * Structure Tag (PlayerStateSpawnData.toTagStructure) :
 *   STRUCT [
 *     [0] BYTE    version
 *     [1] STRUCT  deathSpawn   (SpawnPoint)
 *     [2] STRUCT  logoutSpawn  (SpawnPoint)
 *     [3] VECTOR3f preSpecialSectorTransformOrigin  (si version >= 1)
 *     [4] VECTOR3i preSpecialSector                 (si version >= 1)
 *     FINISH
 *   ]
 *
 * Structure SpawnPoint (inner class PlayerStateSpawnData) :
 *   STRUCT [
 *     [0] STRING  UID (spawn entity)
 *     [1] VECTOR3i absoluteSector
 *     [2] VECTOR3f localPos
 *     [3] VECTOR3f gravityAcceleration
 *     [4] VECTOR3f absolutePosBackup (optionnel)
 *     FINISH
 *   ]
 *
 * Structure SpawnMarker (SpawnMarker.java) :
 *   STRUCT [
 *     [0] STRUCT  spawner (SpawnController)
 *     [1] LONG    lastSpawned
 *     [2] VECTOR3i pos
 *     FINISH
 *   ]
 *
 * Structure SpawnController (SpawnController.java) :
 *   STRUCT [
 *     [0] STRUCT markers (SpawnMarker list)
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import type { Vector3i, Vector3f } from '../../types/Vectors.js';
import { SectorPosition } from './Transform.js';

// ── SpawnPoint ────────────────────────────────────────────────────────────────

/**
 * Represents the SpawnPoint model used by high-level entity component modelling.
 */
export class SpawnPoint {
  /**
   * Creates a SpawnPoint instance.
   *
   * @param entityUID - Input value for the constructor operation.
   * @param sector - Input value for the constructor operation.
   * @param localX - Input value for the constructor operation.
   * @param localY - Input value for the constructor operation.
   * @param localZ - Input value for the constructor operation.
   * @param gravX - Input value for the constructor operation.
   * @param gravY - Input value for the constructor operation.
   * @param gravZ - Input value for the constructor operation.
   */
  constructor(
    /** UID de l'spawn entity (empty for free spawn) */
    readonly entityUID: string,
    /** Absolute spawn sector */
    readonly sector: SectorPosition,
    /** Local sector position */
    readonly localX: number,
    readonly localY: number,
    readonly localZ: number,
    /** Gravity acceleration at the spawn point */
    readonly gravX: number,
    readonly gravY: number,
    readonly gravZ: number,
  ) {}

  static ZERO = new SpawnPoint('', SectorPosition.ZERO, 0, 0, 0, 0, 0, 0);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SpawnPoint {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const uid    = s[0]?.type === TagType.STRING   ? s[0].getString()  : '';
    const secV   = s[1]?.type === TagType.VECTOR3i ? s[1].getVector3i() : null;
    const sector = secV ? new SectorPosition(secV.x, secV.y, secV.z) : SectorPosition.ZERO;
    const loc    = s[2]?.type === TagType.VECTOR3f ? s[2].getVector3f() : null;
    const grav   = s[3]?.type === TagType.VECTOR3f ? s[3].getVector3f() : null;
    return new SpawnPoint(
      uid, sector,
      loc?.x ?? 0, loc?.y ?? 0, loc?.z ?? 0,
      grav?.x ?? 0, grav?.y ?? 0, grav?.z ?? 0,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.string(null, this.entityUID),
      Tags.vector3i(null, this.sector.x, this.sector.y, this.sector.z),
      Tags.vector3f(null, this.localX, this.localY, this.localZ),
      Tags.vector3f(null, this.gravX,  this.gravY,  this.gravZ),
    ]);
  }

  /**
   * Returns a copy updated with the requested value.
   *
   * @param overrides - Input value for the with operation.
   * @returns The computed StarMade-Decoder value.
   */
  with(overrides: Partial<{
    entityUID: string; sector: SectorPosition;
    localX: number; localY: number; localZ: number;
    gravX: number; gravY: number; gravZ: number;
  }>): SpawnPoint {
    return new SpawnPoint(
      overrides.entityUID ?? this.entityUID,
      overrides.sector    ?? this.sector,
      overrides.localX    ?? this.localX,
      overrides.localY    ?? this.localY,
      overrides.localZ    ?? this.localZ,
      overrides.gravX     ?? this.gravX,
      overrides.gravY     ?? this.gravY,
      overrides.gravZ     ?? this.gravZ,
    );
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `SpawnPoint(uid="${this.entityUID}", sector=${this.sector}, local=(${this.localX.toFixed(1)},${this.localY.toFixed(1)},${this.localZ.toFixed(1)}))`;
  }
}

// ── PlayerSpawnData ────────────────────────────────────────────────────────────

/**
 * Represents the PlayerSpawnData model used by high-level entity component modelling.
 */
export class PlayerSpawnData {
  /**
   * Creates a PlayerSpawnData instance.
   *
   * @param version - Input value for the constructor operation.
   * @param deathSpawn - Input value for the constructor operation.
   * @param logoutSpawn - Input value for the constructor operation.
   * @param preSpecialSector - Input value for the constructor operation.
   * @param preSpecialOriginX - Input value for the constructor operation.
   * @param preSpecialOriginY - Input value for the constructor operation.
   * @param preSpecialOriginZ - Input value for the constructor operation.
   */
  constructor(
    readonly version: number,
    readonly deathSpawn: SpawnPoint,
    readonly logoutSpawn: SpawnPoint,
    /** Pre-special sector (before teleport) */
    readonly preSpecialSector: SectorPosition | null,
    readonly preSpecialOriginX: number,
    readonly preSpecialOriginY: number,
    readonly preSpecialOriginZ: number,
  ) {}

  static EMPTY = new PlayerSpawnData(0, SpawnPoint.ZERO, SpawnPoint.ZERO, null, 0, 0, 0);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): PlayerSpawnData {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const version     = s[0]?.type === TagType.BYTE   ? s[0].getByte() : 0;
    const deathSpawn  = s[1]?.type === TagType.STRUCT  ? SpawnPoint.fromTag(s[1]) : SpawnPoint.ZERO;
    const logoutSpawn = s[2]?.type === TagType.STRUCT  ? SpawnPoint.fromTag(s[2]) : SpawnPoint.ZERO;

    let preSpecialSector: SectorPosition | null = null;
    let ox = 0, oy = 0, oz = 0;

    if (version >= 1) {
      const origin = s[3]?.type === TagType.VECTOR3f ? s[3].getVector3f() : null;
      if (origin) { ox = origin.x; oy = origin.y; oz = origin.z; }
      const sec = s[4]?.type === TagType.VECTOR3i ? s[4].getVector3i() : null;
      if (sec) preSpecialSector = new SectorPosition(sec.x, sec.y, sec.z);
    }

    return new PlayerSpawnData(version, deathSpawn, logoutSpawn, preSpecialSector, ox, oy, oz);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const children: Tag[] = [
      Tags.byte(null, this.version),
      this.deathSpawn.toTag(),
      this.logoutSpawn.toTag(),
    ];
    if (this.version >= 1) {
      children.push(Tags.vector3f(null, this.preSpecialOriginX, this.preSpecialOriginY, this.preSpecialOriginZ));
      if (this.preSpecialSector) {
        children.push(Tags.vector3i(null, this.preSpecialSector.x, this.preSpecialSector.y, this.preSpecialSector.z));
      }
    }
    return Tags.struct(null, children);
  }

  /**
   * Returns a copy updated with DeathSpawn.
   *
   * @param spawn - Input value for the withDeathSpawn operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDeathSpawn(spawn: SpawnPoint): PlayerSpawnData {
    return new PlayerSpawnData(this.version, spawn, this.logoutSpawn,
      this.preSpecialSector, this.preSpecialOriginX, this.preSpecialOriginY, this.preSpecialOriginZ);
  }

  /**
   * Returns a copy updated with LogoutSpawn.
   *
   * @param spawn - Input value for the withLogoutSpawn operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLogoutSpawn(spawn: SpawnPoint): PlayerSpawnData {
    return new PlayerSpawnData(this.version, this.deathSpawn, spawn,
      this.preSpecialSector, this.preSpecialOriginX, this.preSpecialOriginY, this.preSpecialOriginZ);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `PlayerSpawnData(v${this.version}, death=${this.deathSpawn}, logout=${this.logoutSpawn})`;
  }
}

// ── SpawnMarker (for entity SpawnController values) ────────────────────────────

/**
 * Represents the SpawnMarker model used by high-level entity component modelling.
 */
export class SpawnMarker {
  /**
   * Creates a SpawnMarker instance.
   *
   * @param lastSpawned - Input value for the constructor operation.
   * @param sectorX - Input value for the constructor operation.
   * @param sectorY - Input value for the constructor operation.
   * @param sectorZ - Input value for the constructor operation.
   */
  constructor(
    readonly lastSpawned: bigint,
    readonly sectorX: number,
    readonly sectorY: number,
    readonly sectorZ: number,
  ) {}

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SpawnMarker {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    // [0] = spawner struct, [1] = long lastSpawned, [2] = Vector3i pos
    const lastSpawned = s[1]?.type === TagType.LONG ? s[1].getLong() : 0n;
    const pos = s[2]?.type === TagType.VECTOR3i ? s[2].getVector3i() : null;
    return new SpawnMarker(lastSpawned, pos?.x ?? 0, pos?.y ?? 0, pos?.z ?? 0);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    // spawner = empty struct
    return Tags.struct(null, [
      Tags.struct(null, []),                // spawner stub
      Tags.long(null, this.lastSpawned),
      Tags.vector3i(null, this.sectorX, this.sectorY, this.sectorZ),
    ]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `SpawnMarker(last=${this.lastSpawned}, pos=(${this.sectorX},${this.sectorY},${this.sectorZ}))`;
  }
}

// ── SpawnController ───────────────────────────────────────────────────────────

/**
 * Represents the SpawnController model used by high-level entity component modelling.
 */
export class SpawnController {
  /**
   * Creates a SpawnController instance.
   *
   * @param markers - Input value for the constructor operation.
   */
  constructor(readonly markers: SpawnMarker[]) {}

  static EMPTY = new SpawnController([]);

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SpawnController {
    const outer = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    // outer[0] = STRUCT markers list
    if (!outer[0] || outer[0].type !== TagType.STRUCT) return SpawnController.EMPTY;
    const markerTags = outer[0].getStruct().filter(t => t.type !== TagType.FINISH);
    const markers = markerTags
      .filter(t => t.type === TagType.STRUCT)
      .map(t => { try { return SpawnMarker.fromTag(t); } catch { return null; } })
      .filter((m): m is SpawnMarker => m !== null);
    return new SpawnController(markers);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const markerTags = [...this.markers.map(m => m.toTag()), FINISH_TAG];
    return Tags.struct(null, [
      new Tag(TagType.STRUCT, null, markerTags),
    ]);
  }

  /**
   * Handles the addMarker operation used by high-level entity component modelling.
   *
   * @param marker - Input value for the addMarker operation.
   * @returns The computed StarMade-Decoder value.
   */
  addMarker(marker: SpawnMarker): SpawnController {
    return new SpawnController([...this.markers, marker]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `SpawnController(${this.markers.length} markers)`;
  }
}
