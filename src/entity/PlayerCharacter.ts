/** @fileoverview Detached character DTOs using the validated saved 16-float transform representation. */
import type { Tag } from '../core/Tag.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { PlayerCharacter } from '../objects/PlayerCharacter.js';
import { Vector3i } from '../types/Vectors.js';
import type { Matrix4f } from '../types/Matrices.js';

/** Character fields and stored transform values, without coordinate conversion or matrix calculations. */
export interface PlayerCharacterData {
  id: number;
  speed: number;
  stepHeight: number;
  /** Actual saved LIST<FLOAT> payload, in its original order. */
  transformValues: number[];
  /** @deprecated Character saves use transformValues; no Matrix4f is synthesized from their list. */
  transform?: Matrix4f;
  sectorPosition?: Vector3i;
  factionCode?: number;
  owner?: string;
}

/** Reads the shared positional character schema, independent of field names. */
export function parsePlayerCharacter(root: Tag, options: TagReadOptions = {}): PlayerCharacterData {
  const model = PlayerCharacter.fromTag(root, options), sector = model.sectorPosition;
  return {
    id: model.id, speed: model.speed, stepHeight: model.stepHeight,
    transformValues: model.transformable.transformValues,
    sectorPosition: new Vector3i(sector.x, sector.y, sector.z),
    factionCode: model.factionId, owner: model.owner,
  };
}
