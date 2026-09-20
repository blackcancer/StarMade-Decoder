/** @fileoverview Detached controller DTOs sharing the validated direct/wrapped entity schema. */
import type { Tag } from '../core/Tag.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { SegmentControllerObject } from '../objects/SegmentController.js';
import { Vector3i } from '../types/Vectors.js';
import { Matrix4f } from '../types/Matrices.js';

/** Compatible controller metadata, with both actual stored transform representations kept distinct. */
export interface SegmentControllerData {
  uniqueId: string;
  realName: string;
  minPos?: Vector3i;
  maxPos?: Vector3i;
  creatorId?: number;
  spawner?: string;
  lastModifier?: string;
  seed?: bigint;
  currentOwner?: string;
  lastDockerPlayer?: string;
  /** Present only when the source contains an actual MATRIX4f Tag. */
  transform?: Matrix4f;
  /** Actual LIST<FLOAT> values in stored order; no matrix is constructed from them. */
  transformValues?: number[];
  sectorPosition?: Vector3i;
  factionCode?: number;
  owner?: string;
  scrap?: boolean;
  vulnerable?: boolean;
  minable?: boolean;
  factionRights?: number;
  nonEmptySegments?: number;
}

/** Reads direct controllers and supported wrappers through the same format model used for edits. */
export function parseSegmentController(root: Tag, options: TagReadOptions = {}): SegmentControllerData {
  const model = SegmentControllerObject.fromTag(root, options);
  const min = model.minPos, max = model.maxPos, sector = model.sectorPosition;
  return {
    uniqueId: model.uniqueId, realName: model.realName,
    minPos: min ? new Vector3i(min.x, min.y, min.z) : undefined,
    maxPos: max ? new Vector3i(max.x, max.y, max.z) : undefined,
    creatorId: model.creatorId, spawner: model.spawner, lastModifier: model.lastModifier, seed: model.seed,
    currentOwner: model.currentOwner, lastDockerPlayer: model.lastDockerPlayer,
    transform: model.transform ? Object.assign(new Matrix4f(), model.transform) : undefined,
    transformValues: model.transformValues ?? undefined,
    sectorPosition: sector ? new Vector3i(sector.x, sector.y, sector.z) : undefined,
    factionCode: model.factionCode, owner: model.owner,
    scrap: model.scrap, vulnerable: model.vulnerable, minable: model.minable,
    factionRights: model.factionRights, nonEmptySegments: model.nonEmptySegments,
  };
}
