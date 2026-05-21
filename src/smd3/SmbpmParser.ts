/**
 * @fileoverview SMBpm Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbpmParser — parser for .smbpm files (blueprint meta).
 *
 * Format (BlueprintEntry.readMeta / readMetaNew) :
 *   int  metaVersion
 *   loop on byte dataType until FINISH_BYTE(1) :
 *     2=SEG_MANAGER_BYTE  → Tag.readFrom (tag binaire standard)
 *     3=DOCKING_BYTE      → int size + size×(UTF name + 3×int pos + 3×float size + short style + byte orient)
 *     4=RAIL_BYTE         → 3×float min + 3×float max + [si v≥2] UTF uid + int wirelessSize×... + int childSize×(UTF+int+bytes Tag)
 *     5=AI_CONFIG_BYTE    → int tagSize + bytes Tag
 *     6=RAIL_DOCKER_BYTE  → byte exists + [si exists] int size × VoidUniqueSegmentPiece(3×int pos + short type + byte orient + byte active + byte hp)
 *     7=CARGO_BYTE        → byte exists + [if exists] int size × (long pos + double capacity)
 *     8=LOCK_BOX_BYTE     → identique CARGO_BYTE
 *     9=THRUST_CONFIG_BYTE→ Tag.readFrom
 *
 * Java source: BlueprintEntry.java (readMeta / readMetaNew)
 */

import { BufferReader } from '../core/BufferReader.js';
import { readFrom } from '../core/TagParser.js';
import type { Tag } from '../core/Tag.js';
import { TagType } from '../core/TagType.js';
import { Tags } from '../core/TagBuilder.js';
import { Matrix4f } from '../types/Matrices.js';
import { SegmentControllerObject } from '../objects/SegmentController.js';
import { ThrustConfig } from '../objects/components/PowerAndThrust.js';

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Defines FINISH_BYTE for StarMade blueprint and segment file parsing.
 */
const FINISH_BYTE       = 1;
/**
 * Defines SEG_MANAGER_BYTE for StarMade blueprint and segment file parsing.
 */
const SEG_MANAGER_BYTE  = 2;
/**
 * Defines DOCKING_BYTE for StarMade blueprint and segment file parsing.
 */
const DOCKING_BYTE      = 3;
/**
 * Defines RAIL_BYTE for StarMade blueprint and segment file parsing.
 */
const RAIL_BYTE         = 4;
/**
 * Defines AI_CONFIG_BYTE for StarMade blueprint and segment file parsing.
 */
const AI_CONFIG_BYTE    = 5;
/**
 * Defines RAIL_DOCKER_BYTE for StarMade blueprint and segment file parsing.
 */
const RAIL_DOCKER_BYTE  = 6;
/**
 * Defines CARGO_BYTE for StarMade blueprint and segment file parsing.
 */
const CARGO_BYTE        = 7;
/**
 * Defines LOCK_BOX_BYTE for StarMade blueprint and segment file parsing.
 */
const LOCK_BOX_BYTE     = 8;
/**
 * Defines THRUST_CONFIG_BYTE for StarMade blueprint and segment file parsing.
 */
const THRUST_CONFIG_BYTE = 9;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Describes the DockingEntry data shape used by StarMade blueprint and segment file parsing.
 */
export interface DockingEntry {
  name: string;
  posX: number; posY: number; posZ: number;
  sizeX: number; sizeY: number; sizeZ: number;
  style: number;
  orientation: number;
  /** Local child entity offset used by StarMade when spawning this attached blueprint. */
  offset: BlueprintChildOffset;
}

/**
 * Describes the CargoPoint data shape used by StarMade blueprint and segment file parsing.
 */
export interface CargoPoint {
  posIndex: bigint;
  capacity: number;
}

/**
 * Describes the RailDockerPiece data shape used by StarMade blueprint and segment file parsing.
 */
export interface RailDockerPiece {
  posX: number; posY: number; posZ: number;
  type: number;
  orientation: number;
  active: boolean;
  hp: number;
}

/**
 * Describes the Vector3f data shape used by StarMade blueprint and segment file parsing.
 */
export interface Vector3f {
  x: number;
  y: number;
  z: number;
}

/**
 * Describes the BlueprintChildOffset data shape used by StarMade blueprint and segment file parsing.
 */
export interface BlueprintChildOffset {
  x: number;
  y: number;
  z: number;
}

/**
 * Describes the RailChildEntry data shape used by StarMade blueprint and segment file parsing.
 */
export interface RailChildEntry {
  name: string;
  /** High-level rail docking request decoded from tag. */
  request: RailChildRequest | null;
  /** Local child entity offset computed from the rail request tag, when available. */
  offset: BlueprintChildOffset | null;
}

/**
 * Describes the BlueprintChildTransform data shape used by StarMade blueprint and segment file parsing.
 */
export interface BlueprintChildTransform {
  name: string;
  mode: 'docking' | 'rail';
  offset: BlueprintChildOffset;
}

/**
 * Describes the AiConfigEntry data shape used by StarMade blueprint and segment file parsing.
 */
export interface AiConfigEntry {
  id: number;
  value: string;
}

/**
 * Describes the AiConfig data shape used by StarMade blueprint and segment file parsing.
 */
export interface AiConfig {
  tagName: string | null;
  entries: AiConfigEntry[];
  values: Record<number, string>;
}

/**
 * Describes the RailPieceRef data shape used by StarMade blueprint and segment file parsing.
 */
