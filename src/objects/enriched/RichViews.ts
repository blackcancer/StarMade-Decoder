/**
 * @fileoverview BlockConfig-Enriched Object Views
 *
 * Builds high-level views that resolve raw StarMade block identifiers into BlockConfig definitions, names, and aggregate statistics.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Enriched views add BlockConfig information to existing domain classes.
 *
 * Pattern: each view wraps the original object and exposes additional helpers
 * that use BlockRegistry to resolve human-readable block names and metadata.
 *
 * These classes are purely additive: they never mutate the base objects.
 *
 * Usage:
 *   BlockRegistry.init(BlockConfig.load(cfg));
 *   const rich = new RichSegmentController(ship);
 *   rich.controlLinks       // ControlLinkRich[] with blockName and blockDef
 *   rich.blockStats.byType  // BlockCountRich[] with mass, price, and HP totals
 *   enrichSmd3(smd3File)    // RichBlockData[] with blockName, hp, and mass
 */

import { BlockRegistry } from '../../config/BlockRegistry.js';
import type { BlockDefinition } from '../../config/BlockConfig.js';
import type { ControlLink, BlockCount } from '../Serializables.js';
import type { ControlElementMapper, ElementCountMap } from '../Serializables.js';
import { indexToPos as smd3IndexToPos } from '../../smd3/Smd3Parser.js';
import type { BlockData, Smd3File, SegmentData } from '../../smd3/Smd3Parser.js';
import type { ItemStack, Inventory } from '../components/Inventory.js';
import type { SegmentController } from '../entities/SegmentController.js';
import type { BlockPosition } from '../ElementPosition.js';

// ── Enriched Control Links ───────────────────────────────────────────────────

export interface ControlLinkRich {
  /** Original control-link payload. */
  readonly link: ControlLink;
  /** Controlled block name resolved from BlockConfig. */
  readonly blockName: string;
  /** Full block definition, or null when no registry entry exists. */
  readonly blockDef: BlockDefinition | null;
}

export function enrichControlLinks(mapper: ControlElementMapper): ControlLinkRich[] {
  return mapper.links.map(link => ({
    link,
    blockName: BlockRegistry.getName(link.type),
    blockDef:  BlockRegistry.get(link.type),
  }));
}

// ── Enriched Block Counts ─────────────────────────────────────────────────────

export interface BlockCountRich {
  /** Original block-count payload. */
  readonly count: BlockCount;
  /** Resolved block name. */
  readonly blockName: string;
  /** Total mass contributed by this block type. */
  readonly totalMass: number;
  /** Total price contributed by this block type. */
  readonly totalPrice: number;
  /** Total hit points contributed by this block type. */
  readonly totalHp: number;
  /** Full block definition, or null for unknown block types. */
  readonly blockDef: BlockDefinition | null;
}

export function enrichBlockCounts(ecm: ElementCountMap): BlockCountRich[] {
  return ecm.counts
    .filter(c => c.count > 0)
    .map(c => {
      const def = BlockRegistry.get(c.type);
      return {
        count:      c,
        blockName:  def?.name ?? `block#${c.type}`,
        totalMass:  (def?.mass  ?? 0) * c.count,
        totalPrice: (def?.price ?? 0) * c.count,
        totalHp:    (def?.hp    ?? 0) * c.count,
        blockDef:   def ?? null,
      };
    })
    .sort((a, b) => b.count.count - a.count.count);
}

/** Aggregate statistics computed from an ElementCountMap. */
export interface BlockCountStats {
  totalBlocks: number;
  totalMass:   number;
  totalPrice:  number;
  totalHp:     number;
  byType:      BlockCountRich[];
}

export function getBlockCountStats(ecm: ElementCountMap): BlockCountStats {
  const entries = enrichBlockCounts(ecm);
  return {
    totalBlocks: entries.reduce((s, e) => s + e.count.count, 0),
    totalMass:   entries.reduce((s, e) => s + e.totalMass, 0),
    totalPrice:  entries.reduce((s, e) => s + e.totalPrice, 0),
    totalHp:     entries.reduce((s, e) => s + e.totalHp, 0),
    byType:      entries,
  };
}

// ── Enriched .smd3 Block Data ────────────────────────────────────────────────

