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
import { readFrom, writeTo } from '../../core/TagParser.js';
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

export class FactionMembership {
  constructor(
    readonly factionId: number,
    readonly rank: number,
  ) {}

  static NONE = new FactionMembership(0, 0);

  static fromTag(tag: Tag): FactionMembership {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    return new FactionMembership(
      s[0]?.type === TagType.INT ? s[0].getInt() : 0,
      s[1]?.type === TagType.INT ? s[1].getInt() : 0,
    );
  }

  toTag(): Tag {
    return Tags.struct(null, [
      Tags.int(null, this.factionId),
      Tags.int(null, this.rank),
    ]);
  }

  toString(): string { return `FactionMembership(id=${this.factionId}, rank=${this.rank})`; }
}

// ── PlayerStateEntity ─────────────────────────────────────────────────────────

export class PlayerStateEntity extends StarMadeEntity {
  readonly entityType = 'PLAYER_STATE';

  constructor(
    readonly credits: bigint,
    readonly spawnData: PlayerSpawnData,
    readonly inventory: Inventory,
    readonly currentSector: SectorPosition | null,
    readonly logoutSector: SectorPosition | null,
    readonly logoutLocalX: number,
    readonly logoutLocalY: number,
    readonly logoutLocalZ: number,
    readonly faction: FactionMembership,
    readonly lastLogin: bigint,
    readonly lastLogout: bigint,
    readonly hasCreativeMode: boolean,
    readonly lastEnteredEntity: string,
    readonly health: number,
    readonly capsuleInventory: Inventory,
    readonly microInventory: Inventory,
    readonly macroInventory: Inventory,
    /** All root Tag children for faithful round-tripping */
    private readonly _rootTag: Tag,
  ) {
    super();
    Object.defineProperty(this, '_rootTag', { enumerable: false });
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

  getField(key: string): EntityField<PlayerStateEntity> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  get hostHistoryField(): EntityField<PlayerStateEntity> | null { return this.fields[9] ?? null; }
  get playerAiManagerField(): EntityField<PlayerStateEntity> | null { return this.fields[14] ?? null; }
  get scanHistoryField(): EntityField<PlayerStateEntity> | null { return this.fields[20] ?? null; }
  get inventoryBackupField(): EntityField<PlayerStateEntity> | null { return this.fields[22] ?? null; }
  get savedCoordinatesField(): EntityField<PlayerStateEntity> | null { return this.fields[23] ?? null; }
  get ignoredPlayersField(): EntityField<PlayerStateEntity> | null { return this.fields[26] ?? null; }
  get cargoInventoryBlockField(): EntityField<PlayerStateEntity> | null { return this.fields[28] ?? null; }

  get hostHistory(): PlayerInfoHistoryList { return new PlayerInfoHistoryList(this._childAt(9)); }
  get scanHistory(): ScanHistory { return new ScanHistory(this._childAt(20)); }
  get inventoryBackup(): InventoryBackupState { return new InventoryBackupState(this._childAt(22)); }
  get savedCoordinates(): SavedCoordinates { return new SavedCoordinates(this._childAt(23)); }
  get ignoredPlayers(): IgnoredPlayers { return new IgnoredPlayers(this._childAt(26)); }
  get cargoInventoryBlock(): CargoInventoryBlock { return new CargoInventoryBlock(this._childAt(28)); }

  // ── Immutable updates ──────────────────────────────────────────────

  withCredits(credits: bigint): PlayerStateEntity {
    const newTag = Tags.setField(this._rootTag, 'credits', Tags.long('credits', credits));
    return PlayerStateEntity.fromTag(newTag);
  }

  withCreativeMode(enabled: boolean): PlayerStateEntity {
    // [10] = BYTE hasCreativeMode (anonymous, access by index)
    const children = this._rootTag.getStruct();
    const newChildren = [...children];
    if (newChildren[10]?.type === TagType.BYTE) {
      newChildren[10] = Tags.byte(null, enabled ? 1 : 0);
    }
    const newTag = new Tag(TagType.STRUCT, this._rootTag.name, newChildren);
    return PlayerStateEntity.fromTag(newTag);
  }

  withFaction(factionId: number, rank = 0): PlayerStateEntity {
    const membership = new FactionMembership(factionId, rank);
    const facTag = this._rootTag.getStruct().find(
      t => t.name === 'pFac-v0' || t.name === 'pFac'
    );
    if (facTag?.name) {
      const newTag = Tags.setField(this._rootTag, facTag.name, membership.toTag());
      return PlayerStateEntity.fromTag(new Tag(TagType.STRUCT, newTag.name,
        [...newTag.getStruct().filter(t => t.type !== TagType.FINISH),
         ...( [newTag.getStruct().find(t => t.type === TagType.FINISH)!])]));
    }
    return this;
  }

  withHealth(health: number): PlayerStateEntity {
    return this._withChild(27, Tags.float(null, health));
  }

  withInventory(inventory: Inventory): PlayerStateEntity {
    const children = this._rootTag.getStruct();
    const newChildren = [...children];
    if (newChildren[2]?.type === TagType.STRUCT) {
      newChildren[2] = inventory.toTag();
    }
    return PlayerStateEntity.fromTag(new Tag(TagType.STRUCT, this._rootTag.name, newChildren));
  }

  withLastLogin(lastLogin: bigint): PlayerStateEntity {
    return this._withChild(7, Tags.long(null, lastLogin));
  }

  withLastLogout(lastLogout: bigint): PlayerStateEntity {
    return this._withChild(8, Tags.long(null, lastLogout));
  }

  withHostHistory(hostHistory: PlayerInfoHistoryList): PlayerStateEntity {
    return this._withChild(9, hostHistory.toTag());
  }

  withLastEnteredEntity(lastEnteredEntity: string): PlayerStateEntity {
    return this._withChild(11, Tags.string(null, lastEnteredEntity));
  }

  withMineAutoArmSecs(mineAutoArmSecs: number): PlayerStateEntity {
    return this._withChild(30, Tags.int(null, mineAutoArmSecs));
  }

  withScanHistory(scanHistory: ScanHistory): PlayerStateEntity {
    return this._withChild(20, scanHistory.toTag());
  }

  withInventoryBackup(inventoryBackup: InventoryBackupState): PlayerStateEntity {
    return this._withChild(22, inventoryBackup.toTag());
  }

  withSavedCoordinates(savedCoordinates: SavedCoordinates): PlayerStateEntity {
    return this._withChild(23, savedCoordinates.toTag());
  }

  withIgnoredPlayers(ignoredPlayers: IgnoredPlayers): PlayerStateEntity {
    return this._withChild(26, ignoredPlayers.toTag());
  }

  withCargoInventoryBlock(cargoInventoryBlock: CargoInventoryBlock): PlayerStateEntity {
    return this._withChild(28, cargoInventoryBlock.toTag());
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toTag(): Tag { return this._rootTag; }
  toBuffer(): Buffer { return writeTo(this._rootTag); }

  private _withChild(index: number, tag: Tag): PlayerStateEntity {
    const children = this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH);
    while (children.length <= index) children.push(Tags.nothing(null));
    const current = children[index];
    children[index] = current?.name !== undefined && tag.name === null
      ? new Tag(tag.type, current.name, tag.value)
      : tag;
    return PlayerStateEntity.fromTag(new Tag(TagType.STRUCT, this._rootTag.name, [...children, FINISH_TAG]));
  }

  private _childAt(index: number): Tag {
    return this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH)[index] ?? Tags.nothing(null);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  static fromTag(root: Tag): PlayerStateEntity {
    const s = root.type === TagType.STRUCT
      ? root.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    // [0] credits
    const credits = s[0]?.type === TagType.LONG ? s[0].getLong() : 0n;

    // [1] spawnData
    let spawnData = PlayerSpawnData.EMPTY;
    if (s[1]?.type === TagType.STRUCT) {
      try { spawnData = PlayerSpawnData.fromTag(s[1]); } catch { /* skip */ }
    }

    // [2] inventory
    let inventory = Inventory.EMPTY;
    if (s[2]?.type === TagType.STRUCT) {
      try { inventory = Inventory.fromTag(s[2]); } catch { /* skip */ }
    }

    // Current sector
    let currentSector: SectorPosition | null = null;
    if (s[3]?.type === TagType.VECTOR3i) {
      const v = s[3].getVector3i();
      currentSector = new SectorPosition(v.x, v.y, v.z);
    }
    const lsectorTag = s.find(t => t.name === 'lsector' && t.type === TagType.VECTOR3i);
    const logoutSector = lsectorTag ? (() => { const v = lsectorTag.getVector3i(); return new SectorPosition(v.x, v.y, v.z); })() : null;

    const lspawnTag = s.find(t => t.name === 'lspawn' && t.type === TagType.VECTOR3f);
    const lsp = lspawnTag?.getVector3f();

    // [6] factionController
    let faction = FactionMembership.NONE;
    const facTag = s.find(t => (t.name === 'pFac-v0' || t.name === 'pFac') && t.type === TagType.STRUCT);
    if (facTag) { try { faction = FactionMembership.fromTag(facTag); } catch { /* skip */ } }

    const lastLogin    = s[7]?.type === TagType.LONG   ? s[7].getLong()    : 0n;
    const lastLogout   = s[8]?.type === TagType.LONG   ? s[8].getLong()    : 0n;
    const creative     = s[10]?.type === TagType.BYTE  ? s[10].getByte() !== 0 : false;
    const lastEntered  = s[11]?.type === TagType.STRING ? s[11].getString() : '';
    const health       = s[27]?.type === TagType.FLOAT ? s[27].getFloat()  : 100;

    // Inventaires de fabrique
    let capsule = Inventory.EMPTY, micro = Inventory.EMPTY, macro = Inventory.EMPTY;
    if (s[16]?.type === TagType.STRUCT) { try { capsule = Inventory.fromTag(s[16]); } catch {} }
    if (s[17]?.type === TagType.STRUCT) { try { micro   = Inventory.fromTag(s[17]); } catch {} }
    if (s[18]?.type === TagType.STRUCT) { try { macro   = Inventory.fromTag(s[18]); } catch {} }

    return new PlayerStateEntity(
      credits, spawnData, inventory, currentSector, logoutSector,
      lsp?.x ?? 0, lsp?.y ?? 0, lsp?.z ?? 0,
      faction, lastLogin, lastLogout, creative, lastEntered, health,
      capsule, micro, macro, root,
    );
  }

  static fromBuffer(data: Buffer | Uint8Array): PlayerStateEntity {
    return PlayerStateEntity.fromTag(readFrom(data));
  }

  toString(): string {
    return `PlayerState(credits=${this.credits}, sector=${this.currentSector}, creative=${this.hasCreativeMode}, health=${this.health})`;
  }
}

function factionMembershipFromFieldValue(value: unknown): FactionMembership {
  if (value instanceof FactionMembership) return value;
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return new FactionMembership(
      fieldValueAsInteger(candidate.factionId, 'factionMembership.factionId'),
      fieldValueAsInteger(candidate.rank ?? 0, 'factionMembership.rank'),
    );
  }
  throw new TypeError('Entity field "factionMembership" expects a FactionMembership or {factionId,rank}');
}

function requireInstance<T>(value: unknown, ctor: new (...args: any[]) => T, key: string): T {
  if (value instanceof ctor) return value;
  throw new TypeError(`Entity field "${key}" expects a ${ctor.name} object`);
}