export interface RailPieceRef {
  kind: number;
  uid: string;
  position: BlueprintChildOffset;
  type: number;
  orientation: number;
  active: boolean;
  hp: number;
}

/**
 * Describes the RailChildRequest data shape used by StarMade blueprint and segment file parsing.
 */
export interface RailChildRequest {
  railTagType: number;
  rail: RailPieceRef | null;
  docked: RailPieceRef | null;
  railTransform: Matrix4f | null;
  dockedTransform: Matrix4f | null;
  railContact: BlueprintChildOffset | null;
  movingAtDockTransform: Matrix4f | null;
  flags: number[];
}

/**
 * Describes the WirelessMarker data shape used by StarMade blueprint and segment file parsing.
 */
export interface WirelessMarker {
  /** Rail UID of the destination chain element. */
  marking: string;
  /** Packed element index of the marker location. */
  markerLocation: bigint;
  /** Packed element index of the source activation controller. */
  fromLocation: bigint;
}

/**
 * Describes the SmbpmFile data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmbpmFile {
  metaVersion: number;
  /** High-level SegmentController view, when present and parseable. */
  manager: SegmentControllerObject | null;
  /** Connexions de docking classiques */
  dockingEntries: DockingEntry[];
  /** Rail UID (for RAIL_BYTE) */
  railUID?: string;
  /** Rail root minimum bound from RAIL_BYTE. */
  railRootMin: Vector3f | null;
  /** Rail root maximum bound from RAIL_BYTE. */
  railRootMax: Vector3f | null;
  /** Wireless logic markers (BBWirelessLogicMarker, metaVersion >= 2) */
  wirelessMarkers: WirelessMarker[];
  /** Rail children */
  railChildren: RailChildEntry[];
  /** Spawn offsets for attached blueprint children declared in DOCKING_BYTE or RAIL_BYTE. */
  childTransforms: BlueprintChildTransform[];
  /** High-level AI config view. */
  aiConfig: AiConfig | null;
  /** Rail docker pieces */
  railDockerPieces: RailDockerPiece[];
  /** Points de cargo */
  cargoPoints: CargoPoint[];
  /** Lock box (same format as cargo) */
  lockBoxPoints: CargoPoint[];
  /** High-level thrust configuration. */
  thrustConfig: ThrustConfig | null;
}

/**
 * Describes the SmbpmInternalState data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmbpmInternalState {
  managerRaw?: Uint8Array | null;
  managerTag?: Tag | null;
  aiRaw?: Uint8Array | null;
  aiTag?: Tag | null;
  thrustRaw?: Uint8Array | null;
  thrustTag?: Tag | null;
}

/**
 * Describes the RailChildInternalState data shape used by StarMade blueprint and segment file parsing.
 */
export interface RailChildInternalState {
  tagRaw?: Uint8Array | null;
  tag?: Tag | null;
}

/**
 * Defines SMBPM_INTERNALS for StarMade blueprint and segment file parsing.
 */
const SMBPM_INTERNALS = new WeakMap<object, SmbpmInternalState>();
/**
 * Defines RAIL_CHILD_INTERNALS for StarMade blueprint and segment file parsing.
 */
const RAIL_CHILD_INTERNALS = new WeakMap<object, RailChildInternalState>();

