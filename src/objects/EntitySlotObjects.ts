/**
 * @fileoverview High-level StarMade .ent slot objects
 *
 * These objects wrap the remaining StarMade-Open .ent nested slots that do not
 * deserve to leak raw Tag trees into the public high-level API. Each object keeps
 * the original tag privately for lossless round-trips, while exposing named
 * fields, summaries, and immutable update helpers.
 */

import { Tag, FINISH_TAG } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType, TAG_TYPE_NAMES } from '../core/TagType.js';
import { Matrix4f } from '../types/Matrices.js';
import { indexToPos, posToIndex } from './ElementPosition.js';
import { ElementCountMap, type BlockCount } from './Serializables.js';
import { Inventory } from './components/Inventory.js';
import {
  buildEditableEntityFields,
  fieldValueAsBigInt,
  fieldValueAsBoolean,
  fieldValueAsInteger,
  fieldValueAsNumber,
  fieldValueAsString,
  type EntityField,
  type EntityFieldSchema,
  type EntityFieldSetterMap,
} from './EntityFieldView.js';

export interface EntVector3i {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EntVector3f {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EntVector4f {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export type EntMatrix4f = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface UniqueSegmentPieceValue {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;
}

export interface RailRequestSummary {
  readonly disconnect: boolean;
  readonly rail: UniqueSegmentPieceValue | null;
  readonly docked: UniqueSegmentPieceValue | null;
  readonly railDockerPosOnRail: EntVector3i | null;
  readonly railMovingToDockerPosOnRail: EntVector3i | null;
  readonly didRotationInPlace: boolean;
  readonly dockingPermission: number | null;
}

export interface CargoInventoryBlockValue {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;
}

export interface ScanEntityData {
  readonly name: string;
  readonly sector: EntVector3i;
  readonly factionId: number;
  readonly controllerInfo: string;
}

export interface ScanResourceData {
  readonly name?: string;
  readonly type: string | number;
  readonly sector?: EntVector3i;
  readonly canViewGenerationData?: boolean;
  readonly resourceInfo?: string;
  readonly resourceCaps?: string;
  readonly resourceAmounts?: string;
  readonly resourceQuantity?: number;
}

export interface QuarterSummary {
  readonly version: number;
  readonly type: number;
  readonly typeName: string;
  readonly min: EntVector3i;
  readonly max: EntVector3i;
  readonly id: number;
  readonly status?: string;
  readonly integrity?: number;
  readonly priority?: number;
  readonly index?: bigint;
  readonly childIds: readonly number[];
  readonly extra: Record<string, unknown> | null;
}

export interface ModuleExplosionSummary {
  readonly version: number;
  readonly created: bigint;
  readonly lastExplosion: bigint;
  readonly explosionDelay: bigint;
  readonly moduleId: bigint;
  readonly radius: number;
  readonly damage: number;
  readonly min: EntVector3f | null;
  readonly max: EntVector3f | null;
  readonly explosionPositionCount: number;
  readonly explosionPositions: readonly bigint[];
  readonly chain: boolean;
  readonly cause: number;
}

export class EntSlotObject {
  readonly kind: string;
  readonly present: boolean;
  readonly tagName: string | null;
  readonly tagType: string;
  readonly childCount: number;

  private readonly _tag!: Tag;

  constructor(kind: string, tag: Tag = Tags.nothing(null)) {
    this.kind = kind;
    this.present = tag.type !== TagType.NOTHING && tag.type !== TagType.FINISH;
    this.tagName = tag.name;
    this.tagType = tagTypeName(tag.type);
    this.childCount = tagChildren(tag).length;
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  get fields(): readonly EntityField<this>[] {
    const children = tagChildren(this._tag);
    return buildEditableEntityFields(children, this._fieldSchema(children), this._fieldSetters(children));
  }

  getField(keyOrIndex: string | number): EntityField<this> | null {
    if (typeof keyOrIndex === 'number') return this.fields[keyOrIndex] ?? null;
    return this.fields.find(field => field.key === keyOrIndex) ?? null;
  }

  withFieldValue(keyOrIndex: string | number, value: unknown): this {
    const children = tagChildren(this._tag);
    if (children.length === 0) {
      throw new TypeError(`${this.kind} has no editable child fields`);
    }
    const index = typeof keyOrIndex === 'number'
      ? keyOrIndex
      : this.fields.find(field => field.key === keyOrIndex)?.index ?? -1;
    if (index < 0 || index >= children.length) {
      throw new RangeError(`${this.kind} field "${String(keyOrIndex)}" does not exist`);
    }
    const next = [...children];
    next[index] = coerceTagValue(children[index], value);
    return this._withTag(rebuildContainerTag(this._tag, next));
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      present: this.present,
      tagName: this.tagName,
      tagType: this.tagType,
      childCount: this.childCount,
      fields: this.fields,
    };
  }

  protected _withTag(tag: Tag): this {
    if (this.constructor === EntSlotObject) {
      return new EntSlotObject(this.kind, tag) as this;
    }
    const Ctor = this.constructor as new (tag: Tag) => this;
    return new Ctor(tag);
  }

  protected _fieldSchema(children: readonly Tag[]): EntityFieldSchema {
    return children.map((child, index) => ({ key: child.name ?? `field${index}` }));
  }

  protected _fieldSetters(children: readonly Tag[]): EntityFieldSetterMap<this> {
    const setters: Record<string, (value: unknown, field: EntityField<this>) => this> = {};
    children.forEach((child, index) => {
      const key = child.name ?? `field${index}`;
      setters[key] = (value, field) => this.withFieldValue(field.index, value);
    });
    return setters;
  }
}

export class NpcDataState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct('[]', [])) {
    super('NpcDataState', tag);
  }

  clear(): NpcDataState {
    return new NpcDataState(Tags.struct(this.tagName, []));
  }
}

export class UniqueSegmentPieceState {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;

  private readonly _tag!: Tag;

  constructor(tag: Tag) {
    const children = tagChildren(tag);
    this.version = children[0]?.type === TagType.BYTE ? children[0].getByte() : 0;
    this.entityUid = children[1]?.type === TagType.STRING ? children[1].getString() : '';
    this.position = vector3iFromTag(children[2]) ?? { x: 0, y: 0, z: 0 };
    this.type = children[3]?.type === TagType.SHORT ? children[3].getShort() : 0;
    this.orientation = children[4]?.type === TagType.BYTE ? children[4].getByte() : 0;
    this.active = children[5]?.type === TagType.BYTE ? children[5].getByte() !== 0 : false;
    this.hitpoints = children[6]?.type === TagType.BYTE ? children[6].getByte() : 0;
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  static from(value: UniqueSegmentPieceValue): UniqueSegmentPieceState {
    return new UniqueSegmentPieceState(uniqueSegmentPieceTag(value));
  }

  withEntityUid(entityUid: string): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), entityUid });
  }

  withPosition(position: EntVector3i): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), position });
  }

  withType(type: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), type });
  }

  withOrientation(orientation: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), orientation });
  }

  withActive(active: boolean): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), active });
  }

  withHitpoints(hitpoints: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), hitpoints });
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): UniqueSegmentPieceValue {
    return {
      version: this.version,
      entityUid: this.entityUid,
      position: this.position,
      type: this.type,
      orientation: this.orientation,
      active: this.active,
      hitpoints: this.hitpoints,
    };
  }
}

export class RailRequestState {
  private readonly _tag!: Tag;

