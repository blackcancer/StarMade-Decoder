/** @fileoverview Validated, detached models for StarMade's seven SERIALIZABLE payloads. */
import { DecodeError } from '../core/DecodeError.js';
import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';
import { formatBytes, formatLimits, checkEntryCount, type FormatLimits } from '../core/FormatLimits.js';
import { RawElement } from '../serializable/Factories.js';
import { posToIndex, indexToPos, type BlockPosition } from './ElementPosition.js';
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../core/TagModelFile.js';

/** Private envelopes retain exact source bytes, including legacy coordinates and NaN payloads. */
const states = new WeakMap<object, { limits: Required<FormatLimits>; raw?: Buffer }>();
/** Returns the validated limits inherited by immutable edits. */
function limits(model: object): Required<FormatLimits> { return states.get(model)!.limits; }
/** Checks the serialized size before allocating or copying data. */
function checkBytes(size: number, budget: Required<FormatLimits>): void {
  if (size > budget.maxBytes) throw new DecodeError('E_LIMIT', 'Serializable byte budget exceeded');
}
/** Registers constructor budgets after checking the complete collection and output size. */
function initialize(model: object, options: FormatLimits, entries: number, size: number): void {
  const budget = formatLimits(options);
  checkEntryCount(entries, budget); checkBytes(size, budget);
  states.set(model, { limits: budget });
}
/** Validates a signed wire integer without coercion. */
function integer(value: number, bits: 16 | 32): number {
  const bound = 2 ** (bits - 1);
  if (!Number.isInteger(value) || value < -bound || value >= bound) throw new DecodeError('E_RANGE', `Expected int${bits}`);
  return value;
}
/** Validates a signed 64-bit wire value without accepting lossy numbers. */
function long(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < -(1n << 63n) || value >= (1n << 63n)) throw new DecodeError('E_RANGE', 'Expected int64 bigint');
  return value;
}
/** Copies and validates a coordinate according to its wire representation. */
function position(value: BlockPosition, bits: 16 | 32): BlockPosition {
  if (!value || typeof value !== 'object') throw new DecodeError('E_FORMAT', 'Missing position');
  return { x: integer(value.x, bits), y: integer(value.y, bits), z: integer(value.z, bits) };
}
/** Converts a representable number to its persisted float32 value, retaining IEEE specials. */
function float(value: number): number {
  if (typeof value !== 'number' || (Number.isFinite(value) && !Number.isFinite(Math.fround(value)))) {
    throw new DecodeError('E_RANGE', 'Expected representable float32');
  }
  return Math.fround(value);
}
/** Checks actual arrays, including callers from untyped JavaScript. */
function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new DecodeError('E_FORMAT', 'Expected an array');
  integer(value.length, 32);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new DecodeError('E_FORMAT', 'Sparse serializable array');
}
/** Encodes a validated model, or returns a detached copy of its untouched source. */
function encode(model: object, size: number, write: (writer: BufferWriter) => void): Uint8Array {
  const state = states.get(model)!;
  if (state.raw) return new Uint8Array(state.raw);
  const writer = new BufferWriter(size, size);
  write(writer);
  return new Uint8Array(writer.toBuffer());
}
/** Remaining nested collection budget for one payload. */
interface ReadBudget { remaining: number; }
/** Reads a bounded count before allocating its records. */
function count(r: BufferReader, minimumBytes: number, budget: ReadBudget): number {
  const size = r.readInt32BE();
  if (size < 0) throw new DecodeError('E_FORMAT', 'Negative serializable count');
  if (size > budget.remaining) throw new DecodeError('E_LIMIT', 'Serializable entry budget exceeded');
  budget.remaining -= size;
  if (size * minimumBytes > r.remaining()) throw new DecodeError('E_TRUNCATED', 'Truncated serializable collection');
  return size;
}
/** Strict standalone reader; constructors validate fields and the original envelope controls byte limits. */
function read<T extends object>(raw: Uint8Array, options: FormatLimits,
  parse: (r: BufferReader, options: Required<FormatLimits>, budget: ReadBudget) => T): T {
  const budget = formatLimits(options), bytes = formatBytes(raw, budget), r = BufferReader.from(bytes);
  let model: T;
  try { model = parse(r, { ...budget, maxBytes: Number.MAX_SAFE_INTEGER }, { remaining: budget.maxEntries }); }
  catch (cause) {
    if (cause instanceof RangeError) throw new DecodeError('E_TRUNCATED', 'Truncated serializable payload', { cause, offset: r.offset });
    throw cause;
  }
  if (!r.isEOF()) throw new DecodeError('E_FORMAT', 'Trailing serializable bytes', { offset: r.offset });
  states.set(model, { limits: budget, raw: bytes });
  return model;
}
/** JSON-safe detached projection; decimal strings retain int64 precision and IEEE specials. */
function json(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString()
    : typeof item === 'number' && !Number.isFinite(item) ? String(item) : item));
}

