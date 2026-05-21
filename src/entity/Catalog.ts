/**
 * @fileoverview Catalog
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Catalog — parser for CATALOG.cat
 *
 * Structure Java :
 *   STRUCT [
 *     "pv0" STRUCT — player catalog entries
 *     "r0"  STRUCT — NPC/system catalog entries
 *   ]
 * Each child struct contains blueprint entries.
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';

/**
 * Describes the CatalogEntry data shape used by legacy typed entity parsing.
 */
export interface CatalogEntry {
  uid?: string;
  name?: string;
  description?: string;
  price?: number;
  mass?: number;
  style?: number;
  category?: string;
}

/**
 * Describes the CatalogData data shape used by legacy typed entity parsing.
 */
export interface CatalogData {
  playerEntries: CatalogEntry[];
  systemEntries: CatalogEntry[];
  totalCount: number;
}

/**
 * Parses a root tag from CATALOG.cat
 */
export function parseCatalog(root: Tag): CatalogData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`Catalog: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
  const playerEntries: CatalogEntry[] = [];
  const systemEntries: CatalogEntry[] = [];

  for (const section of s) {
    if (section.type !== TagType.STRUCT) continue;
    const target = section.name?.startsWith('pv') ? playerEntries : systemEntries;
    const entries = section.getStruct().filter(t => t.type !== TagType.FINISH);
    for (const entry of entries) {
      if (entry.type !== TagType.STRUCT) continue;
      target.push(_parseEntry(entry));
    }
  }

  return { playerEntries, systemEntries, totalCount: playerEntries.length + systemEntries.length };
}

/**
 * Parses Entry for legacy typed entity parsing.
 *
 * @param tag - Input value for the _parseEntry operation.
 * @returns The computed StarMade-Decoder value.
 */
function _parseEntry(tag: Tag): CatalogEntry {
  const entry: CatalogEntry = {};
  const fields = tag.getStruct().filter(t => t.type !== TagType.FINISH);
  for (const f of fields) {
    if (f.name === 'cv0' && f.type === TagType.STRUCT) {
      // struct catalog entry interne
      const inner = f.getStruct().filter(t => t.type !== TagType.FINISH);
      for (const fi of inner) {
        if (fi.type === TagType.STRING && !entry.uid) entry.uid = fi.getString();
        else if (fi.type === TagType.STRING && !entry.name) entry.name = fi.getString();
        else if (fi.type === TagType.STRING) entry.description = fi.getString();
        else if (fi.type === TagType.INT && entry.price === undefined) entry.price = fi.getInt();
        else if (fi.type === TagType.FLOAT) entry.mass = fi.getFloat();
        else if (fi.type === TagType.BYTE) entry.style = fi.getByte();
      }
    }
    if (f.type === TagType.STRING && !entry.uid) entry.uid = f.getString();
    if (f.type === TagType.STRING && !entry.name) entry.name = f.getString();
    if (f.type === TagType.STRING) entry.description = f.getString();
    if (f.type === TagType.INT && entry.price === undefined) entry.price = f.getInt();
    if (f.type === TagType.FLOAT) entry.mass = f.getFloat();
  }
  return entry;
}
