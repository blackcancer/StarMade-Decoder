/**
 * @fileoverview Server Config
 *
 * Handles StarMade configuration data with typed accessors, immutable updates, and serialization helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * ServerConfig — reader and writer for the StarMade server.cfg file.
 *
 * Affected files :
 *   - starmadeDir/server.cfg                          READ + WRITE (config live)
 *   - starmadeDir/data/config/defaultSettings/server.cfg  READ ONLY (template)
 *
 * Format: key = value properties // comment
 * Faithful port of ServerConfig.java (enum metadata with type and default value).
 *
 * Source: org.schema.game.server.data.ServerConfig
 */

import fs from 'fs';
import path from 'path';
import type { SMToolConfig } from './SMToolConfig.js';

// ── Metadata by key (type + default) — port ServerConfig.java ────────────

/**
 * Defines the ConfigValueType type used by StarMade configuration loading, editing, and metadata enrichment.
 */
export type ConfigValueType = 'string' | 'boolean' | 'number' | 'float';

/**
 * Describes the ConfigEntryMeta data shape used by StarMade configuration loading, editing, and metadata enrichment.
 */
export interface ConfigEntryMeta {
  type: ConfigValueType;
  default: string | boolean | number;
}

/** Complete port of the 196 ServerConfig.java entries */
export const SERVER_CONFIG_SCHEMA: Readonly<Record<string, ConfigEntryMeta>> = {
  WORLD:                                     { type: 'string',  default: 'unset' },
  PROTECT_STARTING_SECTOR:                   { type: 'boolean', default: false },
  ENABLE_SIMULATION:                         { type: 'boolean', default: true },
  ALLOW_CUSTOM_IMAGES:                       { type: 'boolean', default: true },
  CONCURRENT_SIMULATION:                     { type: 'number',  default: 256 },
  BLUEPRINTS_USE_COMPONENTS:                 { type: 'boolean', default: true },
  ENEMY_SPAWNING:                            { type: 'boolean', default: true },
  SECTOR_SIZE:                               { type: 'number',  default: 10000 },
  BLUEPRINT_DEFAULT_PRIVATE:                 { type: 'boolean', default: true },
  FLOATING_ITEM_LIFETIME_SECS:               { type: 'number',  default: 240 },
  SIMULATION_SPAWN_DELAY:                    { type: 'number',  default: 420 },
  SIMULATION_TRADING_FILLS_SHOPS:            { type: 'boolean', default: true },
  SECTOR_INACTIVE_TIMEOUT:                   { type: 'number',  default: 20 },
  SECTOR_INACTIVE_CLEANUP_TIMEOUT:           { type: 'number',  default: 10 },
  USE_STARMADE_AUTHENTICATION:               { type: 'boolean', default: false },
  REQUIRE_STARMADE_AUTHENTICATION:           { type: 'boolean', default: false },
  PROTECTED_NAMES_BY_ACCOUNT:               { type: 'number',  default: 10 },
  DEFAULT_BLUEPRINT_ENEMY_USE:               { type: 'boolean', default: true },
  DEFAULT_BLUEPRINT_FACTION_BUY:             { type: 'boolean', default: true },
  DEFAULT_BLUEPRINT_OTHERS_BUY:              { type: 'boolean', default: true },
  DEFAULT_BLUEPRINT_HOME_BASE_BUY:           { type: 'boolean', default: true },
  LOCK_FACTION_SHIPS:                        { type: 'boolean', default: true },
  CATALOG_SLOTS_PER_PLAYER:                  { type: 'number',  default: -1 },
  UNIVERSE_DAY_IN_MS:                        { type: 'number',  default: 1200000 },
  ASTEROIDS_ENABLE_DYNAMIC_PHYSICS:          { type: 'boolean', default: true },
  ENABLE_BREAK_OFF:                          { type: 'boolean', default: false },
  COLLISION_DAMAGE:                          { type: 'boolean', default: false },
  COLLISION_DAMAGE_THRESHOLD:                { type: 'float',   default: 2.0 },
  SKIN_ALLOW_UPLOAD:                         { type: 'boolean', default: true },
  CATALOG_NAME_COLLISION_HANDLING:           { type: 'boolean', default: false },
  SECTOR_AUTOSAVE_SEC:                       { type: 'number',  default: 300 },
  PHYSICS_SLOWDOWN_THRESHOLD:                { type: 'number',  default: 40 },
  THRUST_SPEED_LIMIT:                        { type: 'number',  default: 75 },
  MAX_CLIENTS:                               { type: 'number',  default: 32 },
  SUPER_ADMIN_PASSWORD_USE:                  { type: 'boolean', default: false },
  SUPER_ADMIN_PASSWORD:                      { type: 'string',  default: 'mypassword' },
  SERVER_LISTEN_IP:                          { type: 'string',  default: 'all' },
  SOCKET_BUFFER_SIZE:                        { type: 'number',  default: 65536 },
  PHYSICS_LINEAR_DAMPING:                    { type: 'float',   default: 0.05 },
  PHYSICS_ROTATIONAL_DAMPING:                { type: 'float',   default: 0.05 },
  AI_DESTRUCTION_LOOT_COUNT_MULTIPLIER:      { type: 'float',   default: 0.9 },
  AI_DESTRUCTION_LOOT_STACK_MULTIPLIER:      { type: 'float',   default: 0.9 },
  CHEST_LOOT_COUNT_MULTIPLIER:               { type: 'float',   default: 0.9 },
  CHEST_LOOT_STACK_MULTIPLIER:               { type: 'float',   default: 0.9 },
  USE_WHITELIST:                             { type: 'boolean', default: false },
  FILTER_CONNECTION_MESSAGES:                { type: 'boolean', default: false },
  USE_UDP:                                   { type: 'boolean', default: false },
  AUTO_KICK_MODIFIED_BLUEPRINT_USE:          { type: 'boolean', default: false },
  AUTO_BAN_ID_MODIFIED_BLUEPRINT_USE:        { type: 'boolean', default: false },
  AUTO_BAN_IP_MODIFIED_BLUEPRINT_USE:        { type: 'boolean', default: false },
  AUTO_BAN_TIME_IN_MINUTES:                  { type: 'number',  default: 60 },
  REMOVE_MODIFIED_BLUEPRINTS:                { type: 'boolean', default: false },
  TCP_NODELAY:                               { type: 'boolean', default: true },
  PING_FLUSH:                                { type: 'boolean', default: false },
  SHOP_SPAWNING_PROBABILITY:                 { type: 'float',   default: 0.01 },
  DEFAULT_SPAWN_SECTOR_X:                    { type: 'number',  default: 2 },
  DEFAULT_SPAWN_SECTOR_Y:                    { type: 'number',  default: 2 },
  DEFAULT_SPAWN_SECTOR_Z:                    { type: 'number',  default: 2 },
  MODIFIED_BLUEPRINT_TOLERANCE:              { type: 'float',   default: 0.1 },
  DEFAULT_SPAWN_POINT_X_1:                   { type: 'float',   default: -6.0 },
  DEFAULT_SPAWN_POINT_Y_1:                   { type: 'float',   default: 251.5 },
  DEFAULT_SPAWN_POINT_Z_1:                   { type: 'float',   default: 0.0 },
  DEFAULT_SPAWN_POINT_X_2:                   { type: 'float',   default: -6.0 },
  DEFAULT_SPAWN_POINT_Y_2:                   { type: 'float',   default: 251.5 },
  DEFAULT_SPAWN_POINT_Z_2:                   { type: 'float',   default: 0.0 },
  DEFAULT_SPAWN_POINT_X_3:                   { type: 'float',   default: -6.0 },
  DEFAULT_SPAWN_POINT_Y_3:                   { type: 'float',   default: 251.0 },
  DEFAULT_SPAWN_POINT_Z_3:                   { type: 'float',   default: 0.0 },
  DEFAULT_SPAWN_POINT_X_4:                   { type: 'float',   default: -6.0 },
  DEFAULT_SPAWN_POINT_Y_4:                   { type: 'float',   default: 251.5 },
  DEFAULT_SPAWN_POINT_Z_4:                   { type: 'float',   default: 0.0 },
  PLAYER_DEATH_CREDIT_PUNISHMENT:            { type: 'float',   default: 0.1 },
  PLAYER_DEATH_CREDIT_DROP:                  { type: 'boolean', default: false },
  PLAYER_DEATH_BLOCK_PUNISHMENT:             { type: 'boolean', default: false },
  PLAYER_DEATH_PUNISHMENT_TIME:              { type: 'number',  default: 300 },
  PLAYER_HISTORY_BACKLOG:                    { type: 'number',  default: 30 },
  PROJECTILES_ADDITIVE_VELOCITY:             { type: 'boolean', default: false },
  PROJECTILES_VELOCITY_MULTIPLIER:           { type: 'float',   default: 1.0 },
  WEAPON_RANGE_REFERENCE:                    { type: 'float',   default: 1000.0 },
  ALLOW_UPLOAD_FROM_LOCAL_BLUEPRINTS:        { type: 'boolean', default: true },
  SHOP_NPC_STARTING_CREDITS:                 { type: 'number',  default: 10000000 },
  SHOP_NPC_RECHARGE_CREDITS:                 { type: 'number',  default: 100000 },
  AI_WEAPON_AIMING_ACCURACY:                 { type: 'number',  default: 10 },
  BROADCAST_SHIELD_PERCENTAGE:               { type: 'number',  default: 5 },
  BROADCAST_POWER_PERCENTAGE:                { type: 'number',  default: 20 },
  ADMINS_CIRCUMVENT_STRUCTURE_CONTROL:       { type: 'boolean', default: true },
  STAR_DAMAGE:                               { type: 'boolean', default: true },
  SQL_NIO_FILE_SIZE:                         { type: 'number',  default: 512 },
  GALAXY_DENSITY_TRANSITION_INNER_BOUND:     { type: 'float',   default: 0.1 },
  GALAXY_DENSITY_TRANSITION_OUTER_BOUND:     { type: 'float',   default: 0.2 },
  GALAXY_DENSITY_RATE_INNER:                 { type: 'float',   default: 0.62 },
  GALAXY_DENSITY_RATE_OUTER:                 { type: 'float',   default: 0.75 },
  PLANET_CORE_RADIUS:                        { type: 'float',   default: 0.65 },
  PLANET_SIZE_MEAN_VALUE:                    { type: 'float',   default: 350.0 },
  PLANET_SIZE_DEVIATION_VALUE:               { type: 'float',   default: 150.0 },
  GAS_PLANET_SIZE_MEAN_VALUE:                { type: 'float',   default: 500.0 },
  GAS_PLANET_SIZE_DEVIATION_VALUE:           { type: 'float',   default: 500.0 },
  ASTEROID_RADIUS_MAX:                       { type: 'number',  default: 64 },
  ASTEROID_RESOURCE_SIZE:                    { type: 'float',   default: 2.5 },
  ASTEROID_RESOURCE_CHANCE:                  { type: 'float',   default: 0.006 },
  PLAYER_MAX_BUILD_AREA:                     { type: 'number',  default: 10 },
  NT_SPAM_PROTECT_TIME_MS:                   { type: 'number',  default: 30000 },
  ASTEROID_SECTOR_REPLENISH_TIME_SEC:        { type: 'number',  default: -1 },
  NT_SPAM_PROTECT_MAX_ATTEMPTS:              { type: 'number',  default: 30 },
  NT_SPAM_PROTECT_EXCEPTIONS:                { type: 'string',  default: '127.0.0.1' },
  ANNOUNCE_SERVER_TO_SERVERLIST:             { type: 'boolean', default: false },
  HOST_NAME_TO_ANNOUNCE_TO_SERVER_LIST:      { type: 'string',  default: '' },
  SERVER_LIST_NAME:                          { type: 'string',  default: '' },
  SERVER_LIST_DESCRIPTION:                   { type: 'string',  default: '' },
  MISSILE_DEFENSE_FRIENDLY_FIRE:             { type: 'boolean', default: true },
  USE_DYNAMIC_RECIPE_PRICES:                 { type: 'boolean', default: true },
  DYNAMIC_RECIPE_PRICE_MODIFIER:             { type: 'float',   default: 1.05 },
  MAKE_HOMBASE_ATTACKABLE_ON_FP_DEFICIT:     { type: 'boolean', default: true },
  PLANET_SPECIAL_REGION_PROBABILITY:         { type: 'number',  default: 240 },
  NT_BLOCK_QUEUE_SIZE:                       { type: 'number',  default: 1024 },
  CHUNK_REQUEST_THREAD_POOL_SIZE_TOTAL:      { type: 'number',  default: 10 },
  CHUNK_REQUEST_THREAD_POOL_SIZE_CPU:        { type: 'number',  default: 2 },
  BUY_BLUEPRINTS_WITH_CREDITS:              { type: 'boolean', default: false },
  SHOP_USE_STATIC_SELL_BUY_PRICES:          { type: 'boolean', default: false },
  SHOP_SELL_BUY_PRICES_UPPER_LIMIT:         { type: 'float',   default: 1.2 },
  SHOP_SELL_BUY_PRICES_LOWER_LIMIT:         { type: 'float',   default: 1.2 },
  MINING_BONUS:                              { type: 'number',  default: 1 },
  MAX_LOGIC_SIGNAL_QUEUE_PER_OBJECT:         { type: 'number',  default: 250000 },
  MAX_LOGIC_ACTIVATIONS_AT_ONCE_PER_OBJECT_WARN: { type: 'number', default: 10000 },
  MAX_LOGIC_ACTIVATIONS_AT_ONCE_PER_OBJECT_STOP: { type: 'number', default: 50000 },
  MAX_COORDINATE_BOOKMARKS:                  { type: 'number',  default: 20 },
  ALLOWED_STATIONS_PER_SECTOR:              { type: 'number',  default: 1 },
  STATION_CREDIT_COST:                       { type: 'number',  default: 1000000 },
  SKIN_SERVER_UPLOAD_BLOCK_SIZE:             { type: 'number',  default: 256 },
  WEIGHTED_CENTER_OF_MASS:                   { type: 'boolean', default: true },
  SECURE_UPLINK_ENABLED:                     { type: 'boolean', default: false },
  SECURE_UPLINK_TOKEN:                       { type: 'string',  default: '' },
  USE_STRUCTURE_HP:                          { type: 'boolean', default: true },
  SHOP_REBOOT_COST_PER_SECOND:               { type: 'float',   default: 1000.0 },
  SHOP_ARMOR_REPAIR_COST_PER_HITPOINT:       { type: 'float',   default: 1.0 },
  MAX_SIMULTANEOUS_EXPLOSIONS:               { type: 'number',  default: 10 },
  REMOVE_ENTITIES_WITH_INCONSISTENT_BLOCKS:  { type: 'boolean', default: false },
  OVERRIDE_INVALID_BLUEPRINT_TYPE:           { type: 'boolean', default: true },
  FACTION_FOUNDER_KICKABLE_AFTER_DAYS_INACTIVITY: { type: 'number', default: 30 },
  BLUEPRINT_SPAWNABLE_SHIPS:                 { type: 'boolean', default: true },
  BLUEPRINT_SPAWNABLE_STATIONS:              { type: 'boolean', default: true },
  USE_OLD_GENERATED_PIRATE_STATIONS:         { type: 'boolean', default: false },
  CARGO_BLEED_AT_OVER_CAPACITY:             { type: 'boolean', default: false },
  ALLOW_PERSONAL_INVENTORY_OVER_CAPACITY:    { type: 'boolean', default: false },
  ONLY_ALLOW_FACTION_SHIPS_ADDED_TO_FLEET:  { type: 'boolean', default: false },
  MAX_CHAIN_DOCKING:                         { type: 'number',  default: 25 },
  SHOP_RAILS_ON_ADV:                         { type: 'boolean', default: true },
  SHOP_RAILS_ON_NORMAL:                      { type: 'boolean', default: false },
  ALLOW_FLEET_FORMATION:                     { type: 'boolean', default: true },
  BACKUP_WORLD_ON_MIGRATION:                 { type: 'boolean', default: true },
  BACKUP_BLUEPRINTS_ON_MIGRATION:            { type: 'boolean', default: true },
  SECTORS_TO_EXPLORE_FOR_SYS:               { type: 'number',  default: 15 },
  NPC_FACTION_SPAWN_LIMIT:                   { type: 'number',  default: -1 },
  NPC_DEBUG_MODE:                            { type: 'boolean', default: false },
  FLEET_OUT_OF_SECTOR_MOVEMENT:              { type: 'number',  default: 6000 },
  NPC_LOADED_SHIP_MAX_SPEED_MULT:            { type: 'float',   default: 0.7 },
  USE_FOW:                                   { type: 'boolean', default: true },
  ALLOW_PASTE_AABB_OVERLAPPING:              { type: 'boolean', default: true },
  DEBUG_FSM_STATE:                           { type: 'boolean', default: false },
  PHYSICS_SHAPE_CASTING_TUNNELING_PREVENTION:{ type: 'boolean', default: false },
  FORCE_DISK_WRITE_COMPLETION:               { type: 'boolean', default: false },
  DEBUG_SEGMENT_WRITING:                     { type: 'boolean', default: false },
  TURNING_DIMENSION_SCALE:                   { type: 'float',   default: 1.1 },
  RECIPE_BLOCK_COST:                         { type: 'number',  default: 5000 },
  RECIPE_REFUND_MULT:                        { type: 'float',   default: 0.5 },
  RECIPE_LEVEL_AMOUNT:                       { type: 'number',  default: 4000 },
  NT_SPAM_PROTECT_ACTIVE:                    { type: 'boolean', default: true },
  USE_PERSONAL_SECTORS:                      { type: 'boolean', default: false },
  BATTLE_MODE:                               { type: 'boolean', default: false },
  BATTLE_MODE_CONFIG:                        { type: 'string',  default: '' },
  BATTLE_MODE_FACTIONS:                      { type: 'string',  default: '' },
  LEADERBOARD_BACKLOG:                       { type: 'number',  default: 24 },
  DEBUG_BEAM_POWER_CONSUMPTION:              { type: 'boolean', default: false },
  DEBUG_BEAM_TICKS_DONE:                     { type: 'boolean', default: false },
  DEBUG_BEAM_POWER_PER_TICK:                 { type: 'boolean', default: false },
  DEBUG_MISSILE_POWER_CONSUMPTION:           { type: 'boolean', default: false },
  NPC_LOG_MODE:                              { type: 'number',  default: 0 },
  NPC_DEBUG_SHOP_OWNERS:                     { type: 'string',  default: '' },
  SQL_PERMISSION:                            { type: 'string',  default: '' },
  DEBUG_EMPTY_CHUNK_WRITES:                  { type: 'boolean', default: false },
  ALLOWED_UNPACKED_FILE_UPLOAD_IN_MB:        { type: 'number',  default: 1024 },
  RESTRICT_BUILDING_SIZE:                    { type: 'float',   default: 2.0 },
  DISPLAY_GROUPING_DEBUG_INFORMATION:        { type: 'boolean', default: false },
  MANAGER_CALC_CANCEL_ON:                    { type: 'boolean', default: true },
  JUMP_DRIVE_ENABLED_BY_DEFAULT:             { type: 'boolean', default: true },
  SHORT_RANGE_SCAN_DRIVE_ENABLED_BY_DEFAULT: { type: 'boolean', default: true },
  SPAWN_PROTECTION:                          { type: 'number',  default: 10 },
  AI_ENGAGEMENT_RANGE_OF_MIN_WEAPON_RANGE:   { type: 'float',   default: 0.75 },
  MISSILE_TARGET_PREDICTION_SEC:             { type: 'float',   default: 0.5 },
  AI_WEAPON_SWITCH_DELAY:                    { type: 'number',  default: 500 },
  ALLOW_FACTORY_ON_SHIPS:                    { type: 'boolean', default: false },
  SHIPYARD_IGNORE_STRUCTURE:                 { type: 'boolean', default: false },
  IGNORE_DOCKING_AREA:                       { type: 'boolean', default: false },
  MISSILE_RADIUS_HP_BASE:                    { type: 'float',   default: 1.0 },
  TEST_PLANET_TYPE:                          { type: 'number',  default: 1 },
  MAX_EXPLOSION_POOL:                        { type: 'number',  default: -1 },
};

