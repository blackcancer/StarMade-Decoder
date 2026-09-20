/**
 * @fileoverview Player State Entity
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerStateEntity — player state entity (ENTITY_PLAYERSTATE_*.ent)
 *
 * Port of PlayerState.fromTagStructure() Java.
 *
 * struct[N] map:
 *   [0]  LONG   credits
 *   [1]  STRUCT spawnData (PlayerSpawnData)
 *   [2]  STRUCT inventory (Inventory principal)
 *   [3]  VECTOR3i "sector" (optionnel — legacy format)
 *   [4]  VECTOR3f "lspawn" — local logout position
 *   [5]  VECTOR3i "lsector" — sector logout
 *   [6]  STRUCT  factionController [INT factionId, INT rank]
 *   [7]  LONG    lastLogin
 *   [8]  LONG    lastLogout
 *   [9]  STRUCT  ipHistory / pFac
 *   [10] BYTE    hasCreativeMode
 *   [11] STRING  lastEnteredEntity
 *   [12] VECTOR3i testSector
 *   [13] INT     helmetSlot
 *   [14] STRUCT  playerAiManager
 *   [15] VECTOR3i personalSector
 *   [16] STRUCT  factoryInventoryCapsule
 *   [17] STRUCT  factoryInventoryMicro
 *   [18] STRUCT  factoryInventoryMacro
 *   [19] LONG    lastDeathNotSuicide
 *   [21] BYTE    factionPointProtected
 *   [26] STRUCT  ignored list
 *   [27] FLOAT   health
 *   [30] INT     mineAutoArmSecs
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { StarMadeEntity } from './StarMadeEntity.js';
import { SectorPosition } from '../components/Transform.js';
import { Inventory } from '../components/Inventory.js';
import { PlayerSpawnData, SpawnPoint } from '../components/SpawnData.js';
import {
  buildEditableEntityFields,
  fieldValueAsBigInt,
  fieldValueAsBoolean,
  fieldValueAsInteger,
  fieldValueAsNumber,
  fieldValueAsString,
  PLAYER_STATE_FIELD_SCHEMA,
  type EntityField,
} from '../EntityFieldView.js';
import {
  CargoInventoryBlock,
  IgnoredPlayers,
  InventoryBackupState,
  PlayerInfoHistoryList,
  SavedCoordinates,
  ScanHistory,
} from '../EntitySlotObjects.js';

// ── FactionMembership ─────────────────────────────────────────────────────────

/**
 * Represents the FactionMembership model used by high-level StarMade entity modelling.
 */
export class FactionMembership {
  private readonly file: TagModelFile;
  /** The second INT is the persisted suspension state, not a faction role/rank. */
  constructor(readonly factionId: number, readonly suspended: number, options: TagReadOptions = {}, source?: TagModelFile) {
    this.file = source ?? new TagModelFile(Tags.struct('pFac-v0', [Tags.int(null, factionId), Tags.int(null, suspended)]), options);
    Object.defineProperty(this, 'file', { enumerable: false });
    Object.freeze(this);
  }
  /** Empty membership with no faction and no suspension. */
  static readonly NONE = new FactionMembership(0, 0);
  /** @deprecated Misnamed legacy alias; this is a suspension state, not a member role. */
  get rank(): number { return this.suspended; }
  /** Strict positional parsing retains extensions and accepts the historical absent suspension field. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): FactionMembership {
    const file = new TagModelFile(tag, options), s = file.root.getStruct().filter(value => value.type !== TagType.FINISH);
    if (s[0]?.type !== TagType.INT || (s[1] && s[1].type !== TagType.INT)) throw new DecodeError('E_FORMAT', 'Invalid player faction membership');
    return new FactionMembership(s[0].getInt(), s[1] ? s[1].getInt() : 0, options, file);
  }
  /** Updates existing tuple fields while retaining names and unknown extensions. */
  withFaction(factionId: number, suspended: number): FactionMembership {
    let root = replaceTagField(this.file.root, 0, Tags.int(null, factionId));
    const fields = root.getStruct().filter(value => value.type !== TagType.FINISH);
    if (fields[1]) root = replaceTagField(root, 1, Tags.int(null, suspended));
    else if (suspended !== 0) root = Tags.struct(root.name, [...fields, Tags.int(null, suspended)]);
    return FactionMembership.fromTag(root, this.file.options);
  }
  /** Complete detached tuple, including its original field names and extensions. */
  toTag(): Tag { return this.file.root; }
  /** Diagnostic output names the actual suspension value. */
  toString(): string { return `FactionMembership(id=${this.factionId}, suspended=${this.suspended})`; }
}