/**
 * Represents the BlueprintMeta model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintMeta implements SmbpmFile {
  metaVersion: number;
  manager: SegmentControllerObject | null;
  dockingEntries: DockingEntry[];
  railUID?: string;
  railRootMin: Vector3f | null;
  railRootMax: Vector3f | null;
  wirelessMarkers: WirelessMarker[];
  railChildren: RailChildEntry[];
  childTransforms: BlueprintChildTransform[];
  aiConfig: AiConfig | null;
  railDockerPieces: RailDockerPiece[];
  cargoPoints: CargoPoint[];
  lockBoxPoints: CargoPoint[];
  thrustConfig: ThrustConfig | null;

  /**
   * Creates a BlueprintMeta instance.
   *
   * @param input - Input value for the constructor operation.
   */
  constructor(input: SmbpmFile) {
    this.metaVersion = input.metaVersion;
    this.manager = input.manager;
    this.dockingEntries = [...input.dockingEntries];
    this.railUID = input.railUID;
    this.railRootMin = input.railRootMin ? { ...input.railRootMin } : null;
    this.railRootMax = input.railRootMax ? { ...input.railRootMax } : null;
    this.wirelessMarkers = [...input.wirelessMarkers];
    this.railChildren = [...input.railChildren];
    this.childTransforms = input.childTransforms.length > 0
      ? [...input.childTransforms]
      : buildChildTransforms(this.dockingEntries, this.railChildren);
    this.aiConfig = input.aiConfig ? cloneAiConfig(input.aiConfig) : null;
    this.railDockerPieces = [...input.railDockerPieces];
    this.cargoPoints = [...input.cargoPoints];
    this.lockBoxPoints = [...input.lockBoxPoints];
    this.thrustConfig = input.thrustConfig;
  }

  /**
   * Reports whether hasManager is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hasManager(): boolean {
    return this.manager !== null || getSmbpmInternals(this).managerTag != null;
  }

  /**
   * Reports whether hasRails is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hasRails(): boolean {
    return Boolean(this.railUID || this.railChildren.length > 0 || this.railDockerPieces.length > 0);
  }

  /**
   * Handles the attachmentCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get attachmentCount(): number {
    return this.childTransforms.length;
  }

  /**
   * Handles the childTransformFor operation used by StarMade blueprint and segment file parsing.
   *
   * @param name - Input value for the childTransformFor operation.
   * @returns The computed StarMade-Decoder value.
   */
  childTransformFor(name: string): BlueprintChildTransform | null {
    const wanted = basenameBlueprintEntityName(name);
    return this.childTransforms.find(transform =>
      basenameBlueprintEntityName(transform.name) === wanted
    ) ?? null;
  }

  /**
   * Handles the childOffsetFor operation used by StarMade blueprint and segment file parsing.
   *
   * @param name - Input value for the childOffsetFor operation.
   * @returns The computed StarMade-Decoder value.
   */
  childOffsetFor(name: string): BlueprintChildOffset | null {
    return this.childTransformFor(name)?.offset ?? null;
  }

  /**
   * Returns a copy updated with MetaVersion.
   *
   * @param metaVersion - Input value for the withMetaVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMetaVersion(metaVersion: number): BlueprintMeta {
    return this._with({ metaVersion });
  }

  /**
   * Returns a copy updated with Manager.
   *
   * @param manager - Input value for the withManager operation.
   * @returns The computed StarMade-Decoder value.
   */
  withManager(manager: SegmentControllerObject | null): BlueprintMeta {
    return this._with({ manager }, { preserveManager: false });
  }

  /**
   * Returns a copy updated with DockingEntries.
   *
   * @param dockingEntries - Input value for the withDockingEntries operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDockingEntries(dockingEntries: DockingEntry[]): BlueprintMeta {
    return this._with({
      dockingEntries,
      childTransforms: buildChildTransforms(dockingEntries, this.railChildren),
    });
  }

  /**
   * Returns a copy updated with RailBounds.
   *
   * @param railRootMin - Input value for the withRailBounds operation.
   * @param railRootMax - Input value for the withRailBounds operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailBounds(railRootMin: Vector3f | null, railRootMax: Vector3f | null): BlueprintMeta {
    return this._with({ railRootMin, railRootMax });
  }

  /**
   * Returns a copy updated with RailUID.
   *
   * @param railUID - Input value for the withRailUID operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailUID(railUID: string | undefined): BlueprintMeta {
    return this._with({ railUID });
  }

  /**
   * Returns a copy updated with WirelessMarkers.
   *
   * @param wirelessMarkers - Input value for the withWirelessMarkers operation.
   * @returns The computed StarMade-Decoder value.
   */
  withWirelessMarkers(wirelessMarkers: WirelessMarker[]): BlueprintMeta {
    return this._with({ wirelessMarkers });
  }

  /**
   * Returns a copy updated with RailChildren.
   *
   * @param railChildren - Input value for the withRailChildren operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailChildren(railChildren: RailChildEntry[]): BlueprintMeta {
    return this._with({
      railChildren,
      childTransforms: buildChildTransforms(this.dockingEntries, railChildren),
    }, { preserveRailChildren: false });
  }

  /**
   * Returns a copy updated with RailChildRequest.
   *
   * @param nameOrIndex - Input value for the withRailChildRequest operation.
   * @param request - Input value for the withRailChildRequest operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailChildRequest(nameOrIndex: string | number, request: RailChildRequest | null): BlueprintMeta {
    const index = typeof nameOrIndex === 'number'
      ? nameOrIndex
      : this.railChildren.findIndex(child => child.name === nameOrIndex || basenameBlueprintEntityName(child.name) === basenameBlueprintEntityName(nameOrIndex));
    if (index < 0 || index >= this.railChildren.length) {
      return this;
    }

    const railChildren = [...this.railChildren];
    const offset = getRailChildOffsetFromRequest(request);
    railChildren[index] = { ...railChildren[index], request, offset };
    const next = this._with({
      railChildren,
      childTransforms: buildChildTransforms(this.dockingEntries, railChildren),
    }, { preserveRailChildren: false });

    for (let i = 0; i < this.railChildren.length; i++) {
      if (i !== index) {
        defineRailChildInternals(next.railChildren[i], getRailChildInternals(this.railChildren[i]));
      }
    }

    return next;
  }

  /**
   * Returns a copy updated with AiConfig.
   *
   * @param aiConfig - Input value for the withAiConfig operation.
   * @returns The computed StarMade-Decoder value.
   */
  withAiConfig(aiConfig: AiConfig | null): BlueprintMeta {
    return this._with({ aiConfig: aiConfig ? cloneAiConfig(aiConfig) : null }, { preserveAi: false });
  }

  /**
   * Returns a copy updated with AiValue.
   *
   * @param id - Input value for the withAiValue operation.
   * @param value - Input value for the withAiValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  withAiValue(id: number, value: string): BlueprintMeta {
    const current = this.aiConfig ?? { tagName: null, entries: [], values: {} };
    const entries = current.entries.some(entry => entry.id === id)
      ? current.entries.map(entry => entry.id === id ? { ...entry, value } : entry)
      : [...current.entries, { id, value }];
    return this.withAiConfig({
      tagName: current.tagName,
      entries,
      values: { ...current.values, [id]: value },
    });
  }

  /**
   * Returns a copy updated with RailDockerPieces.
   *
   * @param railDockerPieces - Input value for the withRailDockerPieces operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailDockerPieces(railDockerPieces: RailDockerPiece[]): BlueprintMeta {
    return this._with({ railDockerPieces });
  }

  /**
   * Returns a copy updated with CargoPoints.
   *
   * @param cargoPoints - Input value for the withCargoPoints operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCargoPoints(cargoPoints: CargoPoint[]): BlueprintMeta {
    return this._with({ cargoPoints });
  }

  /**
   * Returns a copy updated with LockBoxPoints.
   *
   * @param lockBoxPoints - Input value for the withLockBoxPoints operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLockBoxPoints(lockBoxPoints: CargoPoint[]): BlueprintMeta {
    return this._with({ lockBoxPoints });
  }

  /**
   * Returns a copy updated with ThrustConfig.
   *
   * @param thrustConfig - Input value for the withThrustConfig operation.
   * @returns The computed StarMade-Decoder value.
   */
  withThrustConfig(thrustConfig: ThrustConfig | null): BlueprintMeta {
    return this._with({ thrustConfig }, { preserveThrust: false });
  }

  /**
   * Returns a copy updated with the requested value.
   *
   * @param overrides - Input value for the _with operation.
   * @param options - Input value for the _with operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _with(
    overrides: Partial<SmbpmFile>,
    options: {
      preserveManager?: boolean;
      preserveAi?: boolean;
      preserveThrust?: boolean;
      preserveRailChildren?: boolean;
    } = {}
  ): BlueprintMeta {
    const next = new BlueprintMeta({
      metaVersion: this.metaVersion,
      manager: this.manager,
      dockingEntries: this.dockingEntries,
      railUID: this.railUID,
      railRootMin: this.railRootMin,
      railRootMax: this.railRootMax,
      wirelessMarkers: this.wirelessMarkers,
      railChildren: this.railChildren,
      childTransforms: this.childTransforms,
      aiConfig: this.aiConfig,
      railDockerPieces: this.railDockerPieces,
      cargoPoints: this.cargoPoints,
      lockBoxPoints: this.lockBoxPoints,
      thrustConfig: this.thrustConfig,
      ...overrides,
    });

    const previous = getSmbpmInternals(this);
    defineSmbpmInternals(next, {
      managerRaw: options.preserveManager === false ? null : previous.managerRaw,
      managerTag: options.preserveManager === false ? null : previous.managerTag,
      aiRaw: options.preserveAi === false ? null : previous.aiRaw,
      aiTag: options.preserveAi === false ? null : previous.aiTag,
      thrustRaw: options.preserveThrust === false ? null : previous.thrustRaw,
      thrustTag: options.preserveThrust === false ? null : previous.thrustTag,
    });

    if (options.preserveRailChildren !== false) {
      for (const child of next.railChildren) {
        const internal = getRailChildInternals(child);
        if (internal.tag || internal.tagRaw) {
          defineRailChildInternals(child, internal);
        }
      }
    }

    return next;
  }
}

/**
 * Returns SmbpmInternals.
 *
 * @param file - Input value for the getSmbpmInternals operation.
 * @returns The computed StarMade-Decoder value.
 */