/** One persisted controller/type record; duplicate records remain visible. */
export interface ControlLink { from: BlockPosition; type: number; targets: BlockPosition[]; }
/** A controller record, including those with no controlled types. */
interface ControlGroup { from: BlockPosition; links: ControlLink[]; }
/** Tag traversal limits plus byte/record ceilings retained by controller-map edits. */
export interface ControlElementMapperOptions extends TagReadOptions, FormatLimits {}
/** Historical trees are kept separately from the detached semantic projection. */
const controllerTags = new WeakMap<ControlElementMapper, { file: TagModelFile; options: ControlElementMapperOptions }>();
/** Reads a positional STRUCT without silently accepting a malformed controller record. */
function controlChildren(tag: Tag): Tag[] {
  if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Expected controller STRUCT');
  return tag.getStruct().filter(child => child.type !== TagType.FINISH);
}
/** Historical Tag coordinates are stored as int32 and are never shifted or narrowed. */
function controlPosition(tag: Tag | undefined): BlockPosition {
  if (tag?.type !== TagType.VECTOR3i) throw new DecodeError('E_FORMAT', 'Expected controller VECTOR3i');
  return position(tag.getVector3i(), 32);
}
/** Coordinate equality does not apply any geometry or game-specific transformation. */
function samePosition(a: BlockPosition, b: BlockPosition): boolean { return a.x === b.x && a.y === b.y && a.z === b.z; }
/** Controller links retain source Tags or disk/network envelopes; raw edits use canonical disk-v2. */
export class ControlElementMapper {
  static readonly FACTORY_ID = 0;
  static readonly DISK_HEADER = -1026;
  #groups: ControlGroup[];
  /** Takes detached controller/type/target snapshots; budgets count all three collection levels. */
  constructor(links: ControlLink[], options: FormatLimits = {}) {
    array(links);
    const budget = formatLimits(options); checkEntryCount(links.length, budget);
    let entries = 0, size = 8; checkBytes(size, budget);
    const groups = new Map<string, ControlGroup>();
    for (const link of links) {
      const from = position(link.from, 16), type = integer(link.type, 16);
      array(link.targets); const key = `${from.x},${from.y},${from.z}`;
      if (!groups.has(key)) { groups.set(key, { from, links: [] }); entries++; size += 10; }
      entries += 1 + link.targets.length; size += 6 + 6 * link.targets.length;
      checkEntryCount(entries, budget); checkBytes(size, budget);
      const targets = link.targets.map(target => position(target, 16));
      groups.get(key)!.links.push({ from, type, targets });
    }
    this.#groups = [...groups.values()];
    this.#validate(options);
    Object.freeze(this);
  }
  /** Validates aggregate counts and canonical bytes after topology changes. */
  #validate(options: FormatLimits): void {
    let entries = this.#groups.length;
    for (const group of this.#groups) for (const link of group.links) entries += 1 + link.targets.length;
    initialize(this, options, entries, this.#size());
  }
  /** Computes canonical disk-v2 size without allocating output. */
  #size(): number { return 8 + this.#groups.reduce((sum, g) => sum + 10 + g.links.reduce((n, l) => n + 6 + 6 * l.targets.length, 0), 0); }
  /** Detached records; empty controller records are retained privately for serialization. */
  get links(): ControlLink[] { return this.#groups.flatMap(group => group.links.map(link => structuredClone(link))); }
  /** Reads all supported disk and compact network versions, rejecting truncation and suffixes. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): ControlElementMapper {
    return read(raw, options, (r, opts, budget) => {
      const header = r.readInt32BE(), legacy = header >= 0, version = legacy ? 0 : -header;
      const disk = legacy || version > 1024, shift = legacy || (!disk && version < 2) ? 8 : 0;
      const coordinate = (value: number): number => ((value + shift) << 16) >> 16;
      let keys: number;
      if (legacy) {
        if (header > budget.remaining) throw new DecodeError('E_LIMIT', 'Too many legacy controllers');
        budget.remaining -= header; keys = header;
        if (keys * 10 > r.remaining()) throw new DecodeError('E_TRUNCATED', 'Truncated legacy controllers');
      } else keys = count(r, 10, budget);
      const groups: ControlGroup[] = [];
      for (let i = 0; i < keys; i++) {
        const from = { x: coordinate(r.readInt16BE()), y: coordinate(r.readInt16BE()), z: coordinate(r.readInt16BE()) };
        const group: ControlGroup = { from, links: [] }, values = count(r, 6, budget);
        for (let v = 0; v < values; v++) {
          const type = r.readInt16BE(), size = count(r, disk ? 6 : 3, budget), targets: BlockPosition[] = [];
          if (disk) {
            for (let e = 0; e < size; e++) targets.push({ x: coordinate(r.readInt16BE()), y: coordinate(r.readInt16BE()), z: coordinate(r.readInt16BE()) });
          } else {
            const bigX = r.readInt8() !== 0, bigY = r.readInt8() !== 0, bigZ = r.readInt8() !== 0;
            const mx = r.readInt16BE(), my = r.readInt16BE(), mz = r.readInt16BE();
            for (let e = 0; e < size; e++) targets.push({
              x: coordinate(mx + (bigX ? r.readInt16BE() : r.readInt8())),
              y: coordinate(my + (bigY ? r.readInt16BE() : r.readInt8())),
              z: coordinate(mz + (bigZ ? r.readInt16BE() : r.readInt8())),
            });
          }
          group.links.push({ from, type, targets });
        }
        groups.push(group);
      }
      const model = new ControlElementMapper([], opts); model.#groups = groups; model.#validate(opts); return model;
    });
  }
  /**
   * Reads cs1 SERIALIZABLE, cs0 packed int32 records, or historical nested controller tuples.
   * Unknown block types, repeated rows, empty controllers, names and tuple extensions remain intact.
   * Format byte limits cover the complete Tag; entry limits count controllers, types and targets.
   */
  static fromTag(tag: Tag, options: ControlElementMapperOptions = {}): ControlElementMapper {
    const budget = formatLimits({ maxBytes: options.maxBytes ?? options.maxInflatedBytes, maxEntries: options.maxEntries ?? options.maxNodes });
    const file = new TagModelFile(tag, { ...options, maxInflatedBytes: Math.min(budget.maxBytes, options.maxInflatedBytes ?? budget.maxBytes) });
    const root = file.root;
    let model: ControlElementMapper;
    if (root.type === TagType.SERIALIZABLE) {
      const element = root.getSerializable() as RawElement;
      if (element.getFactoryId() !== 0) throw new DecodeError('E_FORMAT', 'Expected controller SERIALIZABLE factory 0');
      model = ControlElementMapper.fromRaw(element.raw, budget);
    } else {
      const groups: ControlGroup[] = [], rows = controlChildren(root);
      let entries = rows.length; checkEntryCount(entries, budget);
      for (const row of rows) {
        const fields = controlChildren(row), from = controlPosition(fields[0]), links: ControlLink[] = [];
        if (root.name === 'cs0') {
          if (fields[1]?.type !== TagType.BYTE_ARRAY) throw new DecodeError('E_FORMAT', 'Expected cs0 controller bytes');
          const bytes = fields[1].getByteArray();
          if (bytes.length % 14 !== 0) throw new DecodeError('E_TRUNCATED', 'Incomplete cs0 controller record');
          entries += 2 * (bytes.length / 14); checkEntryCount(entries, budget);
          const reader = BufferReader.from(bytes);
          while (!reader.isEOF()) {
            const target = { x: reader.readInt32BE(), y: reader.readInt32BE(), z: reader.readInt32BE() }, type = reader.readInt16BE();
            links.push({ from, type, targets: [target] });
          }
        } else {
          if (!fields[1]) throw new DecodeError('E_FORMAT', 'Missing historical controller targets');
          const targets = controlChildren(fields[1]); entries += targets.length * 2; checkEntryCount(entries, budget);
          for (const target of targets) {
            const pair = controlChildren(target), to = controlPosition(pair[0]);
            if (pair[1]?.type !== TagType.SHORT) throw new DecodeError('E_FORMAT', 'Expected controller target type SHORT');
            links.push({ from, type: pair[1].getShort(), targets: [to] });
          }
        }
        groups.push({ from, links });
      }
      model = new ControlElementMapper([], { ...budget, maxBytes: Number.MAX_SAFE_INTEGER });
      model.#groups = groups; states.set(model, { limits: budget });
    }
    controllerTags.set(model, { file, options: { ...file.options, ...budget } }); return model;
  }
  /** Returns the complete detached source representation; new/raw models use SERIALIZABLE cs1. */
  toTag(): Tag {
    const source = controllerTags.get(this);
    return source ? source.file.root : new Tag(TagType.SERIALIZABLE, 'cs1', this.toRawElement());
  }
  /** Writes untouched bytes exactly; edits use disk-v2 while retaining empty controller records. */
  toRaw(): Uint8Array {
    for (const group of this.#groups) {
      position(group.from, 16);
      for (const link of group.links) for (const target of link.targets) position(target, 16);
    }
    if (!states.get(this)!.raw) checkBytes(this.#size(), limits(this));
    return encode(this, this.#size(), w => {
      w.writeInt32BE(ControlElementMapper.DISK_HEADER); w.writeInt32BE(this.#groups.length);
      for (const group of this.#groups) {
        w.writeInt16BE(group.from.x); w.writeInt16BE(group.from.y); w.writeInt16BE(group.from.z); w.writeInt32BE(group.links.length);
        for (const link of group.links) {
          w.writeInt16BE(link.type); w.writeInt32BE(link.targets.length);
          for (const t of link.targets) { w.writeInt16BE(t.x); w.writeInt16BE(t.y); w.writeInt16BE(t.z); }
        }
      }
    });
  }
  /** Wraps a detached payload for insertion into a Tag. */
  toRawElement(): RawElement { return new RawElement(0, this.toRaw()); }
  /** Appends a persisted link, retaining all existing records and empty controllers. */
  addLink(from: BlockPosition, type: number, target: BlockPosition): ControlElementMapper {
    const source = controllerTags.get(this);
    if (source?.file.root.type === TagType.STRUCT) {
      from = position(from, 32); target = position(target, 32); integer(type, 16);
      const root = source.file.root, rows = controlChildren(root);
      const index = rows.findIndex(row => samePosition(controlPosition(controlChildren(row)[0]), from));
      const existing = index < 0 ? undefined : rows[index];
      let targets: Tag;
      if (root.name === 'cs0') {
        const previous = existing ? controlChildren(existing)[1] : Tags.byteArray(null, []);
        const bytes = Buffer.alloc(14); bytes.writeInt32BE(target.x); bytes.writeInt32BE(target.y, 4); bytes.writeInt32BE(target.z, 8); bytes.writeInt16BE(type, 12);
        targets = Tags.byteArray(previous.name, Buffer.concat([previous.getByteArray(), bytes]));
      } else {
        const previous = existing ? controlChildren(existing)[1] : Tags.struct(null, []);
        targets = Tags.struct(previous.name, [...controlChildren(previous), Tags.struct(null, [Tags.vector3i(null, target.x, target.y, target.z), Tags.short(null, type)])]);
      }
      if (existing) rows[index] = replaceTagField(existing, 1, targets);
      else rows.push(Tags.struct(null, [Tags.vector3i(null, from.x, from.y, from.z), targets]));
      return ControlElementMapper.fromTag(Tags.struct(root.name, rows), source.options);
    }
    const added = new ControlElementMapper([{ from, type, targets: [target] }], limits(this));
    const model = new ControlElementMapper([], limits(this));
    model.#groups = structuredClone(this.#groups);
    const group = model.#groups.find(g => g.from.x === from.x && g.from.y === from.y && g.from.z === from.z);
    if (group) group.links.push(added.#groups[0].links[0]); else model.#groups.push(added.#groups[0]);
    model.#validate(limits(this)); return this.#retainTag(model);
  }
  /** Removes every record at the specified controller, including empty records. */
  removeFrom(from: BlockPosition): ControlElementMapper {
    const source = controllerTags.get(this);
    if (source?.file.root.type === TagType.STRUCT) {
      from = position(from, 32); const root = source.file.root;
      return ControlElementMapper.fromTag(Tags.struct(root.name, controlChildren(root).filter(row => !samePosition(controlPosition(controlChildren(row)[0]), from))), source.options);
    }
    position(from, 16);
    const model = new ControlElementMapper([], limits(this));
    model.#groups = structuredClone(this.#groups.filter(g => g.from.x !== from.x || g.from.y !== from.y || g.from.z !== from.z));
    model.#validate(limits(this)); return this.#retainTag(model);
  }
  /** Carries SERIALIZABLE names and Tag budgets through raw-model edits. */
  #retainTag(model: ControlElementMapper): ControlElementMapper {
    const source = controllerTags.get(this);
    return source ? ControlElementMapper.fromTag(new Tag(TagType.SERIALIZABLE, source.file.root.name, model.toRawElement()), source.options) : model;
  }
  /** Detached JSON view including empty controller records. */
  toJSON(): unknown { return structuredClone(this.#groups); }
  /** Diagnostic description. */
  toString(): string { return `ControlElementMapper(${this.links.length} links)`; }
}

/** One persisted element count, including zero, negative and unknown type IDs. */
export interface BlockCount { type: number; count: number; }
/** Lossless row storage; effective map operations use the last row for each type, as the game reader does. */
export class ElementCountMap {
  static readonly FACTORY_ID = 1;
  readonly #counts: BlockCount[];
  /** Copies every row without applying game block filtering or discarding nonpositive values. */
  constructor(counts: BlockCount[], options: FormatLimits = {}) {
    array(counts); initialize(this, options, counts.length, 4 + counts.length * 6);
    this.#counts = counts.map(c => ({ type: integer(c.type, 16), count: integer(c.count, 32) })); Object.freeze(this);
  }
  /** Detached persisted rows; duplicates retain their order. */
  get counts(): BlockCount[] { return this.#counts.map(c => ({ ...c })); }
  /** Parses exactly the declared count. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): ElementCountMap {
    return read(raw, options, (r, opts, budget) => {
      const size = count(r, 6, budget), values: BlockCount[] = [];
      for (let i = 0; i < size; i++) values.push({ type: r.readInt16BE(), count: r.readInt32BE() });
      return new ElementCountMap(values, opts);
    });
  }
  /** Encodes every row, including values 0 and -1. */
  toRaw(): Uint8Array { return encode(this, 4 + this.#counts.length * 6, w => {
    w.writeInt32BE(this.#counts.length); for (const c of this.#counts) { w.writeInt16BE(c.type); w.writeInt32BE(c.count); }
  }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(1, this.toRaw()); }
  /** Exact effective total; at most 2^16 int32 values keep its magnitude at or below 2^47. */
  get totalBlocks(): number { return Number(this.totalBlocksBigInt); }
  /** Exact sum of the last persisted count for each type. */
  get totalBlocksBigInt(): bigint {
    const effective = new Map(this.#counts.map(c => [c.type, c.count]));
    let total = 0n; for (const value of effective.values()) total += BigInt(value); return total;
  }
  /** Returns the last value for a type, or zero when absent. */
  getCount(type: number): number { integer(type, 16); return this.#counts.findLast(c => c.type === type)?.count ?? 0; }
  /** Replaces all rows for this type with the explicitly requested value, including zero or negative values. */
  setCount(type: number, count: number): ElementCountMap {
    return new ElementCountMap([...this.#counts.filter(c => c.type !== type), { type, count }], limits(this));
  }
  /** Removes all rows for a type; unlike setCount(type, 0), this removes the stored record. */
  removeType(type: number): ElementCountMap {
    integer(type, 16); return new ElementCountMap(this.#counts.filter(c => c.type !== type), limits(this));
  }
  /** Detached JSON representation. */
  toJSON(): unknown { return { counts: this.counts }; }
  /** Diagnostic description. */
  toString(): string { return `ElementCountMap(${this.#counts.length} rows, ${this.totalBlocks} total)`; }
}

/** Supported on-disk enum names in ordinal order. */
export type NPCEventType = 'GROWN' | 'WAR' | 'PEACE' | 'ALLIES' | 'TRADING' | 'LOST_STATION' | 'LOST_TERRITORY';
/** Persisted enum ordinal table; never silently maps unknown ordinals to another subtype. */
const NPC_EVENT_TYPES: NPCEventType[] = ['GROWN', 'WAR', 'PEACE', 'ALLIES', 'TRADING', 'LOST_STATION', 'LOST_TERRITORY'];
/** TRADING stores both endpoints as signed int32 coordinates. */
export interface NPCRoute { from: BlockPosition; to: BlockPosition; }
/** NPC event with its required subtype payload; unknown ordinals cannot be delimited safely. */
export class NPCFactionNewsEvent {
  static readonly FACTORY_ID = 2;
  readonly #system?: BlockPosition;
  readonly #route?: NPCRoute;
  readonly #payload: Buffer;
  /** Creates a validated event: 0/6 require system, 1/2/3/5 require otherEnt, 4 requires route. */
  constructor(readonly eventType: NPCEventType, readonly time: bigint, readonly factionId: number,
    system?: BlockPosition, readonly otherEnt?: string, route?: NPCRoute, options: FormatLimits = {}) {
    const ordinal = NPC_EVENT_TYPES.indexOf(eventType);
    if (ordinal < 0) throw new DecodeError('E_UNSUPPORTED', 'Unknown NPC event type');
    long(time); integer(factionId, 32); checkEntryCount(1, formatLimits(options));
    let payloadSize: number;
    if (ordinal === 0 || ordinal === 6) {
      if (otherEnt !== undefined || route !== undefined) throw new DecodeError('E_FORMAT', 'Unexpected NPC event payload');
      this.#system = position(system!, 32);
      payloadSize = 12;
    } else if (ordinal === 4) {
      if (system !== undefined || otherEnt !== undefined || !route) throw new DecodeError('E_FORMAT', 'TRADING requires only route');
      this.#route = { from: position(route.from, 32), to: position(route.to, 32) };
      payloadSize = 24;
    } else {
      if (system !== undefined || route !== undefined || typeof otherEnt !== 'string') throw new DecodeError('E_FORMAT', 'NPC event requires only otherEnt');
      payloadSize = 2;
      for (let i = 0; i < otherEnt.length; i++) {
        const code = otherEnt.charCodeAt(i); payloadSize += code > 0 && code <= 127 ? 1 : code <= 2047 ? 2 : 3;
      }
      if (payloadSize > 65537) throw new DecodeError('E_RANGE', 'Modified UTF event payload exceeds 65535 bytes');
    }
    initialize(this, options, 1, 13 + payloadSize);
    const w = new BufferWriter(payloadSize, payloadSize);
    if (this.#system) {
      w.writeInt32BE(this.#system.x); w.writeInt32BE(this.#system.y); w.writeInt32BE(this.#system.z);
    } else if (this.#route) {
      for (const p of [this.#route.from, this.#route.to]) { w.writeInt32BE(p.x); w.writeInt32BE(p.y); w.writeInt32BE(p.z); }
    } else w.writeJavaUTF(otherEnt!);
    this.#payload = w.toBuffer(); Object.freeze(this);
  }
  /** Detached system coordinate, if this subtype carries one. */
  get system(): BlockPosition | undefined { return this.#system && { ...this.#system }; }
  /** Detached trading endpoints, if this subtype carries them. */
  get route(): NPCRoute | undefined { return this.#route && structuredClone(this.#route); }
  /** Enum name used by existing callers. */
  get eventTypeName(): NPCEventType { return this.eventType; }
  /** Reads the source-defined payload for all seven ordinals. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): NPCFactionNewsEvent {
    return read(raw, options, (r, opts) => {
      const ordinal = r.readUInt8(), event = NPC_EVENT_TYPES[ordinal];
      if (!event) throw new DecodeError('E_UNSUPPORTED', 'Unknown NPC event ordinal');
      const time = r.readInt64BE(), faction = r.readInt32BE();
      const vector = (): BlockPosition => ({ x: r.readInt32BE(), y: r.readInt32BE(), z: r.readInt32BE() });
      if (ordinal === 0 || ordinal === 6) return new NPCFactionNewsEvent(event, time, faction, vector(), undefined, undefined, opts);
      if (ordinal === 4) return new NPCFactionNewsEvent(event, time, faction, undefined, undefined, { from: vector(), to: vector() }, opts);
      return new NPCFactionNewsEvent(event, time, faction, undefined, r.readJavaUTF(), undefined, opts);
    });
  }
  /** Encodes the required subtype payload, including an empty modified-UTF string. */
  toRaw(): Uint8Array { return encode(this, 13 + this.#payload.length, w => {
    w.writeUInt8(NPC_EVENT_TYPES.indexOf(this.eventType)); w.writeInt64BE(this.time); w.writeInt32BE(this.factionId); w.writeBytes(this.#payload);
  }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(2, this.toRaw()); }
  /** JSON projection with exact decimal time. */
  toJSON(): unknown { return json({ eventType: this.eventType, time: this.time, factionId: this.factionId, system: this.system, otherEnt: this.otherEnt, route: this.route }); }
  /** Diagnostic description. */
  toString(): string { return `NPCFactionNewsEvent(${this.eventType}, faction=${this.factionId}, time=${this.time})`; }
}

/** Ordered persisted int64 rows; duplicate values are preserved rather than silently deduplicated. */
export class LongSet {
  static readonly FACTORY_ID = 3;
  readonly #values: bigint[];
  /** Takes an int64 snapshot; arbitrary longs need not represent block coordinates. */
  constructor(values: bigint[], options: FormatLimits = {}) {
    array(values); initialize(this, options, values.length, 4 + values.length * 8); this.#values = values.map(long); Object.freeze(this);
  }
  /** Detached stored values. */
  get values(): bigint[] { return [...this.#values]; }
  /** Parses exactly the declared number of int64 values. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): LongSet {
    return read(raw, options, (r, opts, budget) => {
      const size = count(r, 8, budget), values: bigint[] = [];
      for (let i = 0; i < size; i++) values.push(r.readInt64BE()); return new LongSet(values, opts);
    });
  }
  /** Encodes all persisted rows. */
  toRaw(): Uint8Array { return encode(this, 4 + this.#values.length * 8, w => { w.writeInt32BE(this.#values.length); for (const v of this.#values) w.writeInt64BE(v); }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(3, this.toRaw()); }
  /** Decodes the low 48 bits as signed-short positions. */
  get positions(): BlockPosition[] { return this.#values.map(indexToPos); }
  /** Tests the presence of an exact int64 value. */
  has(index: bigint): boolean { long(index); return this.#values.includes(index); }
  /** Appends one row without changing existing duplicates. */
  add(index: bigint): LongSet { return new LongSet([...this.#values, index], limits(this)); }
  /** Appends a signed-short position without silently wrapping coordinates. */
  addPos(x: number, y: number, z: number): LongSet { position({ x, y, z }, 16); return this.add(posToIndex(x, y, z)); }
  /** Removes every occurrence of an exact int64 value. */
  remove(index: bigint): LongSet { long(index); return new LongSet(this.#values.filter(v => v !== index), limits(this)); }
  /** Exact int64 JSON values as decimal strings. */
  toJSON(): unknown { return json({ values: this.#values }); }
  /** Diagnostic description. */
  toString(): string { return `LongSet(${this.#values.length} entries)`; }
}

/** A persisted copied block and its optional connection metadata. */
export interface BufferedBlock { x: number; y: number; z: number; data: number; hasMeta: boolean; controllerPos?: bigint; connectedFrom?: bigint[]; }
/** Copy/paste records; untouched preallocation hints and boolean bytes survive exactly. */
export class BlockBuffer {
  static readonly FACTORY_ID = 4;
  readonly #blocks: BufferedBlock[];
  readonly #size: number;
  /** Copies blocks; absent metadata defaults to controller 0 and no connections only when hasMeta is true. */
  constructor(blocks: BufferedBlock[], options: FormatLimits = {}) {
    array(blocks); const budget = formatLimits(options); checkEntryCount(blocks.length, budget);
    let size = 12, entries = blocks.length;
    this.#blocks = blocks.map(b => {
      const p = position(b, 16), data = integer(b.data, 32);
      if (typeof b.hasMeta !== 'boolean') throw new DecodeError('E_FORMAT', 'Expected metadata boolean');
      size += 11; checkBytes(size, budget);
      if (!b.hasMeta) {
        if (b.controllerPos !== undefined || b.connectedFrom !== undefined) throw new DecodeError('E_FORMAT', 'Metadata would be discarded');
        return { ...p, data, hasMeta: false };
      }
      const connections = b.connectedFrom ?? []; array(connections);
      entries += connections.length; checkEntryCount(entries, budget); size += 12 + connections.length * 8; checkBytes(size, budget);
      return { ...p, data, hasMeta: true, controllerPos: long(b.controllerPos ?? 0n), connectedFrom: connections.map(long) };
    });
    this.#size = size; initialize(this, options, entries, size); Object.freeze(this);
  }
  /** Detached block and nested connection records. */
  get blocks(): BufferedBlock[] { return structuredClone(this.#blocks); }
  /** Strict record parsing; header allocation hints are bounded but do not override actual records. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): BlockBuffer {
    return read(raw, options, (r, opts, budget) => {
      const size = count(r, 11, budget);
      count(r, 0, { remaining: opts.maxEntries }); count(r, 0, { remaining: opts.maxEntries });
      const blocks: BufferedBlock[] = [];
      for (let i = 0; i < size; i++) {
        const b: BufferedBlock = { x: r.readInt16BE(), y: r.readInt16BE(), z: r.readInt16BE(), data: r.readInt32BE(), hasMeta: r.readInt8() !== 0 };
        if (b.hasMeta) {
          b.controllerPos = r.readInt64BE(); const size = count(r, 8, budget); b.connectedFrom = [];
          for (let j = 0; j < size; j++) b.connectedFrom.push(r.readInt64BE());
        }
        blocks.push(b);
      }
      return new BlockBuffer(blocks, opts);
    });
  }
  /** Emits source bytes unchanged, or a new buffer with exact allocation hints. */
  toRaw(): Uint8Array { return encode(this, this.#size, w => {
    const meta = this.#blocks.filter(b => b.hasMeta);
    w.writeInt32BE(this.#blocks.length); w.writeInt32BE(meta.length); w.writeInt32BE(meta.reduce((sum, b) => sum + b.connectedFrom!.length + 1, 0));
    for (const b of this.#blocks) {
      w.writeInt16BE(b.x); w.writeInt16BE(b.y); w.writeInt16BE(b.z); w.writeInt32BE(b.data); w.writeInt8(b.hasMeta ? 1 : 0);
      if (b.hasMeta) { w.writeInt64BE(b.controllerPos!); w.writeInt32BE(b.connectedFrom!.length); for (const c of b.connectedFrom!) w.writeInt64BE(c); }
    }
  }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(4, this.toRaw()); }
  /** Number of stored block records. */
  get blockCount(): number { return this.#blocks.length; }
  /** Detached JSON with int64 values represented exactly. */
  toJSON(): unknown { return json({ blocks: this.#blocks }); }
  /** Diagnostic description. */
  toString(): string { return `BlockBuffer(${this.#blocks.length} blocks)`; }
}

/** One vector record; persisted duplicates retain their ordering. */
export interface Vec3fEntry { key: bigint; x: number; y: number; z: number; }
/** A signed-int64 to IEEE float32-vector map with detached immutable edits. */
export class Long2Vector3fMap {
  static readonly FACTORY_ID = 5;
  readonly #entries: Vec3fEntry[];
  /** Validates and snapshots keys and float32 vectors. */
  constructor(entries: Vec3fEntry[], options: FormatLimits = {}) {
    array(entries); initialize(this, options, entries.length, 4 + entries.length * 20);
    this.#entries = entries.map(e => ({ key: long(e.key), x: float(e.x), y: float(e.y), z: float(e.z) })); Object.freeze(this);
  }
  /** Detached persisted rows. */
  get entries(): Vec3fEntry[] { return this.#entries.map(e => ({ ...e })); }
  /** Parses exactly the declared number of vectors. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): Long2Vector3fMap {
    return read(raw, options, (r, opts, budget) => {
      const size = count(r, 20, budget), entries: Vec3fEntry[] = [];
      for (let i = 0; i < size; i++) entries.push({ key: r.readInt64BE(), x: r.readFloat32BE(), y: r.readFloat32BE(), z: r.readFloat32BE() });
      return new Long2Vector3fMap(entries, opts);
    });
  }
  /** Encodes all persisted vector rows. */
  toRaw(): Uint8Array { return encode(this, 4 + this.#entries.length * 20, w => {
    w.writeInt32BE(this.#entries.length); for (const e of this.#entries) { w.writeInt64BE(e.key); w.writeFloat32BE(e.x); w.writeFloat32BE(e.y); w.writeFloat32BE(e.z); }
  }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(5, this.toRaw()); }
  /** Detached effective value; duplicate keys use the last row. */
  get(key: bigint): Vec3fEntry | undefined { long(key); return this.entries.findLast(e => e.key === key); }
  /** Replaces all occurrences of a key, preserving other records. */
  set(key: bigint, x: number, y: number, z: number): Long2Vector3fMap {
    return new Long2Vector3fMap([...this.#entries.filter(e => e.key !== key), { key, x, y, z }], limits(this));
  }
  /** Removes all occurrences of a key. */
  delete(key: bigint): Long2Vector3fMap { long(key); return new Long2Vector3fMap(this.#entries.filter(e => e.key !== key), limits(this)); }
  /** Exact int64 and IEEE-special JSON values. */
  toJSON(): unknown { return json({ entries: this.#entries }); }
  /** Diagnostic description. */
  toString(): string { return `Long2Vector3fMap(${this.#entries.length} entries)`; }
}

/** Persisted transform floats: origin first, then a row-major 3-by-3 matrix. */
export interface Transform {
  originX: number; originY: number; originZ: number;
  m00: number; m01: number; m02: number; m10: number; m11: number; m12: number; m20: number; m21: number; m22: number;
}
/** One transform row. */
export interface TransformEntry { key: bigint; transform: Transform; }
/** Source-defined float order in TransformTools.serializeFully. */
const TRANSFORM_FIELDS: (keyof Transform)[] = ['originX', 'originY', 'originZ', 'm00', 'm01', 'm02', 'm10', 'm11', 'm12', 'm20', 'm21', 'm22'];
/** Signed-int64 to transform map with preserved wire row order. */
export class Long2TransformMap {
  static readonly FACTORY_ID = 6;
  readonly #entries: TransformEntry[];
  /** Validates and snapshots all twelve persisted float32 components. */
  constructor(entries: TransformEntry[], options: FormatLimits = {}) {
    array(entries); initialize(this, options, entries.length, 4 + entries.length * 56);
    this.#entries = entries.map(e => {
      const key = long(e.key), transform = {} as Transform;
      for (const field of TRANSFORM_FIELDS) transform[field] = float(e.transform[field]); return { key, transform };
    }); Object.freeze(this);
  }
  /** Detached rows and nested transforms. */
  get entries(): TransformEntry[] { return structuredClone(this.#entries); }
  /** Parses exactly the declared number of transforms. */
  static fromRaw(raw: Uint8Array, options: FormatLimits = {}): Long2TransformMap {
    return read(raw, options, (r, opts, budget) => {
      const size = count(r, 56, budget), entries: TransformEntry[] = [];
      for (let i = 0; i < size; i++) {
        const key = r.readInt64BE(), transform = {} as Transform;
        for (const field of TRANSFORM_FIELDS) transform[field] = r.readFloat32BE(); entries.push({ key, transform });
      }
      return new Long2TransformMap(entries, opts);
    });
  }
  /** Encodes origin and matrix in their persisted order. */
  toRaw(): Uint8Array { return encode(this, 4 + this.#entries.length * 56, w => {
    w.writeInt32BE(this.#entries.length); for (const e of this.#entries) { w.writeInt64BE(e.key); for (const field of TRANSFORM_FIELDS) w.writeFloat32BE(e.transform[field]); }
  }); }
  /** Wraps a detached Tag payload. */
  toRawElement(): RawElement { return new RawElement(6, this.toRaw()); }
  /** Detached effective value; the final row wins for duplicate keys. */
  get(key: bigint): TransformEntry | undefined { long(key); return this.entries.findLast(e => e.key === key); }
  /** Replaces every row for a key with a detached transform. */
  set(key: bigint, transform: Transform): Long2TransformMap { return new Long2TransformMap([...this.#entries.filter(e => e.key !== key), { key, transform }], limits(this)); }
  /** Removes every row for a key. */
  delete(key: bigint): Long2TransformMap { long(key); return new Long2TransformMap(this.#entries.filter(e => e.key !== key), limits(this)); }
  /** Exact int64 and IEEE-special JSON values. */
  toJSON(): unknown { return json({ entries: this.#entries }); }
  /** Diagnostic description. */
  toString(): string { return `Long2TransformMap(${this.#entries.length} entries)`; }
}

/** Decodes a known payload under caller budgets; unknown factories retain opaque detached bytes. */
export function decodeSerializable(elem: RawElement, options: FormatLimits = {}): ControlElementMapper | ElementCountMap | NPCFactionNewsEvent | LongSet | BlockBuffer | Long2Vector3fMap | Long2TransformMap | RawElement {
  switch (elem.factoryId) {
    case 0: return ControlElementMapper.fromRaw(elem.raw, options);
    case 1: return ElementCountMap.fromRaw(elem.raw, options);
    case 2: return NPCFactionNewsEvent.fromRaw(elem.raw, options);
    case 3: return LongSet.fromRaw(elem.raw, options);
    case 4: return BlockBuffer.fromRaw(elem.raw, options);
    case 5: return Long2Vector3fMap.fromRaw(elem.raw, options);
    case 6: return Long2TransformMap.fromRaw(elem.raw, options);
    default: return new RawElement(elem.factoryId, formatBytes(elem.raw, formatLimits(options)));
  }
}