// ── PlayerStateEntity ─────────────────────────────────────────────────────────

/**
 * Represents the PlayerStateEntity model used by high-level StarMade entity modelling.
 */
export class PlayerStateEntity extends StarMadeEntity {
  readonly entityType = 'PLAYER_STATE';

  readonly credits: bigint;
  readonly currentSector: SectorPosition | null;
  readonly logoutSector: SectorPosition | null;
  readonly logoutLocalX: number;
  readonly logoutLocalY: number;
  readonly logoutLocalZ: number;
  readonly faction: FactionMembership;
  readonly lastLogin: bigint;
  readonly lastLogout: bigint;
  readonly hasCreativeMode: boolean;
  readonly lastEnteredEntity: string;
  readonly health: number;
  /** Derives fields from the private source; malformed inventory/spawn data is never silently discarded. */
  private constructor(private readonly file: TagModelFile) {
    super(); const s = this._rootTag.getStruct().filter(tag => tag.type !== TagType.FINISH);
    if (![TagType.INT, TagType.LONG].includes(s[0]?.type) || !s[1] || s[2]?.type !== TagType.STRUCT) {
      throw new DecodeError('E_FORMAT', 'Player state requires credits, spawn data and inventory');
    }
    this.credits = s[0].type === TagType.INT ? BigInt(s[0].getInt()) : s[0].getLong();
    this.currentSector = sector(s[3], 'sector', file.options); this.logoutSector = sector(s[5], 'lsector', file.options);
    const local = s[4]?.name === 'lspawn' ? s[4].getVector3f() : null;
    this.logoutLocalX = local?.x ?? 0; this.logoutLocalY = local?.y ?? 0; this.logoutLocalZ = local?.z ?? 0;
    this.faction = s[6] ? FactionMembership.fromTag(s[6], file.options) : FactionMembership.NONE;
    this.lastLogin = optional(s[7], TagType.LONG, 0n); this.lastLogout = optional(s[8], TagType.LONG, 0n);
    this.hasCreativeMode = optional(s[10], TagType.BYTE, 0) !== 0;
    this.lastEnteredEntity = optional(s[11], TagType.STRING, ''); this.health = finite(optional(s[27], TagType.FLOAT, 100));
    this.spawnData; this.inventory; this.capsuleInventory; this.microInventory; this.macroInventory;
    Object.defineProperty(this, 'file', { enumerable: false });
    Object.freeze(this);
  }
  /** Detached source for field views and positional updates. */
  private get _rootTag(): Tag { return this.file.root; }
  /** Fresh component projection prevents mutations of public component objects from affecting the entity. */
  get spawnData(): PlayerSpawnData { return playerSpawn(this._childAt(1), this.currentSector, this.file.options); }
  /** Complete supported InventoryWire projection; caller mutations never alias retained source data. */
  get inventory(): Inventory { return Inventory.fromTag(this._childAt(2), this.file.options); }
  /** Optional capsule inventory, decoded strictly when present. */
  get capsuleInventory(): Inventory { return this.inventoryAt(16); }
  /** Optional micro inventory, decoded strictly when present. */
  get microInventory(): Inventory { return this.inventoryAt(17); }
  /** Optional macro inventory, decoded strictly when present. */
  get macroInventory(): Inventory { return this.inventoryAt(18); }
  /** Returns an independent empty inventory only when the legacy slot is absent. */
  private inventoryAt(index: number): Inventory {
    const tag = this.file.root.getStruct().filter(value => value.type !== TagType.FINISH)[index];
    return tag ? Inventory.fromTag(tag, this.file.options) : new Inventory(new Map());
  }

