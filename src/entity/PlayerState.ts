/**
 * @fileoverview Player State
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerState — parser for ENTITY_PLAYERSTATE_*.ent
 *
 * Structure Java (PlayerState.fromTagStructure) :
 *   STRUCT "PlayerState" [
 *     [0] LONG   "credits"      — player credits
 *     [1] STRUCT spawnData      — spawn data (death/logout)
 *     [2] STRUCT "inv1"         — inventory principal
 *     [3] VECTOR3i "sector"     — current sector (legacy format)
 *         or another field
 *     [4] VECTOR3f "lspawn"     — position logout locale
 *     [5] VECTOR3i "lsector"    — logout sector
 *     [6] STRUCT factionController — player faction data
 *     [7] LONG   lastLogin
 *     [8] LONG   lastLogout
 *     [9] STRUCT "ips"          — historique IPs (ou STRUCT pFac)
 *     [10] BYTE  hasCreativeMode
 *     [11] STRING lastEnteredEntity
 *     ... (many optional fields)
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';
import type { Vector3i, Vector3f } from '../types/Vectors.js';

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
  factionRank?: number;
}

/**
 * Parses a root tag from ENTITY_PLAYERSTATE_*.ent
 */
export function parsePlayerState(root: Tag): PlayerStateData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`PlayerState: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  const result: PlayerStateData = {
    credits: s.length > 0 && s[0].type === TagType.LONG ? s[0].getLong() : 0n,
  };

  // [1] spawnData
  // [2] inv1 (inventory) — the full contents are not decoded here

  // [3] VECTOR3i "sector" (legacy format) or another value
  if (s.length > 3 && s[3].type === TagType.VECTOR3i) {
    result.currentSector = s[3].getVector3i();
  }

  // Search by name for version robustness
  for (const tag of s) {
    if (tag.name === 'lsector' && tag.type === TagType.VECTOR3i) {
      result.logoutSector = tag.getVector3i();
    }
    if (tag.name === 'lspawn' && tag.type === TagType.VECTOR3f) {
      result.logoutLocalPos = tag.getVector3f();
    }
    if (tag.name === 'sector' && tag.type === TagType.VECTOR3i && !result.currentSector) {
      result.currentSector = tag.getVector3i();
    }
  }

  // [7] lastLogin, [8] lastLogout
  if (s.length > 7 && s[7].type === TagType.LONG) result.lastLogin  = s[7].getLong();
  if (s.length > 8 && s[8].type === TagType.LONG) result.lastLogout = s[8].getLong();

  // [10] hasCreativeMode
  if (s.length > 10 && s[10].type === TagType.BYTE) {
    result.hasCreativeMode = s[10].getByte() !== 0;
  }

  // [11] lastEnteredEntity
  if (s.length > 11 && s[11].type === TagType.STRING) {
    result.lastEnteredEntity = s[11].getString();
  }

  // Faction (struct at index 6 or found by name)
  const factionTag = s.find(t => t.name === 'pFac-v0' || t.name === 'pFac' || (t.type === TagType.STRUCT && s.indexOf(t) === 6));
  if (factionTag && factionTag.type === TagType.STRUCT) {
    const fs = factionTag.getStruct().filter(t => t.type !== TagType.FINISH);
    if (fs.length > 0 && fs[0].type === TagType.INT) result.factionId   = fs[0].getInt();
    if (fs.length > 1 && fs[1].type === TagType.INT) result.factionRank = fs[1].getInt();
  }

  return result;
}
