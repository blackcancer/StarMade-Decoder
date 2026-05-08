/**
 * @fileoverview Segment Controller
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SegmentController — shared parser for Ship, SpaceStation, Shop
 * (ENTITY_SHIP_*.ent, ENTITY_SPACESTATION_*.ent, ENTITY_SHOP_*.ent)
 *
 * Structure Java (SegmentController.fromTagStructure) :
 *   STRUCT [
 *     [0] STRING  "uniqueId"      — identifiant unique
 *     [1] VECTOR3i "minPos"       — min bloc
 *     [2] VECTOR3i "maxPos"       — max bloc
 *     [3] STRUCT  dockingController
 *     [4] STRUCT  controlElementMap (SERIALIZABLE factoryId=0)
 *     [5] STRING  realName         — display name
 *     [6] STRUCT  "transformable"  — position/orientation/faction
 *     [7] STRUCT  managerContainer (si ManagedSegmentController)
 *     [8] INT     creatorId
 *     [9] STRING  spawner
 *     [10] STRING lastModifier
 *     [11] LONG   seed
 *     [12] BYTE   touched
 *     ... (many optional fields)
 *     [25] STRING currentOwner
 *     [26] STRING lastDockerPlayer
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';
import type { Vector3i } from '../types/Vectors.js';
import type { Matrix4f } from '../types/Matrices.js';

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

  // From "transformable"
  transform?: Matrix4f;
  sectorPosition?: Vector3i;
  factionCode?: number;
  owner?: string;           // owner stored in transformable data (may differ from currentOwner)

  // Flags
  scrap?: boolean;
  vulnerable?: boolean;
  minable?: boolean;
  factionRights?: number;
  nonEmptySegments?: number;
}

/**
 * Parses a root tag from .ent de type SegmentController
 * (ENTITY_SHIP_*, ENTITY_SPACESTATION_*, ENTITY_SHOP_*)
 */
export function parseSegmentController(root: Tag): SegmentControllerData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`SegmentController: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  // Some files (Shop, SpaceStation) have a wrapper structure
  // Detect whether the root tag is the SegmentController itself or a wrapper
  const firstNames = s.map(t => t.name);
  const isWrapped = !firstNames.includes('uniqueId') &&
                    (firstNames.includes('s3') || firstNames.includes('container'));

  let sc = s;
  if (isWrapped) {
    // Find the child struct containing uniqueId
    for (const sub of s) {
      if (sub.type === TagType.STRUCT) {
        const inner = sub.getStruct().filter(t => t.type !== TagType.FINISH);
        if (inner.some(t => t.name === 'uniqueId')) {
          sc = inner;
          break;
        }
      }
    }
  }

  const result: SegmentControllerData = {
    uniqueId: _str(sc, 'uniqueId') ?? _idx(sc, 0, TagType.STRING) ?? '',
    realName: _str(sc, 'realName') ?? _idx(sc, 5, TagType.STRING) ?? '',
    minPos:   _vec3i(sc, 'minPos') ?? (sc[1]?.type === TagType.VECTOR3i ? sc[1].getVector3i() : undefined),
    maxPos:   _vec3i(sc, 'maxPos') ?? (sc[2]?.type === TagType.VECTOR3i ? sc[2].getVector3i() : undefined),
  };

  // Indexed fields
  if (sc[8]?.type === TagType.INT)    result.creatorId    = sc[8].getInt();
  if (sc[9]?.type === TagType.STRING) result.spawner      = sc[9].getString();
  if (sc[10]?.type === TagType.STRING) result.lastModifier = sc[10].getString();
  if (sc[11]?.type === TagType.LONG)  result.seed         = sc[11].getLong();
  if (sc[25]?.type === TagType.STRING) result.currentOwner        = sc[25].getString();
  if (sc[26]?.type === TagType.STRING) result.lastDockerPlayer    = sc[26].getString();

  // Flags optionnels
  if (sc[15]?.type === TagType.BYTE)  result.scrap       = sc[15].getByte() > 0;
  if (sc[16]?.type === TagType.BYTE)  result.vulnerable  = sc[16].getByte() > 0;
  if (sc[17]?.type === TagType.BYTE)  result.minable     = sc[17].getByte() > 0;
  if (sc[18]?.type === TagType.BYTE)  result.factionRights = sc[18].getByte();
  if (sc[20]?.type === TagType.INT)   result.nonEmptySegments = sc[20].getInt();

  // "transformable" substructure (index 6)
  const transformable = sc[6]?.type === TagType.STRUCT ? sc[6] : _findStruct(sc, 'transformable');
  if (transformable) {
    const ts = transformable.getStruct().filter(t => t.type !== TagType.FINISH);
    if (ts[1]?.type === TagType.MATRIX4f) result.transform      = ts[1].getMatrix4f();
    if (ts[3]?.type === TagType.VECTOR3i) result.sectorPosition = ts[3].getVector3i();
    if (ts[4]?.type === TagType.INT)      result.factionCode    = ts[4].getInt();
    if (ts[5]?.type === TagType.STRING)   result.owner          = ts[5].getString();
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _str(tags: Tag[], name: string): string | undefined {
  return tags.find(t => t.name === name && t.type === TagType.STRING)?.getString();
}

function _vec3i(tags: Tag[], name: string): Vector3i | undefined {
  return tags.find(t => t.name === name && t.type === TagType.VECTOR3i)?.getVector3i();
}

function _findStruct(tags: Tag[], name: string): Tag | undefined {
  return tags.find(t => t.name === name && t.type === TagType.STRUCT);
}

function _idx(tags: Tag[], idx: number, type: TagType): string | undefined {
  if (tags[idx]?.type === type) return (tags[idx].value as string);
  return undefined;
}
