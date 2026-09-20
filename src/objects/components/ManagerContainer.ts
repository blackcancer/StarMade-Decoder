/**
 * @fileoverview Segment Controller Manager Container
 *
 * Represents manager-container state, inventories, power, shields, text blocks, slot assignments, and relevant block-count metadata.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * ManagerContainer stores module state for manageable entities such as ships,
 * space stations, and planets.
 *
 * Port of the Java ManagerContainer.fromTagStructure() / toTagStructure() logic.
 *
 * Tag structure ("container"):
 *   STRUCT "container" [
 *     [0]  STRUCT inventories       ← inventories (kind, position, payload)
 *     [1]  INT    "shipMan0"         ← distance tag (unused)
 *     [2]  STRUCT|BYTE powerTag      ← PowerState for PowerManagerInterface
 *     [3]  DOUBLE|STRUCT shieldTag   ← initialShields or ShieldLocalAddOn
 *     [4]  STRUCT extraTag           ← opaque extra data
 *     [5]  STRUCT actStateTag        ← activation states
 *     [6]  STRUCT texts              ← TextBlocks
 *     [7]  STRUCT relevantECM        ← relevant block ElementCountMap
 *     [8]  STRUCT warpGateInfo       ← warp-gate metadata
 *     [9]  STRUCT moduleTag          ← opaque module data
 *     [10] STRUCT aiTag              ← AI configuration
 *     [11] STRUCT slotAssignment     ← SlotAssignment
 *     [12] STRUCT raceGateInfo       ← opaque race-gate metadata
 *     [13] STRUCT unloadedDummies    ← opaque unloaded entity data
 *     [14] STRUCT moduleExplosions   ← opaque module explosion data
 *     [15] STRUCT powerReactorTag    ← independent opaque PowerInterface reactor tree
 *     [16] BYTE   pullPermission
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { Inventory } from './Inventory.js';
import { InventoryLocation } from './InventoryLocation.js';
import { copyTagModel, rememberTagModel, renderTagModel, tagModelOptions, type TagModelFields } from '../../core/TagModel.js';
import { writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { DecodeError, boundedInteger } from '../../core/DecodeError.js';
import type { BlockPosition } from '../ElementPosition.js';
import { validateBlockPosition, blockPositionKey } from '../../smd3/BlockCoordinates.js';
import { TextBlocks } from './TextBlocks.js';
import { SlotAssignment } from './SlotAssignment.js';
import { PowerState } from './PowerAndThrust.js';
import { ElementCountMap } from '../Serializables.js';
import {
  buildEditableEntityFields,
  fieldValueAsInteger,
  fieldValueAsNumber,
  MANAGER_CONTAINER_FIELD_SCHEMA,
  type EntityField,
} from '../EntityFieldView.js';
import {
  EntSlotObject,
  AiConfigurationState,
  ManagerModulesState,
  ModDataState,
  ModuleExplosionsState,
  RaceGateInfo,
  UnloadedDummiesState,
  WarpGateInfo,
} from '../EntitySlotObjects.js';

// ── PullPermission ────────────────────────────────────────────────────────────

/**
 * Enumerates PullPermission values used by high-level entity component modelling.
 */
export enum PullPermission {
  ALL  = 0,
  SELF = 1,
  NONE = 2,
}

/** Private position indices do not make otherwise frozen manager snapshots mutable. */
const locationCache = new WeakMap<ManagerContainer, ReadonlyMap<string, InventoryLocation>>();

// ── ManagerContainer ──────────────────────────────────────────────────────────

/**
 * Represents the ManagerContainer model used by high-level entity component modelling.
 */
