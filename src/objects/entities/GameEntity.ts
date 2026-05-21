/**
 * @fileoverview Game Entity
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * GameEntity — world entity with position and orientation.
 *
 * Port of SimpleTransformableSendableObject.fromTagStructure() Java.
 *
 * Structure Tag "transformable" :
 *   STRUCT "transformable" [
 *     [0] FLOAT    mass
 *     [1] LIST     transform (16×FLOAT, Matrix4f row-major)
 *     [2] STRUCT   aiTag (optionnel, opaque)
 *     [3] VECTOR3i "sPos" — sector
 *     [4] INT      "fid"  — factionId
 *     [5] STRING   "own"  — owner
 *     [6] STRUCT   spawnController
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { StarMadeEntity } from './StarMadeEntity.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import {
  buildEditableEntityFields,
  fieldValueAsInteger,
  fieldValueAsNumber,
  fieldValueAsString,
  TRANSFORMABLE_FIELD_SCHEMA,
  type EntityField,
} from '../EntityFieldView.js';

/**
 * Represents the GameEntity model used by high-level StarMade entity modelling.
 */
export abstract class GameEntity extends StarMadeEntity {
  /**
   * Creates a GameEntity instance.
   *
   * @param mass - Input value for the constructor operation.
   * @param transform - Input value for the constructor operation.
   * @param sectorPosition - Input value for the constructor operation.
   * @param factionId - Input value for the constructor operation.
   * @param owner - Input value for the constructor operation.
   * @param spawnController - Input value for the constructor operation.
   * @param _transformableChildren - Input value for the constructor operation.
   */
  constructor(
    readonly mass: number,
    readonly transform: EntityTransform,
    readonly sectorPosition: SectorPosition,
    readonly factionId: number,
    readonly owner: string,
    readonly spawnController: SpawnController,
    /** Unknown fields (aiTag, etc.) preserved at their original indexes */
    protected readonly _transformableChildren: Tag[],
  ) {
    super();
    Object.defineProperty(this, '_transformableChildren', { enumerable: false });
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Reports whether isNPC is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isNPC(): boolean { return this.factionId < 0; }

  /** StarMade-Open SimpleTransformableSendableObject slot view, without raw Tag exposure. */
  get transformableFields(): readonly EntityField<this>[] {
    return buildEditableEntityFields(this._transformableChildren, TRANSFORMABLE_FIELD_SCHEMA, {
      mass: value => this.withMass(fieldValueAsNumber(value, 'mass')),
      transform: value => this._clone({ transform: entityTransformFromFieldValue(value) }),
      sectorPosition: value => this.withSector(sectorPositionFromFieldValue(value, 'sectorPosition')),
      factionId: value => this.withFactionId(fieldValueAsInteger(value, 'factionId')),
      owner: value => this.withOwner(fieldValueAsString(value, 'owner')),
      spawnController: value => {
        if (value instanceof SpawnController) return this._clone({ spawnController: value });
        throw new TypeError('Entity field "spawnController" expects a SpawnController object');
      },
    });
  }

  /** AI/noAI transformable slot as a plain high-level field view. */
  get aiConfigurationField(): EntityField<this> | null {
    return this.transformableFields[2] ?? null;
  }

  /**
   * Returns TransformableField.
   *
   * @param key - Input value for the getTransformableField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getTransformableField(key: string): EntityField<this> | null {
    return this.transformableFields.find(field => field.key === key) ?? null;
  }

  // ── Updates ──────────────────────────────────────────────────────────

  /**
   * Returns a cloned copy of this value.
   *
   * @param overrides - Input value for the _clone operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected abstract _clone(overrides: Partial<{
    mass: number;
    transform: EntityTransform;
    sectorPosition: SectorPosition;
    factionId: number;
    owner: string;
    spawnController: SpawnController;
  }>): this;

  /**
   * Returns a copy updated with FactionId.
   *
   * @param fid - Input value for the withFactionId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withFactionId(fid: number): this {
    return this._clone({ factionId: fid });
  }

  /**
   * Returns a copy updated with Owner.
   *
   * @param owner - Input value for the withOwner operation.
   * @returns The computed StarMade-Decoder value.
   */
  withOwner(owner: string): this {
    return this._clone({ owner });
  }

  /**
   * Returns a copy updated with Sector.
   *
   * @param sector - Input value for the withSector operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSector(sector: SectorPosition): this {
    return this._clone({ sectorPosition: sector });
  }

  /**
   * Returns a copy updated with Mass.
   *
   * @param mass - Input value for the withMass operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMass(mass: number): this {
    return this._clone({ mass });
  }

  // ── Serialization of "transformable" ─────────────────────────────────────

  /**
   * Builds TransformableTag for high-level StarMade entity modelling.
   *
   * @param overrides - Input value for the _buildTransformableTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _buildTransformableTag(overrides: Partial<{
    mass: number;
    transform: EntityTransform;
    sectorPosition: SectorPosition;
    factionId: number;
    owner: string;
    spawnController: SpawnController;
  }> = {}): Tag {
    const children = [...this._transformableChildren];
    const mass = overrides.mass ?? this.mass;
    const transform = overrides.transform ?? this.transform;
    const sectorPosition = overrides.sectorPosition ?? this.sectorPosition;
    const factionId = overrides.factionId ?? this.factionId;
    const owner = overrides.owner ?? this.owner;
    const spawnController = overrides.spawnController ?? this.spawnController;
    // [0] mass
    if (children[0]?.type === TagType.FLOAT) {
      children[0] = Tags.float(null, mass);
    }
    // [1] transform LIST
    if (children[1]?.type === TagType.LIST) {
      children[1] = transform.toMatrix4fList(children[1].name);
    }
    // [3] sPos
    const sPosIdx = children.findIndex(t => t.name === 'sPos');
    if (sPosIdx >= 0) {
      children[sPosIdx] = sectorPosition.toTag('sPos');
    }
    // [4] fid
    const fidIdx = children.findIndex(t => t.name === 'fid');
    if (fidIdx >= 0) {
      children[fidIdx] = Tags.int('fid', factionId);
    }
    // [5] own
    const ownIdx = children.findIndex(t => t.name === 'own');
    if (ownIdx >= 0) {
      children[ownIdx] = Tags.string('own', owner);
    }
    // [6] spawnController
    if (children[6]?.type === TagType.STRUCT) {
      children[6] = spawnController.toTag();
    }

    return new Tag(TagType.STRUCT, 'transformable', [...children, FINISH_TAG]);
  }

  /** Parses the "transformable" struct. */
  static parseTransformable(tag: Tag): {
    mass: number;
    transform: EntityTransform;
    sectorPosition: SectorPosition;
    factionId: number;
    owner: string;
    spawnController: SpawnController;
    children: Tag[];
  } {
    const children = tag.getStruct().filter(t => t.type !== TagType.FINISH);

    const mass = children[0]?.type === TagType.FLOAT ? children[0].getFloat() : 0.1;

    let transform = EntityTransform.IDENTITY;
    if (children[1]?.type === TagType.LIST) {
      try { transform = EntityTransform.fromMatrix4fList(children[1]); } catch { /* skip */ }
    }

    const sPosTag = children.find(t => t.name === 'sPos') ?? children[3];
    const sectorPosition = sPosTag?.type === TagType.VECTOR3i
      ? SectorPosition.fromTag(sPosTag) : SectorPosition.ZERO;

    const fidTag = children.find(t => t.name === 'fid') ?? children[4];
    const factionId = fidTag?.type === TagType.INT ? fidTag.getInt() : 0;

    const ownTag = children.find(t => t.name === 'own') ?? children[5];
    const owner  = ownTag?.type === TagType.STRING ? ownTag.getString() : '';

    let spawnController = SpawnController.EMPTY;
    if (children[6]?.type === TagType.STRUCT) {
      try { spawnController = SpawnController.fromTag(children[6]); } catch { /* skip */ }
    }

    return { mass, transform, sectorPosition, factionId, owner, spawnController, children };
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `${this.entityType}(sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`;
  }
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
function entityTransformFromFieldValue(value: unknown): EntityTransform {
  if (value instanceof EntityTransform) return value;
  if (Array.isArray(value) && value.length >= 16) {
    const floats = value.map((entry, index) => fieldValueAsNumber(entry, `transform[${index}]`));
    return new EntityTransform(
      floats[12], floats[13], floats[14],
      floats[0], floats[1], floats[2],
      floats[4], floats[5], floats[6],
      floats[8], floats[9], floats[10],
    );
  }
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return new EntityTransform(
      fieldValueAsNumber(candidate.originX, 'transform.originX'),
      fieldValueAsNumber(candidate.originY, 'transform.originY'),
      fieldValueAsNumber(candidate.originZ, 'transform.originZ'),
      fieldValueAsNumber(candidate.m00, 'transform.m00'),
      fieldValueAsNumber(candidate.m01, 'transform.m01'),
      fieldValueAsNumber(candidate.m02, 'transform.m02'),
      fieldValueAsNumber(candidate.m10, 'transform.m10'),
      fieldValueAsNumber(candidate.m11, 'transform.m11'),
      fieldValueAsNumber(candidate.m12, 'transform.m12'),
      fieldValueAsNumber(candidate.m20, 'transform.m20'),
      fieldValueAsNumber(candidate.m21, 'transform.m21'),
      fieldValueAsNumber(candidate.m22, 'transform.m22'),
    );
  }
  throw new TypeError('Entity field "transform" expects an EntityTransform, 16-number matrix array, or transform object');
}
