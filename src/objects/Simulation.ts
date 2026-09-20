/**
 * @fileoverview Immutable simulation records retaining opaque fields and complete Tag file envelopes.
 * Contract inspected locally in StarMade-Open decf3a1: SimulationManager, SimulationGroup,
 * TargetSectorSimulationGroup, AttackSingleEntitySimulationGroup, SimPrograms and NPCFactionManager.
 */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { readTagDocument, writeTo, type TagDocument, type TagReadOptions } from '../core/TagParser.js';
import { copyTagModel, inheritTagModel, rememberTagModel, renderTagModel, tagModelOptions, type TagModelFields } from '../core/TagModel.js';
import { DecodeError } from '../core/DecodeError.js';
import type { Vector3i } from '../types/Vectors.js';

/** Private file envelopes are shared only between immutable snapshots. */
const documents = new WeakMap<object, TagDocument>();
/** Positional children without the mandatory terminator. */
function children(tag: Tag): Tag[] { return tag.getStruct().filter(value => value.type !== TagType.FINISH); }
/** Rejects required fields with an absent or incorrect wire type. */
function required(parts: Tag[], types: TagType[]): void {
  if (types.some((type, index) => parts[index]?.type !== type)) throw new DecodeError('E_FORMAT', 'Invalid simulation field types');
}
/** Validates a known version or ordinal before interpreting version-specific fields. */
function supported(value: number, allowed: readonly number[], label: string): void {
  if (!allowed.includes(value)) throw new DecodeError('E_UNSUPPORTED', `Unsupported simulation ${label}: ${value}`);
}
/** Carries private source fields and the file envelope into a validated immutable edit. */
function inherited<T extends object>(previous: object, next: T): T {
  inheritTagModel(previous, next); const document = documents.get(previous);
  if (document) documents.set(next, document);
  return next;
}
/** Serializes a complete document while retaining compression, version and trailing data. */
function encoded(model: object, root: Tag, options: TagReadOptions): Buffer {
  const document = documents.get(model);
  return document ? document.toBuffer(root) : writeTo(root, options);
}
/** Checks subtype-specific metadata without discarding its extension fields. */
function metadataFor(type: number, tag: Tag): void {
  if (tag.type === TagType.FINISH) throw new DecodeError('E_FORMAT', 'Simulation metadata must occupy slot 6');
  if (type === 0 && tag.type !== TagType.VECTOR3i) throw new DecodeError('E_FORMAT', 'Target-sector metadata requires VECTOR3i');
  if (type === 2) {
    if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Attack metadata requires STRUCT');
    required(children(tag), [TagType.VECTOR3i, TagType.STRING]);
  }
}

/** Editable semantic fields of an immutable group; metadata is explicit subtype data. */
export interface SimulationGroupFields {
  version: number; type: number; members: readonly string[]; startTime: bigint;
  startSector: Vector3i; programId: number; metadata: Tag;
}