export class ManagerContainer {
  private readonly options: TagReadOptions;
  private readonly inventoryByKind: ReadonlyMap<number, Inventory>;
  /**
   * Creates a ManagerContainer instance.
   *
   * @param inventories - Input value for the constructor operation.
   * @param initialShields - Input value for the constructor operation.
   * @param powerState - Input value for the constructor operation.
   * @param texts - Input value for the constructor operation.
   * @param slotAssignment - Input value for the constructor operation.
   * @param pullPermission - Input value for the constructor operation.
   * @param _children - Input value for the constructor operation.
   */
  constructor(
    /** Legacy kind-keyed view; use inventoryEntries for all positions (kind 3=stash, 1=credits converter). */
    inventories: ReadonlyMap<number, Inventory>,
    /** Initial shield value. */
    readonly initialShields: number,
    /** PowerAddOn in slot 2, separate from the PowerInterface reactor tree in slot 15. */
    readonly powerState: PowerState,
    /** Text blocks from panels and screens. */
    readonly texts: TextBlocks,
    /** Control slot assignments. */
    readonly slotAssignment: SlotAssignment,
    /** Pull permission (0=all, 1=self, 2=none). */
    readonly pullPermission: PullPermission,
    /** Internal StarMade-Open container slots preserved for faithful round-trip serialization. */
    private readonly _children: Tag[], options: TagReadOptions = {},
  ) {
    this.options = Object.freeze(tagModelOptions(options));
    requireInstance(powerState, PowerState, 'powerAddOn'); requireTextBlocks(texts); requireInstance(slotAssignment, SlotAssignment, 'slotAssignment');
    if (typeof initialShields !== 'number' || !Number.isInteger(pullPermission) || pullPermission < -128 || pullPermission > 127) {
      throw new DecodeError('E_RANGE', 'Invalid manager scalar fields');
    }
    this._children = copyTagModel(Tags.struct(null, _children), this.options).getStruct().filter(tag => tag.type !== TagType.FINISH);
    for (const [kind, inventory] of inventories) { boundedInteger(kind, 'inventory kind', 0x7fffffff); requireInstance(inventory, Inventory, 'inventory'); }
    if (inventories.size && (!this._children[0] || this._children[0].type === TagType.NOTHING)) {
      throw new DecodeError('E_INCOMPLETE', 'Inventory positions are required; use EMPTY.withInventoryAt(position, inventory, kind)');
    }
    if (this._children[3]?.type === TagType.STRUCT && initialShields !== 0) throw new DecodeError('E_FORMAT', 'Scalar shields cannot override a modern shield tree');
    const byKind = new Map<number, Inventory>();
    for (const entry of this.inventoryLocations().values()) byKind.set(entry.kind, entry.inventory);
    for (const [kind, inventory] of inventories) {
      const stored = byKind.get(kind);
      if (!stored || !writeTo(stored.toTag(), this.options).equals(writeTo(inventory.toTag(), this.options))) {
        throw new DecodeError('E_FORMAT', 'Inventory map differs from the stored position records');
      }
    }
    this.inventoryByKind = byKind;
    this.relevantElementCountMap;
    writeTo(this.toTag(), this.options);
    Object.defineProperty(this, 'inventoryByKind', { enumerable: false });
    Object.defineProperty(this, '_children', { enumerable: false });
    Object.defineProperty(this, 'options', { enumerable: false });
    Object.freeze(this);
  }

  /** Detached legacy kind-keyed view; inventoryEntries is the complete collection keyed by position. */
  get inventories(): ReadonlyMap<number, Inventory> { return new Map(this.inventoryByKind); }

