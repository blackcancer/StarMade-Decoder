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
 * Metadata follows the active settings, ranges, choices and descriptions in the pinned game reference.
 *
 * Source: org.schema.game.server.data.ServerConfig
 */

import fs from 'fs';
import path from 'path';
import type { SMToolConfig } from './SMToolConfig.js';
import { DecodeError } from '../core/DecodeError.js';
import { formatLimits, formatBytes, formatText, checkEntryCount, type FormatLimits } from '../core/FormatLimits.js';

// ── Current game metadata ───────────────────────────────────────────────

/**
 * Defines the ConfigValueType type used by StarMade configuration loading, editing, and metadata enrichment.
 */
export type ConfigValueType = 'string' | 'boolean' | 'number' | 'float';

/** Exact kind of accepted game setting. */
export type ConfigValueKind = 'string' | 'boolean' | 'int' | 'long' | 'float' | 'enum';

/** Settings group used by the game. */
export type ConfigCategory = 'database' | 'game' | 'npc' | 'network' | 'performance' | 'debug' | 'experimental';

/**
 * Describes the ConfigEntryMeta data shape used by StarMade configuration loading, editing, and metadata enrichment.
 */
export interface ConfigEntryMeta {
  /** SDK accessor type; integers and long integers both use safe JS numbers. */
  readonly type: ConfigValueType;
  /** Exact game value kind, including integer versus long and string versus enum. */
  readonly kind: ConfigValueKind;
  /** Game initial value before reading server.cfg. */
  readonly default: string | boolean | number;
  /** Inclusive numeric lower bound; absent for booleans and strings. */
  readonly min?: number;
  /** Inclusive numeric upper bound; absent for booleans and strings. */
  readonly max?: number;
  /** Accepted boolean or enum values; absent for numeric and free text fields. */
  readonly choices?: readonly (string | boolean)[];
  /** Game settings group. */
  readonly category: ConfigCategory;
  /** Explanation supplied by the game reference. */
  readonly description: string;
}