  constructor(tag: Tag = Tags.byte(null, 1)) {
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  get disconnect(): boolean {
    return this._tag.type !== TagType.STRUCT;
  }

  get rail(): UniqueSegmentPieceState | null {
    if (this.disconnect) return null;
    const tag = tagChildren(this._tag)[0];
    return tag?.type === TagType.STRUCT ? new UniqueSegmentPieceState(tag) : null;
  }

  get docked(): UniqueSegmentPieceState | null {
    if (this.disconnect) return null;
    const tag = tagChildren(this._tag)[1];
    return tag?.type === TagType.STRUCT ? new UniqueSegmentPieceState(tag) : null;
  }

  get turretTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[2]);
  }

  get movedTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[3]);
  }

  get railDockerPosOnRail(): EntVector3i | null {
    return vector3iFromTag(tagChildren(this._tag)[4]);
  }

  get railMovingLocalAtDockTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[5]);
  }

  get railMovingToDockerPosOnRail(): EntVector3i | null {
    return vector3iFromTag(tagChildren(this._tag)[6]);
  }

  get didRotationInPlace(): boolean {
    const tag = tagChildren(this._tag)[7];
    return tag?.type === TagType.BYTE ? tag.getByte() !== 0 : false;
  }

  get dockingPermission(): number | null {
    const tag = tagChildren(this._tag)[8];
    if (tag?.type !== TagType.BYTE) return null;
    const value = tag.getByte();
    return value >= 0 ? value : null;
  }

  withRail(rail: UniqueSegmentPieceState | UniqueSegmentPieceValue): RailRequestState {
    return this._withChild(0, rail instanceof UniqueSegmentPieceState ? rail.toTag() : uniqueSegmentPieceTag(rail));
  }

  withDocked(docked: UniqueSegmentPieceState | UniqueSegmentPieceValue): RailRequestState {
    return this._withChild(1, docked instanceof UniqueSegmentPieceState ? docked.toTag() : uniqueSegmentPieceTag(docked));
  }

  withTurretTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(2, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  withMovedTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(3, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  withRailDockerPosOnRail(position: EntVector3i): RailRequestState {
    return this._withChild(4, Tags.vector3i(null, position.x, position.y, position.z));
  }

  withRailMovingLocalAtDockTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(5, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  withRailMovingToDockerPosOnRail(position: EntVector3i | null): RailRequestState {
    return this._withChild(6, position
      ? Tags.vector3i(null, position.x, position.y, position.z)
      : Tags.byte(null, 0));
  }

  withDidRotationInPlace(didRotationInPlace: boolean): RailRequestState {
    return this._withChild(7, Tags.byte(null, didRotationInPlace ? 1 : 0));
  }

  withDockingPermission(dockingPermission: number | null): RailRequestState {
    return this._withChild(8, Tags.byte(null, dockingPermission ?? -1));
  }

  disconnectRequest(): RailRequestState {
    return new RailRequestState(Tags.byte(null, 1));
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): RailRequestSummary {
    return {
      disconnect: this.disconnect,
      rail: this.rail?.toJSON() ?? null,
      docked: this.docked?.toJSON() ?? null,
      railDockerPosOnRail: this.railDockerPosOnRail,
      railMovingToDockerPosOnRail: this.railMovingToDockerPosOnRail,
      didRotationInPlace: this.didRotationInPlace,
      dockingPermission: this.dockingPermission,
    };
  }

  private _withChild(index: number, tag: Tag): RailRequestState {
    if (this.disconnect) {
      throw new TypeError('Cannot edit fields on a disconnected RailRequestState');
    }
    return new RailRequestState(replaceChild(this._tag, index, tag));
  }
}

export class RailControllerState extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('RailControllerState', tag);
  }

  get modeCode(): number {
    const tag = this.toTag();
    if (tag.type === TagType.BYTE) return tag.getByte();
    const first = tagChildren(tag)[0];
    return first?.type === TagType.BYTE ? first.getByte() : 0;
  }

  get mode(): 'none' | 'docked' | 'railRoot' | 'activeRequest' | 'unknown' {
    switch (this.modeCode) {
      case 0: return 'none';
      case 1: return 'docked';
      case 2: return 'railRoot';
      case 3: return 'activeRequest';
      default: return 'unknown';
    }
  }

  get requestCount(): number {
    return this.currentRequest ? 1 : 0;
  }

  get expectedDockCount(): number {
    return this.expectedRequests.length;
  }

  get currentRequest(): RailRequestState | null {
    const requestTag = tagChildren(this.toTag())[1];
    const firstRequest = tagChildren(requestTag)[0];
    return firstRequest ? new RailRequestState(firstRequest) : null;
  }

  get expectedRequests(): readonly RailRequestState[] {
    const expectedTag = tagChildren(this.toTag())[2];
    return tagChildren(expectedTag).map(child => new RailRequestState(child));
  }

  withCurrentRequest(request: RailRequestState | null): RailControllerState {
    if (request === null) {
      return new RailControllerState(Tags.byte(null, 0));
    }
    const mode = this.modeCode > 0 ? this.modeCode : 3;
    const expected = this._expectedTag();
    return new RailControllerState(Tags.struct(this.tagName, [
      Tags.byte(null, mode),
      Tags.struct(null, [request.toTag()]),
      expected,
    ]));
  }

  withExpectedRequests(requests: readonly RailRequestState[]): RailControllerState {
    const tag = this.toTag();
    if (tag.type !== TagType.STRUCT) {
      return requests.length === 0
        ? this
        : new RailControllerState(Tags.struct(this.tagName, [
            Tags.byte(null, 2),
            Tags.struct(null, []),
            Tags.struct(null, requests.map(request => request.toTag())),
          ]));
    }
    return new RailControllerState(replaceChild(tag, 2, Tags.struct(null, requests.map(request => request.toTag()))));
  }

  addExpectedRequest(request: RailRequestState): RailControllerState {
    return this.withExpectedRequests([...this.expectedRequests, request]);
  }

  removeExpectedRequest(index: number): RailControllerState {
    const requests = [...this.expectedRequests];
    if (index < 0 || index >= requests.length) throw new RangeError(`Expected rail request index ${index} does not exist`);
    requests.splice(index, 1);
    return this.withExpectedRequests(requests);
  }

  clear(): RailControllerState {
    return new RailControllerState(Tags.byte(null, 0));
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      modeCode: this.modeCode,
      mode: this.mode,
      requestCount: this.requestCount,
      expectedDockCount: this.expectedDockCount,
      currentRequest: this.currentRequest,
      expectedRequests: this.expectedRequests,
    };
  }

  private _expectedTag(): Tag {
    const expected = tagChildren(this.toTag())[2];
    return expected?.type === TagType.STRUCT ? expected : Tags.struct(null, []);
  }
}

export class CoreTimerState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [Tags.long(null, -1n)])) {
    super('CoreTimerState', tag);
  }

  get timeLeftMs(): bigint | null {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.LONG ? first.getLong() : null;
  }

  get active(): boolean {
    const timeLeft = this.timeLeftMs;
    return timeLeft !== null && timeLeft >= 0n;
  }

  withTimeLeftMs(timeLeftMs: bigint | number): CoreTimerState {
    return new CoreTimerState(Tags.struct(this.tagName, [Tags.long(null, timeLeftMs)]));
  }

  clear(): CoreTimerState {
    return this.withTimeLeftMs(-1n);
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), timeLeftMs: this.timeLeftMs, active: this.active };
  }
}

export class BlueprintInfo extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 1)) {
    super('BlueprintInfo', tag);
  }

  get path(): string {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.STRING ? first.getString() : '';
  }

  get identifier(): string {
    const second = tagChildren(this.toTag())[1];
    return second?.type === TagType.STRING ? second.getString() : '';
  }

  get loadedFromBlueprint(): boolean {
    return this.toTag().type === TagType.STRUCT;
  }

  withPath(path: string): BlueprintInfo {
    return new BlueprintInfo(Tags.struct(this.tagName, [
      Tags.string(null, path),
      Tags.string(null, this.identifier),
    ]));
  }

  withIdentifier(identifier: string): BlueprintInfo {
    return new BlueprintInfo(Tags.struct(this.tagName, [
      Tags.string(null, this.path),
      Tags.string(null, identifier),
    ]));
  }

  clear(): BlueprintInfo {
    return new BlueprintInfo(Tags.byte(null, 1));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), path: this.path, identifier: this.identifier, loadedFromBlueprint: this.loadedFromBlueprint };
  }
}