// ── Entry value ───────────────────────────────────────────────────────

/**
 * Defines the ConfigValue type used by StarMade configuration loading, editing, and metadata enrichment.
 */
export type ConfigValue = string | boolean | number;

// ── ServerConfig class ───────────────────────────────────────────────────────

/**
 * Represents a StarMade installation server.cfg file.
 *
 * Read: loads the live server.cfg first, otherwise data/config/defaultSettings/server.cfg.
 * Write: always writes to server.cfg at the starmadeDir root.
 */
export class ServerConfig {
  /** Current values (key → parsed value) */
  private readonly _values: Map<string, ConfigValue>;
  /** Raw lines with comments — used for faithful rewriting */
  private readonly _lines: string[];

  /**
   * Creates a ServerConfig instance.
   *
   * @param values - Input value for the constructor operation.
   * @param lines - Input value for the constructor operation.
   */
  private constructor(values: Map<string, ConfigValue>, lines: string[]) {
    this._values = values;
    this._lines  = lines;
  }

  // ── Loading ────────────────────────────────────────────────────────────

  /**
   * Loads server.cfg from starmadeDir.
   * If missing, loads the template from data/config/defaultSettings/server.cfg.
   */
  static load(config: SMToolConfig): ServerConfig {
    const live     = config.paths.serverCfg;
    const template = path.join(config.paths.defaultSettings, 'server.cfg');

    const filePath = fs.existsSync(live) ? live : template;
    if (!fs.existsSync(filePath)) {
      throw new Error(`server.cfg not found: ${live} (template also missing: ${template})`);
    }

    const raw   = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    return ServerConfig._parse(lines);
  }

