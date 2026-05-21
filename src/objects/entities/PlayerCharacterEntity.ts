/**
 * @fileoverview Player Character Entity
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerCharacterEntity — player character entity (ENTITY_PLAYERCHARACTER_*.ent)
 *
 * Port of PlayerCharacter.fromTagStructure() Java.
 *
 * Structure Tag "PlayerCharacter" :
 *   STRUCT "PlayerCharacter" [
 *     INT   "id"
 *     FLOAT "speed"
 *     FLOAT "stepHeight"
 *     STRUCT "transformable" → GameEntity
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { readFrom, writeTo } from '../../core/TagParser.js';
import { GameEntity } from './GameEntity.js';
import { StarMadeEntity } from './StarMadeEntity.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import {
  buildEditableEntityFields,
  fieldValueAsInteger,
  fieldValueAsNumber,
  PLAYER_CHARACTER_FIELD_SCHEMA,
  type EntityField,
} from '../EntityFieldView.js';

/**
 * Represents the PlayerCharacterEntity model used by high-level StarMade entity modelling.
 */
export class PlayerCharacterEntity extends GameEntity {
  readonly entityType = 'PLAYER_CHARACTER';

  /**
   * Creates a PlayerCharacterEntity instance.
   *
   * @param mass - Input value for the constructor operation.
   * @param transform - Input value for the constructor operation.
   * @param sectorPosition - Input value for the constructor operation.
   * @param factionId - Input value for the constructor operation.
   * @param owner - Input value for the constructor operation.
   * @param spawnController - Input value for the constructor operation.
   * @param transformableChildren - Input value for the constructor operation.
   * @param id - Input value for the constructor operation.
   * @param speed - Input value for the constructor operation.
   * @param stepHeight - Input value for the constructor operation.
   * @param noAI - Input value for the constructor operation.
   * @param _rootTag - Input value for the constructor operation.
   */
  constructor(
    // GameEntity
    mass: number, transform: EntityTransform,
    sectorPosition: SectorPosition, factionId: number, owner: string,
    spawnController: SpawnController, transformableChildren: Tag[],
    // PlayerCharacter specifics
    readonly id: number,
    readonly speed: number,
    readonly stepHeight: number,
    readonly noAI: boolean,
    /** Original root Tag for round-tripping */
    private readonly _rootTag: Tag,
  ) {
    super(mass, transform, sectorPosition, factionId, owner, spawnController, transformableChildren);
    Object.defineProperty(this, '_rootTag', { enumerable: false });
  }

  readonly entityType_ = 'PLAYER_CHARACTER';