/** Current StarMade-Open server settings at e5a3b49; 210 active keys. */
export const SERVER_CONFIG_SCHEMA: Readonly<Record<string, ConfigEntryMeta>> = {
  WORLD: { type: "string", kind: "string", default: "unset", category: "database", description: "set world to use (set 'old' for using the old world). if no world exists a new one will be set automatically" },
  PROTECT_STARTING_SECTOR: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "Protects the starting sector" },
  ENABLE_SIMULATION: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Universe AI simulation" },
  CONCURRENT_SIMULATION: { type: "number", kind: "int", default: 256, min: 1, max: 2147483646, category: "performance", description: "How many simulation groups may be in the universe simultaniously (performance)" },
  ENEMY_SPAWNING: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Enables enemy spawing" },
  SECTOR_SIZE: { type: "number", kind: "int", default: 5000, min: 2000, max: 1000000, category: "game", description: "Sets the size of sectors in the universe **WARNING** scaling the size of an existing universe down may cause issues" },
  BLUEPRINT_DEFAULT_PRIVATE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "database", description: "If true, set blueprints private as default (else they are public)" },
  BLUEPRINT_UPLOAD_SPEED: { type: "number", kind: "long", default: 2048, min: 512, max: 4096, category: "network", description: "The speed at which clients can upload blueprints to the server. Specifically, this setting affects the upload block size, which is essentially how big each package sent from the client can be." },
  FLOATING_ITEM_LIFETIME_SECS: { type: "number", kind: "int", default: 240, min: 1, max: 604800, category: "game", description: "How much seconds items floating in space should be alive" },
  SIMULATION_SPAWN_DELAY: { type: "number", kind: "int", default: 420, min: 1, max: 604800, category: "game", description: "How much seconds between simulation spawn ticks" },
  SIMULATION_TRADING_FILLS_SHOPS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Trading guild will deliver stock to shops" },
  SECTOR_INACTIVE_TIMEOUT: { type: "number", kind: "int", default: 20, min: -1, max: 604800, category: "performance", description: "Time in secs after which sectors go inactive (-1 = off)" },
  SECTOR_INACTIVE_CLEANUP_TIMEOUT: { type: "number", kind: "int", default: 10, min: -1, max: 604800, category: "network", description: "Time in secs after which inactive sectors are completely removed from memory (-1 = off)" },
  USE_STARMADE_AUTHENTICATION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "allow star-made.org authentication" },
  REQUIRE_STARMADE_AUTHENTICATION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "require star-made.org authentication (USE_STARMADE_AUTHENTICATION must be true)" },
  PROTECTED_NAMES_BY_ACCOUNT: { type: "number", kind: "int", default: 10, min: 0, max: 2147483647, category: "network", description: "How many player names a player may protect with his account (if exceeded, the player name, that was logged in the longest time ago gets unprotected)" },
  DEFAULT_BLUEPRINT_ENEMY_USE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Default option for blueprints not in catalog yet" },
  DEFAULT_BLUEPRINT_FACTION_BUY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Default option for blueprints not in catalog yet" },
  DEFAULT_BLUEPRINT_OTHERS_BUY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Default option for blueprints not in catalog yet" },
  DEFAULT_BLUEPRINT_HOME_BASE_BUY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Default option for blueprints not in catalog yet" },
  LOCK_FACTION_SHIPS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If true, ships of other factions cant be edited, activated, or entered" },
  CATALOG_SLOTS_PER_PLAYER: { type: "number", kind: "int", default: -1, min: -1, max: 2147483646, category: "game", description: "How many slots per player for saved ships (-1 for unlimited)" },
  UNIVERSE_DAY_IN_MS: { type: "number", kind: "int", default: -1, min: -1, max: 2147483646, category: "game", description: "how long is a 'day' (stellar system rotation) in milliseconds (-1 to switch off system rotation)" },
  ASTEROIDS_ENABLE_DYNAMIC_PHYSICS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "performance", description: "enables asteroids to be able to move in space" },
  ENABLE_BREAK_OFF: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "debug (don't activate unless you know what you're doing)" },
  COLLISION_DAMAGE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "colliding into another object does damage" },
  COLLISION_DAMAGE_THRESHOLD: { type: "float", kind: "float", default: 2, min: 0, max: 3.4028234663852886e+38, category: "game", description: "Threshold of Impulse that does damage (the lower, the less force is needed for damage)" },
  SKIN_ALLOW_UPLOAD: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "network", description: "if off, skin uploading to server is deactivated" },
  CATALOG_NAME_COLLISION_HANDLING: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "if off, saving with an existing entry is denied, if on the name is automatically changed by adding numbers on the end" },
  SECTOR_AUTOSAVE_SEC: { type: "number", kind: "int", default: 300, min: -1, max: 604800, category: "performance", description: "Time interval in secs the server will autosave (-1 for never)" },
  PHYSICS_SLOWDOWN_THRESHOLD: { type: "number", kind: "int", default: 40, min: -1, max: 2147483646, category: "game", description: "Milliseconds a collision test may take before anti-slowdown mode is activated" },
  THRUST_SPEED_LIMIT: { type: "number", kind: "int", default: 75, min: 1, max: 5000, category: "network", description: "How fast ships, etc. may go in m/s . Too high values may induce physics tunneling effects" },
  MAX_CLIENTS: { type: "number", kind: "int", default: 32, min: 1, max: 1024, category: "network", description: "Max number of clients allowed on this server" },
  SUPER_ADMIN_PASSWORD_USE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Enable super admin for this server" },
  SUPER_ADMIN_PASSWORD: { type: "string", kind: "string", default: "mypassword", category: "network", description: "Super admin password for this server" },
  SERVER_LISTEN_IP: { type: "string", kind: "string", default: "all", category: "network", description: "Enter specific ip for the server to listen to. use \"all\" to listen on every ip" },
  SOCKET_BUFFER_SIZE: { type: "number", kind: "int", default: 65536, min: 0, max: 2147483646, category: "network", description: "buffer size of incoming and outgoing data per socket" },
  PHYSICS_LINEAR_DAMPING: { type: "float", kind: "float", default: 0.05, min: 0, max: 1.0, category: "game", description: "how much object slow down naturally (must be between 0 and 1): 0 is no slowdown" },
  PHYSICS_ROTATIONAL_DAMPING: { type: "float", kind: "float", default: 0.05, min: 0, max: 1.0, category: "game", description: "how much object slow down naturally (must be between 0 and 1): 0 is no slowdown" },
  AI_DESTRUCTION_LOOT_COUNT_MULTIPLIER: { type: "float", kind: "float", default: 0.9, min: 0, max: 100.0, category: "game", description: "multiply amount of items in a loot stack. use values smaller 1 for less and 0 for none" },
  AI_DESTRUCTION_LOOT_STACK_MULTIPLIER: { type: "float", kind: "float", default: 0.9, min: 0, max: 100.0, category: "game", description: "multiply amount of items spawned after AI destruction. use values smaller 1 for less and 0 for none" },
  CHEST_LOOT_COUNT_MULTIPLIER: { type: "float", kind: "float", default: 0.9, min: 0, max: 100.0, category: "game", description: "multiply amount of items in a loot stack. use values smaller 1 for less and 0 for none" },
  CHEST_LOOT_STACK_MULTIPLIER: { type: "float", kind: "float", default: 0.9, min: 0, max: 100.0, category: "game", description: "multiply amount of items spawned in chests of generated chests. use values smaller 1 for less and 0 for none" },
  USE_WHITELIST: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "only names/ips from whitelist.txt are allowed" },
  FILTER_CONNECTION_MESSAGES: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "don't display join/disconnect messages" },
  USE_UDP: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Use 'User Datagram Protocol' (UDP) instead of 'Transmission Control Protocol' (TCP) for connections" },
  AUTO_KICK_MODIFIED_BLUEPRINT_USE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Kick players that spawn modified blueprints" },
  AUTO_BAN_ID_MODIFIED_BLUEPRINT_USE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Ban player by name that spawn modified blueprints" },
  AUTO_BAN_IP_MODIFIED_BLUEPRINT_USE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Ban player by IP that spawn modified blueprints" },
  AUTO_BAN_TIME_IN_MINUTES: { type: "number", kind: "int", default: 60, min: 0, max: 2147483646, category: "network", description: "Time to ban in minutes (-1 for permanently)" },
  REMOVE_MODIFIED_BLUEPRINTS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "Auto-removes a modified blueprint" },
  TCP_NODELAY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "network", description: "Naggles algorithm (WARNING: only change when you know what you're doing)" },
  PING_FLUSH: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "flushes ping/pong immediately (WARNING: only change when you know what you're doing)" },
  SHOP_SPAWNING_PROBABILITY: { type: "float", kind: "float", default: 0.1, min: 0, max: 1.0, category: "game", description: "(must be between 0 and 1): 0 is no shops spawned in asteroid sectors, 1 is shop spawned in everyone (default: 8% -> 0.08)" },
  DEFAULT_SPAWN_SECTOR_X: { type: "number", kind: "int", default: 2, min: -2147483648, max: 2147483647, category: "game", description: "DEFAULT Spawn Sector X Coordinate" },
  DEFAULT_SPAWN_SECTOR_Y: { type: "number", kind: "int", default: 2, min: -2147483648, max: 2147483647, category: "game", description: "DEFAULT Spawn Sector Y Coordinate" },
  DEFAULT_SPAWN_SECTOR_Z: { type: "number", kind: "int", default: 2, min: -2147483648, max: 2147483647, category: "game", description: "DEFAULT Spawn Sector Z Coordinate" },
  MODIFIED_BLUEPRINT_TOLERANCE: { type: "float", kind: "float", default: 0.1, min: 0.0, max: 100, category: "game", description: "Tolerance of modified blueprint trigger (default = 10%)" },
  DEFAULT_SPAWN_POINT_X_1: { type: "float", kind: "float", default: 8.0, min: -10000, max: 10000, category: "game", description: "First Rotating Spawn: Local Pos X Coordinate" },
  DEFAULT_SPAWN_POINT_Y_1: { type: "float", kind: "float", default: -6.5, min: -10000, max: 10000, category: "game", description: "First Rotating Spawn: Local Pos Y Coordinate" },
  DEFAULT_SPAWN_POINT_Z_1: { type: "float", kind: "float", default: 0.0, min: -10000, max: 10000, category: "game", description: "First Rotating Spawn: Local Pos Z Coordinate" },
  DEFAULT_SPAWN_POINT_X_2: { type: "float", kind: "float", default: 15.0, min: -10000, max: 10000, category: "game", description: "Second Rotating Spawn: Local Pos X Coordinate" },
  DEFAULT_SPAWN_POINT_Y_2: { type: "float", kind: "float", default: -6.5, min: -10000, max: 10000, category: "game", description: "Second Rotating Spawn: Local Pos Y Coordinate" },
  DEFAULT_SPAWN_POINT_Z_2: { type: "float", kind: "float", default: 8.0, min: -10000, max: 10000, category: "game", description: "Second Rotating Spawn: Local Pos Z Coordinate" },
  DEFAULT_SPAWN_POINT_X_3: { type: "float", kind: "float", default: 8.0, min: -10000, max: 10000, category: "game", description: "Third Rotating Spawn: Local Pos X Coordinate" },
  DEFAULT_SPAWN_POINT_Y_3: { type: "float", kind: "float", default: -6.5, min: -10000, max: 10000, category: "game", description: "Third Rotating Spawn: Local Pos Y Coordinate" },
  DEFAULT_SPAWN_POINT_Z_3: { type: "float", kind: "float", default: 15.0, min: -10000, max: 10000, category: "game", description: "Third Rotating Spawn: Local Pos Z Coordinate" },
  DEFAULT_SPAWN_POINT_X_4: { type: "float", kind: "float", default: 0.0, min: -10000, max: 10000, category: "game", description: "Forth Rotating Spawn: Local Pos X Coordinate" },
  DEFAULT_SPAWN_POINT_Y_4: { type: "float", kind: "float", default: -6.5, min: -10000, max: 10000, category: "game", description: "Forth Rotating Spawn: Local Pos Y Coordinate" },
  DEFAULT_SPAWN_POINT_Z_4: { type: "float", kind: "float", default: 8.0, min: -10000, max: 10000, category: "game", description: "Forth Rotating Spawn: Local Pos Z Coordinate" },
  PLAYER_DEATH_CREDIT_PUNISHMENT: { type: "float", kind: "float", default: 0.1, min: 0, max: 1.0, category: "game", description: "players credits lost of total on death (must be between 0 and 1): 1 = lose all, 0 = keep all" },
  PLAYER_DEATH_CREDIT_DROP: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "drop credits lost on death into space instead" },
  PLAYER_DEATH_BLOCK_PUNISHMENT: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "player will drop all his blocks into space on death" },
  PLAYER_DEATH_PUNISHMENT_TIME: { type: "number", kind: "int", default: 300, min: 0, max: 604800, category: "game", description: "Time interval in seconds after death of a player in which the player is not punished" },
  ALLOW_CHAT_COLOR_CODES: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If true, all players can use color codes in chat messages (e.g &bl for blue text)." },
  ALLOW_CHAT_ASCII_EXTRA: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If true, all players can use extended ASCII characters in chat messages (e.g. Ü, ñ, é, etc.)." },
  DISPLAY_MODULE_CHAR_LIMIT: { type: "number", kind: "int", default: 2000, min: 1, max: 2000, category: "game", description: "how many characters a display module may have (default: 2000)" },
  DISPLAY_MODULE_LINE_LIMIT: { type: "number", kind: "int", default: 20, min: 1, max: 20, category: "game", description: "how many lines a display module may have (default: 20)" },
  PLAYER_HISTORY_BACKLOG: { type: "number", kind: "int", default: 30, min: 0, max: 2147483647, category: "network", description: "How many login history objects (with name, IP, account-name, and time) should be saved by player state" },
  PROJECTILES_ADDITIVE_VELOCITY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "initial projectile speed depend on relative linear velocity of object fired from" },
  PROJECTILES_VELOCITY_MULTIPLIER: { type: "float", kind: "float", default: 1, min: 0, max: 100000.0, category: "game", description: "multiplicator for projectile velocity" },
  WEAPON_RANGE_REFERENCE: { type: "float", kind: "float", default: 2000, min: 300, max: 1000000, category: "game", description: "Reference distance for weapon ranges. (what blockBehaviorConfig.xml weapon ranges are multiplied with (usually the sector size)). Set to 1 to interpret weapon ranges in the config in meters" },
  ALLOW_UPLOAD_FROM_LOCAL_BLUEPRINTS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "network", description: "enables clients being able to upload their pre-build-blueprints to the server" },
  SHOP_NPC_STARTING_CREDITS: { type: "number", kind: "int", default: 10000000, min: 0, max: 2147483647, category: "game", description: "how much credits do shops start with" },
  SHOP_NPC_RECHARGE_CREDITS: { type: "number", kind: "int", default: 100000, min: 0, max: 2147483647, category: "game", description: "how much credits do shops gain about every 10 min" },
  AI_WEAPON_AIMING_ACCURACY: { type: "number", kind: "int", default: 3000, min: 0, max: 2147483647, category: "game", description: "how accurate the AI aims (the higher the value the more accurate vs distance. 10 = about 99% accuracy at 10m)" },
  BROADCAST_SHIELD_PERCENTAGE: { type: "number", kind: "int", default: 5, min: 0, max: 2147483647, category: "network", description: "percent of shields changed for the server to broadcast a shield synch" },
  BROADCAST_POWER_PERCENTAGE: { type: "number", kind: "int", default: 50, min: 0, max: 2147483647, category: "network", description: "percent of power changed for the server to broadcast a power synch (not that critical)" },
  ADMINS_CIRCUMVENT_STRUCTURE_CONTROL: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "network", description: "admins can enter ships of any faction" },
  STAR_DAMAGE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "suns dealing damage to entities" },
  SQL_NIO_FILE_SIZE: { type: "number", kind: "int", default: 256, min: 256, max: 2147483647, category: "database", description: "megabyte limit of .data file when to use NIO (faster) (must be power of 2)" },
  PLANET_CORES_INVULNERABLE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "if true, all planets cores are invulnerable" },
  PLANET_SIZE_MEAN_VALUE: { type: "float", kind: "float", default: 100, min: 50, max: 3.4028234663852886e+38, category: "game", description: "Planet size mean (normal gaussian distribution) (min 50)" },
  PLANET_SIZE_DEVIATION_VALUE: { type: "float", kind: "float", default: 35.0, min: 0, max: 3.4028234663852886e+38, category: "game", description: "Planet size standard deviation. Note: normal gaussian distribution graph scaled horizontally by 1/3 (min 0)" },
  ASTEROID_RADIUS_MAX: { type: "number", kind: "int", default: 64, min: 1, max: 2147483647, category: "game", description: "Asteroid max radius in blocks (from -x to +x)" },
  ASTEROID_RESOURCE_SIZE: { type: "float", kind: "float", default: 2.5, min: 1, max: 65504.0, category: "game", description: "Average diameter of resource veins in asteroids" },
  ASTEROID_RESOURCE_CHANCE: { type: "float", kind: "float", default: 0.003, min: 0.0, max: 1.0, category: "game", description: "Chance per block to place a new resource vein (1.0 = 100%)" },
  PLAYER_MAX_BUILD_AREA: { type: "number", kind: "int", default: 100, min: 0, max: 2147483647, category: "game", description: "max area a player may add/remove in adv. build mode" },
  MAX_MULTI_PLACE_DRAG_INSTANCES: { type: "number", kind: "int", default: 100, min: 1, max: 2147483647, category: "game", description: "max number of instances that can be placed in one multi-place drag session" },
  NT_SPAM_PROTECT_TIME_MS: { type: "number", kind: "int", default: 30000, min: 0, max: 2147483647, category: "network", description: "period of spam protection" },
  ASTEROID_SECTOR_REPLENISH_TIME_SEC: { type: "number", kind: "int", default: -1, min: -1, max: 2147483647, category: "game", description: "seconds until a sector that is mined down to 0 asteroids is replenished (-1 = never)" },
  NT_SPAM_PROTECT_MAX_ATTEMPTS: { type: "number", kind: "int", default: 30, min: 0, max: 2147483647, category: "network", description: "max attempts before refusing connections in spam protect period (default is 1/sec for 30 sec)" },
  NT_SPAM_PROTECT_EXCEPTIONS: { type: "string", kind: "string", default: "127.0.0.1", category: "network", description: "ips excepted from spam control (separate multiple with comma) (default is localhost)" },
  ANNOUNCE_SERVER_TO_SERVERLIST: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "announces the server to the starmade server list so clients can find it. Hostname must be provided for HOST_NAME_TO_ANNOUNCE_TO_SERVER_LIST!" },
  HOST_NAME_TO_ANNOUNCE_TO_SERVER_LIST: { type: "string", kind: "string", default: "", category: "network", description: "this must be a valid hostname (either ip or host, e.g. play.star-made.org)" },
  SERVER_LIST_NAME: { type: "string", kind: "string", default: "NoName", category: "network", description: "max length 64 characters" },
  SERVER_LIST_DESCRIPTION: { type: "string", kind: "string", default: "NoDescription", category: "network", description: "max length 128 characters" },
  MISSILE_DEFENSE_FRIENDLY_FIRE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "can shoot down own or missiles from own faction" },
  USE_DYNAMIC_RECIPE_PRICES: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "use recipe based prices (the price is the price of the parts it is made out of in crafting)" },
  DYNAMIC_RECIPE_PRICE_MODIFIER: { type: "float", kind: "float", default: 1.05, min: -1, max: 1000, category: "game", description: "modifier to adjust dynamic price" },
  MAKE_HOMBASE_ATTACKABLE_ON_FP_DEFICIT: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Home bases become attackable if a faction's Faction Points are in the minus and the faction doesn't own any territory" },
  PLANET_SPECIAL_REGION_PROBABILITY: { type: "number", kind: "int", default: 240, min: 1, max: 2147483647, category: "game", description: "one out of thisValue chance of a special region spawning per planet plate (cities, pyramids, etc) (changing this value migth change some plates, but won't change any plates that are already modified by a player)" },
  NT_BLOCK_QUEUE_SIZE: { type: "number", kind: "int", default: 1024, min: 1, max: 2147483647, category: "network", description: "How many blocks are sent per update. Huge placements will shot faster, but it will consume more bandwidth and is subject to spamming players" },
  CHUNK_REQUEST_THREAD_POOL_SIZE_TOTAL: { type: "number", kind: "int", default: 10, min: 1, max: 2147483647, category: "performance", description: "Thead pool size for chunk requests (from disk and generated)" },
  CHUNK_REQUEST_THREAD_POOL_SIZE_CPU: { type: "number", kind: "int", default: 2, min: 1, max: 2147483647, category: "performance", description: "Available threads of total for CPU generation. WARNING: too high can cause cpu spikes. About the amount of available cores minus one is best" },
  BUY_BLUEPRINTS_WITH_CREDITS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "buy blueprints directly with credits" },
  SHOP_USE_STATIC_SELL_BUY_PRICES: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "shop buy and sell price change depending on stock (shop prices will always stay the same if true)" },
  SHOP_SELL_BUY_PRICES_UPPER_LIMIT: { type: "float", kind: "float", default: 1.2, min: 0.001, max: 3.4028234663852886e+38, category: "game", description: "maximum of base price a shop will want depending on its stock (e.g. max 120 credits if the normal cost is 100)" },
  SHOP_SELL_BUY_PRICES_LOWER_LIMIT: { type: "float", kind: "float", default: 0.8, min: 0.001, max: 3.4028234663852886e+38, category: "game", description: "minimum of base price a shop will want depending on its stock (e.g. max 80 credits if the normal cost is 100)" },
  MINING_BONUS: { type: "number", kind: "int", default: 1, min: 1, max: 2147483647, category: "game", description: "general multiplier on all mining" },
  MAX_LOGIC_SIGNAL_QUEUE_PER_OBJECT: { type: "number", kind: "int", default: 250000, min: 1, max: 2147483647, category: "game", description: "max logic trace queue allowed" },
  MAX_LOGIC_ACTIVATIONS_AT_ONCE_PER_OBJECT_WARN: { type: "number", kind: "int", default: 10000, min: 1, max: 2147483647, category: "game", description: "warn about objects that activate more than x blocks at once" },
  MAX_LOGIC_ACTIVATIONS_AT_ONCE_PER_OBJECT_STOP: { type: "number", kind: "int", default: 50000, min: 1, max: 2147483647, category: "game", description: "stop logic of objects that activate more than x blocks at once. They will enter a logic cooldown of 10 seconds to prevent servers from overloading" },
  MAX_COORDINATE_BOOKMARKS: { type: "number", kind: "int", default: 20, min: 0, max: 2147483647, category: "game", description: "coordinate bookmarks per player allowed" },
  ALLOWED_STATIONS_PER_SECTOR: { type: "number", kind: "int", default: 1, min: 1, max: 2147483647, category: "game", description: "How many stations are allowed per sector" },
  STATION_CREDIT_COST: { type: "number", kind: "int", default: 50000, min: 0, max: 2147483647, category: "game", description: "how much does a station or station blueprint cost" },
  SKIN_SERVER_UPLOAD_BLOCK_SIZE: { type: "number", kind: "int", default: 256, min: 1, max: 32767, category: "network", description: "how fast should skins be transferred from server to clients (too high might cause lag) [default 256 ~ 16kb/s]" },
  WEIGHTED_CENTER_OF_MASS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "if on, the center of mass for each structured will be calculated based on block mass. On 'false', the center of mass is always the core position" },
  SECURE_UPLINK_ENABLED: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "network", description: "dedicated servers can be registered on the StarMade registry" },
  SECURE_UPLINK_TOKEN: { type: "string", kind: "string", default: "", category: "network", description: "uplink token, provided when registering a dedicated server" },
  USE_STRUCTURE_HP: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "ships and other structures use the hitpoint system. if off, a ship will overheat when the core gets taken out (old)" },
  SHOP_REBOOT_COST_PER_SECOND: { type: "float", kind: "float", default: 100, min: 0, max: 3.4028234663852886e+38, category: "game", description: "Cost to reboot a ship at a shop (per second it would take to reboot in space)" },
  SHOP_ARMOR_REPAIR_COST_PER_HITPOINT: { type: "float", kind: "float", default: 1, min: 0, max: 3.4028234663852886e+38, category: "game", description: "Cost to repair a ship's armor at a shop" },
  MAX_SIMULTANEOUS_EXPLOSIONS: { type: "number", kind: "int", default: 10, min: 0, max: 2147483647, category: "performance", description: "the more the faster explosions at the same time are executed (costs in total about 20MB RAM each and of course CPU because it's all threaded) (10 is default for a medium powered singleplayer)" },
  ACID_MAX_BLOCK_OPS_PER_UPDATE: { type: "number", kind: "int", default: 2048, min: 1, max: 2147483647, category: "performance", description: "Maximum acid block damage/propagation steps processed per entity per acid update tick. Lower this if acid weapons cause server lag or combat ping spikes (2048 is the historical default; 256 is the gentler pre-rework value)." },
  ACID_UPDATE_FREQUENCY_MS: { type: "number", kind: "int", default: 10, min: 1, max: 2147483647, category: "performance", description: "Minimum milliseconds between propagation steps for a single acid instance. Higher values slow acid spread and reduce server load (10 is the historical default; 90 is the gentler pre-rework value)." },
  ELEMENT_COLLECTION_RECALC_DEBOUNCE_MS: { type: "number", kind: "int", default: 1000, min: 0, max: 2147483647, category: "performance", description: "Minimum milliseconds between full recalculations of an entity's block systems (thrusters, weapons, reactor, etc.) while it keeps changing. Higher coalesces the recalc / mesh-rebuild / reactor convex-hull storm during heavy block destruction (acid, explosions), at the cost of briefly stale system stats. 0 = recalc as fast as possible (legacy behavior)." },
  PROJECTILE_RAYCAST_AABB_CACHE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "performance", description: "Enables the per-tick broadphase AABB cache used by weapon raycasts in busy sectors (>32 collision objects). Leave ON for performance. Set OFF only as a diagnostic." },
  PROJECTILE_MAX_COLLISION_STEP: { type: "number", kind: "int", default: 25, min: 0, max: 2147483647, category: "performance", description: "Maximum distance a projectile may travel per collision check. When a single frame would move it further (fast weapons at low server FPS), the movement is split into multiple collision-checked sub-steps so it cannot tunnel through a target without registering a hit. 0 = disabled (one check per frame, legacy behavior)." },
  EXPLOSION_APPLY_BUDGET_MS: { type: "number", kind: "int", default: 8, min: 0, max: 2147483647, category: "performance", description: "Maximum milliseconds per server tick spent applying finished explosions' block damage to entities. A fleet-fight volley can finish many explosions at once; without a budget, applying them all in one tick froze the server main loop for hundreds of ms. Excess explosions are applied on following ticks (at least one is always applied per tick). 0 = unlimited (legacy behavior)." },
  REPULSE_SWEEP_INTERVAL_MS: { type: "number", kind: "int", default: 0, min: 0, max: 2147483647, category: "performance", description: "Minimum milliseconds between physics sweeps for an ACTIVE repulsor (one that has thrust dedicated to it). Each repulsor block runs a physics sweep over nearby objects; doing it every tick across a fleet is expensive. Higher values trade hover responsiveness for performance. Decorative/unpowered repulsors are skipped entirely regardless of this setting. 0 = every tick (legacy behavior, smoothest hover)." },
  REMOVE_ENTITIES_WITH_INCONSISTENT_BLOCKS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "This will remove ships that have blocks that are normally disallowed (e.g. space station blocks on ships)" },
  OVERRIDE_INVALID_BLUEPRINT_TYPE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If a loaded blueprint is invalid, it's type will be overridden" },
  FACTION_FOUNDER_KICKABLE_AFTER_DAYS_INACTIVITY: { type: "number", kind: "int", default: 30, min: 0, max: 2147483646, category: "network", description: "Days of inactivity after which a founder may kick another founder" },
  BLUEPRINT_SPAWNABLE_SHIPS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "enables or disables blueprint spawning from item" },
  BLUEPRINT_SPAWNABLE_STATIONS: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "enables or disables blueprint spawning from item" },
  USE_OLD_GENERATED_PIRATE_STATIONS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "enables spawning of old style pirate stations" },
  CARGO_BLEED_AT_OVER_CAPACITY: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "cargo is ejected every minute if storage is at over capacity" },
  ALLOW_PERSONAL_INVENTORY_OVER_CAPACITY: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "Personal Inventory can go over capacity" },
  ONLY_ALLOW_FACTION_SHIPS_ADDED_TO_FLEET: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "only allows faction ships to be added to fleet" },
  MAX_CHAIN_DOCKING: { type: "number", kind: "int", default: 25, min: 0, max: 2147483647, category: "game", description: "maximal deepness of docking chains (may cause glitches depending on OS (path and filename length) at high numbers)" },
  DELETE_DOCKED_ON_OVERHEAT: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If enabled, all entities docked to an entity (recursively) are deleted along with it when its core fully overheats and the entity is destroyed, instead of being undocked. Helps prevent entity clogging." },
  SHOP_RAILS_ON_ADV: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Advanced shops will have 4 rails dockers that can be used like a neutral homebase (anything docked is safe)" },
  SHOP_RAILS_ON_NORMAL: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "Normal shops will have 4 rails dockers that can be used like a neutral homebase (anything docked is safe)" },
  ALLOW_FLEET_FORMATION: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Allows fleet formation" },
  BACKUP_WORLD_ON_MIGRATION: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Back up world when migrating to a new file format" },
  BACKUP_BLUEPRINTS_ON_MIGRATION: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Back up blueprints when migrating to a new file format" },
  SECTORS_TO_EXPLORE_FOR_SYS: { type: "number", kind: "int", default: 15, min: 0, max: 2147483647, category: "game", description: "How many sectors of a system have to be explored" },
  NPC_FACTION_SPAWN_LIMIT: { type: "number", kind: "int", default: -1, min: -1, max: 2147483647, category: "npc", description: "Maximum npc factions per galaxy (-1 for unlimited (will still be around 2-10))" },
  NPC_DEBUG_MODE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "Sends complete NPC faction package to clients (very bandwith intensive)" },
  FLEET_OUT_OF_SECTOR_MOVEMENT: { type: "number", kind: "int", default: 6000, min: 0, max: 2147483647, category: "game", description: "How long for an unloaded fleet to cross a sector in ms" },
  NPC_LOADED_SHIP_MAX_SPEED_MULT: { type: "float", kind: "float", default: 0.7, min: 0, max: 100000.0, category: "game", description: "How fast NPC fleet ships are compared to their max speed when loaded" },
  USE_FOW: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Use 'fog of war'. Turning this off will make everything visible to everyone" },
  ALLOW_PASTE_AABB_OVERLAPPING: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "Allow Paste bounding box overlapping" },
  NPC_PREVENT_HOMEBASE_SYSTEM_LOSS: { type: "boolean", kind: "boolean", default: true, choices: [true, false], category: "npc", description: "Prevents NPC factions from losing their homebase system" },
  NPC_SYSTEM_RATIO_LOSS: { type: "float", kind: "float", default: 0.9, min: 0.1, max: 1.0, category: "npc", description: "Ratio of asset loss required for an NPC faction to lose control of a system." },
  USE_PLAYER_FLEET_DELIVERY: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "game", description: "If enabled, trade deliveries between players can be done by player-assigned fleets instead of NPC fleets." },
  DEFAULT_GAME_MODE: { type: "string", kind: "enum", default: "SURVIVAL", choices: ["SURVIVAL", "CREATIVE"], category: "game", description: "Game mode new players start in. SURVIVAL: normal play. CREATIVE: players are granted creative mode on join (good for creative build servers)." },
  BLUEPRINT_NO_RESOURCE_COST: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "game", description: "If enabled, spawning/buying blueprints costs no resources or credits (good for creative build servers)." },
  DEBUG_FSM_STATE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "transfer debug FSM state. Turning this on may slow down network" },
  PHYSICS_SHAPE_CASTING_TUNNELING_PREVENTION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Makes a convex cast for hight speed object to prevent clipping. High Cost. (Bugged right now, so dont turn it on)" },
  FORCE_DISK_WRITE_COMPLETION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "forces writing operations of raw data to disk directly after operation. For some OS this prevents raw data corruption" },
  DEBUG_SEGMENT_WRITING: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Debugs correctness of writing of segments (costs server performance)" },
  TURNING_DIMENSION_SCALE: { type: "float", kind: "float", default: 1.1, min: 0.0, max: 100, category: "debug", description: "Scaling of tuning speed VS ship dimension (default = 1.1)" },
  RECIPE_BLOCK_COST: { type: "number", kind: "int", default: 5000, min: 0, max: 2147483646, category: "debug", description: "How much blocks have to be invested to create a recipe (min 0)" },
  RECIPE_REFUND_MULT: { type: "float", kind: "float", default: 0.5, min: 0, max: 1.0, category: "debug", description: "how much blocks are refunded from selling a recipe (must be between 0 and 1): 0 no refund, 1 full refund" },
  RECIPE_LEVEL_AMOUNT: { type: "number", kind: "int", default: 4000, min: 0, max: 2147483646, category: "debug", description: "On how much created blocks will a recipe level up (base value) (min 0)" },
  IGNORE_DOCKING_AREA: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "ignores docking area size" },
  ALLOW_OLD_DOCKING_BEAM: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "enables old docking beam" },
  NT_SPAM_PROTECT_ACTIVE: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "enables connection spawn protection (flooding servers with login attempts)" },
  USE_PERSONAL_SECTORS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "will spawn a player in a locked sector sandbox (warning, don't use unless you know what you do)" },
  BATTLE_MODE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "turn on battlemode (warning, don't use unless you know what you're doing)" },
  BATTLE_MODE_CONFIG: { type: "string", kind: "string", default: "battleSector=0,0,0,Physics.smsec;battleSector=15,15,15,Physics.smsec;countdownRound=300;countdownStart=30;maxMass=-1;maxDim=300;maxMassPerFaction=-1;", category: "debug", description: "General config for battlemode" },
  BATTLE_MODE_FACTIONS: { type: "string", kind: "string", default: "[TeamA, fighters, 500,500,500, 0.5,0.1,0.9];[TeamB, fighters, -500,-500,-500, 0.5,0.9,0.2];[TeamFFA,ffa, 0,0,-500, 0.2,0.9,0.9];[Spectators,spectators, 0,500,0,0.8,0.4,0.8]", category: "debug", description: "Faction config for battlemode" },
  LEADERBOARD_BACKLOG: { type: "number", kind: "int", default: 24, min: 0, max: 2147483647, category: "debug", description: "time in hours to keep leaderboard backlog (the more time, the more data has to be sent to client)" },
  DEBUG_BEAM_POWER_CONSUMPTION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "server will send notifications on power consumed (not counting power given from supply) on server (costs performance, so only use for debugging)" },
  DEBUG_BEAM_TICKS_DONE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "server will send notifications on ticks done on server (costs performance, so only use for debugging)" },
  DEBUG_BEAM_POWER_PER_TICK: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "server will send notifications on beam power per tick on server (costs performance, so only use for debugging)" },
  DEBUG_MISSILE_POWER_CONSUMPTION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "server will send notifications on missiles on server (costs performance, so only use for debugging)" },
  NPC_LOG_MODE: { type: "number", kind: "int", default: 0, min: 0, max: 2, category: "debug", description: "use 0 for npc file logs [/logs/npc/] and 1 for normal log output" },
  NPC_DEBUG_SHOP_OWNERS: { type: "string", kind: "string", default: "", category: "debug", description: "Additional shop owners for npc faction shops (case insensitive, seperate with comma)" },
  SQL_PERMISSION: { type: "string", kind: "string", default: "", category: "debug", description: "user name allowed to sql query remotely (direct console always allowed /sql_query, /sql_update, /sql_insert_return_generated_keys) (case insensitive, seperate with comma)" },
  DEBUG_EMPTY_CHUNK_WRITES: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Logs empty chunks (debug only)" },
  ALLOWED_UNPACKED_FILE_UPLOAD_IN_MB: { type: "number", kind: "int", default: 1024, min: 0, max: 2147483647, category: "debug", description: "how much mb is an uploaded blueprint/skin allowed to have (unzipped)" },
  RESTRICT_BUILDING_SIZE: { type: "float", kind: "float", default: 2, min: 0, max: 32, category: "debug", description: "Restricts Building Size to X times Sector Size (-1 for off) Warning: values set in GameConfig.xml overwrite this" },
  DISPLAY_GROUPING_DEBUG_INFORMATION: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Displays grouping calculation information" },
  MANAGER_CALC_CANCEL_ON: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "Enables performance increase by prematurely ending calculations when there is a refresh request" },
  ALLOW_OLD_POWER_SYSTEM: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "enables old power system (WARNING: once the old power system has been disallowed, it cannot be allowed again and the game will ignore this option, as that would cause compatibility issues.)" },
  JUMP_DRIVE_ENABLED_BY_DEFAULT: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "Weather all ships have jump capability or the basic jump chamber is required for jump capability" },
  SHORT_RANGE_SCAN_DRIVE_ENABLED_BY_DEFAULT: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "Weather all ships have scanner capability or the basic scan chamber is required for scan capability" },
  SPAWN_PROTECTION: { type: "number", kind: "int", default: 10, min: 0, max: 2147483647, category: "debug", description: "Spawn protection in seconds (may not yet protect against everything)" },
  AI_ENGAGEMENT_RANGE_OF_MIN_WEAPON_RANGE: { type: "float", kind: "float", default: 0.75, min: 0.0, max: 1.0, category: "debug", description: "Percentage of minimum weapon range the AI prefers to engage from" },
  MISSILE_TARGET_PREDICTION_SEC: { type: "float", kind: "float", default: 3.5, min: 0.0, max: 1000000.0, category: "debug", description: "Since lockstep algorithm is based on recorded target positions, how much should a target chasing missiles predict a target's position based on its velocity (in ticks of 8ms). Change if missiles miss fast targets" },
  AI_WEAPON_SWITCH_DELAY: { type: "number", kind: "int", default: 500, min: 0, max: 2147483647, category: "debug", description: "Delay inbetween an AI can switch weapon in ms" },
  ALLOW_FACTORY_ON_SHIPS: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Factories work on ships" },
  SHIPYARD_IGNORE_STRUCTURE: { type: "boolean", kind: "boolean", default: false, choices: [false, true], category: "debug", description: "Removes necessity to build shipyard structure (just computer and ancor is enough)" },
  MISSILE_RADIUS_HP_BASE: { type: "float", kind: "float", default: 1.1, min: 1e-06, max: 9999999999, category: "debug", description: "Missile Damage to Radius relation: MissileRadius = ((3/4π) * (MissileTotalDamage/MISSILE_RADIUS_HP_BASE)) ^ (1/3)" },
  MAX_EXPLOSION_POOL: { type: "number", kind: "int", default: -1, min: -1, max: 2147483647, category: "debug", description: "Maximum amount of explosions to keep in pool (to reuse in memory, -1 for unlimited)" },
  SERVER_TICK_PROFILER: { type: "boolean", kind: "boolean", default: true, choices: [false, true], category: "debug", description: "Times the server main loop and logs the dominant phase when a tick exceeds SERVER_TICK_WARN_MS (very low cost, helps diagnose stalls)" },
  SERVER_TICK_WARN_MS: { type: "number", kind: "int", default: 120, min: 1, max: 2147483647, category: "debug", description: "Server main-loop tick budget in ms; ticks slower than this get a per-phase breakdown logged (requires SERVER_TICK_PROFILER)" },
};

