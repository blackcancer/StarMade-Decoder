/** @fileoverview Plain JSON-safe projection of actual catalog permissions and ratings. */
import type { Tag } from '../core/Tag.js';
import { Catalog, type CatalogOptions } from '../objects/Catalog.js';

/** Exact catalog entry data; 64-bit values are decimal strings in the JSON projection. */
export type CatalogEntry = ReturnType<import('../objects/Catalog.js').CatalogEntry['toJSON']>;
/** Catalog permissions and per-blueprint/per-user ratings are distinct collections. */
export interface CatalogData {
  entries: CatalogEntry[];
  ratings: Record<string,Record<string,number>>;
  totalCount: number;
}
/** Projects validated wire data without inventing system entries or treating permission flags as price. */
export function parseCatalog(root:Tag,options:CatalogOptions={}):CatalogData {
  const model=Catalog.fromTag(root,options), data=model.toJSON();
  return {...data,totalCount:model.entries.length};
}