export function getSmbpmInternals(file: SmbpmFile): SmbpmInternalState {
  const stored = typeof file === 'object' && file !== null ? SMBPM_INTERNALS.get(file) : undefined;
  if (stored) {
    return stored;
  }

  const legacy = file as SmbpmFile & {
    managerRaw?: Uint8Array | null;
    managerTag?: Tag | null;
    aiRaw?: Uint8Array | null;
    aiTag?: Tag | null;
    thrustRaw?: Uint8Array | null;
    thrustTag?: Tag | null;
  };

  return {
    managerRaw: legacy.managerRaw ?? null,
    managerTag: legacy.managerTag ?? null,
    aiRaw: legacy.aiRaw ?? null,
    aiTag: legacy.aiTag ?? null,
    thrustRaw: legacy.thrustRaw ?? null,
    thrustTag: legacy.thrustTag ?? null,
  };
}

/**
 * Returns RailChildInternals.
 *
 * @param child - Input value for the getRailChildInternals operation.
 * @returns The computed StarMade-Decoder value.
 */
export function getRailChildInternals(child: RailChildEntry): RailChildInternalState {
  const stored = typeof child === 'object' && child !== null ? RAIL_CHILD_INTERNALS.get(child) : undefined;
  if (stored) {
    return stored;
  }

  const legacy = child as RailChildEntry & {
    tagRaw?: Uint8Array | null;
    tag?: Tag | null;
  };

  return {
    tagRaw: legacy.tagRaw ?? null,
    tag: legacy.tag ?? null,
  };
}

/**
 * Handles the defineSmbpmInternals operation used by StarMade blueprint and segment file parsing.
 *
 * @param file - Input value for the defineSmbpmInternals operation.
 * @param internals - Input value for the defineSmbpmInternals operation.
 */
function defineSmbpmInternals(file: SmbpmFile, internals: SmbpmInternalState): void {
  SMBPM_INTERNALS.set(file, internals);
}

/**
 * Handles the defineRailChildInternals operation used by StarMade blueprint and segment file parsing.
 *
 * @param child - Input value for the defineRailChildInternals operation.
 * @param internals - Input value for the defineRailChildInternals operation.
 */
function defineRailChildInternals(child: RailChildEntry, internals: RailChildInternalState): void {
  RAIL_CHILD_INTERNALS.set(child, internals);
}

/**
 * Handles the finalizeSmbpm operation used by StarMade blueprint and segment file parsing.
 *
 * @param input - Input value for the finalizeSmbpm operation.
 * @param internals - Input value for the finalizeSmbpm operation.
 * @returns The computed StarMade-Decoder value.
 */
