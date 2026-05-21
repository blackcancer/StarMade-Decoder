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
 *     [0]  STRUCT inventories       ← inventories (type→Inventory)
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
 *     [15] STRUCT powerReactorTag    ← PowerState for the reactor system
 *     [16] BYTE   pullPermission
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { Inventory } from './Inventory.js';
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
  AiConfigurationState,
  ManagerModulesState,
  ModDataState,
  ModuleExplosionsState,
  RaceGateInfo,
  UnloadedDummiesState,
  WarpGateInfo,
} from '../EntitySlotObjects.js';

// ── PullPermission ────────────────────────────────────────────────────────────

export enum PullPermission {
  ALL  = 0,
  SELF = 1,
  NONE = 2,
}

// ── ManagerContainer ──────────────────────────────────────────────────────────

export class ManagerContainer {
  constructor(
    /** Inventories by type (0=main, 1=capsule, 2=micro, 3=macro). */
    readonly inventories: ReadonlyMap<number, Inventory>,
    /** Initial shield value. */
    readonly initialShields: number,
    /** Initial power state for the newer reactor system. */
    readonly powerState: PowerState,
    /** Text blocks from panels and screens. */
    readonly texts: TextBlocks,
    /** Control slot assignments. */
    readonly slotAssignment: SlotAssignment,
    /** Pull permission (0=all, 1=self, 2=none). */
    readonly pullPermission: PullPermission,
    /** Internal StarMade-Open container slots preserved for faithful round-trip serialization. */
    private readonly _children: Tag[],
  ) {
    Object.defineProperty(this, '_children', { enumerable: false });
  }

  static EMPTY = new ManagerContainer(
    new Map(), 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY,
    PullPermission.ALL, []
  );