/** One supported group, including the mandatory start sector and complete metadata payload. */
export class SimulationGroup implements SimulationGroupFields {
  private readonly memberValues: readonly string[];
  private readonly sector: Vector3i;
  private readonly meta: Tag;
  private readonly options: TagReadOptions;
  /** Creates a validated group; BYTE zero is the real default metadata only for a ravaging group. */
  constructor(readonly version: number, readonly type: number, members: readonly string[], readonly startTime: bigint,
    startSector: Vector3i, readonly programId: number, metadata: Tag = Tags.byte(null, 0), options: TagReadOptions = {}) {
    this.options = tagModelOptions(options);
    supported(version, [0, 1], 'group version'); supported(type, [0, 1, 2], 'group type');
    if (!startSector) throw new DecodeError('E_FORMAT', 'Simulation startSector is required');
    if (programId >= 0) supported(programId, [0, 1], 'program');
    this.memberValues = [...members]; this.sector = { x: startSector.x, y: startSector.y, z: startSector.z };
    metadataFor(type, metadata); this.meta = copyTagModel(metadata, this.options);
    writeTo(this.toTag(), this.options); Object.freeze(this);
  }
  /** Detached member identifiers cannot mutate an existing model. */
  get members(): string[] { return [...this.memberValues]; }
  /** Detached coordinates cannot mutate an existing model. */
  get startSector(): Vector3i { return { ...this.sector }; }
  /** Detached metadata includes subtype-specific extensions. */
  get metadata(): Tag { return copyTagModel(this.meta, this.options); }
  /** Returns a validated edit without sharing mutable caller-owned arrays, vectors or Tags. */
  with(changes: Partial<SimulationGroupFields>): SimulationGroup {
    const fields = { version: this.version, type: this.type, members: this.members, startTime: this.startTime,
      startSector: this.startSector, programId: this.programId, metadata: this.metadata, ...changes };
    return inherited(this, new SimulationGroup(fields.version, fields.type, fields.members, fields.startTime,
      fields.startSector, fields.programId, fields.metadata, this.options));
  }
  /** Reads required current/legacy fields strictly and retains every unmodelled trailing field. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): SimulationGroup {
    const original = copyTagModel(tag, options), parts = children(original);
    required(parts, [TagType.BYTE, TagType.INT, TagType.STRUCT, TagType.LONG, TagType.VECTOR3i, TagType.INT]);
    if (!parts[6]) throw new DecodeError('E_INCOMPLETE', 'Simulation metadata is missing');
    const members = children(parts[2]);
    if (members.some(member => member.type !== TagType.STRING)) throw new DecodeError('E_FORMAT', 'Simulation members require STRING records');
    const result = new SimulationGroup(parts[0].getByte(), parts[1].getInt(), members.map(member => member.getString()),
      parts[3].getLong(), parts[4].getVector3i(), parts[5].getInt(), parts[6], options);
    rememberTagModel(result, original, result.fields(original), options); return result;
  }
  /** Renders only edited fields, retaining root/member names and all unknown slots. */
  toTag(): Tag {
    const initial = Tags.struct(null, []), source = renderTagModel(this, new Map(), initial, this.options);
    const result = renderTagModel(this, this.fields(source), initial, this.options);
    writeTo(result, this.options); return result;
  }
  /** Stable diagnostic representation uses the group's actual persisted fields. */
  toString(): string { return `SimulationGroup(type=${this.type}, members=${this.memberValues.length}, sector=${JSON.stringify(this.sector)})`; }
  /** Known fields retain original member names by position when replacing a collection. */
  private fields(root: Tag): TagModelFields {
    const previous = children(root)[2], members = previous ? children(previous) : [];
    return new Map([[0, Tags.byte(null, this.version)], [1, Tags.int(null, this.type)],
      [2, Tags.struct(null, this.memberValues.map((member, index) => Tags.string(members[index]?.name ?? null, member)))],
      [3, Tags.long(null, this.startTime)], [4, Tags.vector3i(null, this.sector.x, this.sector.y, this.sector.z)],
      [5, Tags.int(null, this.programId)], [6, copyTagModel(this.meta, this.options)]]);
  }
}

/** Only the NPC manager version is modeled; other source fields remain opaque. */
export class NPCFactionManager {
  private readonly options: TagReadOptions;
  /** Creates the supported version-zero manager. */
  constructor(readonly version: number, options: TagReadOptions = {}) {
    this.options = tagModelOptions(options); supported(version, [0], 'NPC manager version');
    writeTo(this.toTag(), this.options); Object.freeze(this);
  }
  /** Returns a validated immutable edit, retaining the original source/envelope. */
  with(changes: { version?: number }): NPCFactionManager {
    return inherited(this, new NPCFactionManager({ version: this.version, ...changes }.version, this.options));
  }
  /** Reads the mandatory version byte and preserves extensions. */
  static fromTag(root: Tag, options: TagReadOptions = {}): NPCFactionManager {
    const original = copyTagModel(root, options), parts = children(original); required(parts, [TagType.BYTE]);
    const result = new NPCFactionManager(parts[0].getByte(), options);
    rememberTagModel(result, original, new Map([[0, Tags.byte(null, result.version)]]), options); return result;
  }
  /** Reads with caller limits and snapshots the original binary envelope. */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): NPCFactionManager {
    const document = readTagDocument(data, options), result = NPCFactionManager.fromTag(document.root, tagModelOptions(options));
    documents.set(result, document); return result;
  }
  /** Returns a detached tree with source extensions intact. */
  toTag(): Tag {
    const result = renderTagModel(this, new Map([[0, Tags.byte(null, this.version)]]), Tags.struct(null, []), this.options);
    writeTo(result, this.options); return result;
  }
  /** Returns detached bytes, preserving an unchanged original file exactly. */
  toBuffer(): Buffer { return encoded(this, this.toTag(), this.options); }
  /** Human-readable supported manager version. */
  toString(): string { return `NPCFactionManager(v${this.version})`; }
}