function finalizeSmbpm(input: SmbpmFile, internals: SmbpmInternalState): BlueprintMeta {
  const meta = new BlueprintMeta(input);
  defineSmbpmInternals(meta, internals);

  for (let i = 0; i < meta.railChildren.length; i++) {
    const source = input.railChildren[i];
    const internal = source ? getRailChildInternals(source) : null;
    if (internal) {
      defineRailChildInternals(meta.railChildren[i], internal);
    }
  }

  return meta;
}

/**
 * Handles the cloneAiConfig operation used by StarMade blueprint and segment file parsing.
 *
 * @param config - Input value for the cloneAiConfig operation.
 * @returns The computed StarMade-Decoder value.
 */
function cloneAiConfig(config: AiConfig): AiConfig {
  return {
    tagName: config.tagName,
    entries: config.entries.map(entry => ({ ...entry })),
    values: { ...config.values },
  };
}

/**
 * Builds ChildTransforms for StarMade blueprint and segment file parsing.
 *
 * @param dockingEntries - Input value for the buildChildTransforms operation.
 * @param railChildren - Input value for the buildChildTransforms operation.
 * @returns The computed StarMade-Decoder value.
 */
function buildChildTransforms(
  dockingEntries: DockingEntry[],
  railChildren: RailChildEntry[]
): BlueprintChildTransform[] {
  const transforms: BlueprintChildTransform[] = [];
  for (const docking of dockingEntries) {
    transforms.push({ name: docking.name, mode: 'docking', offset: docking.offset });
  }
  for (const child of railChildren) {
    if (child.offset) {
      transforms.push({ name: child.name, mode: 'rail', offset: child.offset });
    }
  }
  return transforms;
}

/**
 * Handles the basenameBlueprintEntityName operation used by StarMade blueprint and segment file parsing.
 *
 * @param name - Input value for the basenameBlueprintEntityName operation.
 * @returns The computed StarMade-Decoder value.
 */
function basenameBlueprintEntityName(name: string): string {
  return name.split('/').filter(Boolean).slice(-1)[0] ?? name;
}

// ── Parser principal ──────────────────────────────────────────────────────────

/**
 * Parses Smbpm for StarMade blueprint and segment file parsing.
 *
 * @param data - Input value for the parseSmbpm operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSmbpm(data: Buffer | Uint8Array): BlueprintMeta {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const metaVersion = r.readInt32BE();
  const isOldChunk16 = metaVersion < 4;

  const result: SmbpmFile = {
    metaVersion,
    manager: null,
    dockingEntries: [],
    railRootMin: null,
    railRootMax: null,
    wirelessMarkers: [],
    railChildren: [],
    childTransforms: [],
    aiConfig: null,
    railDockerPieces: [],
    cargoPoints: [],
    lockBoxPoints: [],
    thrustConfig: null,
  };
  const internals: SmbpmInternalState = {};

  while (!r.isEOF()) {
    const dataType = r.readInt8();
    if (dataType === FINISH_BYTE) break;

    switch (dataType) {

      case SEG_MANAGER_BYTE: {
        // Complete binary Tag — use the remaining slice
        const tagBuf = buf.slice(r.offset);
        internals.managerRaw = new Uint8Array(tagBuf);
        try {
          internals.managerTag = readFrom(tagBuf);
          result.manager = SegmentControllerObject.fromTag(internals.managerTag);
        } catch { /* tag invalid, on continue */ }
        return finalizeSmbpm(result, internals); // SEG_MANAGER_BYTE ends reading
      }

      case DOCKING_BYTE: {
        const size = r.readInt32BE();
        for (let i = 0; i < size; i++) {
          const name = r.readJavaUTF();
          const posX = r.readInt32BE(), posY = r.readInt32BE(), posZ = r.readInt32BE();
          const sizeX = r.readFloat32BE(), sizeY = r.readFloat32BE(), sizeZ = r.readFloat32BE();
          const style = r.readInt16BE();
          const orientation = r.readInt8();
          const offset = { x: posX - 16, y: posY - 16, z: posZ - 16 };
          result.dockingEntries.push({ name, posX, posY, posZ, sizeX, sizeY, sizeZ, style, orientation, offset });
          result.childTransforms.push({ name, mode: 'docking', offset });
        }
        break;
      }

      case RAIL_BYTE: {
        result.railRootMin = {
          x: r.readFloat32BE(),
          y: r.readFloat32BE(),
          z: r.readFloat32BE(),
        };
        result.railRootMax = {
          x: r.readFloat32BE(),
          y: r.readFloat32BE(),
          z: r.readFloat32BE(),
        };

        if (metaVersion >= 2) {
          result.railUID = r.readJavaUTF();
          const wirelessSize = r.readInt32BE();
          for (let i = 0; i < wirelessSize; i++) {
            const marking        = r.readJavaUTF();
            const markerLocation = r.readInt64BE();
            const fromLocation   = r.readInt64BE();
            result.wirelessMarkers.push({ marking, markerLocation, fromLocation });
          }
        }

        const size = r.readInt32BE();
        for (let i = 0; i < size; i++) {
          const name = r.readJavaUTF();
          const tagSize = r.readInt32BE();
          let childTag: Tag | null = null;
          let tagRaw: Uint8Array | null = null;
          if (tagSize > 0 && tagSize < 100_000_000) {
            const tagBytes = r.readBytes(tagSize);
            tagRaw = new Uint8Array(tagBytes);
            try { childTag = readFrom(tagBytes); } catch { /* skip */ }
          }
          const request = parseRailChildRequestFromTag(childTag);
          const offset = getRailChildOffsetFromRequest(request);
          const child: RailChildEntry = { name, request, offset };
          defineRailChildInternals(child, { tagRaw, tag: childTag });
          result.railChildren.push(child);
          if (offset) {
            result.childTransforms.push({ name, mode: 'rail', offset });
          }
        }
        break;
      }

      case AI_CONFIG_BYTE: {
        const tagSize = r.readInt32BE();
        if (tagSize > 0 && tagSize < 100_000_000) {
          const tagBytes = r.readBytes(tagSize);
          internals.aiRaw = new Uint8Array(tagBytes);
          try {
            internals.aiTag = readFrom(tagBytes);
            result.aiConfig = parseAiConfigTag(internals.aiTag);
          } catch { /* skip */ }
        }
        break;
      }

      case RAIL_DOCKER_BYTE: {
        const exists = r.readInt8() > 0;
        if (exists) {
          const size = r.readInt32BE();
          for (let i = 0; i < size; i++) {
            const posX = r.readInt32BE(), posY = r.readInt32BE(), posZ = r.readInt32BE();
            const type = r.readInt16BE();
            const orientation = r.readInt8();
            const active = r.readInt8() > 0;
            const hp = r.readInt8();
            result.railDockerPieces.push({ posX, posY, posZ, type, orientation, active, hp });
          }
        }
        break;
      }

      case CARGO_BYTE:
      case LOCK_BOX_BYTE: {
        const exists = r.readInt8() > 0;
        const target = dataType === CARGO_BYTE ? result.cargoPoints : result.lockBoxPoints;
        if (exists) {
          const size = r.readInt32BE();
          for (let i = 0; i < size; i++) {
            const posIndex = r.readInt64BE();
            const capacity = r.readFloat64BE();
            target.push({ posIndex, capacity });
          }
        }
        break;
      }

      case THRUST_CONFIG_BYTE: {
        const tagBuf = buf.slice(r.offset);
        internals.thrustRaw = new Uint8Array(tagBuf);
        try {
          internals.thrustTag = readFrom(tagBuf);
          result.thrustConfig = ThrustConfig.fromTag(internals.thrustTag);
        } catch { /* skip */ }
        return finalizeSmbpm(result, internals); // tag consumes the rest of the stream
      }

      default:
        // Unknown type — cannot continue without knowing the size
        return finalizeSmbpm(result, internals);
    }
  }

  return finalizeSmbpm(result, internals);
}