  /** Loads directly from a Buffer or string for tests and mocks. */
  static fromString(content: string): ServerConfig {
    return ServerConfig._parse(content.split('\n'));
  }

  // ── Typed reads ─────────────────────────────────────────────────────────

  /** Returns a key value typed according to the schema. */
  get(key: string): ConfigValue {
    if (this._values.has(key)) return this._values.get(key)!;
    const meta = SERVER_CONFIG_SCHEMA[key];
    return meta ? meta.default : '';
  }

  /**
   * Returns String.
   *
   * @param key - Input value for the getString operation.
   * @returns The computed StarMade-Decoder value.
   */
  getString(key: string): string   { return String(this.get(key)); }
  /**
   * Returns Number.
   *
   * @param key - Input value for the getNumber operation.
   * @returns The computed StarMade-Decoder value.
   */
  getNumber(key: string): number   { return Number(this.get(key)); }
  /**
   * Returns Boolean.
   *
   * @param key - Input value for the getBoolean operation.
   * @returns The computed StarMade-Decoder value.
   */
  getBoolean(key: string): boolean { return this.get(key) === true || String(this.get(key)).toLowerCase() === 'true'; }
  /**
   * Returns Float.
   *
   * @param key - Input value for the getFloat operation.
   * @returns The computed StarMade-Decoder value.
   */
  getFloat(key: string):   number  { return parseFloat(String(this.get(key))); }

