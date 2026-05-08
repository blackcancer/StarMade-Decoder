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

export abstract class GameEntity extends StarMadeEntity {
  constructor(
    readonly mass: number,
    readonly transform: EntityTransform,
    readonly sectorPosition: SectorPosition,
    readonly factionId: number,
    readonly owner: string,
    readonly spawnController: SpawnController,
    /** Unknown fields (aiTag, etc.) preserved at their original indexes */
    protected readonly _transformableChildren: Tag[],
  ) { super(); }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  get isNPC(): boolean { return this.factionId < 0; }

  // ── Updates ──────────────────────────────────────────────────────────

  protected abstract _clone(overrides: Partial<{
    mass: number;
    transform: EntityTransform;
    sectorPosition: SectorPosition;
    factionId: number;
    owner: string;
    spawnController: SpawnController;
  }>): this;

  withFactionId(fid: number): this {
    return this._clone({ factionId: fid });
  }

  withOwner(owner: string): this {
    return this._clone({ owner });
  }

  withSector(sector: SectorPosition): this {
    return this._clone({ sectorPosition: sector });
  }

  withMass(mass: number): this {
    return this._clone({ mass });
  }

  // ── Serialization of "transformable" ─────────────────────────────────────

  protected _buildTransformableTag(): Tag {
    const children = [...this._transformableChildren];
    // [0] mass
    if (children[0]?.type === TagType.FLOAT) {
      children[0] = Tags.float(null, this.mass);
    }
    // [1] transform LIST
    if (children[1]?.type === TagType.LIST) {
      children[1] = this.transform.toMatrix4fList(children[1].name);
    }
    // [3] sPos
    const sPosIdx = children.findIndex(t => t.name === 'sPos');
    if (sPosIdx >= 0) {
      children[sPosIdx] = this.sectorPosition.toTag('sPos');
    }
    // [4] fid
    const fidIdx = children.findIndex(t => t.name === 'fid');
    if (fidIdx >= 0) {
      children[fidIdx] = Tags.int('fid', this.factionId);
    }
    // [5] own
    const ownIdx = children.findIndex(t => t.name === 'own');
    if (ownIdx >= 0) {
      children[ownIdx] = Tags.string('own', this.owner);
    }
    // [6] spawnController
    if (children[6]?.type === TagType.STRUCT) {
      children[6] = this.spawnController.toTag();
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

  toString(): string {
    return `${this.entityType}(sector=${this.sectorPosition}, faction=${this.factionId}, owner="${this.owner}")`;
  }
}
