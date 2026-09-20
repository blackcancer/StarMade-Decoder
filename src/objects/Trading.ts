/** @fileoverview Validated trade-file records, with retained source fields and compression envelopes. */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { writeTo, type TagReadOptions } from '../core/TagParser.js';
import { copyTagModel, rememberTagModel, inheritTagModel, renderTagModel, tagModelOptions, type TagModelFields } from '../core/TagModel.js';
import { DecodeError } from '../core/DecodeError.js';
import { TagModelFile } from '../core/TagModelFile.js';
import { RawElement } from '../serializable/Factories.js';
import { ElementCountMap, type BlockCount } from './Serializables.js';
import type { Vector3i } from '../types/Vectors.js';
import type { FormatLimits } from '../core/FormatLimits.js';

/** Explicit persisted route fields; no economy or administrative policy is inferred. */
export interface TradeRouteFields {
  blocks: ElementCountMap; blockPrice: bigint; deliveryPrice: bigint; startTime: bigint;
  fromId: bigint; toId: bigint; fleetId: bigint; volume: number;
  startSystem: Vector3i; targetSystem: Vector3i; currentSector: Vector3i;
  fromFactionId: number; toFactionId: number; fromPlayer: string; toPlayer: string;
  fromStation: string; toStation: string; startSector: Vector3i; sectorWayPoints: readonly Vector3i[];
}
/** Complete file origins are private and shared only between immutable revisions. */
const documents = new WeakMap<TradingManager, TagModelFile>();
/** Checks a positional schema, preserving any extension slots. */
function parts(tag: Tag, types: readonly TagType[]): Tag[] {
  const values = tag.getStruct().filter(value => value.type !== TagType.FINISH);
  if (types.some((type, index) => values[index]?.type !== type)) throw new DecodeError('E_FORMAT', 'Invalid trade record fields');
  return values;
}
/** Converts a supplied coordinate without inferring a default sector. */
function vector(value: Vector3i): Vector3i {
  if (!value) throw new DecodeError('E_FORMAT', 'A trade coordinate is required');
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}
/** Converts a stored coordinate to its exact integer Tag. */
function vectorTag(value: Vector3i): Tag { return Tags.vector3i(null, value.x, value.y, value.z); }
/** Raw block payloads use the enclosing Tag ceilings, rather than an unrelated format's lower defaults. */
function blockLimits(options: TagReadOptions): FormatLimits {
  return {maxEntries:options.maxNodes ?? 1_000_000,maxBytes:options.maxInflatedBytes ?? 256 * 1024 * 1024};
}
/** Both TradeActive and TradeManager currently define only version zero. */
function checkVersion(version: number): void {
  if (version !== 0) throw new DecodeError('E_UNSUPPORTED', 'Unsupported trade record version');
}