  /** StarMade-Open PlayerState slot view, without raw Tag exposure. */
  get fields(): readonly EntityField<PlayerStateEntity>[] {
    const children = this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH);
    return buildEditableEntityFields(children, PLAYER_STATE_FIELD_SCHEMA, {
      credits: value => this.withCredits(fieldValueAsBigInt(value, 'credits')),
      inventory: value => this.withInventory(requireInstance(value, Inventory, 'inventory')),
      factionMembership: value => {
        const membership = factionMembershipFromFieldValue(value);
        return this.withFaction(membership.factionId, membership.rank);
      },
      lastLogin: value => this.withLastLogin(fieldValueAsBigInt(value, 'lastLogin')),
      lastLogout: value => this.withLastLogout(fieldValueAsBigInt(value, 'lastLogout')),
      hostHistory: value => this.withHostHistory(requireInstance(value, PlayerInfoHistoryList, 'hostHistory')),
      creativeMode: value => this.withCreativeMode(fieldValueAsBoolean(value, 'creativeMode')),
      lastEnteredEntity: value => this.withLastEnteredEntity(fieldValueAsString(value, 'lastEnteredEntity')),
      scanHistory: value => this.withScanHistory(requireInstance(value, ScanHistory, 'scanHistory')),
      inventoryBackup: value => this.withInventoryBackup(requireInstance(value, InventoryBackupState, 'inventoryBackup')),
      savedCoordinates: value => this.withSavedCoordinates(requireInstance(value, SavedCoordinates, 'savedCoordinates')),
      ignoredPlayers: value => this.withIgnoredPlayers(requireInstance(value, IgnoredPlayers, 'ignoredPlayers')),
      health: value => this.withHealth(fieldValueAsNumber(value, 'health')),
      cargoInventoryBlock: value => this.withCargoInventoryBlock(requireInstance(value, CargoInventoryBlock, 'cargoInventoryBlock')),
      mineAutoArmSecs: value => this.withMineAutoArmSecs(fieldValueAsInteger(value, 'mineAutoArmSecs')),
    });
  }

  /**
   * Returns Field.
   *
   * @param key - Input value for the getField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getField(key: string): EntityField<PlayerStateEntity> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  /**
   * Handles the hostHistoryField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hostHistoryField(): EntityField<PlayerStateEntity> | null { return this.fields[9] ?? null; }
  /**
   * Handles the playerAiManagerField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get playerAiManagerField(): EntityField<PlayerStateEntity> | null { return this.fields[14] ?? null; }
  /**
   * Handles the scanHistoryField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get scanHistoryField(): EntityField<PlayerStateEntity> | null { return this.fields[20] ?? null; }
  /**
   * Handles the inventoryBackupField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get inventoryBackupField(): EntityField<PlayerStateEntity> | null { return this.fields[22] ?? null; }
  /**
   * Saves dCoordinatesField back to StarMade project files.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get savedCoordinatesField(): EntityField<PlayerStateEntity> | null { return this.fields[23] ?? null; }
  /**
   * Handles the ignoredPlayersField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get ignoredPlayersField(): EntityField<PlayerStateEntity> | null { return this.fields[26] ?? null; }
  /**
   * Handles the cargoInventoryBlockField operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get cargoInventoryBlockField(): EntityField<PlayerStateEntity> | null { return this.fields[28] ?? null; }

  /**
   * Handles the hostHistory operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hostHistory(): PlayerInfoHistoryList { return new PlayerInfoHistoryList(this._childAt(9), this.file.options); }
  /**
   * Handles the scanHistory operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get scanHistory(): ScanHistory { return new ScanHistory(this._childAt(20), this.file.options); }
  /**
   * Handles the inventoryBackup operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get inventoryBackup(): InventoryBackupState { return new InventoryBackupState(this._childAt(22), this.file.options); }
  /**
   * Saves dCoordinates back to StarMade project files.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get savedCoordinates(): SavedCoordinates { return new SavedCoordinates(this._childAt(23), this.file.options); }
  /**
   * Handles the ignoredPlayers operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get ignoredPlayers(): IgnoredPlayers { return new IgnoredPlayers(this._childAt(26), this.file.options); }
  /**
   * Handles the cargoInventoryBlock operation used by high-level StarMade entity modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get cargoInventoryBlock(): CargoInventoryBlock { return new CargoInventoryBlock(this._childAt(28), this.file.options); }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Returns a copy updated with Credits.
   *
   * @param credits - Input value for the withCredits operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCredits(credits: bigint): PlayerStateEntity {
    if (typeof credits !== 'bigint') throw new DecodeError('E_RANGE', 'Credits must be bigint');
    const original = this.file.originalRoot.getStruct()[0];
    const value = original.type === TagType.INT && credits >= -2147483648n && credits <= 2147483647n
      ? Tags.int(null, Number(credits)) : Tags.long(null, credits);
    return this.updated(replaceTagField(this._rootTag, 0, value, [TagType.INT, TagType.LONG]));
  }

  /**
   * Returns a copy updated with CreativeMode.
   *
   * @param enabled - Input value for the withCreativeMode operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCreativeMode(enabled: boolean): PlayerStateEntity {
    if (typeof enabled !== 'boolean') throw new DecodeError('E_RANGE', 'Creative mode must be boolean');
    const original = this.file.originalRoot.getStruct()[10];
    const value = original?.type === TagType.BYTE && (original.getByte() !== 0) === enabled ? original.getByte() : Number(enabled);
    return this._withChild(10, Tags.byte(null, value));
  }

  /**
   * Returns a copy updated with Faction.
   *
   * @param factionId - Input value for the withFaction operation.
   * @param rank - Legacy argument name: this is the persisted suspension value, not a member role.
   * @returns The computed StarMade-Decoder value.
   */
  withFaction(factionId: number, rank = 0): PlayerStateEntity {
    const existing = FactionMembership.fromTag(this._childAt(6), this.file.options);
    return this._withChild(6, existing.withFaction(factionId, rank).toTag());
  }

  /**
   * Returns a copy updated with Health.
   *
   * @param health - Input value for the withHealth operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHealth(health: number): PlayerStateEntity {
    return this._withChild(27, Tags.float(null, finite(health)));
  }

  /**
   * Returns a copy updated with Inventory.
   *
   * @param inventory - Input value for the withInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withInventory(inventory: Inventory): PlayerStateEntity {
    return this._withChild(2, this.inventory.withContents(inventory).toTag());
  }

  /**
   * Returns a copy updated with LastLogin.
   *
   * @param lastLogin - Input value for the withLastLogin operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastLogin(lastLogin: bigint): PlayerStateEntity {
    return this._withChild(7, Tags.long(null, lastLogin));
  }

  /**
   * Returns a copy updated with LastLogout.
   *
   * @param lastLogout - Input value for the withLastLogout operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastLogout(lastLogout: bigint): PlayerStateEntity {
    return this._withChild(8, Tags.long(null, lastLogout));
  }

  /**
   * Returns a copy updated with HostHistory.
   *
   * @param hostHistory - Input value for the withHostHistory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHostHistory(hostHistory: PlayerInfoHistoryList): PlayerStateEntity {
    return this._withChild(9, hostHistory.toTag());
  }

  /**
   * Returns a copy updated with LastEnteredEntity.
   *
   * @param lastEnteredEntity - Input value for the withLastEnteredEntity operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastEnteredEntity(lastEnteredEntity: string): PlayerStateEntity {
    return this._withChild(11, Tags.string(null, lastEnteredEntity));
  }

  /**
   * Returns a copy updated with MineAutoArmSecs.
   *
   * @param mineAutoArmSecs - Input value for the withMineAutoArmSecs operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMineAutoArmSecs(mineAutoArmSecs: number): PlayerStateEntity {
    return this._withChild(30, Tags.int(null, mineAutoArmSecs));
  }

  /**
   * Returns a copy updated with ScanHistory.
   *
   * @param scanHistory - Input value for the withScanHistory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withScanHistory(scanHistory: ScanHistory): PlayerStateEntity {
    return this._withChild(20, scanHistory.toTag());
  }

  /**
   * Returns a copy updated with InventoryBackup.
   *
   * @param inventoryBackup - Input value for the withInventoryBackup operation.
   * @returns The computed StarMade-Decoder value.
   */
  withInventoryBackup(inventoryBackup: InventoryBackupState): PlayerStateEntity {
    return this._withChild(22, inventoryBackup.toTag());
  }

  /**
   * Returns a copy updated with SavedCoordinates.
   *
   * @param savedCoordinates - Input value for the withSavedCoordinates operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSavedCoordinates(savedCoordinates: SavedCoordinates): PlayerStateEntity {
    return this._withChild(23, savedCoordinates.toTag());
  }

  /**
   * Returns a copy updated with IgnoredPlayers.
   *
   * @param ignoredPlayers - Input value for the withIgnoredPlayers operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIgnoredPlayers(ignoredPlayers: IgnoredPlayers): PlayerStateEntity {
    return this._withChild(26, ignoredPlayers.toTag());
  }

  /**
   * Returns a copy updated with CargoInventoryBlock.
   *
   * @param cargoInventoryBlock - Input value for the withCargoInventoryBlock operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCargoInventoryBlock(cargoInventoryBlock: CargoInventoryBlock): PlayerStateEntity {
    return this._withChild(28, cargoInventoryBlock.toTag());
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag { return this.file.root; }
  /**
   * Converts this value to Buffer.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toBuffer(): Buffer { return this.file.toBuffer(); }

  /**
   * Returns a copy updated with Child.
   *
   * @param index - Input value for the _withChild operation.
   * @param tag - Input value for the _withChild operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _withChild(index: number, tag: Tag): PlayerStateEntity {
    const accepted = index === 22 || index === 28 ? [TagType.BYTE, TagType.STRUCT] : [tag.type];
    return this.updated(replaceTagField(this._rootTag, index, tag, accepted));
  }

  /**
   * Handles the childAt operation used by high-level StarMade entity modelling.
   *
   * @param index - Input value for the _childAt operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _childAt(index: number): Tag {
    return this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH)[index] ?? Tags.nothing(null);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag, options: TagReadOptions = {}): PlayerStateEntity {
    return new PlayerStateEntity(new TagModelFile(root, options));
  }
  /** Reads the complete file once under shared budgets and preserves its original envelope. */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): PlayerStateEntity {
    return new PlayerStateEntity(TagModelFile.fromBuffer(data, options));
  }
  /** Validates a revision with the same limits and original compression/version/trailing data. */
  private updated(root: Tag): PlayerStateEntity { return new PlayerStateEntity(this.file.withRoot(root)); }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `PlayerState(credits=${this.credits}, sector=${this.currentSector}, creative=${this.hasCreativeMode}, health=${this.health})`;
  }
}