/**
 * Returns RailChildOffsetFromTag.
 *
 * @param tag - Input value for the getRailChildOffsetFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
export function getRailChildOffsetFromTag(tag: Tag | null): BlueprintChildOffset | null {
  return getRailChildOffsetFromRequest(parseRailChildRequestFromTag(tag));
}

/**
 * Parses AiConfigTag for StarMade blueprint and segment file parsing.
 *
 * @param tag - Input value for the parseAiConfigTag operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseAiConfigTag(tag: Tag | null): AiConfig | null {
  if (!tag || tag.type !== TagType.STRUCT) {
    return null;
  }

  const entries: AiConfigEntry[] = [];
  const values: Record<number, string> = {};
  for (const child of tag.getStruct().filter(t => t.type !== TagType.FINISH)) {
    if (child.type !== TagType.STRUCT) continue;
    const pair = child.getStruct().filter(t => t.type !== TagType.FINISH);
    if (pair[0]?.type !== TagType.BYTE || pair[1]?.type !== TagType.STRING) continue;
    const id = pair[0].getByte();
    const value = pair[1].getString();
    entries.push({ id, value });
    values[id] = value;
  }

  return { tagName: tag.name, entries, values };
}

/**
 * Handles the aiConfigToTag operation used by StarMade blueprint and segment file parsing.
 *
 * @param config - Input value for the aiConfigToTag operation.
 * @param fallback - Input value for the aiConfigToTag operation.
 * @returns The computed StarMade-Decoder value.
 */
export function aiConfigToTag(config: AiConfig, fallback: Tag | null = null): Tag {
  const fallbackChildren = fallback?.type === TagType.STRUCT
    ? fallback.getStruct().filter(t => t.type !== TagType.FINISH)
    : [];
  const entryById = new Map(config.entries.map(entry => [entry.id, entry.value]));
  const used = new Set<number>();
  const children: Tag[] = [];

  for (const child of fallbackChildren) {
    if (child.type !== TagType.STRUCT) {
      children.push(child);
      continue;
    }
    const pair = child.getStruct().filter(t => t.type !== TagType.FINISH);
    if (pair[0]?.type !== TagType.BYTE || pair[1]?.type !== TagType.STRING) {
      children.push(child);
      continue;
    }
    const id = pair[0].getByte();
    const value = entryById.get(id);
    if (value === undefined) {
      continue;
    }
    children.push(Tags.struct(child.name, [
      Tags.byte(pair[0].name, id),
      Tags.string(pair[1].name, value),
      ...pair.slice(2),
    ]));
    used.add(id);
  }

  for (const entry of config.entries) {
    if (!used.has(entry.id)) {
      children.push(Tags.struct(null, [
        Tags.byte(null, entry.id),
        Tags.string(null, entry.value),
      ]));
    }
  }

  return Tags.struct(config.tagName ?? fallback?.name ?? null, children);
}

