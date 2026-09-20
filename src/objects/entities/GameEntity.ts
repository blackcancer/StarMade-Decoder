/** @fileoverview Shared immutable transformable entity fields with positional, source-preserving edits. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { StarMadeEntity } from './StarMadeEntity.js';
import { SectorPosition, EntityTransform, type EntityTransformChanges } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import { buildEditableEntityFields, fieldValueAsInteger, fieldValueAsNumber, fieldValueAsString,
  TRANSFORMABLE_FIELD_SCHEMA, type EntityField } from '../EntityFieldView.js';

/** Fields supported by all world entities; no game rules or geometric operations are inferred. */
export interface GameEntityChanges {
  mass: number; transform: EntityTransform; sectorPosition: SectorPosition; factionId: number;
  owner: string; spawnController: SpawnController;
}
/** Rejects non-finite values before float32 storage. */
function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE', 'Entity value must fit finite float32');
  return Math.fround(value);
}
/** Detached positional children including all unknown source fields. */
function parts(root: Tag): Tag[] { return root.getStruct().filter(tag => tag.type !== TagType.FINISH); }
/** Validates the persisted spawn-controller tuple before using its domain projection. */
function spawn(tag: Tag, options: TagReadOptions): SpawnController {
  const list = parts(tag)[0];
  if (list?.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Spawn controller requires a marker STRUCT');
  for (const marker of parts(list)) {
    const values = parts(marker);
    if (values[0]?.type !== TagType.STRUCT || values[1]?.type !== TagType.LONG || values[2]?.type !== TagType.VECTOR3i) {
      throw new DecodeError('E_FORMAT', 'Invalid spawn marker fields');
    }
  }
  return SpawnController.fromTag(tag, options);
}

/** Shared entity view whose editable methods retain all unmodified transformable fields. */
export abstract class GameEntity extends StarMadeEntity {
  private readonly transformableFile: TagModelFile;
  private readonly transformValue: EntityTransform;
  private readonly sectorValue: SectorPosition;
  private readonly spawnTag: TagModelFile;
  readonly mass: number;
  /** Snapshots components and the source children under the supplied Tag limits. */
  constructor(mass: number, transform: EntityTransform, sectorPosition: SectorPosition,
    readonly factionId: number, readonly owner: string, spawnController: SpawnController,
    transformableChildren: Tag[], options: TagReadOptions = {}) {
    super(); this.mass = finite(mass);
    this.transformableFile = new TagModelFile(Tags.struct('transformable', transformableChildren), options);
    const matrix = transform.toMatrix4fList(); matrix.getList().forEach(value => finite(value.getFloat()));
    this.transformValue = EntityTransform.fromMatrix4fList(matrix, options);
    this.sectorValue = SectorPosition.fromTag(sectorPosition.toTag(), options);
    this.spawnTag = new TagModelFile(spawnController.toTag(), options);
    for (const property of ['transformableFile', 'transformValue', 'sectorValue', 'spawnTag']) Object.defineProperty(this, property, { enumerable: false });
    writeTo(Tags.struct(null, [Tags.float(null, this.mass), this.transformValue.toMatrix4fList(),
      this.sectorValue.toTag(), Tags.int(null, factionId), Tags.string(null, owner)]), this.options);
  }
  /** Local limits survive subclass edits without debiting shared read counters twice. */
  protected get options(): TagReadOptions { return this.transformableFile.options; }
  /** Detached original children for subclasses retaining their own file envelope. */
  protected get _transformableChildren(): Tag[] { return parts(this.transformableFile.root); }
  /** Detached transform projection cannot mutate the entity's serialization. */
  get transform(): EntityTransform { return this.transformValue.with({}); }
  /** Detached persisted sector. */
  get sectorPosition(): SectorPosition { return this.sectorValue.with({}); }
  /** Detached spawn-controller projection; its opaque source remains in the private Tag. */
  get spawnController(): SpawnController { return spawn(this.spawnTag.root, this.options); }
  /** Legacy SDK category: any negative faction ID, including pirates and traders. */
  get isNPC(): boolean { return this.factionId < 0; }
  /** Editable views use actual source slots and return validated immutable revisions. */
  get transformableFields(): readonly EntityField<this>[] {
    return buildEditableEntityFields(this._transformableChildren, TRANSFORMABLE_FIELD_SCHEMA, {
      mass: value => this.withMass(fieldValueAsNumber(value, 'mass')),
      transform: value => this._clone({ transform: entityTransformFromFieldValue(value, this.transform) }),
      sectorPosition: value => this.withSector(sectorPositionFromFieldValue(value, 'sectorPosition')),
      factionId: value => this.withFactionId(fieldValueAsInteger(value, 'factionId')),
      owner: value => this.withOwner(fieldValueAsString(value, 'owner')),
      spawnController: value => {
        if (value instanceof SpawnController) return this._clone({ spawnController: value });
        throw new TypeError('Entity field "spawnController" expects a SpawnController object');
      },
    });
  }
  /** Opaque AI field view, when the source contains this optional slot. */
  get aiConfigurationField(): EntityField<this> | null { return this.transformableFields[2] ?? null; }
  /** Finds one named semantic field without exposing raw Tags. */
  getTransformableField(key: string): EntityField<this> | null { return this.transformableFields.find(field => field.key === key) ?? null; }
  /** Subclasses serialize explicit edits while retaining their original root/envelope. */
  protected abstract _clone(overrides: Partial<GameEntityChanges>): this;
  /** Changes only the stored faction ID. */
  withFactionId(value: number): this { return this._clone({ factionId: value }); }
  /** Changes only the stored owner. */
  withOwner(value: string): this { return this._clone({ owner: value }); }
  /** Changes only the stored sector. */
  withSector(value: SectorPosition): this { return this._clone({ sectorPosition: value }); }
  /** Changes only the stored finite mass. */
  withMass(value: number): this { return this._clone({ mass: value }); }
  /** Patches explicit slots only; names, unknown fields and unused matrix components remain unchanged. */
  protected _buildTransformableTag(overrides: Partial<GameEntityChanges> = {}): Tag {
    let root = this.transformableFile.root;
    if (overrides.mass !== undefined) root = replaceTagField(root, 0, Tags.float(null, finite(overrides.mass)));
    if (overrides.transform !== undefined) {
      const previous = parts(root)[1], values = previous.getList(), replacement = overrides.transform.toMatrix4fList().getList();
      for (const index of Array.from({length:16}, (_, index) => index)) values[index] = Tags.float(values[index].name, finite(replacement[index].getFloat()));
      root = replaceTagField(root, 1, new Tag(TagType.LIST, previous.name, values, TagType.FLOAT));
    }
    if (overrides.sectorPosition !== undefined) root = replaceTagField(root, 3, overrides.sectorPosition.toTag());
    if (overrides.factionId !== undefined) root = replaceTagField(root, 4, Tags.int(null, overrides.factionId));
    if (overrides.owner !== undefined) root = replaceTagField(root, 5, Tags.string(null, overrides.owner));
    if (overrides.spawnController !== undefined) {
      const changed = overrides.spawnController.toTag();
      if (!writeTo(changed, this.options).equals(writeTo(this.spawnController.toTag(), this.options))) root = replaceTagField(root, 6, changed);
    }
    return this.transformableFile.withRoot(root).root;
  }
  /** Parses required mass/matrix and validates any present optional typed slots without silent recovery. */
  static parseTransformable(tag: Tag, options: TagReadOptions = {}): {
    mass: number; transform: EntityTransform; sectorPosition: SectorPosition; factionId: number;
    owner: string; spawnController: SpawnController; children: Tag[];
  } {
    const children = parts(new TagModelFile(tag, options).root);
    if (children[0]?.type !== TagType.FLOAT || children[1]?.type !== TagType.LIST) throw new DecodeError('E_FORMAT', 'Transformable requires FLOAT mass and LIST matrix');
    const matrix = children[1].getList();
    if (matrix.length !== 16 || children[1].listType !== TagType.FLOAT) throw new DecodeError('E_FORMAT', 'Transformable matrix requires exactly 16 FLOATs');
    matrix.forEach(value => finite(value.getFloat()));
    for (const [index, type] of [[3, TagType.VECTOR3i], [4, TagType.INT], [5, TagType.STRING], [6, TagType.STRUCT]]) {
      if (children[index] && children[index].type !== type) throw new DecodeError('E_FORMAT', `Invalid transformable field ${index}`);
    }
    return { mass: finite(children[0].getFloat()), transform: EntityTransform.fromMatrix4fList(children[1], options),
      sectorPosition: children[3] ? SectorPosition.fromTag(children[3], options) : new SectorPosition(0, 0, 0, options),
      factionId: children[4] ? children[4].getInt() : 0, owner: children[5] ? children[5].getString() : '',
      spawnController: children[6] ? spawn(children[6], options) : new SpawnController([], options), children };
  }
  /** Human-readable entity identity and persisted location. */
  toString(): string { return `${this.entityType}(sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`; }
}

/**
 * Handles the sectorPositionFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the sectorPositionFromFieldValue operation.
 * @param key - Input value for the sectorPositionFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function sectorPositionFromFieldValue(value: unknown, key: string): SectorPosition {
  if (value instanceof SectorPosition) return value;
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return new SectorPosition(
      fieldValueAsInteger(candidate.x, `${key}.x`),
      fieldValueAsInteger(candidate.y, `${key}.y`),
      fieldValueAsInteger(candidate.z, `${key}.z`),
    );
  }
  throw new TypeError(`Entity field "${key}" expects a SectorPosition or {x,y,z}`);
}

/**
 * Handles the entityTransformFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the entityTransformFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function entityTransformFromFieldValue(value: unknown, baseline: EntityTransform): EntityTransform {
  if (value instanceof EntityTransform) return value;
  if (Array.isArray(value) && value.length === 16) {
    const floats = value.map((entry, index) => fieldValueAsNumber(entry, `transform[${index}]`));
    return EntityTransform.fromMatrix4fList(Tags.list(null, floats.map(value => Tags.float(null, value))));
  }
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const changes: EntityTransformChanges = {};
    for (const key of ['originX','originY','originZ','m00','m01','m02','m10','m11','m12','m20','m21','m22'] as const) changes[key] = fieldValueAsNumber(candidate[key], `transform.${key}`);
    for (const key of ['m03','m13','m23','m33'] as const) if (candidate[key] !== undefined) changes[key] = fieldValueAsNumber(candidate[key], `transform.${key}`);
    return baseline.with(changes);
  }
  throw new TypeError('Entity field "transform" expects an EntityTransform, 16-number matrix array, or transform object');
}
