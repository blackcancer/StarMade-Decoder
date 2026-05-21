/**
 * @fileoverview Config  Module  Exports
 *
 * Handles StarMade configuration data with typed accessors, immutable updates, and serialization helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * index.ts — public exports for the config module
 */
export { SMToolConfig }         from './SMToolConfig.js';
export type { SMToolConfigData, StarMadePaths } from './SMToolConfig.js';

export { ServerConfig, SERVER_CONFIG_SCHEMA } from './ServerConfig.js';
export type { ConfigEntryMeta, ConfigValueType, ConfigValue } from './ServerConfig.js';

export { BlockConfig, BlockDefinition } from './BlockConfig.js';

export { BlockBehaviorConfig } from './BlockBehaviorConfig.js';
export type { BehaviorValue } from './BlockBehaviorConfig.js';

export { FactionConfig } from './FactionConfig.js';
export type { FactionConfigValue } from './FactionConfig.js';
export { BlockRegistry } from './BlockRegistry.js';

export {
  parseSystemNames,
  writeSystemNames,
} from './SystemNames.js';
export type { SystemNamesFile, SystemNameSyllable } from './SystemNames.js';
