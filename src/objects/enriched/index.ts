/**
 * @fileoverview Enriched Views Exports
 *
 * Exports BlockConfig-enriched object helpers and rich view classes.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Exports enriched views.
 */
export {
  enrichControlLinks, enrichBlockCounts, getBlockCountStats,
  enrichSegment, enrichSmd3, getSegmentStats,
  enrichInventory, RichSegmentController,
} from './RichViews.js';
export type {
  ControlLinkRich, BlockCountRich, BlockCountStats,
  BlockDataRich, SegmentStats, ItemStackRich,
} from './RichViews.js';
