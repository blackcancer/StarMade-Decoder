/**
 * @fileoverview Typed faction summaries from the actual v0/v1/v2 manager layouts.
 * Source contract: StarMade-Open decf3a1, FactionManager.fromTagStructure and Faction.
 * Presets, invitations and news are never inferred to be factions by field type.
 */
import { Tag } from '../core/Tag.js';
import { FactionManager } from '../objects/Factions.js';
import type { TagReadOptions } from '../core/TagParser.js';

/** A faction summary. Credits have no field in this format and are never fabricated. */
export interface FactionEntry {
  id: number;
  name?: string;
  /** Retained for source compatibility; this parser does not populate this field. */
  credits?: bigint;
  /** SDK category: 0 for other factions, 1 for the Java NPC-faction ID interval. */
  factionType?: number;
  memberCount?: number;
}

/** Summary of the represented manager collections. */
export interface FactionsData {
  version: number;
  factions: FactionEntry[];
  totalCount: number;
}

/** Reads the same complete layout as the editable model, without losing nested faction entries. */
export function parseFactions(root: Tag, options: TagReadOptions = {}): FactionsData {
  const manager = FactionManager.fromTag(root, options);
  const factions = manager.all.map(faction => ({ id: faction.id, name: faction.name,
    factionType: faction.isNPC ? 1 : 0, memberCount: faction.memberCount }));
  return { version: manager.version, factions, totalCount: factions.length };
}