  static readonly EMPTY = new ManagerContainer(
    new Map(), 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY,
    PullPermission.ALL, []
  );

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag, options: TagReadOptions = {}): ManagerContainer {
    tag=copyTagModel(tag,options);
    const parts = tag.getStruct().filter(t => t.type !== TagType.FINISH);

    // [2] power (PowerAddOn, legacy system)
    // [3] shields
    let initialShields = 0;
    if (parts[3]?.type === TagType.DOUBLE) {
      initialShields = parts[3].getDouble();
    }

    // [6] text blocks
    const texts = parts[6]?.type === TagType.STRUCT
      ? TextBlocks.fromTag(parts[6],options)
      : TextBlocks.EMPTY;

    // [11] slotAssignment
    const slotAssignment = parts[11]?.type === TagType.STRUCT
      ? SlotAssignment.fromTag(parts[11],options)
      : SlotAssignment.EMPTY;

    // PowerAddOn lives at slot 2. Slot 15 is a different reactor schema.
    let powerState = PowerState.EMPTY;
    if (parts[2]?.type === TagType.STRUCT || parts[2]?.type === TagType.DOUBLE) powerState = PowerState.fromTagOld(parts[2], options);
    for (const [index, types] of [[2, [TagType.STRUCT, TagType.DOUBLE]], [3, [TagType.STRUCT, TagType.DOUBLE]],
      [6, [TagType.STRUCT]], [11, [TagType.STRUCT]], [16, []]] as const) {
      const value = parts[index];
      if (value && value.type !== TagType.NOTHING && value.type !== TagType.BYTE && !(types as readonly TagType[]).includes(value.type)) {
        throw new DecodeError('E_FORMAT', `Invalid manager field ${index}`);
      }
    }

    // [16] pullPermission
    const pullPerm = parts[16]?.type === TagType.BYTE
      ? (parts[16].getByte() as PullPermission)
      : PullPermission.ALL;

    const result = new ManagerContainer(
      new Map(), initialShields, powerState, texts, slotAssignment, pullPerm, parts,options
    );
    rememberTagModel(result,tag,result.fieldsForTag(),options);return result;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Returns an unambiguous legacy kind match.
   * @deprecated Use getInventoryAt(position) to address the complete collection.
   *
   * @param type - Input value for the getInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  getInventory(type = 0): Inventory {
    if (this.inventoryTags().filter(tag => tag.type === TagType.STRUCT && tag.getStruct()[0]?.value === type).length > 1) {
      throw new DecodeError('E_FORMAT', 'Several inventories share this kind; use getInventoryAt(position)');
    }
    boundedInteger(type, 'inventory kind', 0x7fffffff);
    return this.inventoryByKind.get(type) ?? new Inventory(new Map(), Infinity, undefined, this.options);
  }

  /** Complete position-indexed inventories; malformed or duplicate positions fail explicitly. */
  get inventoryEntries(): readonly InventoryLocation[] {
    return [...this.inventoryLocations().values()];
  }

  /** Builds the immutable position index once; repeated lookups are constant time. */
  private inventoryLocations(): ReadonlyMap<string, InventoryLocation> {
    const cached = locationCache.get(this); if (cached) return cached;
    const locations = new Map<string, InventoryLocation>();
    for (const tag of this.inventoryTags()) {
      if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Invalid inventory entry');
      const parts = tag.getStruct();
      if (parts[0]?.type !== TagType.INT || parts[1]?.type !== TagType.VECTOR3i || parts[2]?.type !== TagType.STRUCT) {
        throw new DecodeError('E_FORMAT', 'Inventory entries require kind, block position and inventory payload');
      }
      const entry = new InventoryLocation(parts[0].getInt(), parts[1].getVector3i(), Inventory.fromTag(parts[2],this.options));
      if (locations.has(entry.key)) throw new DecodeError('E_FORMAT', 'Duplicate inventory block position');
      locations.set(entry.key, entry);
    }
    locationCache.set(this, locations);
    return locations;
  }

  /** Looks up an inventory by its actual block position, without conflating inventories of one kind. */
  getInventoryAt(position: BlockPosition): Inventory | undefined {
    validateBlockPosition(position);
    const key = blockPositionKey(position);
    return this.inventoryLocations().get(key)?.inventory;
  }

  /** Edits one location and preserves its wrapper metadata; new inventories default to stash kind 3. */
  withInventoryAt(position: BlockPosition, inventory: Inventory, kind?: number): ManagerContainer {
    validateBlockPosition(position); requireInstance(inventory, Inventory, 'inventory');
    const entries = this.inventoryEntries, key = blockPositionKey(position), index = entries.findIndex(entry => entry.key === key);
    const tags = this.inventoryTags(), old = index < 0 ? undefined : tags[index];
    const parts = old ? old.getStruct().filter(tag => tag.type !== TagType.FINISH) : [];
    const targetKind = kind ?? (index < 0 ? 3 : entries[index].kind);
    boundedInteger(targetKind, 'inventory kind', 0x7fffffff);
    parts[0] = Tags.int(parts[0]?.name ?? null, targetKind);
    parts[1] = Tags.vector3i(parts[1]?.name ?? null, position.x, position.y, position.z);
    parts[2] = index < 0 ? inventory.toTag() : entries[index].inventory.withContents(inventory).toTag();
    const replacement = Tags.struct(old?.name ?? null, parts);
    if (index < 0) tags.push(replacement); else tags[index] = replacement;
    return this.replaceInventoryTags(tags);
  }

  /** Removes exactly one position, leaving other inventories and manager fields intact. */
  withoutInventoryAt(position: BlockPosition): ManagerContainer {
    validateBlockPosition(position);
    const index = this.inventoryEntries.findIndex(entry => entry.key === blockPositionKey(position));
    if (index < 0) return this;
    const tags = this.inventoryTags(); tags.splice(index, 1);
    return this.replaceInventoryTags(tags);
  }

  /**
   * Legacy kind alias.
   * @deprecated Use getInventoryAt(position); kinds are not unique inventory identities.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get mainInventory():     Inventory { return this.getInventory(0); }
  /**
   * Legacy kind alias.
   * @deprecated Use getInventoryAt(position); kinds are not unique inventory identities.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get capsuleInventory():  Inventory { return this.getInventory(1); }
  /**
   * Legacy kind alias.
   * @deprecated Use getInventoryAt(position); kinds are not unique inventory identities.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get microInventory():    Inventory { return this.getInventory(2); }
  /**
   * Legacy kind alias.
   * @deprecated Use getInventoryAt(position); kinds are not unique inventory identities.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get macroInventory():    Inventory { return this.getInventory(3); }

  /** StarMade-Open ManagerContainer slot view, without raw Tag exposure. */
  get fields(): readonly EntityField<ManagerContainer>[] {
    return buildEditableEntityFields(this.toTag().getStruct().filter(tag => tag.type !== TagType.FINISH), MANAGER_CONTAINER_FIELD_SCHEMA, {
      powerAddOn: value => this.withPower(requireInstance(value, PowerState, 'powerAddOn')),
      shieldAddOn: value => value instanceof EntSlotObject ? this.withShieldAddOn(value) : this.withInitialShields(fieldValueAsNumber(value, 'shieldAddOn')),
      texts: value => this.withTexts(requireTextBlocks(value)),
      warpGateInfo: value => this.withWarpGateInfo(requireInstance(value, WarpGateInfo, 'warpGateInfo')),
      modules: value => this.withModules(requireInstance(value, ManagerModulesState, 'modules')),
      aiConfiguration: value => this.withAiConfiguration(requireInstance(value, AiConfigurationState, 'aiConfiguration')),
      slotAssignment: value => this.withSlotAssignment(requireInstance(value, SlotAssignment, 'slotAssignment')),
      raceGateInfo: value => this.withRaceGateInfo(requireInstance(value, RaceGateInfo, 'raceGateInfo')),
      unloadedDummies: value => this.withUnloadedDummies(requireInstance(value, UnloadedDummiesState, 'unloadedDummies')),
      moduleExplosions: value => this.withModuleExplosions(requireInstance(value, ModuleExplosionsState, 'moduleExplosions')),
      powerReactor: value => this.withPowerReactor(requireInstance(value, EntSlotObject, 'powerReactor')),
      pullPermission: value => this.withPullPermission(fieldValueAsInteger(value, 'pullPermission') as PullPermission),
      modData: value => this.withModData(requireInstance(value, ModDataState, 'modData')),
    });
  }

  /**
   * Returns Field.
   *
   * @param key - Input value for the getField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getField(key: string): EntityField<ManagerContainer> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  /**
   * Handles the warpGateInfo operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get warpGateInfo(): WarpGateInfo { return new WarpGateInfo(this.child(8), this.options); }
  /**
   * Handles the modules operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get modules(): ManagerModulesState { return new ManagerModulesState(this.child(9), this.options); }
  /**
   * Handles the aiConfiguration operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get aiConfiguration(): AiConfigurationState { return new AiConfigurationState(this.child(10), this.options); }
  /**
   * Handles the raceGateInfo operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get raceGateInfo(): RaceGateInfo { return new RaceGateInfo(this.child(12), this.options); }
  /**
   * Handles the unloadedDummies operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get unloadedDummies(): UnloadedDummiesState { return new UnloadedDummiesState(this.child(13), this.options); }
  /**
   * Handles the moduleExplosions operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get moduleExplosions(): ModuleExplosionsState { return new ModuleExplosionsState(this.child(14), this.options); }
  /**
   * Handles the modData operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get modData(): ModDataState { return new ModDataState(this.child(17), this.options); }

  /** Complete opaque PowerInterface reactor tree from slot 15, detached from this manager. */
  get powerReactor(): EntSlotObject { return new EntSlotObject('PowerInterface', this.child(15), this.options); }
  /** Complete shield storage, including modern local-shield trees and historical scalar values. */
  get shieldAddOn(): EntSlotObject { return new EntSlotObject('ShieldLocalAddOn', this.child(3), this.options); }
  /** Explicitly replaces reactor storage without touching the independent PowerAddOn. */
  withPowerReactor(reactor: EntSlotObject): ManagerContainer {
    const tag = requireInstance(reactor, EntSlotObject, 'powerReactor').toTag();
    if (![TagType.STRUCT, TagType.BYTE, TagType.NOTHING].includes(tag.type)) throw new DecodeError('E_FORMAT', 'PowerInterface requires a reactor tree or absent marker');
    return this._withChild(15, tag);
  }
  /** Explicitly replaces modern shield storage; scalar shields use withInitialShields. */
  withShieldAddOn(shields: EntSlotObject): ManagerContainer {
    const tag = requireInstance(shields, EntSlotObject, 'shieldAddOn').toTag();
    if (![TagType.STRUCT, TagType.BYTE, TagType.NOTHING].includes(tag.type)) throw new DecodeError('E_FORMAT', 'ShieldLocalAddOn requires a tree or absent marker');
    return this._withChild(3, tag);
  }

  /**
   * Relevant ElementCountMap stored at [7] relevantECM, when present.
   * The on-disk format is a STRUCT of [SHORT type, INT count] pairs.
   */
  get relevantElementCountMap(): ElementCountMap | null {
    const tag = this._children[7];
    if (tag?.type !== TagType.STRUCT) return null;

    const counts = tag.getStruct().filter(t => t.type !== TagType.FINISH).map(entry => {
      if (entry.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Invalid relevant block-count entry');
      const pair = entry.getStruct();
      if (pair[0]?.type !== TagType.SHORT || pair[1]?.type !== TagType.INT) throw new DecodeError('E_FORMAT', 'Relevant block counts require SHORT and INT');
      return { type: pair[0].getShort(), count: pair[1].getInt() };
    });

    return new ElementCountMap(counts,{maxBytes:this.options.maxInflatedBytes,maxEntries:this.options.maxNodes});
  }

  // ── Immutable updates ──────────────────────────────────────────────

  /**
   * Replaces an existing unambiguous kind; creating an inventory requires an explicit position.
   *
   * @param type - Input value for the withInventory operation.
   * @param inventory - Input value for the withInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withInventory(type: number, inventory: Inventory): ManagerContainer {
    boundedInteger(type, 'inventory kind', 0x7fffffff); requireInstance(inventory, Inventory, 'inventory');
    const tags = this.inventoryTags(), indices = tags.flatMap((tag, index) =>
      tag.type === TagType.STRUCT && tag.getStruct()[0]?.value === type ? [index] : []);
    if (indices.length > 1) throw new DecodeError('E_FORMAT', 'Several inventories share this kind; use withInventoryAt(position)');
    if (!indices.length) throw new DecodeError('E_INCOMPLETE', 'New inventories require withInventoryAt(position, inventory, kind)');
    const index = indices[0], old = tags[index], parts = old.getStruct().filter(tag => tag.type !== TagType.FINISH);
    parts[2] = Inventory.fromTag(parts[2], this.options).withContents(inventory).toTag();
    tags[index] = Tags.struct(old.name, parts);
    return this.replaceInventoryTags(tags);
  }

  /** Reads entry tags while retaining their original names and extension fields. */
  private inventoryTags(): Tag[] {
    const tag = this._children[0];
    if (!tag || tag.type === TagType.NOTHING) return [];
    if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Inventory collection requires STRUCT');
    return tag.getStruct().filter(tag => tag.type !== TagType.FINISH);
  }

  /** Replaces inventory records and rebuilds both complete and compatibility indices. */
  private replaceInventoryTags(tags: Tag[]): ManagerContainer {
    return this._withChild(0, Tags.struct(this._children[0]?.name ?? null, tags));
  }

  /**
   * Returns a copy updated with Power.
   *
   * @param power - Input value for the withPower operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPower(power: PowerState): ManagerContainer {
    return this._withChild(2, requireInstance(power, PowerState, 'powerAddOn').toTag());
  }

  /**
   * Returns a copy updated with InitialShields.
   *
   * @param initialShields - Input value for the withInitialShields operation.
   * @returns The computed StarMade-Decoder value.
   */
  withInitialShields(initialShields: number): ManagerContainer {
    if (typeof initialShields !== 'number') throw new DecodeError('E_RANGE', 'Shields require a numeric double value');
    if (this._children[3]?.type === TagType.STRUCT) throw new DecodeError('E_UNSUPPORTED', 'Modern shield trees require withShieldAddOn');
    return this._withChild(3, Tags.double(null, initialShields));
  }

  /**
   * Returns a copy updated with Texts.
   *
   * @param texts - Input value for the withTexts operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTexts(texts: TextBlocks): ManagerContainer {
    return this._withChild(6, requireTextBlocks(texts).toTag());
  }

  /**
   * Returns a copy updated with SlotAssignment.
   *
   * @param sa - Input value for the withSlotAssignment operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSlotAssignment(sa: SlotAssignment): ManagerContainer {
    return this._withChild(11, requireInstance(sa, SlotAssignment, 'slotAssignment').toTag());
  }

  /**
   * Returns a copy updated with PullPermission.
   *
   * @param perm - Input value for the withPullPermission operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPullPermission(perm: PullPermission): ManagerContainer {
    if (!Number.isInteger(perm) || perm < -128 || perm > 127) throw new DecodeError('E_RANGE', 'Pull permission must fit a signed byte');
    return this._withChild(16, Tags.byte(null, perm));
  }

  /**
   * Returns a copy updated with WarpGateInfo.
   *
   * @param warpGateInfo - Input value for the withWarpGateInfo operation.
   * @returns The computed StarMade-Decoder value.
   */
  withWarpGateInfo(warpGateInfo: WarpGateInfo): ManagerContainer {
    return this._withChild(8, requireInstance(warpGateInfo, WarpGateInfo, 'warpGateInfo').toTag());
  }

  /**
   * Returns a copy updated with Modules.
   *
   * @param modules - Input value for the withModules operation.
   * @returns The computed StarMade-Decoder value.
   */
  withModules(modules: ManagerModulesState): ManagerContainer {
    return this._withChild(9, requireInstance(modules, ManagerModulesState, 'modules').toTag());
  }

  /**
   * Returns a copy updated with AiConfiguration.
   *
   * @param aiConfiguration - Input value for the withAiConfiguration operation.
   * @returns The computed StarMade-Decoder value.
   */
  withAiConfiguration(aiConfiguration: AiConfigurationState): ManagerContainer {
    return this._withChild(10, requireInstance(aiConfiguration, AiConfigurationState, 'aiConfiguration').toTag());
  }

  /**
   * Returns a copy updated with RaceGateInfo.
   *
   * @param raceGateInfo - Input value for the withRaceGateInfo operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRaceGateInfo(raceGateInfo: RaceGateInfo): ManagerContainer {
    return this._withChild(12, requireInstance(raceGateInfo, RaceGateInfo, 'raceGateInfo').toTag());
  }

  /**
   * Returns a copy updated with UnloadedDummies.
   *
   * @param unloadedDummies - Input value for the withUnloadedDummies operation.
   * @returns The computed StarMade-Decoder value.
   */
  withUnloadedDummies(unloadedDummies: UnloadedDummiesState): ManagerContainer {
    return this._withChild(13, requireInstance(unloadedDummies, UnloadedDummiesState, 'unloadedDummies').toTag());
  }

  /**
   * Returns a copy updated with ModuleExplosions.
   *
   * @param moduleExplosions - Input value for the withModuleExplosions operation.
   * @returns The computed StarMade-Decoder value.
   */
  withModuleExplosions(moduleExplosions: ModuleExplosionsState): ManagerContainer {
    return this._withChild(14, requireInstance(moduleExplosions, ModuleExplosionsState, 'moduleExplosions').toTag());
  }

  /**
   * Returns a copy updated with ModData.
   *
   * @param modData - Input value for the withModData operation.
   * @returns The computed StarMade-Decoder value.
   */
  withModData(modData: ModDataState): ManagerContainer {
    return this._withChild(17, requireInstance(modData, ModDataState, 'modData').toTag());
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag { return renderTagModel(this,this.fieldsForTag(),Tags.struct('container',[]),this.options); }

  /** Projects every retained child and current modeled values at their actual storage slots. */
  private fieldsForTag(): TagModelFields {
    const fields=new Map(this._children.map((tag,index)=>[index,tag]));
    if (this._children[3]?.type !== TagType.STRUCT) fields.set(3,Tags.double(null,this.initialShields));
    fields.set(6,this.texts.toTag());
    fields.set(11,this.slotAssignment.toTag());
    fields.set(2, this.powerState.toTag()); fields.set(16, Tags.byte(null, this.pullPermission));
    return fields;
  }

  /** Returns one detached complete stored field with this manager's traversal limits. */
  private child(index: number): Tag { return copyTagModel(this._children[index] ?? Tags.nothing(null), this.options); }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `ManagerContainer(inventories=${this.inventoryEntries.length}, shields=${this.initialShields}, power=${this.powerState})`;
  }

  /**
   * Returns a copy updated with Child.
   *
   * @param index - Input value for the _withChild operation.
   * @param tag - Input value for the _withChild operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _withChild(index: number, tag: Tag): ManagerContainer {
    const root = this.toTag(), children = root.getStruct().filter(value => value.type !== TagType.FINISH);
    while (children.length <= index) children.push(Tags.nothing(null));
    const current = children[index];
    children[index] = tag.name === null ? Tags.rename(tag, current.name) : tag;
    return ManagerContainer.fromTag(Tags.struct(root.name, children), this.options);
  }

}

/**
 * Handles the requireInstance operation used by high-level entity component modelling.
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

/**
 * Handles the requireTextBlocks operation used by high-level entity component modelling.
 *
 * @param value - Input value for the requireTextBlocks operation.
 * @returns The computed StarMade-Decoder value.
 */
function requireTextBlocks(value: unknown): TextBlocks {
  if (value instanceof TextBlocks) return value;
  throw new TypeError('Entity field "texts" expects a TextBlocks object');
}
