/** @fileoverview Immutable player-character entity with positional field edits and retained file envelopes. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { GameEntity, type GameEntityChanges } from './GameEntity.js';
import { buildEditableEntityFields, fieldValueAsInteger, fieldValueAsNumber,
  PLAYER_CHARACTER_FIELD_SCHEMA, type EntityField } from '../EntityFieldView.js';

/** Character fields are always derived from the same private root used for serialization. */
export class PlayerCharacterEntity extends GameEntity {
  readonly entityType = 'PLAYER_CHARACTER';
  readonly entityType_ = 'PLAYER_CHARACTER';
  readonly id: number;
  readonly speed: number;
  readonly stepHeight: number;
  readonly noAI: boolean;
  /** Reads actual positional fields independently of their optional names. */
  private constructor(private readonly file: TagModelFile) {
    const children = file.root.getStruct();
    if (children[0]?.type !== TagType.INT || children[1]?.type !== TagType.FLOAT || children[2]?.type !== TagType.FLOAT || children[3]?.type !== TagType.STRUCT) {
      throw new DecodeError('E_FORMAT', 'Invalid player-character fields');
    }
    const parsed = GameEntity.parseTransformable(children[3], file.options);
    super(parsed.mass, parsed.transform, parsed.sectorPosition, parsed.factionId, parsed.owner,
      parsed.spawnController, parsed.children, file.options);
    this.id = children[0].getInt(); this.speed = finite(children[1].getFloat()); this.stepHeight = finite(children[2].getFloat());
    this.noAI = parsed.children[2]?.type === TagType.BYTE ? parsed.children[2].getByte() !== 0 : false;
    Object.defineProperty(this, 'file', { enumerable: false });
    Object.freeze(this);
  }
  /** Editable scalar field views retain the complete source tree. */
  get fields(): readonly EntityField<PlayerCharacterEntity>[] {
    return buildEditableEntityFields(this.file.root.getStruct().filter(tag => tag.type !== TagType.FINISH), PLAYER_CHARACTER_FIELD_SCHEMA, {
      id: value => this.withId(fieldValueAsInteger(value, 'id')),
      speed: value => this.withSpeed(fieldValueAsNumber(value, 'speed')),
      stepHeight: value => this.withStepHeight(fieldValueAsNumber(value, 'stepHeight')),
    });
  }
  /** Finds a semantic field without exposing the retained source Tags. */
  getField(key: string): EntityField<PlayerCharacterEntity> | null { return this.fields.find(field => field.key === key) ?? null; }
  /** Patches only explicitly requested transformable fields. */
  protected _clone(overrides: Partial<GameEntityChanges>): this {
    return new PlayerCharacterEntity(this.file.withRoot(replaceTagField(this.file.root, 3,
      this._buildTransformableTag(overrides)))) as this;
  }
  /** Updates the positional ID, retaining its stored name. */
  withId(id: number): PlayerCharacterEntity { return this.updated(0, Tags.int(null, id)); }
  /** Updates finite float32 speed without rewriting any transformable fields. */
  withSpeed(speed: number): PlayerCharacterEntity { return this.updated(1, Tags.float(null, finite(speed))); }
  /** Updates finite float32 step height without rewriting any other fields. */
  withStepHeight(stepHeight: number): PlayerCharacterEntity { return this.updated(2, Tags.float(null, finite(stepHeight))); }
  /** Validates a changed field before exposing the new immutable snapshot. */
  private updated(index: number, value: Tag): PlayerCharacterEntity {
    return new PlayerCharacterEntity(this.file.withRoot(replaceTagField(this.file.root, index, value)));
  }
  /** Complete detached root, including unknown fields. */
  toTag(): Tag { return this.file.root; }
  /** Exact original or reverted bytes; edits retain compression/version/trailing data. */
  toBuffer(): Buffer { return this.file.toBuffer(); }
  /** Validates and snapshots a supplied root under explicit limits. */
  static fromTag(root: Tag, options: TagReadOptions = {}): PlayerCharacterEntity { return new PlayerCharacterEntity(new TagModelFile(root, options)); }
  /** Reads once with shared resource budgets, retaining the original file envelope. */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): PlayerCharacterEntity {
    return new PlayerCharacterEntity(TagModelFile.fromBuffer(data, options));
  }
  /** Human-readable character identity and persisted location. */
  toString(): string { return `PlayerCharacter(id=${this.id}, speed=${this.speed}, sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`; }
}

/** Rejects numbers that would become non-finite when persisted as float32. */
function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE', 'Character value must fit finite float32');
  return Math.fround(value);
}
