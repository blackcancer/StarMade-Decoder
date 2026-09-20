/**
 * @fileoverview Typed projection of archived metadata objects grouped by sector.
 * Delegates validation to the lossless archive model so both APIs use the game's
 * INT identifier, SHORT type, opaque Tag payload and optional SHORT subtype.
 * @author InitSysRev
 * @version 2.0.0
 */

import { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';
import { FloatingItemsArchive, type FloatingItemPosition } from '../objects/FloatingItems.js';

/** A distinct metadata object and its containing sector; the payload is detached. */
export interface FloatingItemEntry {
  id: number;
  type: number;
  subObjectId: number;
  payload: Tag;
  sector: FloatingItemPosition;
}

/** One archived sector, including sectors that currently contain no objects. */
export interface FloatingItemSectorData {
  position: FloatingItemPosition;
  items: FloatingItemEntry[];
}

/** Semantic archive projection; nextId is an identifier counter, never a quantity. */
export interface FloatingItemsData {
  version: number;
  nextId: number;
  format: 'modern' | 'legacy';
  sectors: FloatingItemSectorData[];
  items: FloatingItemEntry[];
}

/** Parses a complete metadata archive and returns a detached typed projection. */
export function parseFloatingItems(root: Tag): FloatingItemsData {
  if (root.type !== TagType.STRUCT) {
    throw new TypeError(`FloatingItems: expected STRUCT root, got ${root.type}`);
  }

  const archive = FloatingItemsArchive.fromTag(root);
  const sectors = archive.sectors.map(group => ({ position: group.position,
    items: group.items.map(item => ({ id: item.id, type: item.blockType, subObjectId: item.subObjectId,
      payload: item.payload, sector: group.position })),
  }));
  return { version: archive.version, nextId: archive.nextId, format: archive.format,
    sectors, items: sectors.flatMap(group => group.items) };
}