export class ItemsToSpawnWith extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('ItemsToSpawnWith', tag);
  }

  get elementCountMap(): ElementCountMap {
    const tag = this.toTag();
    if (tag.type !== TagType.BYTE_ARRAY) return new ElementCountMap([]);
    try {
      return ElementCountMap.fromRaw(tag.getByteArray());
    } catch {
      return new ElementCountMap([]);
    }
  }

  get counts(): readonly BlockCount[] {
    return this.elementCountMap.counts;
  }

  get totalBlocks(): number {
    return this.elementCountMap.totalBlocks;
  }

  getCount(type: number): number {
    return this.elementCountMap.getCount(type);
  }

  withCount(type: number, count: number): ItemsToSpawnWith {
    const map = this.elementCountMap.setCount(type, count);
    return map.totalBlocks > 0
      ? new ItemsToSpawnWith(Tags.byteArray(this.tagName, map.toRaw()))
      : this.clear();
  }

  clear(): ItemsToSpawnWith {
    return new ItemsToSpawnWith(Tags.byte(null, 0));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), counts: this.counts, totalBlocks: this.totalBlocks };
  }
}

export class QuarterState {
  readonly version: number;
  readonly type: number;
  readonly typeName: string;
  readonly min: EntVector3i;
  readonly max: EntVector3i;
  readonly id: number;
  readonly status?: string;
  readonly integrity?: number;
  readonly priority?: number;
  readonly index?: bigint;
  readonly childIds: readonly number[];
  readonly extra: EntSlotObject | null;

  private readonly _tag!: Tag;

  constructor(tag: Tag) {
    const children = tagChildren(tag);
    this.version = children[0]?.type === TagType.BYTE ? children[0].getByte() : 0;
    this.type = children[1]?.type === TagType.BYTE ? children[1].getByte() : 0;
    this.typeName = quarterTypeName(this.type);
    this.min = vector3iFromTag(children[2]) ?? { x: 0, y: 0, z: 0 };
    this.max = vector3iFromTag(children[3]) ?? { x: 0, y: 0, z: 0 };
    this.id = children[4]?.type === TagType.INT ? children[4].getInt() : 0;
    this.status = children[5]?.type === TagType.STRING ? children[5].getString() : undefined;
    this.integrity = children[6]?.type === TagType.FLOAT ? children[6].getFloat() : undefined;
    this.priority = children[7]?.type === TagType.INT ? children[7].getInt() : undefined;
    this.index = children[8]?.type === TagType.LONG ? children[8].getLong() : undefined;
    this.childIds = tagChildren(children[10])
      .filter(child => child.type === TagType.INT)
      .map(child => child.getInt());
    this.extra = children[11] && children[11].type !== TagType.NOTHING
      ? new EntSlotObject(`${this.typeName}QuarterExtra`, children[11])
      : null;
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  static create(data: {
    type: number;
    min: EntVector3i;
    max: EntVector3i;
    id: number;
    status?: string;
    integrity?: number;
    priority?: number;
    index?: bigint | number;
    childIds?: readonly number[];
    extra?: EntSlotObject | null;
  }): QuarterState {
    const childIds = data.childIds ?? [];
    return new QuarterState(Tags.struct(null, [
      Tags.byte(null, 0),
      Tags.byte(null, data.type),
      Tags.vector3i(null, data.min.x, data.min.y, data.min.z),
      Tags.vector3i(null, data.max.x, data.max.y, data.max.z),
      Tags.int(null, data.id),
      Tags.string(null, data.status ?? 'NORMAL'),
      Tags.float(null, data.integrity ?? 1),
      Tags.int(null, data.priority ?? 0),
      Tags.long(null, data.index ?? 0n),
      Tags.int(null, childIds.length),
      new Tag(TagType.LIST, null, childIds.map(id => Tags.int(null, id)), TagType.INT),
      data.extra?.toTag() ?? Tags.nothing(null),
    ]));
  }

  withType(type: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 1, Tags.byte(null, type)));
  }

  withBounds(min: EntVector3i, max: EntVector3i): QuarterState {
    return new QuarterState(replaceChild(
      replaceChild(this._tag, 2, Tags.vector3i(null, min.x, min.y, min.z)),
      3,
      Tags.vector3i(null, max.x, max.y, max.z),
    ));
  }

  withId(id: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 4, Tags.int(null, id)));
  }

  withStatus(status: string): QuarterState {
    return new QuarterState(replaceChild(this._tag, 5, Tags.string(null, status)));
  }

  withIntegrity(integrity: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 6, Tags.float(null, integrity)));
  }

  withPriority(priority: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 7, Tags.int(null, priority)));
  }

  withIndex(index: bigint | number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 8, Tags.long(null, index)));
  }

  withChildIds(childIds: readonly number[]): QuarterState {
    return new QuarterState(replaceChild(
      replaceChild(this._tag, 9, Tags.int(null, childIds.length)),
      10,
      new Tag(TagType.LIST, null, childIds.map(id => Tags.int(null, id)), TagType.INT),
    ));
  }

  withExtra(extra: EntSlotObject | null): QuarterState {
    return new QuarterState(replaceChild(this._tag, 11, extra?.toTag() ?? Tags.nothing(null)));
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): QuarterSummary {
    return {
      version: this.version,
      type: this.type,
      typeName: this.typeName,
      min: this.min,
      max: this.max,
      id: this.id,
      status: this.status,
      integrity: this.integrity,
      priority: this.priority,
      index: this.index,
      childIds: this.childIds,
      extra: this.extra?.toJSON() ?? null,
    };
  }
}

export class QuarterManagerState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [])])) {
    super('QuarterManagerState', tag);
  }

  get version(): number {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.BYTE ? first.getByte() : 0;
  }

  get quarters(): readonly QuarterState[] {
    const quarterStruct = tagChildren(this.toTag())[1];
    return tagChildren(quarterStruct)
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new QuarterState(child));
  }

  withVersion(version: number): QuarterManagerState {
    return new QuarterManagerState(replaceChild(this.toTag(), 0, Tags.byte(null, version)));
  }

  withQuarter(index: number, quarter: QuarterState): QuarterManagerState {
    const children = tagChildren(this.toTag());
    const quarterStruct = children[1]?.type === TagType.STRUCT ? children[1] : Tags.struct(null, []);
    const quarters = tagChildren(quarterStruct);
    if (index < 0 || index >= quarters.length) {
      throw new RangeError(`Quarter index ${index} does not exist`);
    }
    const nextQuarters = [...quarters];
    nextQuarters[index] = quarter.toTag();
    return new QuarterManagerState(replaceChild(this.toTag(), 1, Tags.struct(quarterStruct.name, nextQuarters)));
  }

  addQuarter(quarter: QuarterState): QuarterManagerState {
    const children = tagChildren(this.toTag());
    const quarterStruct = children[1]?.type === TagType.STRUCT ? children[1] : Tags.struct(null, []);
    return new QuarterManagerState(replaceChild(
      this.toTag(),
      1,
      Tags.struct(quarterStruct.name, [...tagChildren(quarterStruct), quarter.toTag()]),
    ));
  }

  clearQuarters(): QuarterManagerState {
    return new QuarterManagerState(Tags.struct(this.tagName, [
      Tags.byte(null, this.version),
      Tags.struct(null, []),
    ]));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), version: this.version, quarters: this.quarters };
  }
}

export class PlayerInfoHistoryEntry {
  constructor(
    readonly time: bigint,
    readonly ip: string,
    readonly starmadeName: string,
  ) {}