export interface BlockDataRich {
  /** Local position within the segment. */
  readonly position: BlockPosition;
  /** Original block payload. */
  readonly block: BlockData;
  /** Resolved block name. */
  readonly blockName: string;
  /** Full block definition, or null for unknown block types. */
  readonly blockDef: BlockDefinition | null;
}

/**
 * Enriches all non-empty blocks in a segment.
 */
export function enrichSegment(seg: SegmentData): BlockDataRich[] {
  const result: BlockDataRich[] = [];
  for (let i = 0; i < seg.blocks.length; i++) {
    const block = seg.blocks[i];
    if (block.type === 0) continue;
    const def = BlockRegistry.get(block.type);
    result.push({
      position:  smd3IndexToPos(i),
      block,
      blockName: def?.name ?? `block#${block.type}`,
      blockDef:  def ?? null,
    });
  }
  return result;
}

/**
 * Enriches every segment of a parsed .smd3 file.
 */
export function enrichSmd3(smd3: Smd3File): Array<{ segment: SegmentData; blocks: BlockDataRich[] }> {
  return smd3.segments.map(seg => ({
    segment: seg,
    blocks:  enrichSegment(seg),
  }));
}

/** Statistics computed for an enriched segment. */
export interface SegmentStats {
  totalBlocks:    number;
  uniqueTypes:    number;
  totalMass:      number;
  topTypes:       Array<{ type: number; name: string; count: number; mass: number }>;
}

export function getSegmentStats(seg: SegmentData): SegmentStats {
  const typeCounts = new Map<number, number>();
  for (const b of seg.blocks) {
    if (b.type !== 0) typeCounts.set(b.type, (typeCounts.get(b.type) ?? 0) + 1);
  }

  let totalMass = 0;
  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const def  = BlockRegistry.get(type);
      const mass = (def?.mass ?? 0) * count;
      totalMass += mass;
      return { type, name: def?.name ?? `block#${type}`, count, mass };
    });

  return {
    totalBlocks: seg.blockCount,
    uniqueTypes: typeCounts.size,
    totalMass,
    topTypes,
  };
}

// ── Enriched Item Stacks ─────────────────────────────────────────────────────

export interface ItemStackRich {
  readonly item: ItemStack;
  readonly blockName: string;
  readonly totalMass:  number;
  readonly totalPrice: number;
  readonly blockDef:   BlockDefinition | null;
}

export function enrichInventory(inventory: Inventory): ItemStackRich[] {
  return inventory.items.map(item => {
    const def = BlockRegistry.get(item.type);
    return {
      item,
      blockName:  def?.name  ?? `block#${item.type}`,
      totalMass:  (def?.mass  ?? 0) * item.count,
      totalPrice: (def?.price ?? 0) * item.count,
      blockDef:   def ?? null,
    };
  });
}

// ── RichSegmentController Entity View ────────────────────────────────────────

export class RichSegmentController {
  constructor(private readonly entity: SegmentController) {}

  /** Control links enriched with block names and definitions. */
  get controlLinks(): ControlLinkRich[] {
    return enrichControlLinks(this.entity.controlElementMap);
  }

  /** Enriched block statistics from the ManagerContainer ElementCountMap. */
  get blockStats(): BlockCountStats | null {
    const ecm = this.entity.managerContainer?.relevantElementCountMap ?? null;
    return ecm ? getBlockCountStats(ecm) : null;
  }

  /**
   * Analyzes the blocks of a .smd3 file associated with this entity.
   * @param smd3File Parsed .smd3 file loaded via parseSmd3().
   */
  analyzeSmd3(smd3File: Smd3File): SegmentStats[] {
    return smd3File.segments.map(getSegmentStats);
  }

  /** Compact entity summary using resolved block names. */
  summary(): {
    uniqueId:    string;
    realName:    string;
    entityType:  string;
    sector:      string;
    factionId:   number;
    controlLinks: number;
    topControlTypes: string[];
  } {
    const topTypes = [...new Set(this.entity.controlElementMap.links.map(l => l.type))]
      .slice(0, 5)
      .map(t => BlockRegistry.getName(t));

    return {
      uniqueId:    this.entity.uniqueId,
      realName:    this.entity.realName,
      entityType:  this.entity.entityType,
      sector:      this.entity.sectorPosition.toString(),
      factionId:   this.entity.factionId,
      controlLinks: this.entity.controlElementMap.links.length,
      topControlTypes: topTypes,
    };
  }
}