/**
 * Parses RailChildRequestFromTag for StarMade blueprint and segment file parsing.
 *
 * @param tag - Input value for the parseRailChildRequestFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseRailChildRequestFromTag(tag: Tag | null): RailChildRequest | null {
  if (!tag || tag.type !== TagType.STRUCT) {
    return null;
  }

  const root = tag.getStruct();
  const railTagType = root[0]?.type === TagType.BYTE ? root[0].getByte() : -1;

  if (railTagType !== 1 && railTagType !== 3) {
    return null;
  }

  const requestContainer = root[1];
  const request = requestContainer?.type === TagType.STRUCT ? requestContainer.getStruct()[0] : null;
  const requestChildren = request?.type === TagType.STRUCT ? request.getStruct() : null;

  if (!requestChildren) {
    return null;
  }

  const rail = parseRailRequestPiece(requestChildren[0]);
  const docked = parseRailRequestPiece(requestChildren[1]);
  const railTransform = requestChildren[2]?.type === TagType.MATRIX4f ? requestChildren[2].getMatrix4f() : null;
  const dockedTransform = requestChildren[3]?.type === TagType.MATRIX4f ? requestChildren[3].getMatrix4f() : null;
  const railContact = requestChildren[4]?.type === TagType.VECTOR3i ? requestChildren[4].getVector3i() : null;
  const movingAtDockTransform = requestChildren[5]?.type === TagType.MATRIX4f ? requestChildren[5].getMatrix4f() : null;
  const flags = requestChildren
    .slice(6)
    .filter(t => t.type === TagType.BYTE)
    .map(t => t.getByte());

  return {
    railTagType,
    rail,
    docked,
    railTransform,
    dockedTransform,
    railContact: railContact ? { x: railContact.x, y: railContact.y, z: railContact.z } : null,
    movingAtDockTransform,
    flags,
  };
}

/**
 * Returns RailChildOffsetFromRequest.
 *
 * @param request - Input value for the getRailChildOffsetFromRequest operation.
 * @returns The computed StarMade-Decoder value.
 */
export function getRailChildOffsetFromRequest(request: RailChildRequest | null): BlueprintChildOffset | null {
  if (!request?.rail || !request.docked || !request.movingAtDockTransform) {
    return null;
  }

  const railOrigin = orientedRailBlockOrigin(request.rail.position, request.rail.orientation, false, 1);
  const dockedOrigin = orientedRailBlockOrigin(request.docked.position, request.docked.orientation, true, 0);

  return {
    x: request.movingAtDockTransform.m03 + railOrigin.x - dockedOrigin.x,
    y: request.movingAtDockTransform.m13 + railOrigin.y - dockedOrigin.y,
    z: request.movingAtDockTransform.m23 + railOrigin.z - dockedOrigin.z,
  };
}

/**
 * Handles the railChildRequestToTag operation used by StarMade blueprint and segment file parsing.
 *
 * @param request - Input value for the railChildRequestToTag operation.
 * @param fallback - Input value for the railChildRequestToTag operation.
 * @returns The computed StarMade-Decoder value.
 */
export function railChildRequestToTag(request: RailChildRequest, fallback: Tag | null = null): Tag {
  const fallbackRoot = fallback?.type === TagType.STRUCT
    ? fallback.getStruct().filter(t => t.type !== TagType.FINISH)
    : [];
  const requestContainer = fallbackRoot[1]?.type === TagType.STRUCT ? fallbackRoot[1] : null;
  const containerChildren = requestContainer
    ? requestContainer.getStruct().filter(t => t.type !== TagType.FINISH)
    : [];
  const fallbackRequest = containerChildren[0]?.type === TagType.STRUCT ? containerChildren[0] : null;
  const requestChildren = fallbackRequest
    ? fallbackRequest.getStruct().filter(t => t.type !== TagType.FINISH)
    : [];

  const payloadChildren = [
    buildRailRequestPiece(request.rail, requestChildren[0]),
    buildRailRequestPiece(request.docked, requestChildren[1]),
    request.railTransform ? Tags.matrix4f(requestChildren[2]?.name ?? null, request.railTransform) : requestChildren[2],
    request.dockedTransform ? Tags.matrix4f(requestChildren[3]?.name ?? null, request.dockedTransform) : requestChildren[3],
    request.railContact ? Tags.vector3i(requestChildren[4]?.name ?? null, request.railContact.x, request.railContact.y, request.railContact.z) : requestChildren[4],
    request.movingAtDockTransform ? Tags.matrix4f(requestChildren[5]?.name ?? null, request.movingAtDockTransform) : requestChildren[5],
    ...buildRailRequestFlags(request.flags, requestChildren.slice(6)),
  ].filter((tag): tag is Tag => tag !== undefined);

  const requestTag = Tags.struct(fallbackRequest?.name ?? null, payloadChildren);
  const newContainerChildren = [requestTag, ...containerChildren.slice(1)];
  const newContainer = Tags.struct(requestContainer?.name ?? null, newContainerChildren);
  const newRootChildren = [...fallbackRoot];
  setAt(newRootChildren, 0, Tags.byte(fallbackRoot[0]?.name ?? null, request.railTagType));
  setAt(newRootChildren, 1, newContainer);
  return Tags.struct(fallback?.name ?? null, newRootChildren);
}

