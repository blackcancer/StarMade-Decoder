/**
 * @fileoverview Runtime Block Definition Registry
 *
 * Provides process-wide lookup helpers for block names, definitions, and numeric properties used by enriched views.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Global BlockDefinition registry.
 *
 * This optional singleton lets any class carrying StarMade block type IDs
 * resolve names and numeric properties once a BlockConfig has been loaded.
 *
 * Usage:
 *   BlockRegistry.init(BlockConfig.load(cfg));
 *   const name = BlockRegistry.getName(1);  // → "Ship Core"
 *
 * Without initialization, BlockRegistry.getName(id) safely returns "block#id".
 */

import type { BlockConfig, BlockDefinition } from './BlockConfig.js';

/**
 * Represents the BlockRegistry model used by StarMade configuration loading, editing, and metadata enrichment.
 */
export class BlockRegistry {
  private static _config: BlockConfig | null = null;

  /** Initializes the global registry. This may be called multiple times. */
  static init(config: BlockConfig): void {
    BlockRegistry._config = config;
  }

  /** Returns true when the registry has been initialized. */
  static get isInitialized(): boolean { return BlockRegistry._config !== null; }

  /** Returns the BlockDefinition for an ID, or null when the ID is unknown. */
  static get(id: number): BlockDefinition | null {
    return BlockRegistry._config?.getById(id) ?? null;
  }

  /** Returns the block name for an ID, or "block#id" when the ID is unknown. */
  static getName(id: number): string {
    return BlockRegistry._config?.getById(id)?.name ?? `block#${id}`;
  }

  /** Returns the block hit points, or null when the ID is unknown. */
  static getHp(id: number): number | null {
    return BlockRegistry._config?.getById(id)?.hp ?? null;
  }

  /** Returns the block mass, or null when the ID is unknown. */
  static getMass(id: number): number | null {
    return BlockRegistry._config?.getById(id)?.mass ?? null;
  }

  /** Returns the block price, or null when the ID is unknown. */
  static getPrice(id: number): number | null {
    return BlockRegistry._config?.getById(id)?.price ?? null;
  }

  /** Resets the registry, primarily for tests. */
  static reset(): void {
    BlockRegistry._config = null;
  }
}
