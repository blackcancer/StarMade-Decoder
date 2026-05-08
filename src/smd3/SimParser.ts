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

export interface SimGroup {
  /** Raw simulation group Tag */
  raw: Tag;
}

export interface SimFile {
  version: number;
  groups: SimGroup[];
  lastUpdate?: bigint;
  /** Raw root Tag */
  rootTag: Tag;
}

export function parseSim(data: Buffer | Uint8Array): SimFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const root = readFrom(buf);

  const result: SimFile = { version: 0, groups: [], rootTag: root };

  if (root.type !== TagType.STRUCT) return result;

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  if (s[0]?.type === TagType.BYTE)  result.version    = s[0].getByte();
  if (s[2]?.type === TagType.LONG)  result.lastUpdate = s[2].getLong();

  // [1] Simulation group STRUCT
  if (s[1]?.type === TagType.STRUCT) {
    for (const g of s[1].getStruct().filter(t => t.type !== TagType.FINISH)) {
      result.groups.push({ raw: g });
    }
  }

  return result;
}
