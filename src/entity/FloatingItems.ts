/**
 * @fileoverview Floating Items
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * FloatingItems — parser for FLOATING_ITEMS_ARCHIVE.ent
 *
 * Structure :
 *   STRUCT [
 *     BYTE  version
 *     INT   count
 *     STRUCT "floatingItems" [
 *       items...
 *     ]
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';

/**
 * Describes the FloatingItemEntry data shape used by legacy typed entity parsing.
 */
export interface FloatingItemEntry {
  type?: number;
  count?: number;
}

/**
 * Describes the FloatingItemsData data shape used by legacy typed entity parsing.
 */
export interface FloatingItemsData {
  version: number;
  declaredCount: number;
  items: FloatingItemEntry[];
}

/**
 * Parses a root tag from FLOATING_ITEMS_ARCHIVE.ent
 */
export function parseFloatingItems(root: Tag): FloatingItemsData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`FloatingItems: expected STRUCT root, got ${root.type}`);
  }

  const s = root.getStruct().filter(t => t.type !== TagType.FINISH);

  const version        = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
  const declaredCount  = s[1]?.type === TagType.INT  ? s[1].getInt()  : 0;

  const items: FloatingItemEntry[] = [];
  const itemsStruct = s.find(t => t.name === 'floatingItems' && t.type === TagType.STRUCT);
  if (itemsStruct) {
    for (const item of itemsStruct.getStruct().filter(t => t.type !== TagType.FINISH)) {
      if (item.type === TagType.STRUCT) {
        const fs = item.getStruct().filter(t => t.type !== TagType.FINISH);
        items.push({
          type:  fs[0]?.type === TagType.SHORT ? fs[0].getShort() : undefined,
          count: fs[1]?.type === TagType.INT   ? fs[1].getInt()   : undefined,
        });
      }
    }
  }

  return { version, declaredCount, items };
}