/**
 * Parses RailRequestPiece for StarMade blueprint and segment file parsing.
 *
 * @param tag - Input value for the parseRailRequestPiece operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseRailRequestPiece(tag: Tag | undefined): RailPieceRef | null {
  if (!tag || tag.type !== TagType.STRUCT) {
    return null;
  }

  const children = tag.getStruct();
  const kind = children[0]?.type === TagType.BYTE ? children[0].getByte() : 0;
  const uid = children[1]?.type === TagType.STRING ? children[1].getString() : '';
  const position = children[2]?.type === TagType.VECTOR3i ? children[2].getVector3i() : null;
  const type = children[3]?.type === TagType.SHORT ? children[3].getShort() : 0;
  const orientation = children[4]?.type === TagType.BYTE ? children[4].getByte() : undefined;
  const active = children[5]?.type === TagType.BYTE ? children[5].getByte() > 0 : false;
  const hp = children[6]?.type === TagType.BYTE ? children[6].getByte() : 0;

  if (!position || orientation === undefined) {
    return null;
  }

  return {
    kind,
    uid,
    position: { x: position.x, y: position.y, z: position.z },
    type,
    orientation,
    active,
    hp,
  };
}

/**
 * Builds RailRequestPiece for StarMade blueprint and segment file parsing.
 *
 * @param piece - Input value for the buildRailRequestPiece operation.
 * @param fallback - Input value for the buildRailRequestPiece operation.
 * @returns The computed StarMade-Decoder value.
 */
function buildRailRequestPiece(piece: RailPieceRef | null, fallback: Tag | undefined): Tag | undefined {
  if (!piece) {
    return fallback;
  }

  const children = fallback?.type === TagType.STRUCT
    ? fallback.getStruct().filter(t => t.type !== TagType.FINISH)
    : [];
  return Tags.struct(fallback?.name ?? null, [
    Tags.byte(children[0]?.name ?? null, piece.kind),
    Tags.string(children[1]?.name ?? null, piece.uid),
    Tags.vector3i(children[2]?.name ?? null, piece.position.x, piece.position.y, piece.position.z),
    Tags.short(children[3]?.name ?? null, piece.type),
    Tags.byte(children[4]?.name ?? null, piece.orientation),
    Tags.byte(children[5]?.name ?? null, piece.active ? 1 : 0),
    Tags.byte(children[6]?.name ?? null, piece.hp),
    ...children.slice(7),
  ]);
}

/**
 * Builds RailRequestFlags for StarMade blueprint and segment file parsing.
 *
 * @param flags - Input value for the buildRailRequestFlags operation.
 * @param fallback - Input value for the buildRailRequestFlags operation.
 * @returns The computed StarMade-Decoder value.
 */
function buildRailRequestFlags(flags: number[], fallback: Tag[]): Tag[] {
  if (flags.length === 0) {
    return fallback;
  }

  return flags.map((flag, index) => Tags.byte(fallback[index]?.name ?? null, flag));
}

/**
 * Stores At.
 *
 * @param target - Input value for the setAt operation.
 * @param index - Input value for the setAt operation.
 * @param value - Input value for the setAt operation.
 */
function setAt<T>(target: T[], index: number, value: T): void {
  while (target.length <= index) target.push(undefined as T);
  target[index] = value;
}

/**
 * Defines normal24PrimaryOrientations for StarMade blueprint and segment file parsing.
 */
const normal24PrimaryOrientations = [
  'front', 'front', 'front', 'front',
  'back', 'back', 'back', 'back',
  'bottom', 'bottom', 'bottom', 'bottom',
  'top', 'top', 'top', 'top',
  'right', 'right', 'right', 'right',
  'left', 'left', 'left', 'left',
] as const;

/**
 * Defines the OriencubePrimarySide type used by StarMade blueprint and segment file parsing.
 */
type OriencubePrimarySide = typeof normal24PrimaryOrientations[number];

/**
 * Handles the orientedRailBlockOrigin operation used by StarMade blueprint and segment file parsing.
 *
 * @param position - Input value for the orientedRailBlockOrigin operation.
 * @param orientation - Input value for the orientedRailBlockOrigin operation.
 * @param mirrored - Input value for the orientedRailBlockOrigin operation.
 * @param move - Input value for the orientedRailBlockOrigin operation.
 * @returns The computed StarMade-Decoder value.
 */
function orientedRailBlockOrigin(
  position: BlueprintChildOffset,
  orientation: number,
  mirrored: boolean,
  move: number
): BlueprintChildOffset {
  const side = normal24PrimaryOrientations[modulo(orientation, normal24PrimaryOrientations.length)];
  const primarySide = mirrored ? mirrorPrimarySide(side) : side;
  const origin = { x: position.x - 16, y: position.y - 16, z: position.z - 16 };

  switch (primarySide) {
    case 'front': origin.z += move; break;
    case 'back': origin.z -= move; break;
    case 'top': origin.y += move; break;
    case 'bottom': origin.y -= move; break;
    case 'right': origin.x -= move; break;
    case 'left': origin.x += move; break;
  }

  return origin;
}

/**
 * Handles the mirrorPrimarySide operation used by StarMade blueprint and segment file parsing.
 *
 * @param side - Input value for the mirrorPrimarySide operation.
 * @returns The computed StarMade-Decoder value.
 */
function mirrorPrimarySide(side: OriencubePrimarySide): OriencubePrimarySide {
  switch (side) {
    case 'front': return 'back';
    case 'back': return 'front';
    case 'top': return 'bottom';
    case 'bottom': return 'top';
    case 'right': return 'left';
    case 'left': return 'right';
  }
}

/**
 * Handles the modulo operation used by StarMade blueprint and segment file parsing.
 *
 * @param value - Input value for the modulo operation.
 * @param divisor - Input value for the modulo operation.
 * @returns The computed StarMade-Decoder value.
 */
function modulo(value: number, divisor: number): number {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}