  static create(time: bigint | number, ip: string, starmadeName = ''): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(typeof time === 'number' ? BigInt(time) : time, ip, starmadeName);
  }

  static fromTag(tag: Tag): PlayerInfoHistoryEntry {
    const children = tagChildren(tag);
    return new PlayerInfoHistoryEntry(
      children[0]?.type === TagType.LONG ? children[0].getLong() : 0n,
      children[1]?.type === TagType.STRING ? children[1].getString() : '',
      children[2]?.type === TagType.STRING ? children[2].getString() : '',
    );
  }

  withTime(time: bigint | number): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(typeof time === 'number' ? BigInt(time) : time, this.ip, this.starmadeName);
  }

  withIp(ip: string): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(this.time, ip, this.starmadeName);
  }

  withStarmadeName(starmadeName: string): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(this.time, this.ip, starmadeName);
  }

  toTag(): Tag {
    return Tags.struct(null, [
      Tags.long(null, this.time),
      Tags.string(null, this.ip),
      Tags.string(null, this.starmadeName),
    ]);
  }
}

export class PlayerInfoHistoryList extends EntSlotObject {
  constructor(tag: Tag = Tags.struct('hist', [])) {
    super('PlayerInfoHistoryList', tag);
  }

  get entries(): readonly PlayerInfoHistoryEntry[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => PlayerInfoHistoryEntry.fromTag(child));
  }

  addEntry(entry: PlayerInfoHistoryEntry): PlayerInfoHistoryList {
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, [...this.entries.map(e => e.toTag()), entry.toTag()]));
  }

  withEntry(index: number, entry: PlayerInfoHistoryEntry): PlayerInfoHistoryList {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`History index ${index} does not exist`);
    entries[index] = entry;
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  removeEntry(index: number): PlayerInfoHistoryList {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`History index ${index} does not exist`);
    entries.splice(index, 1);
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  clear(): PlayerInfoHistoryList {
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), entries: this.entries };
  }
}

export class ScanDataRecord {
  readonly origin: EntVector3i;
  readonly time: bigint;
  readonly range: number;
  readonly systemOwnershipType: number;
  readonly entityData: readonly ScanEntityData[];
  readonly resourceData: readonly ScanResourceData[];

  private readonly _tag!: Tag;

  constructor(tag: Tag) {
    const children = tagChildren(tag);
    this.origin = vector3iFromTag(children[0]) ?? { x: 0, y: 0, z: 0 };
    this.time = children[1]?.type === TagType.LONG ? children[1].getLong() : 0n;
    this.range = children[2]?.type === TagType.FLOAT ? children[2].getFloat() : 0;
    this.systemOwnershipType = children[3]?.type === TagType.INT ? children[3].getInt() : 0;
    this.entityData = tagChildren(children[4]).map(parseScanEntityData);
    this.resourceData = tagChildren(children[5]).map(parseScanResourceData);
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  static create(data: {
    origin: EntVector3i;
    time: bigint | number;
    range: number;
    systemOwnershipType?: number;
    entityData?: readonly ScanEntityData[];
    resourceData?: readonly ScanResourceData[];
  }): ScanDataRecord {
    return new ScanDataRecord(Tags.struct('ScanDataTag', [
      Tags.vector3i('Origin', data.origin.x, data.origin.y, data.origin.z),
      Tags.long('Time', data.time),
      Tags.float('Range', data.range),
      Tags.int('SystemOwnershipType', data.systemOwnershipType ?? 0),
      Tags.struct('EntityData', (data.entityData ?? []).map(scanEntityDataToTag)),
      Tags.struct('ResourceData', (data.resourceData ?? []).map(scanResourceDataToTag)),
    ]));
  }

  withOrigin(origin: EntVector3i): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 0, Tags.vector3i('Origin', origin.x, origin.y, origin.z)));
  }

  withTime(time: bigint | number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 1, Tags.long('Time', time)));
  }

  withRange(range: number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 2, Tags.float('Range', range)));
  }

  withSystemOwnershipType(systemOwnershipType: number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 3, Tags.int('SystemOwnershipType', systemOwnershipType)));
  }

  withEntityData(entityData: readonly ScanEntityData[]): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 4, Tags.struct('EntityData', entityData.map(scanEntityDataToTag))));
  }

  addEntityData(entity: ScanEntityData): ScanDataRecord {
    return this.withEntityData([...this.entityData, entity]);
  }

  withResourceData(resourceData: readonly ScanResourceData[]): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 5, Tags.struct('ResourceData', resourceData.map(scanResourceDataToTag))));
  }

  addResourceData(resource: ScanResourceData): ScanDataRecord {
    return this.withResourceData([...this.resourceData, resource]);
  }

  toTag(): Tag {
    return this._tag;
  }
}

export class ScanHistory extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ScanHistory', tag);
  }

  get scans(): readonly ScanDataRecord[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ScanDataRecord(child));
  }

  withScan(index: number, scan: ScanDataRecord): ScanHistory {
    const scans = tagChildren(this.toTag());
    if (index < 0 || index >= scans.length) throw new RangeError(`Scan index ${index} does not exist`);
    const next = [...scans];
    next[index] = scan.toTag();
    return new ScanHistory(Tags.struct(this.tagName, next));
  }

  addScan(scan: ScanDataRecord): ScanHistory {
    return new ScanHistory(Tags.struct(this.tagName, [...this.scans.map(entry => entry.toTag()), scan.toTag()]));
  }

  removeScan(index: number): ScanHistory {
    const scans = [...this.scans];
    if (index < 0 || index >= scans.length) throw new RangeError(`Scan index ${index} does not exist`);
    scans.splice(index, 1);
    return new ScanHistory(Tags.struct(this.tagName, scans.map(scan => scan.toTag())));
  }

  clear(): ScanHistory {
    return new ScanHistory(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), scans: this.scans };
  }
}

export class SavedCoordinateEntry {
  constructor(
    readonly sector: EntVector3i,
    readonly name: string,
    readonly color: EntVector4f = { x: 1, y: 1, z: 1, w: 1 },
    readonly icon = 0,
  ) {}

  static create(sector: EntVector3i, name: string, color?: EntVector4f, icon?: number): SavedCoordinateEntry {
    return new SavedCoordinateEntry(sector, name, color, icon);
  }

  static fromTag(tag: Tag): SavedCoordinateEntry {
    const children = tagChildren(tag);
    return new SavedCoordinateEntry(
      vector3iFromTag(children[0]) ?? { x: 0, y: 0, z: 0 },
      children[1]?.type === TagType.STRING ? children[1].getString() : '',
      vector4fFromTag(children[2]) ?? { x: 1, y: 1, z: 1, w: 1 },
      children[3]?.type === TagType.INT ? children[3].getInt() : 0,
    );
  }

  withSector(sector: EntVector3i): SavedCoordinateEntry {
    return new SavedCoordinateEntry(sector, this.name, this.color, this.icon);
  }

  withName(name: string): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, name, this.color, this.icon);
  }

  withColor(color: EntVector4f): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, this.name, color, this.icon);
  }

  withIcon(icon: number): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, this.name, this.color, icon);
  }

  toTag(): Tag {
    return Tags.struct(null, [
      Tags.vector3i(null, this.sector.x, this.sector.y, this.sector.z),
      Tags.string(null, this.name),
      Tags.vector4f(null, this.color.x, this.color.y, this.color.z, this.color.w),
      Tags.int(null, this.icon),
    ]);
  }
}

export class SavedCoordinates extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('SavedCoordinates', tag);
  }

  get entries(): readonly SavedCoordinateEntry[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => SavedCoordinateEntry.fromTag(child));
  }

  add(entry: SavedCoordinateEntry): SavedCoordinates {
    return new SavedCoordinates(Tags.struct(this.tagName, [...this.entries.map(e => e.toTag()), entry.toTag()]));
  }

  withEntry(index: number, entry: SavedCoordinateEntry): SavedCoordinates {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`Saved coordinate index ${index} does not exist`);
    entries[index] = entry;
    return new SavedCoordinates(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  remove(index: number): SavedCoordinates {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`Saved coordinate index ${index} does not exist`);
    entries.splice(index, 1);
    return new SavedCoordinates(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  clear(): SavedCoordinates {
    return new SavedCoordinates(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), entries: this.entries };
  }
}