  /** StarMade-Open PlayerCharacter slot view, without raw Tag exposure. */
  get fields(): readonly EntityField<PlayerCharacterEntity>[] {
    const children = this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH);
    return buildEditableEntityFields(children, PLAYER_CHARACTER_FIELD_SCHEMA, {
      id: value => this.withId(fieldValueAsInteger(value, 'id')),
      speed: value => this.withSpeed(fieldValueAsNumber(value, 'speed')),
      stepHeight: value => this.withStepHeight(fieldValueAsNumber(value, 'stepHeight')),
    });
  }

  /**
   * Returns Field.
   *
   * @param key - Input value for the getField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getField(key: string): EntityField<PlayerCharacterEntity> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  // ── Updates ──────────────────────────────────────────────────────────

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _clone(overrides: Partial<{
    mass: number; transform: EntityTransform; sectorPosition: SectorPosition;
    factionId: number; owner: string; spawnController: SpawnController;
  }>): this {
    return new PlayerCharacterEntity(
      overrides.mass ?? this.mass,
      overrides.transform ?? this.transform,
      overrides.sectorPosition ?? this.sectorPosition,
      overrides.factionId ?? this.factionId,
      overrides.owner ?? this.owner,
      overrides.spawnController ?? this.spawnController,
      this._transformableChildren,
      this.id, this.speed, this.stepHeight, this.noAI,
      this._rebuildRootTag({
        mass: overrides.mass ?? this.mass,
        transform: overrides.transform ?? this.transform,
        factionId: overrides.factionId ?? this.factionId,
        owner:     overrides.owner ?? this.owner,
        sector:    overrides.sectorPosition ?? this.sectorPosition,
        spawnController: overrides.spawnController ?? this.spawnController,
      }),
    ) as unknown as this;
  }

  /**
   * Returns a copy updated with Id.
   *
   * @param id - Input value for the withId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withId(id: number): PlayerCharacterEntity {
    return new PlayerCharacterEntity(
      this.mass, this.transform, this.sectorPosition, this.factionId, this.owner,
      this.spawnController, this._transformableChildren,
      id, this.speed, this.stepHeight, this.noAI, this._rebuildRootTag({ id }),
    );
  }

  /**
   * Returns a copy updated with Speed.
   *
   * @param speed - Input value for the withSpeed operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSpeed(speed: number): PlayerCharacterEntity {
    return new PlayerCharacterEntity(
      this.mass, this.transform, this.sectorPosition, this.factionId, this.owner,
      this.spawnController, this._transformableChildren,
      this.id, speed, this.stepHeight, this.noAI, this._rebuildRootTag({ speed }),
    );
  }

  /**
   * Returns a copy updated with StepHeight.
   *
   * @param stepHeight - Input value for the withStepHeight operation.
   * @returns The computed StarMade-Decoder value.
   */
  withStepHeight(stepHeight: number): PlayerCharacterEntity {
    return new PlayerCharacterEntity(
      this.mass, this.transform, this.sectorPosition, this.factionId, this.owner,
      this.spawnController, this._transformableChildren,
      this.id, this.speed, stepHeight, this.noAI, this._rebuildRootTag({ stepHeight }),
    );
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag { return this._rootTag; }
  /**
   * Converts this value to Buffer.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toBuffer(): Buffer { return writeTo(this._rootTag); }

  /**
   * Handles the rebuildRootTag operation used by high-level StarMade entity modelling.
   *
   * @param overrides - Input value for the _rebuildRootTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _rebuildRootTag(overrides: Partial<{
    id: number; speed: number; stepHeight: number; mass: number; transform: EntityTransform;
    factionId: number; owner: string; sector: SectorPosition; spawnController: SpawnController;
  }>): Tag {
    const s = this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH);
    const children = [...s];

    // [0] id
    if (children[0]?.name === 'id') children[0] = Tags.int('id', overrides.id ?? this.id);
    // [1] speed
    if (children[1]?.name === 'speed') children[1] = Tags.float('speed', overrides.speed ?? this.speed);
    // [2] stepHeight
    if (children[2]?.name === 'stepHeight') children[2] = Tags.float('stepHeight', overrides.stepHeight ?? this.stepHeight);
    // [3] transformable
    if (children[3]?.type === TagType.STRUCT) {
      children[3] = this._buildTransformableTag({
        mass: overrides.mass ?? this.mass,
        transform: overrides.transform ?? this.transform,
        sectorPosition: overrides.sector ?? this.sectorPosition,
        factionId: overrides.factionId ?? this.factionId,
        owner: overrides.owner ?? this.owner,
        spawnController: overrides.spawnController ?? this.spawnController,
      });
    }
    return new Tag(TagType.STRUCT, this._rootTag.name, [...children, FINISH_TAG]);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): PlayerCharacterEntity {
    const s = root.type === TagType.STRUCT
      ? root.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const id         = s.find(t => t.name === 'id')?.getInt()          ?? 0;
    const speed      = s.find(t => t.name === 'speed')?.getFloat()      ?? 4;
    const stepHeight = s.find(t => t.name === 'stepHeight')?.getFloat() ?? 0;

    let mass = 0.1, transform = EntityTransform.IDENTITY;
    let sectorPosition = SectorPosition.ZERO, factionId = 0, owner = '';
    let spawnController = SpawnController.EMPTY;
    let transformableChildren: Tag[] = [];
    let noAI = false;

    const trTag = s.find(t => t.name === 'transformable' && t.type === TagType.STRUCT);
    if (trTag) {
      const parsed = GameEntity.parseTransformable(trTag);
      mass = parsed.mass; transform = parsed.transform;
      sectorPosition = parsed.sectorPosition; factionId = parsed.factionId;
      owner = parsed.owner; spawnController = parsed.spawnController;
      transformableChildren = parsed.children;
      noAI = parsed.children.find(t => t.name === 'noAI')?.getByte() !== 0;
    }

    return new PlayerCharacterEntity(
      mass, transform, sectorPosition, factionId, owner, spawnController, transformableChildren,
      id, speed, stepHeight, noAI, root,
    );
  }

  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array): PlayerCharacterEntity {
    return PlayerCharacterEntity.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `PlayerCharacter(id=${this.id}, speed=${this.speed}, sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`;
  }
}
