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
import { readFrom } from '../../core/TagParser.js';
import { SegmentController, type BlockBounds } from './SegmentController.js';
import { SectorPosition, EntityTransform } from '../components/Transform.js';
import { SpawnController } from '../components/SpawnData.js';
import { ManagerContainer } from '../components/ManagerContainer.js';

// ── Helper: build from parsed data ─────────────────────────────

function make<T extends SegmentController>(
  ctor: new (...args: any[]) => T, root: Tag,
): T {
  const p = (SegmentController as any)._parse(root);
  return new ctor(
    p.mass, p.transform, p.sectorPosition, p.factionId, p.owner,
    p.spawnController, p.transformableChildren,
    p.uniqueId, p.realName, p.bounds, p.dockingState, p.controlElementMap,
    p.managerContainer, p.creatorId, p.spawner, p.lastModifier, p.seed,
    p.nonEmptySegments, p.hpState, p.textBlocks, p.scrap, p.vulnerable,
    p.minable, p.factionRights, p.currentOwner, p.lastDockerPlayer,
    p.lastEditBlocks, p.lastDamageTaken, p.tagVersion, p.rootChildren,
  );
}

/**
 * Clones while applying overrides directly on properties.
 * GameEntity overrides (factionId, owner, sector, mass) are updated
 * in transformableChildren and rootChildren before rebuilding.
 */
function cloneWith<T extends SegmentController>(
  entity: T,
  ctor: new (...args: any[]) => T,
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
  const p = (SegmentController as any)._parse(entity.toTag());

  // Patch transformableChildren
  const tc = [...p.transformableChildren];
  if (overrides.factionId !== undefined) {
    const i = tc.findIndex(t => t.name === 'fid');
    if (i >= 0) tc[i] = Tags.int('fid', overrides.factionId);
  }
  if (overrides.owner !== undefined) {
    const i = tc.findIndex(t => t.name === 'own');
    if (i >= 0) tc[i] = Tags.string('own', overrides.owner);
  }
  if (overrides.sectorPosition !== undefined) {
    const i = tc.findIndex(t => t.name === 'sPos');
    const s = overrides.sectorPosition;
    if (i >= 0) tc[i] = Tags.vector3i('sPos', s.x, s.y, s.z);
  }
  if (overrides.mass !== undefined && tc[0]?.type === TagType.FLOAT) {
    tc[0] = Tags.float(null, overrides.mass);
  }

  return new ctor(
    overrides.mass           ?? p.mass,
    overrides.transform      ?? p.transform,
    overrides.sectorPosition ?? p.sectorPosition,
    overrides.factionId      ?? p.factionId,
    overrides.owner          ?? p.owner,
    overrides.spawnController ?? p.spawnController,
    tc,
    overrides.uniqueId        ?? p.uniqueId,
    overrides.realName       ?? p.realName,
    overrides.bounds          ?? p.bounds,
    p.dockingState, p.controlElementMap,
    Object.prototype.hasOwnProperty.call(overrides, 'managerContainer') ? overrides.managerContainer ?? null : p.managerContainer,
    overrides.creatorId      ?? p.creatorId,
    overrides.spawner        ?? p.spawner,
    overrides.lastModifier   ?? p.lastModifier,
    overrides.seed           ?? p.seed,
    overrides.nonEmptySegments ?? p.nonEmptySegments,
    p.hpState, p.textBlocks,
    overrides.scrap          ?? p.scrap,
    overrides.vulnerable     ?? p.vulnerable,
    overrides.minable        ?? p.minable,
    overrides.factionRights  ?? p.factionRights,
    overrides.currentOwner     ?? p.currentOwner,
    overrides.lastDockerPlayer ?? p.lastDockerPlayer,
    overrides.lastEditBlocks   ?? p.lastEditBlocks,
    overrides.lastDamageTaken  ?? p.lastDamageTaken,
    overrides.tagVersion       ?? p.tagVersion,
    overrides.rootChildren ?? p.rootChildren,
  );
}

// ── Ship ──────────────────────────────────────────────────────────────────────

export class Ship extends SegmentController {
  readonly entityType = 'SHIP';

  static fromTag(root: Tag): Ship        { return make(Ship, root); }
  static fromBuffer(data: Buffer | Uint8Array): Ship { return Ship.fromTag(readFrom(data)); }

  protected _clone(overrides: any): this { return cloneWith(this, Ship, overrides) as unknown as this; }
}

// ── SpaceStation ──────────────────────────────────────────────────────────────

export class SpaceStation extends SegmentController {
  readonly entityType = 'SPACE_STATION';

  static fromTag(root: Tag): SpaceStation        { return make(SpaceStation, root); }
  static fromBuffer(data: Buffer | Uint8Array): SpaceStation { return SpaceStation.fromTag(readFrom(data)); }

  protected _clone(overrides: any): this { return cloneWith(this, SpaceStation, overrides) as unknown as this; }
}

// ── ShopSpaceStation ──────────────────────────────────────────────────────────

export class ShopSpaceStation extends SegmentController {
  readonly entityType = 'SHOP';

  static fromTag(root: Tag): ShopSpaceStation        { return make(ShopSpaceStation, root); }
  static fromBuffer(data: Buffer | Uint8Array): ShopSpaceStation { return ShopSpaceStation.fromTag(readFrom(data)); }

  protected _clone(overrides: any): this { return cloneWith(this, ShopSpaceStation, overrides) as unknown as this; }
}

// ── FloatingRock ──────────────────────────────────────────────────────────────

export class FloatingRock extends SegmentController {
  readonly entityType = 'ASTEROID';

  static fromTag(root: Tag): FloatingRock        { return make(FloatingRock, root); }
  static fromBuffer(data: Buffer | Uint8Array): FloatingRock { return FloatingRock.fromTag(readFrom(data)); }

  protected _clone(overrides: any): this { return cloneWith(this, FloatingRock, overrides) as unknown as this; }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function parseSegmentControllerEntity(
  root: Tag, filename = '',
): Ship | SpaceStation | ShopSpaceStation | FloatingRock {
  const f = filename.toUpperCase();
  if (f.includes('ENTITY_SHIP'))         return Ship.fromTag(root);
  if (f.includes('ENTITY_SPACESTATION')) return SpaceStation.fromTag(root);
  if (f.includes('ENTITY_SHOP'))         return ShopSpaceStation.fromTag(root);
  if (f.includes('ENTITY_ASTEROID'))     return FloatingRock.fromTag(root);
  return Ship.fromTag(root);
}