  /** All values (key → value). */
  entries(): ReadonlyMap<string, ConfigValue> { return this._values; }

  /** Keys present in the file; may include unknown keys. */
  keys(): string[] { return [...this._values.keys()]; }

  /** Checks whether a key is known by the schema. */
  isKnown(key: string): boolean { return key in SERVER_CONFIG_SCHEMA; }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Returns a new instance with the modified value.
   * The key must be known by the schema; otherwise TypeError is thrown.
   */
  set(key: string, value: ConfigValue): ServerConfig {
    if (!(key in SERVER_CONFIG_SCHEMA)) {
      throw new TypeError(`Unknown ServerConfig schema key: "${key}"`);
    }
    const newValues = new Map(this._values);
    newValues.set(key, value);

    // Update the matching line in _lines
    const newLines = ServerConfig._updateLine(this._lines, key, value);
    return new ServerConfig(newValues, newLines);
  }

  /** Updates multiple keys at once. */
  setMany(entries: Record<string, ConfigValue>): ServerConfig {
    let cfg: ServerConfig = this;
    for (const [k, v] of Object.entries(entries)) cfg = cfg.set(k, v);
    return cfg;
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Writes to starmadeDir/server.cfg.
   * Preserves comments and line order from the original file.
   */
  save(config: SMToolConfig): void {
    fs.writeFileSync(config.paths.serverCfg, this.toString(), 'utf8');
  }

  /** String representation of the file using reconstructed lines. */
  toString(): string { return this._lines.join('\n'); }

  // ── Parsing interne ───────────────────────────────────────────────────────

  /**
   * Parses input data for StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param lines - Input value for the _parse operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _parse(lines: string[]): ServerConfig {
    const values = new Map<string, ConfigValue>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Format: KEY = value // optional comment
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;

      const key     = trimmed.slice(0, eqIdx).trim();
      const rest    = trimmed.slice(eqIdx + 1);
      const commentIdx = rest.indexOf('//');
      const rawValue = (commentIdx >= 0 ? rest.slice(0, commentIdx) : rest).trim();

      values.set(key, ServerConfig._castValue(key, rawValue));
    }

    return new ServerConfig(values, [...lines]);
  }

  /**
   * Handles the castValue operation used by StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param key - Input value for the _castValue operation.
   * @param raw - Input value for the _castValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _castValue(key: string, raw: string): ConfigValue {
    const meta = SERVER_CONFIG_SCHEMA[key];
    if (!meta) return raw; // unknown key → raw string

    switch (meta.type) {
      case 'boolean': return raw.toLowerCase() === 'true';
      case 'number':  return parseInt(raw, 10);
      case 'float':   return parseFloat(raw);
      default:        return raw;
    }
  }

  /**
   * Handles the updateLine operation used by StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param lines - Input value for the _updateLine operation.
   * @param key - Input value for the _updateLine operation.
   * @param value - Input value for the _updateLine operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _updateLine(lines: string[], key: string, value: ConfigValue): string[] {
    const newLines = [...lines];
    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i];
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) continue;
      const lineKey = line.slice(0, eqIdx).trim();
      if (lineKey !== key) continue;

      // Preserve the comment
      const rest = line.slice(eqIdx + 1);
      const commentIdx = rest.indexOf('//');
      const comment = commentIdx >= 0 ? ' ' + rest.slice(commentIdx).trim() : '';
      newLines[i] = `${key} = ${value}${comment}`;
      return newLines;
    }
    // Missing key → append at the end
    newLines.push(`${key} = ${value}`);
    return newLines;
  }
}
