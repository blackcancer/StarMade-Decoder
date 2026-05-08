/**
 * @fileoverview Player Character
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerCharacter — parser for ENTITY_PLAYERCHARACTER_*.ent
 *
 * Structure Java (PlayerCharacter.toTagStructure) :
 *   STRUCT "PlayerCharacter" [
 *     INT    "id"          — numeric character identifier
 *     FLOAT  "speed"       — movement speed
 *     FLOAT  "stepHeight"  — step height
 *     STRUCT "transformable" — world position/orientation (SimpleTransformableSendableObject)
 *       [0] FLOAT  mass
 *       [1] MATRIX4f transform   — matrice de position/orientation
 *       [2] STRUCT aiTag         — configuration IA
 *       [3] VECTOR3i secPos      — sector position
 *       [4] INT    fCode         — faction code
 *       [5] STRING owner         — owner
 *       [6] STRUCT spawnController
 *     FINISH
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';
import type { Vector3i } from '../types/Vectors.js';
import type { Matrix4f } from '../types/Matrices.js';

export interface PlayerCharacterData {
  id: number;
  speed: number;
  stepHeight: number;
  transform?: Matrix4f;        // matrice de position/orientation
  sectorPosition?: Vector3i;   // current sector
  factionCode?: number;        // faction code
  owner?: string;              // owner
}

/**
 * Parses a root tag from ENTITY_PLAYERCHARACTER_*.ent
 */
export function parsePlayerCharacter(root: Tag): PlayerCharacterData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`PlayerCharacter: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct();

  const result: PlayerCharacterData = {
    id:         _findInt(s, 'id')    ?? 0,
    speed:      _findFloat(s, 'speed') ?? 0,
    stepHeight: _findFloat(s, 'stepHeight') ?? 0,
  };

  // "transformable" substructure
  const transformable = _findStruct(s, 'transformable');
  if (transformable) {
    const ts = transformable.getStruct();
    // [1] = MATRIX4f transform
    if (ts.length > 1 && ts[1].type === TagType.MATRIX4f) {
      result.transform = ts[1].getMatrix4f();
    }
    // [3] = VECTOR3i secPos
    if (ts.length > 3 && ts[3].type === TagType.VECTOR3i) {
      result.sectorPosition = ts[3].getVector3i();
    }
    // [4] = INT fCode
    if (ts.length > 4 && ts[4].type === TagType.INT) {
      result.factionCode = ts[4].getInt();
    }
    // [5] = STRING owner
    if (ts.length > 5 && ts[5].type === TagType.STRING) {
      result.owner = ts[5].getString();
    }
  }

  return result;
}

// ── Helpers internes ─────────────────────────────────────────────────────────

function _findInt(tags: Tag[], name: string): number | undefined {
  return tags.find(t => t.name === name && t.type === TagType.INT)?.getInt();
}

function _findFloat(tags: Tag[], name: string): number | undefined {
  return tags.find(t => t.name === name && t.type === TagType.FLOAT)?.getFloat();
}

function _findStruct(tags: Tag[], name: string): Tag | undefined {
  return tags.find(t => t.name === name && t.type === TagType.STRUCT);
}