export class IgnoredPlayers extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('IgnoredPlayers', tag);
  }

  get names(): readonly string[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRING)
      .map(child => child.getString());
  }

  add(name: string): IgnoredPlayers {
    return this.names.includes(name)
      ? this
      : new IgnoredPlayers(Tags.struct(this.tagName, [...this.names.map(n => Tags.string(null, n)), Tags.string(null, name)]));
  }

  remove(name: string): IgnoredPlayers {
    return new IgnoredPlayers(Tags.struct(this.tagName, this.names.filter(n => n !== name).map(n => Tags.string(null, n))));
  }

  clear(): IgnoredPlayers {
    return new IgnoredPlayers(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), names: this.names };
  }
}

export class InventoryBackupState extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('InventoryBackupState', tag);
  }

  get hasBackup(): boolean {
    return this.toTag().type === TagType.STRUCT;
  }

  get mainInventory(): Inventory | null {
    return this._inventoryAt(0);
  }

  get capsuleInventory(): Inventory | null {
    return this._inventoryAt(1);
  }

  get microInventory(): Inventory | null {
    return this._inventoryAt(2);
  }

  get macroInventory(): Inventory | null {
    return this._inventoryAt(3);
  }

  withMainInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(0, inventory);
  }

  withCapsuleInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(1, inventory);
  }

  withMicroInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(2, inventory);
  }

  withMacroInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(3, inventory);
  }

  withInventories(inventories: {
    mainInventory: Inventory;
    capsuleInventory: Inventory;
    microInventory: Inventory;
    macroInventory: Inventory;
  }): InventoryBackupState {
    return new InventoryBackupState(Tags.struct(this.tagName, [
      inventories.mainInventory.toTag(),
      inventories.capsuleInventory.toTag(),
      inventories.microInventory.toTag(),
      inventories.macroInventory.toTag(),
    ]));
  }

  clear(): InventoryBackupState {
    return new InventoryBackupState(Tags.byte(null, 0));
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      hasBackup: this.hasBackup,
      mainInventorySize: this.mainInventory?.size ?? null,
      capsuleInventorySize: this.capsuleInventory?.size ?? null,
      microInventorySize: this.microInventory?.size ?? null,
      macroInventorySize: this.macroInventory?.size ?? null,
    };
  }

  private _inventoryAt(index: number): Inventory | null {
    const tag = tagChildren(this.toTag())[index];
    if (tag?.type !== TagType.STRUCT) return null;
    try {
      return Inventory.fromTag(tag);
    } catch {
      return null;
    }
  }

  private _withInventoryAt(index: number, inventory: Inventory): InventoryBackupState {
    const children = tagChildren(this.toTag());
    while (children.length < 4) children.push(Inventory.EMPTY.toTag());
    children[index] = inventory.toTag();
    return new InventoryBackupState(Tags.struct(this.tagName, children.slice(0, 4)));
  }
}

export class CargoInventoryBlock extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('CargoInventoryBlock', tag);
  }

  get piece(): CargoInventoryBlockValue | null {
    const children = tagChildren(this.toTag());
    if (children.length < 7) return null;
    const position = vector3iFromTag(children[2]);
    if (!position) return null;
    return {
      version: children[0]?.type === TagType.BYTE ? children[0].getByte() : 0,
      entityUid: children[1]?.type === TagType.STRING ? children[1].getString() : '',
      position,
      type: children[3]?.type === TagType.SHORT ? children[3].getShort() : 0,
      orientation: children[4]?.type === TagType.BYTE ? children[4].getByte() : 0,
      active: children[5]?.type === TagType.BYTE ? children[5].getByte() !== 0 : false,
      hitpoints: children[6]?.type === TagType.BYTE ? children[6].getByte() : 0,
    };
  }

  withPiece(piece: CargoInventoryBlockValue): CargoInventoryBlock {
    return new CargoInventoryBlock(Tags.struct(this.tagName, [
      Tags.byte(null, piece.version),
      Tags.string(null, piece.entityUid),
      Tags.vector3i(null, piece.position.x, piece.position.y, piece.position.z),
      Tags.short(null, piece.type),
      Tags.byte(null, piece.orientation),
      Tags.byte(null, piece.active ? 1 : 0),
      Tags.byte(null, piece.hitpoints),
    ]));
  }

  clear(): CargoInventoryBlock {
    return new CargoInventoryBlock(Tags.byte(null, 0));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), piece: this.piece };
  }
}

export class WarpGateInfo extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('WarpGateInfo', tag);
  }

  clear(): WarpGateInfo {
    return new WarpGateInfo(Tags.byte(null, 0));
  }
}

export class RaceGateInfo extends EntSlotObject {
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('RaceGateInfo', tag);
  }

  clear(): RaceGateInfo {
    return new RaceGateInfo(Tags.byte(null, 0));
  }
}

export class ManagerModuleEntryState {
  readonly positionIndex: bigint;
  readonly position: EntVector3i;
  readonly payloadType: string;

  private readonly _tag!: Tag;

  constructor(tag: Tag) {
    const children = tagChildren(tag);
    const positionTag = children[0];
    if (positionTag?.type === TagType.VECTOR3i) {
      this.position = vector3iFromTag(positionTag) ?? { x: 0, y: 0, z: 0 };
      this.positionIndex = posToIndex(this.position.x, this.position.y, this.position.z);
    } else {
      this.positionIndex = positionTag?.type === TagType.LONG ? positionTag.getLong() : 0n;
      this.position = indexToPos(this.positionIndex);
    }
    this.payloadType = tagTypeName(children[1]?.type ?? TagType.NOTHING);
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  get payload(): EntSlotObject {
    return new EntSlotObject('ManagerModuleEntryPayload', tagChildren(this._tag)[1] ?? Tags.nothing(null));
  }

  get chargeState(): { readonly encodedCharge: number; readonly autoCharge: boolean; readonly active: boolean } | null {
    const children = tagChildren(this.payload.toTag());
    if (children[0]?.type !== TagType.FLOAT) return null;
    return {
      encodedCharge: children[0].getFloat(),
      autoCharge: children[1]?.type === TagType.BYTE ? children[1].getByte() !== 0 : false,
      active: children[2]?.type === TagType.BYTE ? children[2].getByte() !== 0 : false,
    };
  }

  get transporterTarget(): { readonly name: string; readonly destinationUid: string; readonly destinationBlock: EntVector3i; readonly publicAccess: number } | null {
    const children = tagChildren(this.payload.toTag());
    if (children[0]?.type !== TagType.STRING || children[1]?.type !== TagType.STRING) return null;
    const destinationBlock = vector3iFromTag(children[2]);
    if (!destinationBlock) return null;
    return {
      name: children[0].getString(),
      destinationUid: children[1].getString(),
      destinationBlock,
      publicAccess: children[3]?.type === TagType.BYTE ? children[3].getByte() : 0,
    };
  }

  withPosition(position: EntVector3i): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 0, Tags.long(null, posToIndex(position.x, position.y, position.z))));
  }

  withPositionIndex(positionIndex: bigint | number): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 0, Tags.long(null, positionIndex)));
  }

  withPayload(payload: EntSlotObject): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 1, payload.toTag()));
  }

  withChargeState(encodedCharge: number, autoCharge = this.chargeState?.autoCharge ?? false, active = this.chargeState?.active ?? false): ManagerModuleEntryState {
    return this.withPayload(new EntSlotObject('ChargeState', Tags.struct(null, [
      Tags.float(null, encodedCharge),
      Tags.byte(null, autoCharge ? 1 : 0),
      Tags.byte(null, active ? 1 : 0),
    ])));
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): Record<string, unknown> {
    return {
      positionIndex: this.positionIndex,
      position: this.position,
      payloadType: this.payloadType,
      payload: this.payload.toJSON(),
      chargeState: this.chargeState,
      transporterTarget: this.transporterTarget,
    };
  }
}