/** Semantic state: uniqueGroups is the next group-ID counter, never a timestamp. */
export interface SimulationStateFields { version: number; groups: readonly SimulationGroup[]; uniqueGroups: bigint; }

/** Immutable group collection and group-ID generator, with lossless source retention. */
export class SimulationState implements SimulationStateFields {
  private readonly values: readonly SimulationGroup[];
  private readonly options: TagReadOptions;
  /** Validates and snapshots groups under the same caller-selected traversal/output budgets. */
  constructor(readonly version: number, groups: readonly SimulationGroup[], readonly uniqueGroups: bigint, options: TagReadOptions = {}) {
    this.options = tagModelOptions(options); supported(version, [0], 'state version');
    this.values = groups.map(group => SimulationGroup.fromTag(group.toTag(), this.options));
    writeTo(this.toTag(), this.options); Object.freeze(this);
  }
  /** Detached array of immutable group snapshots. */
  get groups(): SimulationGroup[] { return [...this.values]; }
  /** @deprecated Misnamed legacy alias for uniqueGroups; this is not an update time. */
  get lastUpdate(): bigint { return this.uniqueGroups; }
  /** Returns a validated state edit preserving original fields and the binary envelope. */
  with(changes: Partial<SimulationStateFields>): SimulationState {
    const fields = { version: this.version, groups: this.values, uniqueGroups: this.uniqueGroups, ...changes };
    return inherited(this, new SimulationState(fields.version, fields.groups, fields.uniqueGroups, this.options));
  }
  /** Adds a detached group without inventing group-ID allocation or gameplay behavior. */
  addGroup(group: SimulationGroup): SimulationState { return this.with({ groups: [...this.values, group] }); }
  /** Removes an existing group; invalid positions fail explicitly. */
  removeGroup(index: number): SimulationState {
    if (!Number.isInteger(index) || index < 0 || index >= this.values.length) throw new DecodeError('E_RANGE', 'Simulation group index is out of range');
    return this.with({ groups: this.values.filter((_, position) => position !== index) });
  }
  /** Explicitly updates the group-ID generator without treating it as a timestamp. */
  withUniqueGroups(value: bigint): SimulationState { return this.with({ uniqueGroups: value }); }
  /** @deprecated Use withUniqueGroups; the supplied value is a group-ID counter. */
  withLastUpdate(value: bigint): SimulationState { return this.withUniqueGroups(value); }
  /** Reads required fields strictly; the legacy absent counter defaults to zero as in the Java reader. */
  static fromTag(root: Tag, options: TagReadOptions = {}): SimulationState {
    const original = copyTagModel(root, options), parts = children(original); required(parts, [TagType.BYTE, TagType.STRUCT]);
    if (parts[2] && parts[2].type !== TagType.LONG) throw new DecodeError('E_FORMAT', 'Simulation uniqueGroups requires LONG');
    const groups = children(parts[1]).map(group => SimulationGroup.fromTag(group, options));
    const result = new SimulationState(parts[0].getByte(), groups, parts[2] ? parts[2].getLong() : 0n, options);
    rememberTagModel(result, original, result.fields(), options); return result;
  }
  /** Reads with caller limits and snapshots the original binary envelope. */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): SimulationState {
    const document = readTagDocument(data, options), result = SimulationState.fromTag(document.root, tagModelOptions(options));
    documents.set(result, document); return result;
  }
  /** Returns a detached source-preserving tree, validating all output limits. */
  toTag(): Tag {
    const result = renderTagModel(this, this.fields(), Tags.struct('SimulationState', []), this.options);
    writeTo(result, this.options); return result;
  }
  /** Returns detached bytes with exact no-op and reverted output. */
  toBuffer(): Buffer { return encoded(this, this.toTag(), this.options); }
  /** Diagnostic output names the counter according to its actual meaning. */
  toString(): string { return `SimulationState(v${this.version}, ${this.values.length} groups, uniqueGroups=${this.uniqueGroups})`; }
  /** Projects only modeled fields; source-only slots and names remain retained. */
  private fields(): TagModelFields {
    return new Map([[0, Tags.byte(null, this.version)], [1, Tags.struct(null, this.values.map(group => group.toTag()))],
      [2, Tags.long(null, this.uniqueGroups)]]);
  }
}