  static fromTag(tag: Tag): ManagerContainer {
    if (tag.type !== TagType.STRUCT) return ManagerContainer.EMPTY;
    const parts = tag.getStruct().filter(t => t.type !== TagType.FINISH);

    // [0] inventories
    const inventories = new Map<number, Inventory>();
    if (parts[0]?.type === TagType.STRUCT) {
      const invTags = parts[0].getStruct().filter(t => t.type !== TagType.FINISH);
      for (const invEntry of invTags) {
        if (invEntry.type !== TagType.STRUCT) continue;
        const e = invEntry.getStruct().filter(t => t.type !== TagType.FINISH);
        const type = e[0]?.type === TagType.INT ? e[0].getInt() : -1;
        if (type >= 0 && e[2]?.type === TagType.STRUCT) {
          try { inventories.set(type, Inventory.fromTag(e[2])); } catch { /* skip */ }
        }
      }
    }

    // [2] power (PowerAddOn, legacy system)
    // [3] shields
    let initialShields = 0;
    if (parts[3]?.type === TagType.DOUBLE) {
      initialShields = parts[3].getDouble();
    }

    // [6] text blocks
    const texts = parts[6]?.type === TagType.STRUCT
      ? TextBlocks.fromTag(parts[6])
      : TextBlocks.EMPTY;

    // [11] slotAssignment
    const slotAssignment = parts[11]?.type === TagType.STRUCT
      ? SlotAssignment.fromTag(parts[11])
      : SlotAssignment.EMPTY;

    // [15] powerReactorTag (reactor system)
    let powerState = PowerState.EMPTY;
    if (parts[15]?.type === TagType.STRUCT) {
      try { powerState = PowerState.fromTag(parts[15]); } catch { /* skip */ }
    } else if (parts[2]?.type === TagType.STRUCT) {
      try { powerState = PowerState.fromTag(parts[2]); } catch { /* skip */ }
    }

    // [16] pullPermission
    const pullPerm = parts[16]?.type === TagType.BYTE
      ? (parts[16].getByte() as PullPermission)
      : PullPermission.ALL;

    return new ManagerContainer(
      inventories, initialShields, powerState, texts, slotAssignment, pullPerm, parts
    );
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  getInventory(type = 0): Inventory {
    return this.inventories.get(type) ?? Inventory.EMPTY;
  }

  get mainInventory():     Inventory { return this.getInventory(0); }
  get capsuleInventory():  Inventory { return this.getInventory(1); }
  get microInventory():    Inventory { return this.getInventory(2); }
  get macroInventory():    Inventory { return this.getInventory(3); }

  /** StarMade-Open ManagerContainer slot view, without raw Tag exposure. */
  get fields(): readonly EntityField<ManagerContainer>[] {
    return buildEditableEntityFields(this._children, MANAGER_CONTAINER_FIELD_SCHEMA, {
      shieldAddOn: value => this.withInitialShields(fieldValueAsNumber(value, 'shieldAddOn')),
      texts: value => this.withTexts(requireTextBlocks(value)),
      warpGateInfo: value => this.withWarpGateInfo(requireInstance(value, WarpGateInfo, 'warpGateInfo')),
      modules: value => this.withModules(requireInstance(value, ManagerModulesState, 'modules')),
      aiConfiguration: value => this.withAiConfiguration(requireInstance(value, AiConfigurationState, 'aiConfiguration')),
      slotAssignment: value => this.withSlotAssignment(requireInstance(value, SlotAssignment, 'slotAssignment')),
      raceGateInfo: value => this.withRaceGateInfo(requireInstance(value, RaceGateInfo, 'raceGateInfo')),
      unloadedDummies: value => this.withUnloadedDummies(requireInstance(value, UnloadedDummiesState, 'unloadedDummies')),
      moduleExplosions: value => this.withModuleExplosions(requireInstance(value, ModuleExplosionsState, 'moduleExplosions')),
      powerReactor: value => this.withPower(requireInstance(value, PowerState, 'powerReactor')),
      pullPermission: value => this.withPullPermission(fieldValueAsInteger(value, 'pullPermission') as PullPermission),
      modData: value => this.withModData(requireInstance(value, ModDataState, 'modData')),
    });
  }

  getField(key: string): EntityField<ManagerContainer> | null {
    return this.fields.find(field => field.key === key) ?? null;
  }

  get warpGateInfo(): WarpGateInfo { return new WarpGateInfo(this._children[8]); }
  get modules(): ManagerModulesState { return new ManagerModulesState(this._children[9]); }
  get aiConfiguration(): AiConfigurationState { return new AiConfigurationState(this._children[10]); }
  get raceGateInfo(): RaceGateInfo { return new RaceGateInfo(this._children[12]); }
  get unloadedDummies(): UnloadedDummiesState { return new UnloadedDummiesState(this._children[13]); }
  get moduleExplosions(): ModuleExplosionsState { return new ModuleExplosionsState(this._children[14]); }
  get modData(): ModDataState { return new ModDataState(this._children[17]); }

  /**
   * Relevant ElementCountMap stored at [7] relevantECM, when present.
   * The on-disk format is a STRUCT of [SHORT type, INT count] pairs.
   */
  get relevantElementCountMap(): ElementCountMap | null {
    const tag = this._children[7];
    if (tag?.type !== TagType.STRUCT) return null;

    const counts = tag.getStruct()
      .filter(t => t.type !== TagType.FINISH)
      .map(entry => {
        if (entry.type !== TagType.STRUCT) return null;
        const pair = entry.getStruct().filter(t => t.type !== TagType.FINISH);
        if (pair[0]?.type !== TagType.SHORT || pair[1]?.type !== TagType.INT) return null;
        return { type: pair[0].getShort(), count: pair[1].getInt() };
      })
      .filter((entry): entry is { type: number; count: number } => entry !== null);

    return new ElementCountMap(counts);
  }

  // ── Immutable updates ──────────────────────────────────────────────

  withInventory(type: number, inventory: Inventory): ManagerContainer {
    const m = new Map(this.inventories);
    m.set(type, inventory);
    return new ManagerContainer(m, this.initialShields, this.powerState,
      this.texts, this.slotAssignment, this.pullPermission, this._children);
  }

  withPower(power: PowerState): ManagerContainer {
    return new ManagerContainer(this.inventories, this.initialShields, power,
      this.texts, this.slotAssignment, this.pullPermission, this._children);
  }

  withInitialShields(initialShields: number): ManagerContainer {
    return new ManagerContainer(this.inventories, initialShields, this.powerState,
      this.texts, this.slotAssignment, this.pullPermission, this._children);
  }

  withTexts(texts: TextBlocks): ManagerContainer {
    return new ManagerContainer(this.inventories, this.initialShields, this.powerState,
      texts, this.slotAssignment, this.pullPermission, this._children);
  }

  withSlotAssignment(sa: SlotAssignment): ManagerContainer {
    return new ManagerContainer(this.inventories, this.initialShields, this.powerState,
      this.texts, sa, this.pullPermission, this._children);
  }

  withPullPermission(perm: PullPermission): ManagerContainer {
    return new ManagerContainer(this.inventories, this.initialShields, this.powerState,
      this.texts, this.slotAssignment, perm, this._children);
  }

  withWarpGateInfo(warpGateInfo: WarpGateInfo): ManagerContainer {
    return this._withChild(8, warpGateInfo.toTag());
  }

  withModules(modules: ManagerModulesState): ManagerContainer {
    return this._withChild(9, modules.toTag());
  }

  withAiConfiguration(aiConfiguration: AiConfigurationState): ManagerContainer {
    return this._withChild(10, aiConfiguration.toTag());
  }

  withRaceGateInfo(raceGateInfo: RaceGateInfo): ManagerContainer {
    return this._withChild(12, raceGateInfo.toTag());
  }

  withUnloadedDummies(unloadedDummies: UnloadedDummiesState): ManagerContainer {
    return this._withChild(13, unloadedDummies.toTag());
  }

  withModuleExplosions(moduleExplosions: ModuleExplosionsState): ManagerContainer {
    return this._withChild(14, moduleExplosions.toTag());
  }

  withModData(modData: ModDataState): ManagerContainer {
    return this._withChild(17, modData.toTag());
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toTag(): Tag {
    // Rebuild from raw children while replacing the known fields
    const children = [...this._children];

    // Helper that replaces or inserts a field at a fixed index
    const setAt = (idx: number, t: Tag) => {
      if (idx < children.length) children[idx] = t;
      else { while (children.length <= idx) children.push(Tags.nothing(null)); children[idx] = t; }
    };

    // [3] initial shields
    if (children[3]?.type === TagType.DOUBLE) setAt(3, Tags.double(null, this.initialShields));
    // [6] texts
    setAt(6, this.texts.toTag());
    // [11] slotAssignment
    if (children.length > 11) setAt(11, this.slotAssignment.toTag());
    // [15] power
    if (children.length > 15) setAt(15, this.powerState.toTag());
    // [16] pullPermission
    if (children.length > 16) setAt(16, Tags.byte(null, this.pullPermission));

    return new Tag(TagType.STRUCT, 'container', [...children, FINISH_TAG]);
  }

  toString(): string {
    return `ManagerContainer(inventories=${this.inventories.size}, shields=${this.initialShields}, power=${this.powerState})`;
  }

  private _withChild(index: number, tag: Tag): ManagerContainer {
    const children = [...this._children];
    while (children.length <= index) children.push(Tags.nothing(null));
    const current = children[index];
    children[index] = current?.name !== undefined && tag.name === null
      ? new Tag(tag.type, current.name, tag.value, tag.listType ?? undefined)
      : tag;
    return new ManagerContainer(this.inventories, this.initialShields, this.powerState,
      this.texts, this.slotAssignment, this.pullPermission, children);
  }
}

function requireInstance<T>(value: unknown, ctor: new (...args: any[]) => T, key: string): T {
  if (value instanceof ctor) return value;
  throw new TypeError(`Entity field "${key}" expects a ${ctor.name} object`);
}

function requireTextBlocks(value: unknown): TextBlocks {
  if (value instanceof TextBlocks) return value;
  throw new TypeError('Entity field "texts" expects a TextBlocks object');
}
