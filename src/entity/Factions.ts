/**
 * @fileoverview Factions
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Factions — parser for FACTIONS.fac
 *
 * Structure Java (FactionManager.fromTagStructure) :
 *   STRUCT [
 *     [0] BYTE    version
 *     [1] STRUCT  factions list
 *         each faction = STRUCT [
 *           INT  factionId
 *           STRING name
 *           LONG credits
 *           BYTE factionType (0=player, 1=npc, ...)
 *           ... members, relations, news, etc.
 *         ]
 *     ...
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';

export interface FactionEntry {
  id: number;
  name?: string;
  credits?: bigint;
  factionType?: number;
  memberCount?: number;
}

export interface FactionsData {
  version: number;
  factions: FactionEntry[];
  totalCount: number;
}

/**
 * Parses a root tag from FACTIONS.fac
 */
export function parseFactions(root: Tag): FactionsData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`Factions: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
  const factions: FactionEntry[] = [];

  // Iterate over child structs that represent factions
  for (let i = 1; i < s.length; i++) {
    if (s[i].type !== TagType.STRUCT) continue;
    const fs = s[i].getStruct().filter(t => t.type !== TagType.FINISH);
    if (fs.length === 0) continue;

    const entry: FactionEntry = {
      id: fs[0]?.type === TagType.INT ? fs[0].getInt() : i,
    };

    // Find fields by type/order
    for (const ft of fs) {
      if (ft.type === TagType.STRING && !entry.name) {
        entry.name = ft.getString();
      }
      if (ft.type === TagType.LONG && entry.credits === undefined) {
        entry.credits = ft.getLong();
      }
      if (ft.type === TagType.BYTE && entry.factionType === undefined) {
        entry.factionType = ft.getByte();
      }
    }

    // Count members (child struct containing INT member IDs)
    const memberStruct = fs.find(t => t.type === TagType.STRUCT);
    if (memberStruct) {
      const ms = memberStruct.getStruct().filter(t => t.type !== TagType.FINISH);
      entry.memberCount = ms.length;
    }

    factions.push(entry);
  }

  return { version, factions, totalCount: factions.length };
}