// Public metadata is immutable, including nested choice lists.
for (const metadata of Object.values(SERVER_CONFIG_SCHEMA)) {
  if (metadata.choices) Object.freeze(metadata.choices);
  Object.freeze(metadata);
}
Object.freeze(SERVER_CONFIG_SCHEMA);

/** Exact game source revision used to qualify the public settings schema. */
export const SERVER_CONFIG_SCHEMA_SOURCE = 'e5a3b49d86943c4d618cea6512e28fa0b95901df';

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
  private readonly _limits: Required<FormatLimits>;

  /**
   * Creates a ServerConfig instance.
   *
   * @param values - Input value for the constructor operation.
   * @param lines - Input value for the constructor operation.
   */
  private constructor(values: Map<string, ConfigValue>, lines: string[], limits: Required<FormatLimits>) {
    checkEntryCount(values.size, limits);
    formatBytes(lines.join('\n'), limits);
    this._values = new Map(values);
    this._lines = [...lines];
    this._limits = limits;
    Object.freeze(this);
  }

  // ── Loading ────────────────────────────────────────────────────────────

  /**
   * Loads server.cfg from starmadeDir.
   * If missing, loads the template from data/config/defaultSettings/server.cfg.
   */
  static load(config: SMToolConfig, options: FormatLimits = {}): ServerConfig {
    const live     = config.paths.serverCfg;
    const template = path.join(config.paths.defaultSettings, 'server.cfg');

    const filePath = fs.existsSync(live) ? live : template;
    if (!fs.existsSync(filePath)) {
      throw new Error(`server.cfg not found: ${live} (template also missing: ${template})`);
    }

    const limits = formatLimits(options);
    if (fs.statSync(filePath).size > limits.maxBytes) throw new DecodeError('E_LIMIT', 'Server config byte budget exceeded');
    return ServerConfig.fromString(formatText(fs.readFileSync(filePath)), limits);
  }

  /** Loads directly from a Buffer or string for tests and mocks. */
  static fromString(content: string, options: FormatLimits = {}): ServerConfig {
    if (typeof content !== 'string') throw new TypeError('Server config must be a string');
    const limits = formatLimits(options);
    formatBytes(content, limits);
    return ServerConfig._parse(content.split('\n'), limits);
  }

  // ── Typed reads ─────────────────────────────────────────────────────────

  /** Returns a key value typed according to the schema. */
  get(key: string): ConfigValue {
    if (this._values.has(key)) return this._values.get(key)!;
    const meta = Object.hasOwn(SERVER_CONFIG_SCHEMA, key) ? SERVER_CONFIG_SCHEMA[key] : undefined;
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
  entries(): ReadonlyMap<string, ConfigValue> { return new Map(this._values); }

  /** Keys present in the file; may include unknown keys. */
  keys(): string[] { return [...this._values.keys()]; }

  /** Checks whether a key is known by the schema. */
  isKnown(key: string): boolean { return typeof key === 'string' && Object.hasOwn(SERVER_CONFIG_SCHEMA, key); }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Returns a new instance with the modified value.
   * The key must be known by the schema; otherwise TypeError is thrown.
   */
  set(key: string, value: ConfigValue): ServerConfig {
    if (!this.isKnown(key)) {
      throw new TypeError(`Unknown ServerConfig schema key: "${key}"`);
    }
    ServerConfig._validateValue(key, value, true);
    const newValues = new Map(this._values);
    newValues.set(key, value);

    // Update the matching line in _lines
    const newLines = ServerConfig._updateLine(this._lines, key, value);
    return new ServerConfig(newValues, newLines, this._limits);
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
  private static _parse(lines: string[], limits: Required<FormatLimits>): ServerConfig {
    const values = new Map<string, ConfigValue>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

      // Format: KEY = value // optional comment
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;

      const key     = trimmed.slice(0, eqIdx).trim();
      const rest    = trimmed.slice(eqIdx + 1);
      const commentIdx = rest.indexOf('//');
      const rawValue = (commentIdx >= 0 ? rest.slice(0, commentIdx) : rest).trim();

      if (!key) throw new TypeError('Server config key must not be empty');
      values.set(key, ServerConfig._castValue(key, rawValue));
      checkEntryCount(values.size, limits);
    }

    return new ServerConfig(values, lines, limits);
  }

  /**
   * Handles the castValue operation used by StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param key - Input value for the _castValue operation.
   * @param raw - Input value for the _castValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _castValue(key: string, raw: string): ConfigValue {
    const meta = Object.hasOwn(SERVER_CONFIG_SCHEMA, key) ? SERVER_CONFIG_SCHEMA[key] : undefined;
    if (!meta) return raw; // unknown key → raw string

    let value: ConfigValue = raw;
    if (meta.type === 'boolean') {
      if (!/^(true|false)$/i.test(raw)) throw new TypeError(`Invalid boolean for ${key}`);
      value = raw.toLowerCase() === 'true';
    } else if (meta.type === 'number' || meta.type === 'float') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new TypeError(`Invalid number for ${key}`);
      value = Number(raw);
    }
    ServerConfig._validateValue(key, value);
    return value;
  }

  /** Rejects values that would change type or inject records when reparsed. */
  private static _validateValue(key: string, value: ConfigValue, enforceBounds = false): void {
    const meta = SERVER_CONFIG_SCHEMA[key];
    const type = meta.type;
    if (type === 'boolean') {
      if (typeof value !== 'boolean') throw new TypeError(`${key} requires a boolean`);
    } else if (type === 'string') {
      if (typeof value !== 'string' || value.trim() !== value || /[\r\n]/.test(value) || value.includes('//') || Buffer.from(value).toString('utf8') !== value) {
        throw new TypeError(`${key} requires text representable on one server.cfg line`);
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'number' && !Number.isSafeInteger(value))) {
      throw new TypeError(`${key} requires a finite ${type === 'number' ? 'safe integer' : 'number'}`);
    }
    if (meta.kind === 'enum' && !meta.choices!.some(choice => String(choice).toLowerCase() === String(value).toLowerCase())) {
      throw new RangeError(`${key} must be one of ${meta.choices!.join(', ')}`);
    }
    // Reading retains an existing file's original numeric value; new edits must
    // be representable in the current game's inclusive state range.
    if (enforceBounds && typeof value === 'number') {
      if (value < meta.min!) throw new RangeError(`${key} must be at least ${meta.min}`);
      if (value > meta.max!) throw new RangeError(`${key} must be at most ${meta.max}`);
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
    let found = false;
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
      const ending = line.endsWith('\r') ? '\r' : '';
      newLines[i] = `${key} = ${value}${comment}${ending}`;
      found = true;
    }
    // Missing key → append at the end
    if (!found) newLines.push(`${key} = ${value}`);
    return newLines;
  }
}