export class ManagerModuleState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ManagerModuleState', tag);
  }

  get tagId(): string | null {
    return this.tagName;
  }

  get metadataCount(): number {
    return this.childCount;
  }

  get moduleKind(): string {
    return managerModuleKind(this.tagId);
  }

  get entries(): readonly ManagerModuleEntryState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ManagerModuleEntryState(child));
  }

  withEntry(index: number, entry: ManagerModuleEntryState): ManagerModuleState {
    const entries = tagChildren(this.toTag());
    if (index < 0 || index >= entries.length) throw new RangeError(`Manager module entry index ${index} does not exist`);
    const next = [...entries];
    next[index] = entry.toTag();
    return new ManagerModuleState(Tags.struct(this.tagId, next));
  }

  addEntry(entry: ManagerModuleEntryState): ManagerModuleState {
    return new ManagerModuleState(Tags.struct(this.tagId, [...tagChildren(this.toTag()), entry.toTag()]));
  }

  removeEntry(index: number): ManagerModuleState {
    const entries = tagChildren(this.toTag());
    if (index < 0 || index >= entries.length) throw new RangeError(`Manager module entry index ${index} does not exist`);
    const next = [...entries];
    next.splice(index, 1);
    return new ManagerModuleState(Tags.struct(this.tagId, next));
  }

  clearEntries(): ManagerModuleState {
    return new ManagerModuleState(Tags.struct(this.tagId, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), tagId: this.tagId, moduleKind: this.moduleKind, metadataCount: this.metadataCount, entries: this.entries };
  }
}

export class ManagerModulesState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ManagerModulesState', tag);
  }

  get modules(): readonly ManagerModuleState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ManagerModuleState(child));
  }

  get moduleIds(): readonly string[] {
    return this.modules.map(module => module.tagId ?? '');
  }

  getModule(tagId: string): ManagerModuleState | null {
    return this.modules.find(module => module.tagId === tagId) ?? null;
  }

  getModules(tagId: string): readonly ManagerModuleState[] {
    return this.modules.filter(module => module.tagId === tagId);
  }

  withModule(tagId: string, module: ManagerModuleState): ManagerModulesState {
    const modules = tagChildren(this.toTag());
    const index = modules.findIndex(child => child.name === tagId);
    const renamed = Tags.rename(module.toTag(), tagId);
    const next = index >= 0 ? [...modules] : [...modules, renamed];
    if (index >= 0) next[index] = renamed;
    return new ManagerModulesState(Tags.struct(this.tagName, next));
  }

  clear(): ManagerModulesState {
    return new ManagerModulesState(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), moduleIds: this.moduleIds, modules: this.modules };
  }
}

export class AiConfigurationState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct('AIConfig1', [])) {
    super('AiConfigurationState', tag);
  }

  get settings(): readonly { readonly id: number; readonly value: string }[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => {
        const fields = tagChildren(child);
        return {
          id: fields[0]?.type === TagType.BYTE ? fields[0].getByte() : 0,
          value: fields[1]?.type === TagType.STRING ? fields[1].getString() : '',
        };
      });
  }

  getSetting(id: number): string | null {
    return this.settings.find(setting => setting.id === id)?.value ?? null;
  }

  withSetting(id: number, value: string | boolean | number): AiConfigurationState {
    const settingTag = Tags.struct(null, [
      Tags.byte(null, id),
      Tags.string(null, String(value)),
    ]);
    const settings = tagChildren(this.toTag());
    const index = settings.findIndex(setting => {
      const fields = tagChildren(setting);
      return fields[0]?.type === TagType.BYTE && fields[0].getByte() === id;
    });
    const next = index >= 0 ? [...settings] : [...settings, settingTag];
    if (index >= 0) next[index] = settingTag;
    return new AiConfigurationState(Tags.struct(this.tagName, next));
  }

  clear(): AiConfigurationState {
    return new AiConfigurationState(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), settings: this.settings };
  }
}

export class UnloadedDummiesState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('UnloadedDummiesState', tag);
  }

  get dummyCount(): number {
    return this.childCount;
  }

  clear(): UnloadedDummiesState {
    return new UnloadedDummiesState(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), dummyCount: this.dummyCount };
  }
}

export class ModuleExplosionState {
  private readonly _tag!: Tag;

  constructor(tag: Tag) {
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  static create(data: {
    created?: bigint | number;
    lastExplosion?: bigint | number;
    explosionDelay?: bigint | number;
    moduleId?: bigint | number;
    radius?: number;
    damage?: number;
    min?: EntVector3f;
    max?: EntVector3f;
    explosionPositions?: readonly (bigint | number)[];
    chain?: boolean;
    cause?: number;
  } = {}): ModuleExplosionState {
    const min = data.min ?? { x: 0, y: 0, z: 0 };
    const max = data.max ?? { x: 0, y: 0, z: 0 };
    return new ModuleExplosionState(Tags.struct(null, [
      Tags.byte(null, 0),
      Tags.long(null, data.created ?? 0n),
      Tags.long(null, data.lastExplosion ?? 0n),
      Tags.long(null, data.explosionDelay ?? 0n),
      Tags.long(null, data.moduleId ?? 0n),
      Tags.int(null, data.radius ?? 0),
      Tags.int(null, data.damage ?? 0),
      Tags.vector3f(null, min.x, min.y, min.z),
      Tags.vector3f(null, max.x, max.y, max.z),
      Tags.byteArray(null, writeInt64ListPayload(data.explosionPositions ?? [])),
      Tags.byte(null, data.chain ? 1 : 0),
      Tags.byte(null, data.cause ?? 0),
    ]));
  }

  get version(): number { return this.summary.version; }
  get created(): bigint { return this.summary.created; }
  get lastExplosion(): bigint { return this.summary.lastExplosion; }
  get explosionDelay(): bigint { return this.summary.explosionDelay; }
  get moduleId(): bigint { return this.summary.moduleId; }
  get radius(): number { return this.summary.radius; }
  get damage(): number { return this.summary.damage; }
  get min(): EntVector3f | null { return this.summary.min; }
  get max(): EntVector3f | null { return this.summary.max; }
  get explosionPositions(): readonly bigint[] { return this.summary.explosionPositions; }
  get chain(): boolean { return this.summary.chain; }
  get cause(): number { return this.summary.cause; }

  get summary(): ModuleExplosionSummary {
    const children = tagChildren(this._tag);
    const positions = children[9]?.type === TagType.BYTE_ARRAY ? children[9].getByteArray() : new Uint8Array();
    const explosionPositions = readInt64ListPayload(positions);
    return {
      version: children[0]?.type === TagType.BYTE ? children[0].getByte() : 0,
      created: children[1]?.type === TagType.LONG ? children[1].getLong() : 0n,
      lastExplosion: children[2]?.type === TagType.LONG ? children[2].getLong() : 0n,
      explosionDelay: children[3]?.type === TagType.LONG ? children[3].getLong() : 0n,
      moduleId: children[4]?.type === TagType.LONG ? children[4].getLong() : 0n,
      radius: children[5]?.type === TagType.INT ? children[5].getInt() : 0,
      damage: children[6]?.type === TagType.INT ? children[6].getInt() : 0,
      min: vector3fFromTag(children[7]),
      max: vector3fFromTag(children[8]),
      explosionPositionCount: explosionPositions.length,
      explosionPositions,
      chain: children[10]?.type === TagType.BYTE ? children[10].getByte() !== 0 : false,
      cause: children[11]?.type === TagType.BYTE ? children[11].getByte() : 0,
    };
  }

  withCreated(created: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 1, Tags.long(null, created)));
  }

  withLastExplosion(lastExplosion: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 2, Tags.long(null, lastExplosion)));
  }

  withExplosionDelay(explosionDelay: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 3, Tags.long(null, explosionDelay)));
  }

  withModuleId(moduleId: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 4, Tags.long(null, moduleId)));
  }

  withRadius(radius: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 5, Tags.int(null, radius)));
  }

  withDamage(damage: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 6, Tags.int(null, damage)));
  }

  withBounds(min: EntVector3f, max: EntVector3f): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(
      replaceChild(this._tag, 7, Tags.vector3f(null, min.x, min.y, min.z)),
      8,
      Tags.vector3f(null, max.x, max.y, max.z),
    ));
  }

  withExplosionPositions(positions: readonly (bigint | number)[]): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 9, Tags.byteArray(null, writeInt64ListPayload(positions))));
  }

  addExplosionPosition(position: bigint | number): ModuleExplosionState {
    return this.withExplosionPositions([...this.explosionPositions, typeof position === 'number' ? BigInt(position) : position]);
  }

  removeExplosionPosition(index: number): ModuleExplosionState {
    const positions = [...this.explosionPositions];
    if (index < 0 || index >= positions.length) throw new RangeError(`Explosion position index ${index} does not exist`);
    positions.splice(index, 1);
    return this.withExplosionPositions(positions);
  }

  withChain(chain: boolean): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 10, Tags.byte(null, chain ? 1 : 0)));
  }

  withCause(cause: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 11, Tags.byte(null, cause)));
  }

  toTag(): Tag {
    return this._tag;
  }

  toJSON(): ModuleExplosionSummary {
    return this.summary;
  }
}