/**
 * Handles the factionMembershipFromFieldValue operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the factionMembershipFromFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function factionMembershipFromFieldValue(value: unknown): FactionMembership {
  if (value instanceof FactionMembership) return value;
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return new FactionMembership(
      fieldValueAsInteger(candidate.factionId, 'factionMembership.factionId'),
      fieldValueAsInteger(candidate.suspended ?? candidate.rank ?? 0, 'factionMembership.rank'),
    );
  }
  throw new TypeError('Entity field "factionMembership" expects a FactionMembership or {factionId,rank}');
}

/**
 * Handles the requireInstance operation used by high-level StarMade entity modelling.
 *
 * @param value - Input value for the requireInstance operation.
 * @param ctor - Input value for the requireInstance operation.
 * @param key - Input value for the requireInstance operation.
 * @returns The computed StarMade-Decoder value.
 */
function requireInstance<T>(value: unknown, ctor: new (...args: any[]) => T, key: string): T {
  if (value instanceof ctor) return value;
  throw new TypeError(`Entity field "${key}" expects a ${ctor.name} object`);
}

/** Reads an optional scalar without converting a present malformed value into a default. */
function optional<T extends bigint | number | string>(tag: Tag | undefined, type: TagType, fallback: T): T {
  if (!tag) return fallback;
  if (tag.type !== type) throw new DecodeError('E_FORMAT', 'Invalid optional player field');
  return tag.value as T;
}
/** Legacy named sectors remain optional; a present matching field must have the correct type. */
function sector(tag: Tag | undefined, name: string, options: TagReadOptions): SectorPosition | null {
  if (tag?.name !== name) return null;
  return SectorPosition.fromTag(tag, options);
}
/** Rejects non-finite health/position values before float32 storage. */
function finite(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE', 'Player value must fit finite float32');
  return Math.fround(value);
}
/** Reads both the actual structured spawn data and the documented legacy VECTOR3f form. */
function playerSpawn(tag: Tag, current: SectorPosition | null, options: TagReadOptions): PlayerSpawnData {
  if (tag.type === TagType.VECTOR3f) {
    const value = tag.getVector3f(), position = current ?? new SectorPosition(0, 0, 0);
    return new PlayerSpawnData(0, new SpawnPoint('', position, value.x, value.y, value.z, 0, 0, 0, options),
      new SpawnPoint('', new SectorPosition(0, 0, 0), 0, 0, 0, 0, 0, 0, options), null, 0, 0, 0, options);
  }
  return PlayerSpawnData.fromTag(tag, options);
}
