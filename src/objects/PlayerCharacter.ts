/**
 * @fileoverview Player Character
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerCharacter — business object for ENTITY_PLAYERCHARACTER_*.ent
 *
 * Complete deserialization — no raw tag is kept.
 * Unknown fields (spawnController) are preserved as typed Tags
 * by index in _children to allow faithful round-tripping.
 *
 * Structure Tag :
 *   STRUCT "PlayerCharacter" [
 *     INT   "id"
 *     FLOAT "speed"
 *     FLOAT "stepHeight"
 *     STRUCT "transformable" [
 *       [0] FLOAT    mass
 *       [1] LIST     transform (16×FLOAT, matrice 4×4)
 *       [2] BYTE     "noAI"
 *       [3] VECTOR3i "sPos"    — sector
 *       [4] INT      "fid"     — factionId
 *       [5] STRING   "own"     — owner
 *       [6] STRUCT   spawnController
 *       FINISH
 *     ]
 *     FINISH
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import type { Vector3i } from '../types/Vectors.js';

// ── Transformable Subobject ───────────────────────────────────────────────────

/**
 * Represents the PlayerTransformable model used by high-level StarMade object modelling.
 */
export class PlayerTransformable {
  /**
   * Creates a PlayerTransformable instance.
   *
   * @param mass - Input value for the constructor operation.
   * @param transformValues - Input value for the constructor operation.
   * @param noAI - Input value for the constructor operation.
   * @param sectorPosition - Input value for the constructor operation.
   * @param factionId - Input value for the constructor operation.
   * @param owner - Input value for the constructor operation.
   * @param _extra - Input value for the constructor operation.
   */
  constructor(
    public mass: number,
    /** 4×4 transform matrix (16 floats, LIST in the tag) */
    public transformValues: number[],
    public noAI: boolean,
    public sectorPosition: Vector3i | null,
    public factionId: number,
    public owner: string,
    /** Unknown fields preserved by index (spawnController, etc.) */
    private _extra: Tag[],
  ) {
    Object.defineProperty(this, '_extra', { enumerable: false });
  }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): PlayerTransformable {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);

    const mass   = s[0]?.type === TagType.FLOAT    ? s[0].getFloat()   : 0.1;

    // [1] LIST de floats = matrice 4×4
    const transformValues: number[] = [];
    if (s[1]?.type === TagType.LIST) {
      for (const item of s[1].getList()) {
        if (item.type === TagType.FLOAT) transformValues.push(item.getFloat());
      }
    }

    const noAI         = s[2]?.type === TagType.BYTE    ? s[2].getByte() !== 0      : false;
    const sectorPos    = s[3]?.type === TagType.VECTOR3i ? s[3].getVector3i()        : null;
    const factionId    = s[4]?.type === TagType.INT      ? s[4].getInt()             : 0;
    const owner        = s[5]?.type === TagType.STRING   ? s[5].getString()          : '';
    const extra        = s.slice(6); // spawnController + autres

    return new PlayerTransformable(mass, transformValues, noAI, sectorPos, factionId, owner, extra);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    // Float LIST reconstruction
    const floatItems = this.transformValues.map(f => Tags.float(null, f));
    const transformTag = Tags.list('transform', floatItems);

    return Tags.struct('transformable', [
      Tags.float(null, this.mass),
      transformTag,
      Tags.byte('noAI', this.noAI ? 1 : 0),
      this.sectorPosition
        ? Tags.vector3i('sPos', this.sectorPosition.x, this.sectorPosition.y, this.sectorPosition.z)
        : Tags.vector3i('sPos', 0, 0, 0),
      Tags.int('fid', this.factionId),
      Tags.string('own', this.owner),
      ...this._extra,
    ]);
  }
}

// ── PlayerCharacter ───────────────────────────────────────────────────────────

/**
 * Represents the PlayerCharacter model used by high-level StarMade object modelling.
 */
export class PlayerCharacter {
  /**
   * Creates a PlayerCharacter instance.
   *
   * @param id - Input value for the constructor operation.
   * @param speed - Input value for the constructor operation.
   * @param stepHeight - Input value for the constructor operation.
   * @param transformable - Input value for the constructor operation.
   */
  constructor(
    public id: number,
    public speed: number,
    public stepHeight: number,
    public transformable: PlayerTransformable,
  ) {}

  // ── Accessors pratiques ───────────────────────────────────────────────────────

  /**
   * Handles the sectorPosition operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get sectorPosition(): Vector3i | null { return this.transformable.sectorPosition; }
  /**
   * Handles the factionId operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get factionId(): number               { return this.transformable.factionId; }
  /**
   * Handles the owner operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get owner(): string                   { return this.transformable.owner; }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Returns a copy updated with Id.
   *
   * @param id - Input value for the withId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withId(id: number): PlayerCharacter {
    return new PlayerCharacter(id, this.speed, this.stepHeight, this.transformable);
  }

  /**
   * Returns a copy updated with Speed.
   *
   * @param speed - Input value for the withSpeed operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSpeed(speed: number): PlayerCharacter {
    return new PlayerCharacter(this.id, speed, this.stepHeight, this.transformable);
  }

  /**
   * Returns a copy updated with StepHeight.
   *
   * @param h - Input value for the withStepHeight operation.
   * @returns The computed StarMade-Decoder value.
   */
  withStepHeight(h: number): PlayerCharacter {
    return new PlayerCharacter(this.id, this.speed, h, this.transformable);
  }

  /**
   * Returns a copy updated with FactionId.
   *
   * @param fid - Input value for the withFactionId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withFactionId(fid: number): PlayerCharacter {
    const tr = this.transformable;
    return new PlayerCharacter(this.id, this.speed, this.stepHeight,
      new PlayerTransformable(tr.mass, tr.transformValues, tr.noAI,
        tr.sectorPosition, fid, tr.owner, (tr as any)._extra));
  }

  /**
   * Returns a copy updated with Owner.
   *
   * @param owner - Input value for the withOwner operation.
   * @returns The computed StarMade-Decoder value.
   */
  withOwner(owner: string): PlayerCharacter {
    const tr = this.transformable;
    return new PlayerCharacter(this.id, this.speed, this.stepHeight,
      new PlayerTransformable(tr.mass, tr.transformValues, tr.noAI,
        tr.sectorPosition, tr.factionId, owner, (tr as any)._extra));
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct('PlayerCharacter', [
      Tags.int('id', this.id),
      Tags.float('speed', this.speed),
      Tags.float('stepHeight', this.stepHeight),
      this.transformable.toTag(),
    ]);
  }

  /**
   * Converts this value to Buffer.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): PlayerCharacter {
    const s = root.type === TagType.STRUCT
      ? root.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const id         = s.find(t => t.name === 'id')?.getInt()          ?? 0;
    const speed      = s.find(t => t.name === 'speed')?.getFloat()      ?? 4;
    const stepHeight = s.find(t => t.name === 'stepHeight')?.getFloat() ?? 0;
    const trTag      = s.find(t => t.name === 'transformable' && t.type === TagType.STRUCT);
    const transformable = trTag
      ? PlayerTransformable.fromTag(trTag)
      : new PlayerTransformable(0, [], false, null, 0, '', []);

    return new PlayerCharacter(id, speed, stepHeight, transformable);
  }

  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array): PlayerCharacter {
    return PlayerCharacter.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `PlayerCharacter(id=${this.id}, speed=${this.speed}, sector=${JSON.stringify(this.sectorPosition)}, faction=${this.factionId}, owner="${this.owner}")`;
  }
}
