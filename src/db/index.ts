/**
 * @fileoverview DB Module Exports
 *
 * Decoders and encoders for VARBINARY columns in the StarMade HSQLDB
 * that contain custom binary-serialized data.
 *
 * @author InitSysRev
 * @version 1.1.0
 */

export {
  // FleetCommand (FLEETS.COMMAND)
  decodeFleetCommand,
  encodeFleetCommand,
  // Fleet remotes (FLEETS.SAVED_REMOTES)
  decodeFleetRemotes,
  encodeFleetRemotes,
  // Constants + types
  FLEET_COMMAND_TYPES,
  CMD_TYPES,
} from './FleetDb.js';
export type {
  FleetCommand,
  FleetRemotes,
  FleetCommandType,
  CommandArg,
} from './FleetDb.js';

// ── Business objects ──────────────────────────────────────────────────────────
export { FleetCommandObject } from './FleetCommandObject.js';
export { FleetRemotesObject } from './FleetRemotesObject.js';
export { SectorItemsObject }  from './SectorItemsObject.js';
export { TradePricesObject }  from './TradePricesObject.js';
export { StarSystem }         from './StarSystemObject.js';

export {
  decodeSectorItems,
  encodeSectorItems,
  FREE_ITEM_BYTE_SIZE,
  MAX_ITEMS_PER_SECTOR,
} from './SectorItems.js';
export type { FreeItem } from './SectorItems.js';

export {
  decodeTradeNodeItems,
  encodeTradeNodeItems,
} from './TradeNodeItems.js';
export type { TradePrices, TradePriceEntry } from './TradeNodeItems.js';

export {
  decodeSystemInfos,
  encodeSystemInfos,
  decodeSystemResources,
  encodeSystemResources,
  systemIndexToCoords,
  systemCoordsToIndex,
  SYSTEM_SIZE,
  SECTOR_DATA_SIZE,
  SYSTEM_INFOS_SIZE,
  RESOURCE_COUNT,
  SECTOR_TYPES,
  PLANET_TYPES,
  RESOURCE_ITEM_IDS,
} from './SystemDb.js';
export type { SectorInfo, SectorType, PlanetType, SystemResource } from './SystemDb.js';

export {
  parseWorldSeed,
  writeWorldSeed,
} from './WorldSeed.js';
export type { WorldSeedFile } from './WorldSeed.js';

export {
  parsePersistentObjects,
  writePersistentObjects,
} from './PersistentObjects.js';
export type { PersistentObjectFile, PersistentObjectEntry } from './PersistentObjects.js';
