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

export class PlayerCharacterEntity extends GameEntity {
  readonly entityType = 'PLAYER_CHARACTER';

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
  }

  readonly entityType_ = 'PLAYER_CHARACTER';

  // ── Updates ──────────────────────────────────────────────────────────

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
        factionId: overrides.factionId ?? this.factionId,
        owner:     overrides.owner ?? this.owner,
        sector:    overrides.sectorPosition ?? this.sectorPosition,
      }),
    ) as unknown as this;
  }

  withId(id: number): PlayerCharacterEntity {
    return new PlayerCharacterEntity(
      this.mass, this.transform, this.sectorPosition, this.factionId, this.owner,
      this.spawnController, this._transformableChildren,
      id, this.speed, this.stepHeight, this.noAI, this._rebuildRootTag({ id }),
    );
  }

  withSpeed(speed: number): PlayerCharacterEntity {
    return new PlayerCharacterEntity(
      this.mass, this.transform, this.sectorPosition, this.factionId, this.owner,
      this.spawnController, this._transformableChildren,
      this.id, speed, this.stepHeight, this.noAI, this._rebuildRootTag({ speed }),
    );
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toTag(): Tag { return this._rootTag; }
  toBuffer(): Buffer { return writeTo(this._rootTag); }

  private _rebuildRootTag(overrides: Partial<{
    id: number; speed: number; factionId: number; owner: string; sector: SectorPosition;
  }>): Tag {
    const s = this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH);
    const children = [...s];

    // [0] id
    if (children[0]?.name === 'id') children[0] = Tags.int('id', overrides.id ?? this.id);
    // [1] speed
    if (children[1]?.name === 'speed') children[1] = Tags.float('speed', overrides.speed ?? this.speed);
    // [3] transformable
    if (children[3]?.type === TagType.STRUCT) {
      children[3] = this._buildTransformableTag();
    }
    return new Tag(TagType.STRUCT, this._rootTag.name, [...children, FINISH_TAG]);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

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

  static fromBuffer(data: Buffer | Uint8Array): PlayerCharacterEntity {
    return PlayerCharacterEntity.fromTag(readFrom(data));
  }

  toString(): string {
    return `PlayerCharacter(id=${this.id}, speed=${this.speed}, sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`;
  }
}
