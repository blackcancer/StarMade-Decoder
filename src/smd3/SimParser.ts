/**
 * @fileoverview Sim Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SimParser — parser for .sim files (simulation state).
 *
 * A .sim is simply a standard binary Tag file.
 * It is parsed with readFrom(), then semantic fields are extracted.
 *
 * Structure Java (SimulationManager.toTagStructure) :
 *   STRUCT "SimulationState" [
 *     BYTE    version
 *     STRUCT  simulationGroups
 *     LONG    lastUpdate
 *     FINISH
 *   ]
 */

import { readFrom } from '../core/TagParser.js';
import { TagType } from '../core/TagType.js';
import type { Tag } from '../core/Tag.js';
import type { Vector3i } from '../types/Vectors.js';
import { SimulationGroup as SimulationGroupObject, SimulationState } from '../objects/Simulation.js';

/**
 * Describes the SimGroup data shape used by StarMade blueprint and segment file parsing.
 */
export interface SimGroup {
  version: number;
  type: number;
  members: string[];
  startTime: bigint;
  startSector: Vector3i | null;
  programId: number;
  /** @deprecated raw fallback tag for unknown group fields. Prefer the typed fields above. */
  raw: Tag;
}

/**
 * Describes the SimFile data shape used by StarMade blueprint and segment file parsing.
 */
export interface SimFile {
  version: number;
  groups: SimGroup[];
  lastUpdate?: bigint;
  /** High-level simulation state, when the root tag is parseable. */
  simulation?: SimulationState | null;
  /** @deprecated raw fallback tag for unknown fields. Prefer simulation/version/groups/lastUpdate. */
  rootTag: Tag;
}

/**
 * Parses Sim for StarMade blueprint and segment file parsing.
 *
 * @param data - Input value for the parseSim operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSim(data: Buffer | Uint8Array): SimFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const root = readFrom(buf);

  const result: SimFile = { version: 0, groups: [], simulation: null, rootTag: root };

  if (root.type !== TagType.STRUCT) return result;

  try {
    const simulation = SimulationState.fromTag(root);
    const rootChildren = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const rawGroups = rootChildren[1]?.type === TagType.STRUCT
      ? rootChildren[1].getStruct().filter(t => t.type !== TagType.FINISH)
      : [];
    result.simulation = simulation;
    result.version = simulation.version;
    result.lastUpdate = simulation.lastUpdate;
    result.groups = simulation.groups.map((group, index) => ({
      version: group.version,
      type: group.type,
      members: [...group.members],
      startTime: group.startTime,
      startSector: group.startSector,
      programId: group.programId,
      raw: rawGroups[index] ?? group.toTag(),
    }));
    return result;
  } catch {
    result.simulation = null;
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  if (s[0]?.type === TagType.BYTE)  result.version    = s[0].getByte();
  if (s[2]?.type === TagType.LONG)  result.lastUpdate = s[2].getLong();

  // [1] Simulation group STRUCT
  if (s[1]?.type === TagType.STRUCT) {
    for (const g of s[1].getStruct().filter(t => t.type !== TagType.FINISH)) {
      if (g.type === TagType.STRUCT) {
        try {
          const group = SimulationGroupObject.fromTag(g);
          result.groups.push({
            version: group.version,
            type: group.type,
            members: [...group.members],
            startTime: group.startTime,
            startSector: group.startSector,
            programId: group.programId,
            raw: g,
          });
          continue;
        } catch {
          // Fall through to a default typed shell preserving the raw tag.
        }
      }
      result.groups.push({
        version: 0,
        type: 0,
        members: [],
        startTime: 0n,
        startSector: null,
        programId: 0,
        raw: g,
      });
    }
  }

  return result;
}
