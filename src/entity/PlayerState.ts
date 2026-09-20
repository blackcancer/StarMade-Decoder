/** @fileoverview Detached player-state DTOs projected from the shared validated format model. */
import type { Tag } from '../core/Tag.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { PlayerState } from '../objects/PlayerState.js';
import { Vector3i, Vector3f } from '../types/Vectors.js';

/** Compatible player-state fields with exact signed-long values and explicit faction suspension. */
export interface PlayerStateData {
  credits: bigint;
  currentSector?: Vector3i;
  logoutSector?: Vector3i;
  logoutLocalPos?: Vector3f;
  lastLogin?: bigint;
  lastLogout?: bigint;
  hasCreativeMode?: boolean;
  lastEnteredEntity?: string;
  factionId?: number;
  factionSuspended: number;
  /** @deprecated The saved pFac field is suspension state; use factionSuspended. */
  factionRank?: number;
}

/** Parses through the shared schema and returns independently mutable DTO coordinates. */
export function parsePlayerState(root: Tag, options: TagReadOptions = {}): PlayerStateData {
  const model = PlayerState.fromTag(root, options);
  const current = model.currentSector, logout = model.logoutSector, local = model.logoutLocalPos;
  return {
    credits: model.credits,
    currentSector: current ? new Vector3i(current.x, current.y, current.z) : undefined,
    logoutSector: logout ? new Vector3i(logout.x, logout.y, logout.z) : undefined,
    logoutLocalPos: local ? new Vector3f(local.x, local.y, local.z) : undefined,
    lastLogin: model.lastLogin, lastLogout: model.lastLogout,
    hasCreativeMode: model.hasCreativeMode, lastEnteredEntity: model.lastEnteredEntity,
    factionId: model.factionId, factionSuspended: model.factionSuspended, factionRank: model.factionSuspended,
  };
}
