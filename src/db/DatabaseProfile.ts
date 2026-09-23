/** @fileoverview Versioned database ordinal and compression contracts. */
/** Explicit wire contracts. Current means StarMade-Open e5a3b49d8; legacy-sdk preserves SDK 2.0.1 ordinals. */
export type DatabaseProfile = 'current' | 'legacy-sdk';

/** Current game fleet command ordinals. */
export const FLEET_COMMAND_TYPES = [
  'IDLE',
  'MOVE_FLEET',
  'PATROL_FLEET',
  'TRADE_FLEET_NPC',
  'TRADE_FLEET_ACTIVE',
  'TRADE_FLEET_WAITING',
  'FLEET_ATTACK',
  'FLEET_DEFEND',
  'ESCORT',
  'REPAIR',
  'STANDOFF',
  'RECON_FLEET',
  'SENTRY_FORMATION',
  'SENTRY',
  'FLEET_IDLE_FORMATION',
  'CALL_TO_CARRIER',
  'MINE_IN_SECTOR',
  'CLOAK',
  'UNCLOAK',
  'JAM',
  'UNJAM',
  'ACTIVATE_REMOTE',
  'INTERDICT',
  'STOP_INTERDICT'
] as const;

/** Historical SDK command ordinals, not a certification of a game version. */
export const LEGACY_FLEET_COMMAND_TYPES = [
  'IDLE',
  'MOVE_FLEET',
  'PATROL_FLEET',
  'TRADE_FLEET',
  'REPAIR_FLEET',
  'FLEET_ATTACK',
  'FLEET_DEFEND',
  'ESCORT',
  'REPAIR',
  'ARTILLERY',
  'SENTRY_FORMATION',
  'SENTRY',
  'FLEET_IDLE_FORMATION',
  'CALL_TO_CARRIER',
  'MINE_IN_SECTOR',
  'CLOAK',
  'UNCLOAK',
  'JAM',
  'UNJAM',
  'ACTIVATE_REMOTE',
  'INTERDICT',
  'STOP_INTERDICT'
] as const;

/** Current game sector ordinals. */
export const SECTOR_TYPES = [
  'SPACE_STATION',
  'ASTEROID',
  'PLANET',
  'MAIN',
  'SUN',
  'BLACK_HOLE',
  'VOID',
  'LOW_ASTEROID',
  'GIANT',
  'DOUBLE_STAR'
] as const;

/** Historical SDK sector ordinals. */
export const LEGACY_SECTOR_TYPES = [
  'SPACE_STATION',
  'ASTEROID',
  'PLANET',
  'GAS_PLANET',
  'MAIN',
  'SUN',
  'BLACK_HOLE',
  'VOID',
  'LOW_ASTEROID',
  'GIANT',
  'DOUBLE_STAR'
] as const;

/** Current game planet ordinals. */
export const PLANET_TYPES = [
  'MARS',
  'EARTH',
  'DESERT',
  'PURPLE',
  'ICE'
] as const;

/** Historical SDK planet labels. */
export const LEGACY_PLANET_TYPES = [
  'ICE',
  'DESERT',
  'TERRAN',
  'GAS_GIANT',
  'TOXIC',
  'LAVA',
  'BARREN'
] as const;

/** Command names available across explicitly selected profiles. */
export type FleetCommandType = typeof FLEET_COMMAND_TYPES[number] | typeof LEGACY_FLEET_COMMAND_TYPES[number];
/** Sector names available across explicitly selected profiles. */
export type SectorType = typeof SECTOR_TYPES[number] | typeof LEGACY_SECTOR_TYPES[number];
/** Planet names available across explicitly selected profiles. */
export type PlanetType = typeof PLANET_TYPES[number] | typeof LEGACY_PLANET_TYPES[number];

/** Ordinal and compression settings for a database profile. */
export interface DatabaseContract {
  /** Command names indexed by wire ordinal. */
  readonly fleetCommands: readonly FleetCommandType[];
  /** Sector names indexed by wire ordinal. */
  readonly sectorTypes: readonly SectorType[];
  /** Planet names indexed by metadata ordinal. */
  readonly planetTypes: readonly PlanetType[];
  /** Whether trade payloads use the historical SDK's raw DEFLATE. */
  readonly rawDeflate: boolean;
}

/** Select a contract explicitly; never guess a profile from ambiguous ordinals. */
export function getDatabaseProfile(profile: DatabaseProfile = 'current'): DatabaseContract {
  if (profile === 'current') return { fleetCommands: FLEET_COMMAND_TYPES, sectorTypes: SECTOR_TYPES, planetTypes: PLANET_TYPES, rawDeflate: false };
  if (profile === 'legacy-sdk') return { fleetCommands: LEGACY_FLEET_COMMAND_TYPES, sectorTypes: LEGACY_SECTOR_TYPES, planetTypes: LEGACY_PLANET_TYPES, rawDeflate: true };
  throw new RangeError(`Unknown database profile: ${profile}`);
}