export class ModuleExplosionsState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ModuleExplosionsState', tag);
  }

  get explosions(): readonly ModuleExplosionState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ModuleExplosionState(child));
  }

  withExplosion(index: number, explosion: ModuleExplosionState): ModuleExplosionsState {
    const explosions = tagChildren(this.toTag());
    if (index < 0 || index >= explosions.length) throw new RangeError(`Module explosion index ${index} does not exist`);
    const next = [...explosions];
    next[index] = explosion.toTag();
    return new ModuleExplosionsState(Tags.struct(this.tagName, next));
  }

  addExplosion(explosion: ModuleExplosionState): ModuleExplosionsState {
    return new ModuleExplosionsState(Tags.struct(this.tagName, [...tagChildren(this.toTag()), explosion.toTag()]));
  }

  removeExplosion(index: number): ModuleExplosionsState {
    const explosions = tagChildren(this.toTag());
    if (index < 0 || index >= explosions.length) throw new RangeError(`Module explosion index ${index} does not exist`);
    const next = [...explosions];
    next.splice(index, 1);
    return new ModuleExplosionsState(Tags.struct(this.tagName, next));
  }

  clear(): ModuleExplosionsState {
    return new ModuleExplosionsState(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), explosions: this.explosions };
  }
}

export class ModDataState extends EntSlotObject {
  constructor(tag: Tag = Tags.struct('ModMCModules', [])) {
    super('ModDataState', tag);
  }

  get moduleCount(): number {
    return this.childCount;
  }

  clear(): ModDataState {
    return new ModDataState(Tags.struct(this.tagName, []));
  }

  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), moduleCount: this.moduleCount };
  }
}

function tagChildren(tag: Tag | undefined): Tag[] {
  if (!tag || (tag.type !== TagType.STRUCT && tag.type !== TagType.LIST)) return [];
  return (tag.value as Tag[]).filter(child => child.type !== TagType.FINISH);
}

function uniqueSegmentPieceTag(piece: UniqueSegmentPieceValue): Tag {
  return Tags.struct(null, [
    Tags.byte(null, piece.version),
    Tags.string(null, piece.entityUid),
    Tags.vector3i(null, piece.position.x, piece.position.y, piece.position.z),
    Tags.short(null, piece.type),
    Tags.byte(null, piece.orientation),
    Tags.byte(null, piece.active ? 1 : 0),
    Tags.byte(null, piece.hitpoints),
  ]);
}

function quarterTypeName(type: number): string {
  return [
    'BRIDGE',
    'CANTEEN',
    'CARGO',
    'GUARD',
    'LIVING',
    'MEDICAL',
    'RECREATION',
    'ENGINEERING',
    'TRAINING',
    'GUNNERY',
    'HANGAR',
    'SHIPYARD',
  ][type] ?? `UNKNOWN_${type}`;
}

function managerModuleKind(tagId: string | null): string {
  if (!tagId) return 'unknown';
  if (tagId.startsWith('EF')) return 'effect';
  switch (tagId) {
    case 'A': return 'docking';
    case 'ACD': return 'activationDestination';
    case 'INTR': return 'interdiction';
    case 'J': return 'jumpDrive';
    case 'JAO': return 'jumpAddOn';
    case 'JP': return 'jumpInhibitor';
    case 'LSC': return 'longRangeScanner';
    case 'RBST': return 'reactorBoost';
    case 'RSCN': return 'scanAddOn';
    case 'RSTLTH': return 'stealth';
    case 'SC': return 'structureScanner';
    case 'SSC': return 'structureScanner';
    case 'SYRD': return 'shipyard';
    case 'TR': return 'transporter';
    case 'TRM': return 'tractorBeam';
    default: return 'module';
  }
}

function tagTypeName(type: TagType): string {
  return TAG_TYPE_NAMES[type] ?? TagType[type] ?? String(type);
}

function matrix4fFromTag(tag: Tag | undefined): EntMatrix4f | null {
  if (tag?.type !== TagType.MATRIX4f) return null;
  const m = tag.getMatrix4f();
  return [
    m.m00, m.m01, m.m02, m.m03,
    m.m10, m.m11, m.m12, m.m13,
    m.m20, m.m21, m.m22, m.m23,
    m.m30, m.m31, m.m32, m.m33,
  ];
}

function matrix4fFromArray(values: EntMatrix4f): Matrix4f {
  return new Matrix4f(
    values[0], values[1], values[2], values[3],
    values[4], values[5], values[6], values[7],
    values[8], values[9], values[10], values[11],
    values[12], values[13], values[14], values[15],
  );
}

function rebuildContainerTag(tag: Tag, children: Tag[]): Tag {
  if (tag.type === TagType.LIST) {
    const listType = tag.listType ?? children[0]?.type ?? TagType.NOTHING;
    return new Tag(TagType.LIST, tag.name, children, listType);
  }
  if (tag.type === TagType.STRUCT) {
    return new Tag(TagType.STRUCT, tag.name, [...children, FINISH_TAG]);
  }
  throw new TypeError(`Cannot rebuild ${tagTypeName(tag.type)} as a container`);
}

function replaceChild(tag: Tag, index: number, replacement: Tag): Tag {
  const children = tagChildren(tag);
  while (children.length <= index) children.push(Tags.nothing(null));
  const current = children[index];
  children[index] = current && replacement.name === null
    ? new Tag(replacement.type, current.name, replacement.value, replacement.listType ?? undefined)
    : replacement;
  return rebuildContainerTag(tag.type === TagType.STRUCT || tag.type === TagType.LIST ? tag : Tags.struct(tag.name, []), children);
}

