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

const FINISH_BYTE       = 1;
const SEG_MANAGER_BYTE  = 2;
const DOCKING_BYTE      = 3;
const RAIL_BYTE         = 4;
const AI_CONFIG_BYTE    = 5;
const RAIL_DOCKER_BYTE  = 6;
const CARGO_BYTE        = 7;
const LOCK_BOX_BYTE     = 8;
const THRUST_CONFIG_BYTE = 9;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DockingEntry {
  name: string;
  posX: number; posY: number; posZ: number;
  sizeX: number; sizeY: number; sizeZ: number;
  style: number;
  orientation: number;
  /** Local child entity offset used by StarMade when spawning this attached blueprint. */
  offset: BlueprintChildOffset;
}

export interface CargoPoint {
  posIndex: bigint;
  capacity: number;
}

export interface RailDockerPiece {
  posX: number; posY: number; posZ: number;
  type: number;
  orientation: number;
  active: boolean;
  hp: number;
}

export interface Vector3f {
  x: number;
  y: number;
  z: number;
}

export interface BlueprintChildOffset {
  x: number;
  y: number;
  z: number;
}

export interface RailChildEntry {
  name: string;
  /** High-level rail docking request decoded from tag. */
  request: RailChildRequest | null;
  /** Local child entity offset computed from the rail request tag, when available. */
  offset: BlueprintChildOffset | null;
}

export interface BlueprintChildTransform {
  name: string;
  mode: 'docking' | 'rail';
  offset: BlueprintChildOffset;
}

export interface AiConfigEntry {
  id: number;
  value: string;
}

export interface AiConfig {
  tagName: string | null;
  entries: AiConfigEntry[];
  values: Record<number, string>;
}

export interface RailPieceRef {
  kind: number;
  uid: string;
  position: BlueprintChildOffset;
  type: number;
  orientation: number;
  active: boolean;
  hp: number;
}

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

export interface WirelessMarker {
  /** Rail UID of the destination chain element. */
  marking: string;
  /** Packed element index of the marker location. */
  markerLocation: bigint;
  /** Packed element index of the source activation controller. */
  fromLocation: bigint;
}

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

export interface SmbpmInternalState {
  managerRaw?: Uint8Array | null;
  managerTag?: Tag | null;
  aiRaw?: Uint8Array | null;
  aiTag?: Tag | null;
  thrustRaw?: Uint8Array | null;
  thrustTag?: Tag | null;
}

export interface RailChildInternalState {
  tagRaw?: Uint8Array | null;
  tag?: Tag | null;
}

const SMBPM_INTERNALS = new WeakMap<object, SmbpmInternalState>();
const RAIL_CHILD_INTERNALS = new WeakMap<object, RailChildInternalState>();

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

  get hasManager(): boolean {
    return this.manager !== null || getSmbpmInternals(this).managerTag != null;
  }

  get hasRails(): boolean {
    return Boolean(this.railUID || this.railChildren.length > 0 || this.railDockerPieces.length > 0);
  }

  get attachmentCount(): number {
    return this.childTransforms.length;
  }

  childTransformFor(name: string): BlueprintChildTransform | null {
    const wanted = basenameBlueprintEntityName(name);
    return this.childTransforms.find(transform =>
      basenameBlueprintEntityName(transform.name) === wanted
    ) ?? null;
  }

  childOffsetFor(name: string): BlueprintChildOffset | null {
    return this.childTransformFor(name)?.offset ?? null;
  }

  withMetaVersion(metaVersion: number): BlueprintMeta {
    return this._with({ metaVersion });
  }

  withManager(manager: SegmentControllerObject | null): BlueprintMeta {
    return this._with({ manager }, { preserveManager: false });
  }

  withDockingEntries(dockingEntries: DockingEntry[]): BlueprintMeta {
    return this._with({
      dockingEntries,
      childTransforms: buildChildTransforms(dockingEntries, this.railChildren),
    });
  }

  withRailBounds(railRootMin: Vector3f | null, railRootMax: Vector3f | null): BlueprintMeta {
    return this._with({ railRootMin, railRootMax });
  }

  withRailUID(railUID: string | undefined): BlueprintMeta {
    return this._with({ railUID });
  }

  withWirelessMarkers(wirelessMarkers: WirelessMarker[]): BlueprintMeta {
    return this._with({ wirelessMarkers });
  }

  withRailChildren(railChildren: RailChildEntry[]): BlueprintMeta {
    return this._with({
      railChildren,
      childTransforms: buildChildTransforms(this.dockingEntries, railChildren),
    }, { preserveRailChildren: false });
  }

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

  withAiConfig(aiConfig: AiConfig | null): BlueprintMeta {
    return this._with({ aiConfig: aiConfig ? cloneAiConfig(aiConfig) : null }, { preserveAi: false });
  }

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

  withRailDockerPieces(railDockerPieces: RailDockerPiece[]): BlueprintMeta {
    return this._with({ railDockerPieces });
  }

  withCargoPoints(cargoPoints: CargoPoint[]): BlueprintMeta {
    return this._with({ cargoPoints });
  }

  withLockBoxPoints(lockBoxPoints: CargoPoint[]): BlueprintMeta {
    return this._with({ lockBoxPoints });
  }

  withThrustConfig(thrustConfig: ThrustConfig | null): BlueprintMeta {
    return this._with({ thrustConfig }, { preserveThrust: false });
  }

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

function defineSmbpmInternals(file: SmbpmFile, internals: SmbpmInternalState): void {
  SMBPM_INTERNALS.set(file, internals);
}

function defineRailChildInternals(child: RailChildEntry, internals: RailChildInternalState): void {
  RAIL_CHILD_INTERNALS.set(child, internals);
}

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

function cloneAiConfig(config: AiConfig): AiConfig {
  return {
    tagName: config.tagName,
    entries: config.entries.map(entry => ({ ...entry })),
    values: { ...config.values },
  };
}

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

function basenameBlueprintEntityName(name: string): string {
  return name.split('/').filter(Boolean).slice(-1)[0] ?? name;
}

// ── Parser principal ──────────────────────────────────────────────────────────

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

export function getRailChildOffsetFromTag(tag: Tag | null): BlueprintChildOffset | null {
  return getRailChildOffsetFromRequest(parseRailChildRequestFromTag(tag));
}

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

function buildRailRequestFlags(flags: number[], fallback: Tag[]): Tag[] {
  if (flags.length === 0) {
    return fallback;
  }

  return flags.map((flag, index) => Tags.byte(fallback[index]?.name ?? null, flag));
}

function setAt<T>(target: T[], index: number, value: T): void {
  while (target.length <= index) target.push(undefined as T);
  target[index] = value;
}

const normal24PrimaryOrientations = [
  'front', 'front', 'front', 'front',
  'back', 'back', 'back', 'back',
  'bottom', 'bottom', 'bottom', 'bottom',
  'top', 'top', 'top', 'top',
  'right', 'right', 'right', 'right',
  'left', 'left', 'left', 'left',
] as const;

type OriencubePrimarySide = typeof normal24PrimaryOrientations[number];

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

function modulo(value: number, divisor: number): number {
  return ((Math.trunc(value) % divisor) + divisor) % divisor;
}