/** Immutable trade record with faithful opaque extension retention. */
export class TradeRoute implements TradeRouteFields {
  private readonly counts: readonly BlockCount[];
  private readonly points: readonly Vector3i[];
  #pointNames: readonly (string | null)[] = [];
  private readonly payloadSource = {};
  private readonly options: TagReadOptions;
  /** Creates a route from explicit wire values and validates it before exposing the model. */
  constructor(blocks: ElementCountMap, readonly blockPrice: bigint, readonly deliveryPrice: bigint,
    readonly startTime: bigint, readonly fromId: bigint, readonly toId: bigint, readonly fleetId: bigint,
    readonly volume: number, readonly startSystem: Vector3i, readonly targetSystem: Vector3i,
    readonly currentSector: Vector3i, readonly fromFactionId: number, readonly toFactionId: number,
    readonly fromPlayer: string, readonly toPlayer: string, readonly fromStation: string,
    readonly toStation: string, readonly startSector: Vector3i, sectorWayPoints: readonly Vector3i[], options: TagReadOptions = {}) {
    this.options = tagModelOptions(options);
    for (const value of [blockPrice,deliveryPrice,startTime,fromId,toId,fleetId]) if (typeof value !== 'bigint') throw new DecodeError('E_FORMAT','Trade long fields require bigint');
    this.counts = blocks.counts.map(count => Object.freeze({ ...count }));
    this.startSystem = vector(startSystem); this.targetSystem = vector(targetSystem);
    this.currentSector = vector(currentSector); this.startSector = vector(startSector);
    this.points = sectorWayPoints.map(vector);
    if (!Number.isFinite(volume)) throw new DecodeError('E_RANGE', 'Trade volume must be finite');
    writeTo(this.toTag(), this.options); Object.freeze(this);
  }
  /** Creates a record with named fields and caller-selected codec limits. */
  static create(fields: TradeRouteFields, options: TagReadOptions = {}): TradeRoute {
    return new TradeRoute(fields.blocks, fields.blockPrice, fields.deliveryPrice, fields.startTime,
      fields.fromId, fields.toId, fields.fleetId, fields.volume, fields.startSystem, fields.targetSystem,
      fields.currentSector, fields.fromFactionId, fields.toFactionId, fields.fromPlayer, fields.toPlayer,
      fields.fromStation, fields.toStation, fields.startSector, fields.sectorWayPoints, options);
  }
  /** Detached block counts; changing the returned legacy value cannot mutate the route. */
  get blocks(): ElementCountMap { return new ElementCountMap(this.counts.map(count => ({ ...count })), blockLimits(this.options)); }
  /** Detached waypoints in their persisted order. */
  get sectorWayPoints(): Vector3i[] { return this.points.map(point => ({ ...point })); }
  /** Returns a validated revision that retains source-only fields and names. */
  with(changes: Partial<TradeRouteFields>): TradeRoute {
    const result = TradeRoute.create({ ...this, blocks: this.blocks, sectorWayPoints: this.sectorWayPoints, ...changes }, this.options);
    result.#pointNames=this.#pointNames;
    inheritTagModel(this.payloadSource, result.payloadSource); inheritTagModel(this, result);
    result.toTag(); return result;
  }
  /** Reads the versioned tuple strictly; damaged fields are never silently substituted. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): TradeRoute {
    const source = copyTagModel(tag, options), outer = parts(source, [TagType.BYTE, TagType.STRUCT]);
    checkVersion(outer[0].getByte());
    const p = parts(outer[1], [TagType.SERIALIZABLE, ...Array<TagType>(6).fill(TagType.LONG), TagType.DOUBLE,
      TagType.VECTOR3i, TagType.VECTOR3i, TagType.VECTOR3i, TagType.INT, TagType.INT,
      TagType.STRING, TagType.STRING, TagType.STRING, TagType.STRING, TagType.VECTOR3i, TagType.STRUCT]);
    const raw = p[0].value as RawElement;
    if (raw.factoryId !== 1) throw new DecodeError('E_FORMAT', 'Trade blocks require ElementCountMap factory 1');
    const bytes = Buffer.from(raw.raw);
    const waypoints = p[18].getStruct().filter(t => t.type !== TagType.FINISH);
    if (waypoints.some(t => t.type !== TagType.VECTOR3i)) throw new DecodeError('E_FORMAT', 'Trade waypoints require integer coordinates');
    const result = new TradeRoute(ElementCountMap.fromRaw(bytes,blockLimits(options)), p[1].getLong(), p[2].getLong(), p[3].getLong(),
      p[4].getLong(), p[5].getLong(), p[6].getLong(), p[7].getDouble(), p[8].getVector3i(), p[9].getVector3i(),
      p[10].getVector3i(), p[11].getInt(), p[12].getInt(), p[13].getString(), p[14].getString(),
      p[15].getString(), p[16].getString(), p[17].getVector3i(), waypoints.map(t => t.getVector3i()), options);
    result.#pointNames=Object.freeze(waypoints.map(tag=>tag.name));
    rememberTagModel(result.payloadSource, outer[1], result.fields(), options);
    rememberTagModel(result, source, new Map([[0, Tags.byte(null, 0)], [1, result.payload()]]), options);
    return result;
  }
  /** Encodes represented blocks without filtering zero/negative stored quantities. */
  private fields(): TagModelFields {
    const raw = Buffer.alloc(4 + this.counts.length * 6); raw.writeInt32BE(this.counts.length);
    this.counts.forEach((count, index) => {
      if (!Number.isInteger(count.type) || !Number.isInteger(count.count)) throw new DecodeError('E_RANGE', 'Block type and quantity must be integers');
      raw.writeInt16BE(count.type, 4 + index * 6); raw.writeInt32BE(count.count, 6 + index * 6);
    });
    const tags = [new Tag(TagType.SERIALIZABLE, null, new RawElement(1, raw)),
      Tags.long(null, this.blockPrice), Tags.long(null, this.deliveryPrice), Tags.long(null, this.startTime),
      Tags.long(null, this.fromId), Tags.long(null, this.toId), Tags.long(null, this.fleetId), Tags.double(null, this.volume),
      vectorTag(this.startSystem), vectorTag(this.targetSystem), vectorTag(this.currentSector),
      Tags.int(null, this.fromFactionId), Tags.int(null, this.toFactionId), Tags.string(null, this.fromPlayer),
      Tags.string(null, this.toPlayer), Tags.string(null, this.fromStation), Tags.string(null, this.toStation),
      vectorTag(this.startSector), Tags.struct(null, this.points.map((point,index)=>Tags.rename(vectorTag(point),this.#pointNames[index]??null)))];
    return new Map(tags.map((tag, index) => [index, tag]));
  }
  /** Renders a payload while retaining unknown slots and unchanged source representations. */
  private payload(): Tag { return renderTagModel(this.payloadSource, this.fields(), Tags.struct(null, []), this.options); }
  /** Returns a detached complete route tree. */
  toTag(): Tag { return renderTagModel(this, new Map([[0, Tags.byte(null, 0)], [1, this.payload()]]), Tags.struct(null, []), this.options); }
  /** JSON uses decimal strings for 64-bit fields without losing precision. */
  toJSON(): object {
    return { blocks: this.blocks.counts, blockPrice: String(this.blockPrice), deliveryPrice: String(this.deliveryPrice),
      startTime: String(this.startTime), fromId: String(this.fromId), toId: String(this.toId), fleetId: String(this.fleetId),
      volume: this.volume, startSystem: this.startSystem, targetSystem: this.targetSystem, currentSector: this.currentSector,
      fromFactionId: this.fromFactionId, toFactionId: this.toFactionId, fromPlayer: this.fromPlayer, toPlayer: this.toPlayer,
      fromStation: this.fromStation, toStation: this.toStation, startSector: this.startSector, sectorWayPoints: this.sectorWayPoints };
  }
  /** Human-readable diagnostic, independent from the wire representation. */
  toString(): string { return `TradeRoute(${this.fromStation}→${this.toStation}, blocks=${this.blocks.totalBlocks}, price=${this.blockPrice}, fleet=${this.fleetId})`; }
}

/** Immutable collection for TRADING.tag; all edits validate indices and preserve source envelopes. */
export class TradingManager {
  private readonly values: readonly TradeRoute[];
  private readonly options: TagReadOptions;
  /** Creates a complete versioned manager; routes are immutable and the array is copied. */
  constructor(readonly version: number, routes: readonly TradeRoute[], options: TagReadOptions = {}) {
    checkVersion(version); this.options = tagModelOptions(options); this.values = [...routes];
    writeTo(this.toTag(), this.options); Object.freeze(this);
  }
  /** Detached route array. */
  get routes(): TradeRoute[] { return [...this.values]; }
  /** Returns routes originating in one faction. */
  routesFrom(factionId: number): TradeRoute[] { return this.values.filter(route => route.fromFactionId === factionId); }
  /** Returns routes addressed to one faction. */
  routesTo(factionId: number): TradeRoute[] { return this.values.filter(route => route.toFactionId === factionId); }
  /** Returns routes in either direction between two factions. */
  routesBetween(a: number, b: number): TradeRoute[] {
    return this.values.filter(route => (route.fromFactionId === a && route.toFactionId === b) || (route.fromFactionId === b && route.toFactionId === a));
  }
  /** Appends a route, preserving existing order. */
  addRoute(route: TradeRoute): TradingManager { return this.updated([...this.values, route]); }
  /** Removes one existing index. */
  removeRoute(index: number): TradingManager {
    this.checkIndex(index); return this.updated(this.values.filter((_, position) => position !== index));
  }
  /** Replaces one existing index. */
  updateRoute(index: number, route: TradeRoute): TradingManager {
    this.checkIndex(index); return this.updated(this.values.map((value, position) => position === index ? route : value));
  }
  /** Rejects missing indices instead of silently ignoring edits. */
  private checkIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.values.length) throw new DecodeError('E_RANGE', 'Trade route index does not exist');
  }
  /** Carries immutable source metadata to a validated replacement collection. */
  private updated(routes: TradeRoute[]): TradingManager {
    const result = inheritTagModel(this, new TradingManager(this.version, routes, this.options)), document = documents.get(this);
    if (document) documents.set(result, document); result.toBuffer(); return result;
  }
  /** Reads every route strictly and retains unknown manager fields. */
  static fromTag(root: Tag, options: TagReadOptions = {}): TradingManager {
    const source = copyTagModel(root, options), p = parts(source, [TagType.BYTE, TagType.STRUCT]); checkVersion(p[0].getByte());
    const result = new TradingManager(p[0].getByte(), p[1].getStruct().filter(t => t.type !== TagType.FINISH).map(t => TradeRoute.fromTag(t, options)), options);
    rememberTagModel(result, source, result.fields(), options); return result;
  }
  /** Known fields at their persisted positions. */
  private fields(): TagModelFields { return new Map([[0, Tags.byte(null, this.version)], [1, Tags.struct(null, this.values.map(route => route.toTag()))]]); }
  /** Returns a detached, field-preserving root. */
  toTag(): Tag { return renderTagModel(this, this.fields(), Tags.struct(null, []), this.options); }
  /** Serializes original bytes when unchanged, retaining compression/version/trailer after edits. */
  toBuffer(): Buffer { const doc = documents.get(this); return doc ? doc.withRoot(this.toTag()).toBuffer() : writeTo(this.toTag(), this.options); }
  /** Reads one file with explicit codec limits. */
  static fromBuffer(data: Uint8Array, options: TagReadOptions = {}): TradingManager {
    const doc = TagModelFile.fromBuffer(data, options), result = TradingManager.fromTag(doc.root, doc.options); documents.set(result, doc); return result;
  }
  /** Exact JSON projection independent from retained binary metadata. */
  toJSON(): object { return {version: this.version, routes: this.values.map(route => route.toJSON())}; }
  /** Human-readable collection summary. */
  toString(): string { return `TradingManager(v${this.version}, ${this.values.length} routes)`; }
}