function coerceTagValue(current: Tag, value: unknown): Tag {
  if (value instanceof EntSlotObject) {
    return current.name !== null ? Tags.rename(value.toTag(), current.name) : value.toTag();
  }

  switch (current.type) {
    case TagType.BYTE:
      return Tags.byte(current.name, typeof value === 'boolean'
        ? (value ? 1 : 0)
        : fieldValueAsInteger(value, current.name ?? 'byteField'));
    case TagType.SHORT:
      return Tags.short(current.name, fieldValueAsInteger(value, current.name ?? 'shortField'));
    case TagType.INT:
      return Tags.int(current.name, fieldValueAsInteger(value, current.name ?? 'intField'));
    case TagType.LONG:
      return Tags.long(current.name, fieldValueAsBigInt(value, current.name ?? 'longField'));
    case TagType.FLOAT:
      return Tags.float(current.name, fieldValueAsNumber(value, current.name ?? 'floatField'));
    case TagType.DOUBLE:
      return Tags.double(current.name, fieldValueAsNumber(value, current.name ?? 'doubleField'));
    case TagType.STRING:
      return Tags.string(current.name, fieldValueAsString(value, current.name ?? 'stringField'));
    case TagType.VECTOR3i: {
      const vector = vector3FromValue(value, current.name ?? 'vector3iField');
      return Tags.vector3i(current.name, vector.x, vector.y, vector.z);
    }
    case TagType.VECTOR3f: {
      const vector = vector3FromValue(value, current.name ?? 'vector3fField');
      return Tags.vector3f(current.name, vector.x, vector.y, vector.z);
    }
    case TagType.VECTOR4f: {
      const vector = vector4FromValue(value, current.name ?? 'vector4fField');
      return Tags.vector4f(current.name, vector.x, vector.y, vector.z, vector.w);
    }
    case TagType.BYTE_ARRAY:
      if (value instanceof Uint8Array) return Tags.byteArray(current.name, value);
      if (Array.isArray(value)) return Tags.byteArray(current.name, value.map((entry, index) => fieldValueAsInteger(entry, `byteArray[${index}]`)));
      throw new TypeError(`Entity field "${current.name ?? 'byteArray'}" expects a Uint8Array or byte array`);
    case TagType.STRUCT:
    case TagType.LIST:
      if (value instanceof EntSlotObject) return Tags.rename(value.toTag(), current.name);
      throw new TypeError(`Entity field "${current.name ?? 'container'}" expects an EntSlotObject`);
    case TagType.NOTHING:
    case TagType.FINISH:
      return Tags.nothing(current.name);
    default:
      throw new TypeError(`Unsupported editable tag type ${tagTypeName(current.type)}`);
  }
}

function vector3FromValue(value: unknown, key: string): EntVector3i {
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return {
      x: fieldValueAsInteger(candidate.x, `${key}.x`),
      y: fieldValueAsInteger(candidate.y, `${key}.y`),
      z: fieldValueAsInteger(candidate.z, `${key}.z`),
    };
  }
  throw new TypeError(`Entity field "${key}" expects {x,y,z}`);
}

function vector4FromValue(value: unknown, key: string): EntVector4f {
  if (value !== null && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return {
      x: fieldValueAsNumber(candidate.x, `${key}.x`),
      y: fieldValueAsNumber(candidate.y, `${key}.y`),
      z: fieldValueAsNumber(candidate.z, `${key}.z`),
      w: fieldValueAsNumber(candidate.w, `${key}.w`),
    };
  }
  throw new TypeError(`Entity field "${key}" expects {x,y,z,w}`);
}

function vector3iFromTag(tag: Tag | undefined): EntVector3i | null {
  if (tag?.type !== TagType.VECTOR3i) return null;
  const v = tag.getVector3i();
  return { x: v.x, y: v.y, z: v.z };
}

function vector3fFromTag(tag: Tag | undefined): EntVector3f | null {
  if (tag?.type !== TagType.VECTOR3f) return null;
  const v = tag.getVector3f();
  return { x: v.x, y: v.y, z: v.z };
}

function vector4fFromTag(tag: Tag | undefined): EntVector4f | null {
  if (tag?.type !== TagType.VECTOR4f) return null;
  const v = tag.getVector4f();
  return { x: v.x, y: v.y, z: v.z, w: v.w };
}

function parseScanEntityData(tag: Tag): ScanEntityData {
  const fields = tagChildren(tag);
  return {
    name: fields[0]?.type === TagType.STRING ? fields[0].getString() : '',
    sector: vector3iFromTag(fields[1]) ?? { x: 0, y: 0, z: 0 },
    factionId: fields[2]?.type === TagType.INT ? fields[2].getInt() : 0,
    controllerInfo: fields[3]?.type === TagType.STRING ? fields[3].getString() : '',
  };
}

function scanEntityDataToTag(data: ScanEntityData): Tag {
  return Tags.struct(null, [
    Tags.string(null, data.name),
    Tags.vector3i(null, data.sector.x, data.sector.y, data.sector.z),
    Tags.int(null, data.factionId),
    Tags.string(null, data.controllerInfo),
  ]);
}

function parseScanResourceData(tag: Tag): ScanResourceData {
  const fields = tagChildren(tag);
  if (fields[0]?.type === TagType.SHORT) {
    return {
      type: fields[0].getShort(),
      resourceQuantity: fields[1]?.type === TagType.FLOAT ? fields[1].getFloat() : 0,
    };
  }
  return {
    name: fields[0]?.type === TagType.STRING ? fields[0].getString() : '',
    type: fields[1]?.type === TagType.STRING ? fields[1].getString() : '',
    sector: vector3iFromTag(fields[2]) ?? undefined,
    canViewGenerationData: fields[3]?.type === TagType.BYTE ? fieldValueAsBoolean(fields[3].getByte(), 'canViewGenerationData') : undefined,
    resourceInfo: fields[4]?.type === TagType.STRING ? fields[4].getString() : undefined,
    resourceCaps: fields[5]?.type === TagType.STRING ? fields[5].getString() : undefined,
    resourceAmounts: fields[6]?.type === TagType.STRING ? fields[6].getString() : undefined,
  };
}

function scanResourceDataToTag(data: ScanResourceData): Tag {
  if (typeof data.type === 'number') {
    return Tags.struct('ResourceScanDataSet', [
      Tags.short('Type', data.type),
      Tags.float('ResourceAmounts', data.resourceQuantity ?? 0),
    ]);
  }
  return Tags.struct('ResourceScanDataSet', [
    Tags.string('Name', data.name ?? ''),
    Tags.string('Type', data.type),
    Tags.vector3i('Sector', data.sector?.x ?? 0, data.sector?.y ?? 0, data.sector?.z ?? 0),
    Tags.byte('CanViewGenerationData', data.canViewGenerationData ? 1 : 0),
    Tags.string('ResourceData', data.resourceInfo ?? ''),
    Tags.string('ResourceCaps', data.resourceCaps ?? ''),
    Tags.string('ResourceAmounts', data.resourceAmounts ?? ''),
  ]);
}

function readInt32BE(bytes: Uint8Array, offset: number): number {
  const unsigned = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

function writeInt32BE(bytes: Uint8Array, offset: number, value: number): void {
  const unsigned = value >>> 0;
  bytes[offset] = (unsigned >>> 24) & 0xff;
  bytes[offset + 1] = (unsigned >>> 16) & 0xff;
  bytes[offset + 2] = (unsigned >>> 8) & 0xff;
  bytes[offset + 3] = unsigned & 0xff;
}

function readInt64BE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value > 0x7fffffffffffffffn ? value - 0x10000000000000000n : value;
}

function writeInt64BE(bytes: Uint8Array, offset: number, value: bigint | number): void {
  let unsigned = typeof value === 'number' ? BigInt(value) : value;
  if (unsigned < 0) unsigned += 0x10000000000000000n;
  for (let i = 7; i >= 0; i--) {
    bytes[offset + i] = Number(unsigned & 0xffn);
    unsigned >>= 8n;
  }
}

function readInt64ListPayload(bytes: Uint8Array): bigint[] {
  if (bytes.length < 4) return [];
  const count = Math.max(0, readInt32BE(bytes, 0));
  const values: bigint[] = [];
  for (let index = 0; index < count && 4 + index * 8 + 8 <= bytes.length; index++) {
    values.push(readInt64BE(bytes, 4 + index * 8));
  }
  return values;
}

function writeInt64ListPayload(values: readonly (bigint | number)[]): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 8);
  writeInt32BE(bytes, 0, values.length);
  values.forEach((value, index) => writeInt64BE(bytes, 4 + index * 8, value));
  return bytes;
}
