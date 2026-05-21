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

/**
 * Describes the EntVector3i data shape used by high-level StarMade object modelling.
 */
export interface EntVector3i {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Describes the EntVector3f data shape used by high-level StarMade object modelling.
 */
export interface EntVector3f {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Describes the EntVector4f data shape used by high-level StarMade object modelling.
 */
export interface EntVector4f {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * Defines the EntMatrix4f type used by high-level StarMade object modelling.
 */
export type EntMatrix4f = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * Describes the UniqueSegmentPieceValue data shape used by high-level StarMade object modelling.
 */
export interface UniqueSegmentPieceValue {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;
}

/**
 * Describes the RailRequestSummary data shape used by high-level StarMade object modelling.
 */
export interface RailRequestSummary {
  readonly disconnect: boolean;
  readonly rail: UniqueSegmentPieceValue | null;
  readonly docked: UniqueSegmentPieceValue | null;
  readonly railDockerPosOnRail: EntVector3i | null;
  readonly railMovingToDockerPosOnRail: EntVector3i | null;
  readonly didRotationInPlace: boolean;
  readonly dockingPermission: number | null;
}

/**
 * Describes the CargoInventoryBlockValue data shape used by high-level StarMade object modelling.
 */
export interface CargoInventoryBlockValue {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;
}

/**
 * Describes the ScanEntityData data shape used by high-level StarMade object modelling.
 */
export interface ScanEntityData {
  readonly name: string;
  readonly sector: EntVector3i;
  readonly factionId: number;
  readonly controllerInfo: string;
}

/**
 * Describes the ScanResourceData data shape used by high-level StarMade object modelling.
 */
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

/**
 * Describes the QuarterSummary data shape used by high-level StarMade object modelling.
 */
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

/**
 * Describes the ModuleExplosionSummary data shape used by high-level StarMade object modelling.
 */
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

/**
 * Represents the EntSlotObject model used by high-level StarMade object modelling.
 */
export class EntSlotObject {
  readonly kind: string;
  readonly present: boolean;
  readonly tagName: string | null;
  readonly tagType: string;
  readonly childCount: number;

  private readonly _tag!: Tag;

  /**
   * Creates a EntSlotObject instance.
   *
   * @param kind - Input value for the constructor operation.
   * @param tag - Input value for the constructor operation.
   */
  constructor(kind: string, tag: Tag = Tags.nothing(null)) {
    this.kind = kind;
    this.present = tag.type !== TagType.NOTHING && tag.type !== TagType.FINISH;
    this.tagName = tag.name;
    this.tagType = tagTypeName(tag.type);
    this.childCount = tagChildren(tag).length;
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  /**
   * Handles the fields operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get fields(): readonly EntityField<this>[] {
    const children = tagChildren(this._tag);
    return buildEditableEntityFields(children, this._fieldSchema(children), this._fieldSetters(children));
  }

  /**
   * Returns Field.
   *
   * @param keyOrIndex - Input value for the getField operation.
   * @returns The computed StarMade-Decoder value.
   */
  getField(keyOrIndex: string | number): EntityField<this> | null {
    if (typeof keyOrIndex === 'number') return this.fields[keyOrIndex] ?? null;
    return this.fields.find(field => field.key === keyOrIndex) ?? null;
  }

  /**
   * Returns a copy updated with FieldValue.
   *
   * @param keyOrIndex - Input value for the withFieldValue operation.
   * @param value - Input value for the withFieldValue operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Tag.
   *
   * @param tag - Input value for the _withTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _withTag(tag: Tag): this {
    if (this.constructor === EntSlotObject) {
      return new EntSlotObject(this.kind, tag) as this;
    }
    const Ctor = this.constructor as new (tag: Tag) => this;
    return new Ctor(tag);
  }

  /**
   * Handles the fieldSchema operation used by high-level StarMade object modelling.
   *
   * @param children - Input value for the _fieldSchema operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _fieldSchema(children: readonly Tag[]): EntityFieldSchema {
    return children.map((child, index) => ({ key: child.name ?? `field${index}` }));
  }

  /**
   * Handles the fieldSetters operation used by high-level StarMade object modelling.
   *
   * @param children - Input value for the _fieldSetters operation.
   * @returns The computed StarMade-Decoder value.
   */
  protected _fieldSetters(children: readonly Tag[]): EntityFieldSetterMap<this> {
    const setters: Record<string, (value: unknown, field: EntityField<this>) => this> = {};
    children.forEach((child, index) => {
      const key = child.name ?? `field${index}`;
      setters[key] = (value, field) => this.withFieldValue(field.index, value);
    });
    return setters;
  }
}

/**
 * Represents the NpcDataState model used by high-level StarMade object modelling.
 */
export class NpcDataState extends EntSlotObject {
  /**
   * Creates a NpcDataState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct('[]', [])) {
    super('NpcDataState', tag);
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): NpcDataState {
    return new NpcDataState(Tags.struct(this.tagName, []));
  }
}

/**
 * Represents the UniqueSegmentPieceState model used by high-level StarMade object modelling.
 */
export class UniqueSegmentPieceState {
  readonly version: number;
  readonly entityUid: string;
  readonly position: EntVector3i;
  readonly type: number;
  readonly orientation: number;
  readonly active: boolean;
  readonly hitpoints: number;

  private readonly _tag!: Tag;

  /**
   * Creates a UniqueSegmentPieceState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
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

  /**
   * Creates a value from input data.
   *
   * @param value - Input value for the from operation.
   * @returns The computed StarMade-Decoder value.
   */
  static from(value: UniqueSegmentPieceValue): UniqueSegmentPieceState {
    return new UniqueSegmentPieceState(uniqueSegmentPieceTag(value));
  }

  /**
   * Returns a copy updated with EntityUid.
   *
   * @param entityUid - Input value for the withEntityUid operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntityUid(entityUid: string): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), entityUid });
  }

  /**
   * Returns a copy updated with Position.
   *
   * @param position - Input value for the withPosition operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPosition(position: EntVector3i): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), position });
  }

  /**
   * Returns a copy updated with Type.
   *
   * @param type - Input value for the withType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withType(type: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), type });
  }

  /**
   * Returns a copy updated with Orientation.
   *
   * @param orientation - Input value for the withOrientation operation.
   * @returns The computed StarMade-Decoder value.
   */
  withOrientation(orientation: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), orientation });
  }

  /**
   * Returns a copy updated with Active.
   *
   * @param active - Input value for the withActive operation.
   * @returns The computed StarMade-Decoder value.
   */
  withActive(active: boolean): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), active });
  }

  /**
   * Returns a copy updated with Hitpoints.
   *
   * @param hitpoints - Input value for the withHitpoints operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHitpoints(hitpoints: number): UniqueSegmentPieceState {
    return UniqueSegmentPieceState.from({ ...this.toJSON(), hitpoints });
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

/**
 * Represents the RailRequestState model used by high-level StarMade object modelling.
 */
export class RailRequestState {
  private readonly _tag!: Tag;

  /**
   * Creates a RailRequestState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 1)) {
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  /**
   * Handles the disconnect operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get disconnect(): boolean {
    return this._tag.type !== TagType.STRUCT;
  }

  /**
   * Handles the rail operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get rail(): UniqueSegmentPieceState | null {
    if (this.disconnect) return null;
    const tag = tagChildren(this._tag)[0];
    return tag?.type === TagType.STRUCT ? new UniqueSegmentPieceState(tag) : null;
  }

  /**
   * Handles the docked operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get docked(): UniqueSegmentPieceState | null {
    if (this.disconnect) return null;
    const tag = tagChildren(this._tag)[1];
    return tag?.type === TagType.STRUCT ? new UniqueSegmentPieceState(tag) : null;
  }

  /**
   * Handles the turretTransform operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get turretTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[2]);
  }

  /**
   * Handles the movedTransform operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get movedTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[3]);
  }

  /**
   * Handles the railDockerPosOnRail operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get railDockerPosOnRail(): EntVector3i | null {
    return vector3iFromTag(tagChildren(this._tag)[4]);
  }

  /**
   * Handles the railMovingLocalAtDockTransform operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get railMovingLocalAtDockTransform(): EntMatrix4f | null {
    return matrix4fFromTag(tagChildren(this._tag)[5]);
  }

  /**
   * Handles the railMovingToDockerPosOnRail operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get railMovingToDockerPosOnRail(): EntVector3i | null {
    return vector3iFromTag(tagChildren(this._tag)[6]);
  }

  /**
   * Handles the didRotationInPlace operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get didRotationInPlace(): boolean {
    const tag = tagChildren(this._tag)[7];
    return tag?.type === TagType.BYTE ? tag.getByte() !== 0 : false;
  }

  /**
   * Handles the dockingPermission operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get dockingPermission(): number | null {
    const tag = tagChildren(this._tag)[8];
    if (tag?.type !== TagType.BYTE) return null;
    const value = tag.getByte();
    return value >= 0 ? value : null;
  }

  /**
   * Returns a copy updated with Rail.
   *
   * @param rail - Input value for the withRail operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRail(rail: UniqueSegmentPieceState | UniqueSegmentPieceValue): RailRequestState {
    return this._withChild(0, rail instanceof UniqueSegmentPieceState ? rail.toTag() : uniqueSegmentPieceTag(rail));
  }

  /**
   * Returns a copy updated with Docked.
   *
   * @param docked - Input value for the withDocked operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDocked(docked: UniqueSegmentPieceState | UniqueSegmentPieceValue): RailRequestState {
    return this._withChild(1, docked instanceof UniqueSegmentPieceState ? docked.toTag() : uniqueSegmentPieceTag(docked));
  }

  /**
   * Returns a copy updated with TurretTransform.
   *
   * @param transform - Input value for the withTurretTransform operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTurretTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(2, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  /**
   * Returns a copy updated with MovedTransform.
   *
   * @param transform - Input value for the withMovedTransform operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMovedTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(3, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  /**
   * Returns a copy updated with RailDockerPosOnRail.
   *
   * @param position - Input value for the withRailDockerPosOnRail operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailDockerPosOnRail(position: EntVector3i): RailRequestState {
    return this._withChild(4, Tags.vector3i(null, position.x, position.y, position.z));
  }

  /**
   * Returns a copy updated with RailMovingLocalAtDockTransform.
   *
   * @param transform - Input value for the withRailMovingLocalAtDockTransform operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailMovingLocalAtDockTransform(transform: EntMatrix4f): RailRequestState {
    return this._withChild(5, Tags.matrix4f(null, matrix4fFromArray(transform)));
  }

  /**
   * Returns a copy updated with RailMovingToDockerPosOnRail.
   *
   * @param position - Input value for the withRailMovingToDockerPosOnRail operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRailMovingToDockerPosOnRail(position: EntVector3i | null): RailRequestState {
    return this._withChild(6, position
      ? Tags.vector3i(null, position.x, position.y, position.z)
      : Tags.byte(null, 0));
  }

  /**
   * Returns a copy updated with DidRotationInPlace.
   *
   * @param didRotationInPlace - Input value for the withDidRotationInPlace operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDidRotationInPlace(didRotationInPlace: boolean): RailRequestState {
    return this._withChild(7, Tags.byte(null, didRotationInPlace ? 1 : 0));
  }

  /**
   * Returns a copy updated with DockingPermission.
   *
   * @param dockingPermission - Input value for the withDockingPermission operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDockingPermission(dockingPermission: number | null): RailRequestState {
    return this._withChild(8, Tags.byte(null, dockingPermission ?? -1));
  }

  /**
   * Handles the disconnectRequest operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  disconnectRequest(): RailRequestState {
    return new RailRequestState(Tags.byte(null, 1));
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Child.
   *
   * @param index - Input value for the _withChild operation.
   * @param tag - Input value for the _withChild operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _withChild(index: number, tag: Tag): RailRequestState {
    if (this.disconnect) {
      throw new TypeError('Cannot edit fields on a disconnected RailRequestState');
    }
    return new RailRequestState(replaceChild(this._tag, index, tag));
  }
}

/**
 * Represents the RailControllerState model used by high-level StarMade object modelling.
 */
export class RailControllerState extends EntSlotObject {
  /**
   * Creates a RailControllerState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('RailControllerState', tag);
  }

  /**
   * Handles the modeCode operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get modeCode(): number {
    const tag = this.toTag();
    if (tag.type === TagType.BYTE) return tag.getByte();
    const first = tagChildren(tag)[0];
    return first?.type === TagType.BYTE ? first.getByte() : 0;
  }

  /**
   * Handles the mode operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get mode(): 'none' | 'docked' | 'railRoot' | 'activeRequest' | 'unknown' {
    switch (this.modeCode) {
      case 0: return 'none';
      case 1: return 'docked';
      case 2: return 'railRoot';
      case 3: return 'activeRequest';
      default: return 'unknown';
    }
  }

  /**
   * Handles the requestCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get requestCount(): number {
    return this.currentRequest ? 1 : 0;
  }

  /**
   * Validates edDockCount for high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get expectedDockCount(): number {
    return this.expectedRequests.length;
  }

  /**
   * Handles the currentRequest operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get currentRequest(): RailRequestState | null {
    const requestTag = tagChildren(this.toTag())[1];
    const firstRequest = tagChildren(requestTag)[0];
    return firstRequest ? new RailRequestState(firstRequest) : null;
  }

  /**
   * Validates edRequests for high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get expectedRequests(): readonly RailRequestState[] {
    const expectedTag = tagChildren(this.toTag())[2];
    return tagChildren(expectedTag).map(child => new RailRequestState(child));
  }

  /**
   * Returns a copy updated with CurrentRequest.
   *
   * @param request - Input value for the withCurrentRequest operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with ExpectedRequests.
   *
   * @param requests - Input value for the withExpectedRequests operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Handles the addExpectedRequest operation used by high-level StarMade object modelling.
   *
   * @param request - Input value for the addExpectedRequest operation.
   * @returns The computed StarMade-Decoder value.
   */
  addExpectedRequest(request: RailRequestState): RailControllerState {
    return this.withExpectedRequests([...this.expectedRequests, request]);
  }

  /**
   * Handles the removeExpectedRequest operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeExpectedRequest operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeExpectedRequest(index: number): RailControllerState {
    const requests = [...this.expectedRequests];
    if (index < 0 || index >= requests.length) throw new RangeError(`Expected rail request index ${index} does not exist`);
    requests.splice(index, 1);
    return this.withExpectedRequests(requests);
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): RailControllerState {
    return new RailControllerState(Tags.byte(null, 0));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Validates edTag for high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  private _expectedTag(): Tag {
    const expected = tagChildren(this.toTag())[2];
    return expected?.type === TagType.STRUCT ? expected : Tags.struct(null, []);
  }
}

/**
 * Represents the CoreTimerState model used by high-level StarMade object modelling.
 */
export class CoreTimerState extends EntSlotObject {
  /**
   * Creates a CoreTimerState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [Tags.long(null, -1n)])) {
    super('CoreTimerState', tag);
  }

  /**
   * Handles the timeLeftMs operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get timeLeftMs(): bigint | null {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.LONG ? first.getLong() : null;
  }

  /**
   * Handles the active operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get active(): boolean {
    const timeLeft = this.timeLeftMs;
    return timeLeft !== null && timeLeft >= 0n;
  }

  /**
   * Returns a copy updated with TimeLeftMs.
   *
   * @param timeLeftMs - Input value for the withTimeLeftMs operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTimeLeftMs(timeLeftMs: bigint | number): CoreTimerState {
    return new CoreTimerState(Tags.struct(this.tagName, [Tags.long(null, timeLeftMs)]));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): CoreTimerState {
    return this.withTimeLeftMs(-1n);
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), timeLeftMs: this.timeLeftMs, active: this.active };
  }
}

/**
 * Represents the BlueprintInfo model used by high-level StarMade object modelling.
 */
export class BlueprintInfo extends EntSlotObject {
  /**
   * Creates a BlueprintInfo instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 1)) {
    super('BlueprintInfo', tag);
  }

  /**
   * Handles the path operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get path(): string {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.STRING ? first.getString() : '';
  }

  /**
   * Handles the identifier operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get identifier(): string {
    const second = tagChildren(this.toTag())[1];
    return second?.type === TagType.STRING ? second.getString() : '';
  }

  /**
   * Loads edFromBlueprint from StarMade project files.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get loadedFromBlueprint(): boolean {
    return this.toTag().type === TagType.STRUCT;
  }

  /**
   * Returns a copy updated with Path.
   *
   * @param path - Input value for the withPath operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPath(path: string): BlueprintInfo {
    return new BlueprintInfo(Tags.struct(this.tagName, [
      Tags.string(null, path),
      Tags.string(null, this.identifier),
    ]));
  }

  /**
   * Returns a copy updated with Identifier.
   *
   * @param identifier - Input value for the withIdentifier operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIdentifier(identifier: string): BlueprintInfo {
    return new BlueprintInfo(Tags.struct(this.tagName, [
      Tags.string(null, this.path),
      Tags.string(null, identifier),
    ]));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): BlueprintInfo {
    return new BlueprintInfo(Tags.byte(null, 1));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), path: this.path, identifier: this.identifier, loadedFromBlueprint: this.loadedFromBlueprint };
  }
}

/**
 * Represents the ItemsToSpawnWith model used by high-level StarMade object modelling.
 */
export class ItemsToSpawnWith extends EntSlotObject {
  /**
   * Creates a ItemsToSpawnWith instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('ItemsToSpawnWith', tag);
  }

  /**
   * Handles the elementCountMap operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get elementCountMap(): ElementCountMap {
    const tag = this.toTag();
    if (tag.type !== TagType.BYTE_ARRAY) return new ElementCountMap([]);
    try {
      return ElementCountMap.fromRaw(tag.getByteArray());
    } catch {
      return new ElementCountMap([]);
    }
  }

  /**
   * Handles the counts operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get counts(): readonly BlockCount[] {
    return this.elementCountMap.counts;
  }

  /**
   * Converts this value to talBlocks.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get totalBlocks(): number {
    return this.elementCountMap.totalBlocks;
  }

  /**
   * Returns Count.
   *
   * @param type - Input value for the getCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  getCount(type: number): number {
    return this.elementCountMap.getCount(type);
  }

  /**
   * Returns a copy updated with Count.
   *
   * @param type - Input value for the withCount operation.
   * @param count - Input value for the withCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCount(type: number, count: number): ItemsToSpawnWith {
    const map = this.elementCountMap.setCount(type, count);
    return map.totalBlocks > 0
      ? new ItemsToSpawnWith(Tags.byteArray(this.tagName, map.toRaw()))
      : this.clear();
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): ItemsToSpawnWith {
    return new ItemsToSpawnWith(Tags.byte(null, 0));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), counts: this.counts, totalBlocks: this.totalBlocks };
  }
}

/**
 * Represents the QuarterState model used by high-level StarMade object modelling.
 */
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

  /**
   * Creates a QuarterState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
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

  /**
   * Builds a value for high-level StarMade object modelling.
   *
   * @param data - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Type.
   *
   * @param type - Input value for the withType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withType(type: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 1, Tags.byte(null, type)));
  }

  /**
   * Returns a copy updated with Bounds.
   *
   * @param min - Input value for the withBounds operation.
   * @param max - Input value for the withBounds operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBounds(min: EntVector3i, max: EntVector3i): QuarterState {
    return new QuarterState(replaceChild(
      replaceChild(this._tag, 2, Tags.vector3i(null, min.x, min.y, min.z)),
      3,
      Tags.vector3i(null, max.x, max.y, max.z),
    ));
  }

  /**
   * Returns a copy updated with Id.
   *
   * @param id - Input value for the withId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withId(id: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 4, Tags.int(null, id)));
  }

  /**
   * Returns a copy updated with Status.
   *
   * @param status - Input value for the withStatus operation.
   * @returns The computed StarMade-Decoder value.
   */
  withStatus(status: string): QuarterState {
    return new QuarterState(replaceChild(this._tag, 5, Tags.string(null, status)));
  }

  /**
   * Returns a copy updated with Integrity.
   *
   * @param integrity - Input value for the withIntegrity operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIntegrity(integrity: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 6, Tags.float(null, integrity)));
  }

  /**
   * Returns a copy updated with Priority.
   *
   * @param priority - Input value for the withPriority operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPriority(priority: number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 7, Tags.int(null, priority)));
  }

  /**
   * Returns a copy updated with Index.
   *
   * @param index - Input value for the withIndex operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIndex(index: bigint | number): QuarterState {
    return new QuarterState(replaceChild(this._tag, 8, Tags.long(null, index)));
  }

  /**
   * Returns a copy updated with ChildIds.
   *
   * @param childIds - Input value for the withChildIds operation.
   * @returns The computed StarMade-Decoder value.
   */
  withChildIds(childIds: readonly number[]): QuarterState {
    return new QuarterState(replaceChild(
      replaceChild(this._tag, 9, Tags.int(null, childIds.length)),
      10,
      new Tag(TagType.LIST, null, childIds.map(id => Tags.int(null, id)), TagType.INT),
    ));
  }

  /**
   * Returns a copy updated with Extra.
   *
   * @param extra - Input value for the withExtra operation.
   * @returns The computed StarMade-Decoder value.
   */
  withExtra(extra: EntSlotObject | null): QuarterState {
    return new QuarterState(replaceChild(this._tag, 11, extra?.toTag() ?? Tags.nothing(null)));
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

/**
 * Represents the QuarterManagerState model used by high-level StarMade object modelling.
 */
export class QuarterManagerState extends EntSlotObject {
  /**
   * Creates a QuarterManagerState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [])])) {
    super('QuarterManagerState', tag);
  }

  /**
   * Handles the version operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get version(): number {
    const first = tagChildren(this.toTag())[0];
    return first?.type === TagType.BYTE ? first.getByte() : 0;
  }

  /**
   * Handles the quarters operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get quarters(): readonly QuarterState[] {
    const quarterStruct = tagChildren(this.toTag())[1];
    return tagChildren(quarterStruct)
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new QuarterState(child));
  }

  /**
   * Returns a copy updated with Version.
   *
   * @param version - Input value for the withVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withVersion(version: number): QuarterManagerState {
    return new QuarterManagerState(replaceChild(this.toTag(), 0, Tags.byte(null, version)));
  }

  /**
   * Returns a copy updated with Quarter.
   *
   * @param index - Input value for the withQuarter operation.
   * @param quarter - Input value for the withQuarter operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Handles the addQuarter operation used by high-level StarMade object modelling.
   *
   * @param quarter - Input value for the addQuarter operation.
   * @returns The computed StarMade-Decoder value.
   */
  addQuarter(quarter: QuarterState): QuarterManagerState {
    const children = tagChildren(this.toTag());
    const quarterStruct = children[1]?.type === TagType.STRUCT ? children[1] : Tags.struct(null, []);
    return new QuarterManagerState(replaceChild(
      this.toTag(),
      1,
      Tags.struct(quarterStruct.name, [...tagChildren(quarterStruct), quarter.toTag()]),
    ));
  }

  /**
   * Handles the clearQuarters operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clearQuarters(): QuarterManagerState {
    return new QuarterManagerState(Tags.struct(this.tagName, [
      Tags.byte(null, this.version),
      Tags.struct(null, []),
    ]));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), version: this.version, quarters: this.quarters };
  }
}

/**
 * Represents the PlayerInfoHistoryEntry model used by high-level StarMade object modelling.
 */
export class PlayerInfoHistoryEntry {
  /**
   * Creates a PlayerInfoHistoryEntry instance.
   *
   * @param time - Input value for the constructor operation.
   * @param ip - Input value for the constructor operation.
   * @param starmadeName - Input value for the constructor operation.
   */
  constructor(
    readonly time: bigint,
    readonly ip: string,
    readonly starmadeName: string,
  ) {}

  /**
   * Builds a value for high-level StarMade object modelling.
   *
   * @param time - Input value for the create operation.
   * @param ip - Input value for the create operation.
   * @param starmadeName - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
  static create(time: bigint | number, ip: string, starmadeName = ''): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(typeof time === 'number' ? BigInt(time) : time, ip, starmadeName);
  }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): PlayerInfoHistoryEntry {
    const children = tagChildren(tag);
    return new PlayerInfoHistoryEntry(
      children[0]?.type === TagType.LONG ? children[0].getLong() : 0n,
      children[1]?.type === TagType.STRING ? children[1].getString() : '',
      children[2]?.type === TagType.STRING ? children[2].getString() : '',
    );
  }

  /**
   * Returns a copy updated with Time.
   *
   * @param time - Input value for the withTime operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTime(time: bigint | number): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(typeof time === 'number' ? BigInt(time) : time, this.ip, this.starmadeName);
  }

  /**
   * Returns a copy updated with Ip.
   *
   * @param ip - Input value for the withIp operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIp(ip: string): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(this.time, ip, this.starmadeName);
  }

  /**
   * Returns a copy updated with StarmadeName.
   *
   * @param starmadeName - Input value for the withStarmadeName operation.
   * @returns The computed StarMade-Decoder value.
   */
  withStarmadeName(starmadeName: string): PlayerInfoHistoryEntry {
    return new PlayerInfoHistoryEntry(this.time, this.ip, starmadeName);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.long(null, this.time),
      Tags.string(null, this.ip),
      Tags.string(null, this.starmadeName),
    ]);
  }
}

/**
 * Represents the PlayerInfoHistoryList model used by high-level StarMade object modelling.
 */
export class PlayerInfoHistoryList extends EntSlotObject {
  /**
   * Creates a PlayerInfoHistoryList instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct('hist', [])) {
    super('PlayerInfoHistoryList', tag);
  }

  /**
   * Returns iterable key/value entries for this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entries(): readonly PlayerInfoHistoryEntry[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => PlayerInfoHistoryEntry.fromTag(child));
  }

  /**
   * Handles the addEntry operation used by high-level StarMade object modelling.
   *
   * @param entry - Input value for the addEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  addEntry(entry: PlayerInfoHistoryEntry): PlayerInfoHistoryList {
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, [...this.entries.map(e => e.toTag()), entry.toTag()]));
  }

  /**
   * Returns a copy updated with Entry.
   *
   * @param index - Input value for the withEntry operation.
   * @param entry - Input value for the withEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntry(index: number, entry: PlayerInfoHistoryEntry): PlayerInfoHistoryList {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`History index ${index} does not exist`);
    entries[index] = entry;
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  /**
   * Handles the removeEntry operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeEntry(index: number): PlayerInfoHistoryList {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`History index ${index} does not exist`);
    entries.splice(index, 1);
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): PlayerInfoHistoryList {
    return new PlayerInfoHistoryList(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), entries: this.entries };
  }
}

/**
 * Represents the ScanDataRecord model used by high-level StarMade object modelling.
 */
export class ScanDataRecord {
  readonly origin: EntVector3i;
  readonly time: bigint;
  readonly range: number;
  readonly systemOwnershipType: number;
  readonly entityData: readonly ScanEntityData[];
  readonly resourceData: readonly ScanResourceData[];

  private readonly _tag!: Tag;

  /**
   * Creates a ScanDataRecord instance.
   *
   * @param tag - Input value for the constructor operation.
   */
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

  /**
   * Builds a value for high-level StarMade object modelling.
   *
   * @param data - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Origin.
   *
   * @param origin - Input value for the withOrigin operation.
   * @returns The computed StarMade-Decoder value.
   */
  withOrigin(origin: EntVector3i): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 0, Tags.vector3i('Origin', origin.x, origin.y, origin.z)));
  }

  /**
   * Returns a copy updated with Time.
   *
   * @param time - Input value for the withTime operation.
   * @returns The computed StarMade-Decoder value.
   */
  withTime(time: bigint | number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 1, Tags.long('Time', time)));
  }

  /**
   * Returns a copy updated with Range.
   *
   * @param range - Input value for the withRange operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRange(range: number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 2, Tags.float('Range', range)));
  }

  /**
   * Returns a copy updated with SystemOwnershipType.
   *
   * @param systemOwnershipType - Input value for the withSystemOwnershipType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSystemOwnershipType(systemOwnershipType: number): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 3, Tags.int('SystemOwnershipType', systemOwnershipType)));
  }

  /**
   * Returns a copy updated with EntityData.
   *
   * @param entityData - Input value for the withEntityData operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntityData(entityData: readonly ScanEntityData[]): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 4, Tags.struct('EntityData', entityData.map(scanEntityDataToTag))));
  }

  /**
   * Handles the addEntityData operation used by high-level StarMade object modelling.
   *
   * @param entity - Input value for the addEntityData operation.
   * @returns The computed StarMade-Decoder value.
   */
  addEntityData(entity: ScanEntityData): ScanDataRecord {
    return this.withEntityData([...this.entityData, entity]);
  }

  /**
   * Returns a copy updated with ResourceData.
   *
   * @param resourceData - Input value for the withResourceData operation.
   * @returns The computed StarMade-Decoder value.
   */
  withResourceData(resourceData: readonly ScanResourceData[]): ScanDataRecord {
    return new ScanDataRecord(replaceChild(this._tag, 5, Tags.struct('ResourceData', resourceData.map(scanResourceDataToTag))));
  }

  /**
   * Handles the addResourceData operation used by high-level StarMade object modelling.
   *
   * @param resource - Input value for the addResourceData operation.
   * @returns The computed StarMade-Decoder value.
   */
  addResourceData(resource: ScanResourceData): ScanDataRecord {
    return this.withResourceData([...this.resourceData, resource]);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }
}

/**
 * Represents the ScanHistory model used by high-level StarMade object modelling.
 */
export class ScanHistory extends EntSlotObject {
  /**
   * Creates a ScanHistory instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ScanHistory', tag);
  }

  /**
   * Handles the scans operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get scans(): readonly ScanDataRecord[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ScanDataRecord(child));
  }

  /**
   * Returns a copy updated with Scan.
   *
   * @param index - Input value for the withScan operation.
   * @param scan - Input value for the withScan operation.
   * @returns The computed StarMade-Decoder value.
   */
  withScan(index: number, scan: ScanDataRecord): ScanHistory {
    const scans = tagChildren(this.toTag());
    if (index < 0 || index >= scans.length) throw new RangeError(`Scan index ${index} does not exist`);
    const next = [...scans];
    next[index] = scan.toTag();
    return new ScanHistory(Tags.struct(this.tagName, next));
  }

  /**
   * Handles the addScan operation used by high-level StarMade object modelling.
   *
   * @param scan - Input value for the addScan operation.
   * @returns The computed StarMade-Decoder value.
   */
  addScan(scan: ScanDataRecord): ScanHistory {
    return new ScanHistory(Tags.struct(this.tagName, [...this.scans.map(entry => entry.toTag()), scan.toTag()]));
  }

  /**
   * Handles the removeScan operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeScan operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeScan(index: number): ScanHistory {
    const scans = [...this.scans];
    if (index < 0 || index >= scans.length) throw new RangeError(`Scan index ${index} does not exist`);
    scans.splice(index, 1);
    return new ScanHistory(Tags.struct(this.tagName, scans.map(scan => scan.toTag())));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): ScanHistory {
    return new ScanHistory(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), scans: this.scans };
  }
}

/**
 * Represents the SavedCoordinateEntry model used by high-level StarMade object modelling.
 */
export class SavedCoordinateEntry {
  /**
   * Creates a SavedCoordinateEntry instance.
   *
   * @param sector - Input value for the constructor operation.
   * @param name - Input value for the constructor operation.
   * @param color - Input value for the constructor operation.
   * @param icon - Input value for the constructor operation.
   */
  constructor(
    readonly sector: EntVector3i,
    readonly name: string,
    readonly color: EntVector4f = { x: 1, y: 1, z: 1, w: 1 },
    readonly icon = 0,
  ) {}

  /**
   * Builds a value for high-level StarMade object modelling.
   *
   * @param sector - Input value for the create operation.
   * @param name - Input value for the create operation.
   * @param color - Input value for the create operation.
   * @param icon - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
  static create(sector: EntVector3i, name: string, color?: EntVector4f, icon?: number): SavedCoordinateEntry {
    return new SavedCoordinateEntry(sector, name, color, icon);
  }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SavedCoordinateEntry {
    const children = tagChildren(tag);
    return new SavedCoordinateEntry(
      vector3iFromTag(children[0]) ?? { x: 0, y: 0, z: 0 },
      children[1]?.type === TagType.STRING ? children[1].getString() : '',
      vector4fFromTag(children[2]) ?? { x: 1, y: 1, z: 1, w: 1 },
      children[3]?.type === TagType.INT ? children[3].getInt() : 0,
    );
  }

  /**
   * Returns a copy updated with Sector.
   *
   * @param sector - Input value for the withSector operation.
   * @returns The computed StarMade-Decoder value.
   */
  withSector(sector: EntVector3i): SavedCoordinateEntry {
    return new SavedCoordinateEntry(sector, this.name, this.color, this.icon);
  }

  /**
   * Returns a copy updated with Name.
   *
   * @param name - Input value for the withName operation.
   * @returns The computed StarMade-Decoder value.
   */
  withName(name: string): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, name, this.color, this.icon);
  }

  /**
   * Returns a copy updated with Color.
   *
   * @param color - Input value for the withColor operation.
   * @returns The computed StarMade-Decoder value.
   */
  withColor(color: EntVector4f): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, this.name, color, this.icon);
  }

  /**
   * Returns a copy updated with Icon.
   *
   * @param icon - Input value for the withIcon operation.
   * @returns The computed StarMade-Decoder value.
   */
  withIcon(icon: number): SavedCoordinateEntry {
    return new SavedCoordinateEntry(this.sector, this.name, this.color, icon);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.vector3i(null, this.sector.x, this.sector.y, this.sector.z),
      Tags.string(null, this.name),
      Tags.vector4f(null, this.color.x, this.color.y, this.color.z, this.color.w),
      Tags.int(null, this.icon),
    ]);
  }
}

/**
 * Represents the SavedCoordinates model used by high-level StarMade object modelling.
 */
export class SavedCoordinates extends EntSlotObject {
  /**
   * Creates a SavedCoordinates instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('SavedCoordinates', tag);
  }

  /**
   * Returns iterable key/value entries for this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entries(): readonly SavedCoordinateEntry[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => SavedCoordinateEntry.fromTag(child));
  }

  /**
   * Handles the add operation used by high-level StarMade object modelling.
   *
   * @param entry - Input value for the add operation.
   * @returns The computed StarMade-Decoder value.
   */
  add(entry: SavedCoordinateEntry): SavedCoordinates {
    return new SavedCoordinates(Tags.struct(this.tagName, [...this.entries.map(e => e.toTag()), entry.toTag()]));
  }

  /**
   * Returns a copy updated with Entry.
   *
   * @param index - Input value for the withEntry operation.
   * @param entry - Input value for the withEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntry(index: number, entry: SavedCoordinateEntry): SavedCoordinates {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`Saved coordinate index ${index} does not exist`);
    entries[index] = entry;
    return new SavedCoordinates(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  /**
   * Handles the remove operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the remove operation.
   * @returns The computed StarMade-Decoder value.
   */
  remove(index: number): SavedCoordinates {
    const entries = [...this.entries];
    if (index < 0 || index >= entries.length) throw new RangeError(`Saved coordinate index ${index} does not exist`);
    entries.splice(index, 1);
    return new SavedCoordinates(Tags.struct(this.tagName, entries.map(e => e.toTag())));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): SavedCoordinates {
    return new SavedCoordinates(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), entries: this.entries };
  }
}

/**
 * Represents the IgnoredPlayers model used by high-level StarMade object modelling.
 */
export class IgnoredPlayers extends EntSlotObject {
  /**
   * Creates a IgnoredPlayers instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('IgnoredPlayers', tag);
  }

  /**
   * Handles the names operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get names(): readonly string[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRING)
      .map(child => child.getString());
  }

  /**
   * Handles the add operation used by high-level StarMade object modelling.
   *
   * @param name - Input value for the add operation.
   * @returns The computed StarMade-Decoder value.
   */
  add(name: string): IgnoredPlayers {
    return this.names.includes(name)
      ? this
      : new IgnoredPlayers(Tags.struct(this.tagName, [...this.names.map(n => Tags.string(null, n)), Tags.string(null, name)]));
  }

  /**
   * Handles the remove operation used by high-level StarMade object modelling.
   *
   * @param name - Input value for the remove operation.
   * @returns The computed StarMade-Decoder value.
   */
  remove(name: string): IgnoredPlayers {
    return new IgnoredPlayers(Tags.struct(this.tagName, this.names.filter(n => n !== name).map(n => Tags.string(null, n))));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): IgnoredPlayers {
    return new IgnoredPlayers(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), names: this.names };
  }
}

/**
 * Represents the InventoryBackupState model used by high-level StarMade object modelling.
 */
export class InventoryBackupState extends EntSlotObject {
  /**
   * Creates a InventoryBackupState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('InventoryBackupState', tag);
  }

  /**
   * Reports whether hasBackup is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hasBackup(): boolean {
    return this.toTag().type === TagType.STRUCT;
  }

  /**
   * Handles the mainInventory operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get mainInventory(): Inventory | null {
    return this._inventoryAt(0);
  }

  /**
   * Handles the capsuleInventory operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get capsuleInventory(): Inventory | null {
    return this._inventoryAt(1);
  }

  /**
   * Handles the microInventory operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get microInventory(): Inventory | null {
    return this._inventoryAt(2);
  }

  /**
   * Handles the macroInventory operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get macroInventory(): Inventory | null {
    return this._inventoryAt(3);
  }

  /**
   * Returns a copy updated with MainInventory.
   *
   * @param inventory - Input value for the withMainInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMainInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(0, inventory);
  }

  /**
   * Returns a copy updated with CapsuleInventory.
   *
   * @param inventory - Input value for the withCapsuleInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCapsuleInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(1, inventory);
  }

  /**
   * Returns a copy updated with MicroInventory.
   *
   * @param inventory - Input value for the withMicroInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMicroInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(2, inventory);
  }

  /**
   * Returns a copy updated with MacroInventory.
   *
   * @param inventory - Input value for the withMacroInventory operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMacroInventory(inventory: Inventory): InventoryBackupState {
    return this._withInventoryAt(3, inventory);
  }

  /**
   * Returns a copy updated with Inventories.
   *
   * @param inventories - Input value for the withInventories operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): InventoryBackupState {
    return new InventoryBackupState(Tags.byte(null, 0));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Handles the inventoryAt operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the _inventoryAt operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _inventoryAt(index: number): Inventory | null {
    const tag = tagChildren(this.toTag())[index];
    if (tag?.type !== TagType.STRUCT) return null;
    try {
      return Inventory.fromTag(tag);
    } catch {
      return null;
    }
  }

  /**
   * Returns a copy updated with InventoryAt.
   *
   * @param index - Input value for the _withInventoryAt operation.
   * @param inventory - Input value for the _withInventoryAt operation.
   * @returns The computed StarMade-Decoder value.
   */
  private _withInventoryAt(index: number, inventory: Inventory): InventoryBackupState {
    const children = tagChildren(this.toTag());
    while (children.length < 4) children.push(Inventory.EMPTY.toTag());
    children[index] = inventory.toTag();
    return new InventoryBackupState(Tags.struct(this.tagName, children.slice(0, 4)));
  }
}

/**
 * Represents the CargoInventoryBlock model used by high-level StarMade object modelling.
 */
export class CargoInventoryBlock extends EntSlotObject {
  /**
   * Creates a CargoInventoryBlock instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('CargoInventoryBlock', tag);
  }

  /**
   * Handles the piece operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Piece.
   *
   * @param piece - Input value for the withPiece operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): CargoInventoryBlock {
    return new CargoInventoryBlock(Tags.byte(null, 0));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), piece: this.piece };
  }
}

/**
 * Represents the WarpGateInfo model used by high-level StarMade object modelling.
 */
export class WarpGateInfo extends EntSlotObject {
  /**
   * Creates a WarpGateInfo instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('WarpGateInfo', tag);
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): WarpGateInfo {
    return new WarpGateInfo(Tags.byte(null, 0));
  }
}

/**
 * Represents the RaceGateInfo model used by high-level StarMade object modelling.
 */
export class RaceGateInfo extends EntSlotObject {
  /**
   * Creates a RaceGateInfo instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.byte(null, 0)) {
    super('RaceGateInfo', tag);
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): RaceGateInfo {
    return new RaceGateInfo(Tags.byte(null, 0));
  }
}

/**
 * Represents the ManagerModuleEntryState model used by high-level StarMade object modelling.
 */
export class ManagerModuleEntryState {
  readonly positionIndex: bigint;
  readonly position: EntVector3i;
  readonly payloadType: string;

  private readonly _tag!: Tag;

  /**
   * Creates a ManagerModuleEntryState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
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

  /**
   * Handles the payload operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get payload(): EntSlotObject {
    return new EntSlotObject('ManagerModuleEntryPayload', tagChildren(this._tag)[1] ?? Tags.nothing(null));
  }

  /**
   * Handles the chargeState operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get chargeState(): { readonly encodedCharge: number; readonly autoCharge: boolean; readonly active: boolean } | null {
    const children = tagChildren(this.payload.toTag());
    if (children[0]?.type !== TagType.FLOAT) return null;
    return {
      encodedCharge: children[0].getFloat(),
      autoCharge: children[1]?.type === TagType.BYTE ? children[1].getByte() !== 0 : false,
      active: children[2]?.type === TagType.BYTE ? children[2].getByte() !== 0 : false,
    };
  }

  /**
   * Handles the transporterTarget operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Position.
   *
   * @param position - Input value for the withPosition operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPosition(position: EntVector3i): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 0, Tags.long(null, posToIndex(position.x, position.y, position.z))));
  }

  /**
   * Returns a copy updated with PositionIndex.
   *
   * @param positionIndex - Input value for the withPositionIndex operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPositionIndex(positionIndex: bigint | number): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 0, Tags.long(null, positionIndex)));
  }

  /**
   * Returns a copy updated with Payload.
   *
   * @param payload - Input value for the withPayload operation.
   * @returns The computed StarMade-Decoder value.
   */
  withPayload(payload: EntSlotObject): ManagerModuleEntryState {
    return new ManagerModuleEntryState(replaceChild(this._tag, 1, payload.toTag()));
  }

  /**
   * Returns a copy updated with ChargeState.
   *
   * @param encodedCharge - Input value for the withChargeState operation.
   * @param autoCharge - Input value for the withChargeState operation.
   * @param active - Input value for the withChargeState operation.
   * @returns The computed StarMade-Decoder value.
   */
  withChargeState(encodedCharge: number, autoCharge = this.chargeState?.autoCharge ?? false, active = this.chargeState?.active ?? false): ManagerModuleEntryState {
    return this.withPayload(new EntSlotObject('ChargeState', Tags.struct(null, [
      Tags.float(null, encodedCharge),
      Tags.byte(null, autoCharge ? 1 : 0),
      Tags.byte(null, active ? 1 : 0),
    ])));
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

/**
 * Represents the ManagerModuleState model used by high-level StarMade object modelling.
 */
export class ManagerModuleState extends EntSlotObject {
  /**
   * Creates a ManagerModuleState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ManagerModuleState', tag);
  }

  /**
   * Handles the tagId operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get tagId(): string | null {
    return this.tagName;
  }

  /**
   * Handles the metadataCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get metadataCount(): number {
    return this.childCount;
  }

  /**
   * Handles the moduleKind operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get moduleKind(): string {
    return managerModuleKind(this.tagId);
  }

  /**
   * Returns iterable key/value entries for this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entries(): readonly ManagerModuleEntryState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ManagerModuleEntryState(child));
  }

  /**
   * Returns a copy updated with Entry.
   *
   * @param index - Input value for the withEntry operation.
   * @param entry - Input value for the withEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntry(index: number, entry: ManagerModuleEntryState): ManagerModuleState {
    const entries = tagChildren(this.toTag());
    if (index < 0 || index >= entries.length) throw new RangeError(`Manager module entry index ${index} does not exist`);
    const next = [...entries];
    next[index] = entry.toTag();
    return new ManagerModuleState(Tags.struct(this.tagId, next));
  }

  /**
   * Handles the addEntry operation used by high-level StarMade object modelling.
   *
   * @param entry - Input value for the addEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  addEntry(entry: ManagerModuleEntryState): ManagerModuleState {
    return new ManagerModuleState(Tags.struct(this.tagId, [...tagChildren(this.toTag()), entry.toTag()]));
  }

  /**
   * Handles the removeEntry operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeEntry operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeEntry(index: number): ManagerModuleState {
    const entries = tagChildren(this.toTag());
    if (index < 0 || index >= entries.length) throw new RangeError(`Manager module entry index ${index} does not exist`);
    const next = [...entries];
    next.splice(index, 1);
    return new ManagerModuleState(Tags.struct(this.tagId, next));
  }

  /**
   * Handles the clearEntries operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clearEntries(): ManagerModuleState {
    return new ManagerModuleState(Tags.struct(this.tagId, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), tagId: this.tagId, moduleKind: this.moduleKind, metadataCount: this.metadataCount, entries: this.entries };
  }
}

/**
 * Represents the ManagerModulesState model used by high-level StarMade object modelling.
 */
export class ManagerModulesState extends EntSlotObject {
  /**
   * Creates a ManagerModulesState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ManagerModulesState', tag);
  }

  /**
   * Handles the modules operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get modules(): readonly ManagerModuleState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ManagerModuleState(child));
  }

  /**
   * Handles the moduleIds operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get moduleIds(): readonly string[] {
    return this.modules.map(module => module.tagId ?? '');
  }

  /**
   * Returns Module.
   *
   * @param tagId - Input value for the getModule operation.
   * @returns The computed StarMade-Decoder value.
   */
  getModule(tagId: string): ManagerModuleState | null {
    return this.modules.find(module => module.tagId === tagId) ?? null;
  }

  /**
   * Returns Modules.
   *
   * @param tagId - Input value for the getModules operation.
   * @returns The computed StarMade-Decoder value.
   */
  getModules(tagId: string): readonly ManagerModuleState[] {
    return this.modules.filter(module => module.tagId === tagId);
  }

  /**
   * Returns a copy updated with Module.
   *
   * @param tagId - Input value for the withModule operation.
   * @param module - Input value for the withModule operation.
   * @returns The computed StarMade-Decoder value.
   */
  withModule(tagId: string, module: ManagerModuleState): ManagerModulesState {
    const modules = tagChildren(this.toTag());
    const index = modules.findIndex(child => child.name === tagId);
    const renamed = Tags.rename(module.toTag(), tagId);
    const next = index >= 0 ? [...modules] : [...modules, renamed];
    if (index >= 0) next[index] = renamed;
    return new ManagerModulesState(Tags.struct(this.tagName, next));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): ManagerModulesState {
    return new ManagerModulesState(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), moduleIds: this.moduleIds, modules: this.modules };
  }
}

/**
 * Represents the AiConfigurationState model used by high-level StarMade object modelling.
 */
export class AiConfigurationState extends EntSlotObject {
  /**
   * Creates a AiConfigurationState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct('AIConfig1', [])) {
    super('AiConfigurationState', tag);
  }

  /**
   * Stores tings.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns Setting.
   *
   * @param id - Input value for the getSetting operation.
   * @returns The computed StarMade-Decoder value.
   */
  getSetting(id: number): string | null {
    return this.settings.find(setting => setting.id === id)?.value ?? null;
  }

  /**
   * Returns a copy updated with Setting.
   *
   * @param id - Input value for the withSetting operation.
   * @param value - Input value for the withSetting operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): AiConfigurationState {
    return new AiConfigurationState(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), settings: this.settings };
  }
}

/**
 * Represents the UnloadedDummiesState model used by high-level StarMade object modelling.
 */
export class UnloadedDummiesState extends EntSlotObject {
  /**
   * Creates a UnloadedDummiesState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('UnloadedDummiesState', tag);
  }

  /**
   * Handles the dummyCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get dummyCount(): number {
    return this.childCount;
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): UnloadedDummiesState {
    return new UnloadedDummiesState(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), dummyCount: this.dummyCount };
  }
}

/**
 * Represents the ModuleExplosionState model used by high-level StarMade object modelling.
 */
export class ModuleExplosionState {
  private readonly _tag!: Tag;

  /**
   * Creates a ModuleExplosionState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag) {
    Object.defineProperty(this, '_tag', { value: tag, enumerable: false });
  }

  /**
   * Builds a value for high-level StarMade object modelling.
   *
   * @param data - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Handles the version operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get version(): number { return this.summary.version; }
  /**
   * Builds d for high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get created(): bigint { return this.summary.created; }
  /**
   * Handles the lastExplosion operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get lastExplosion(): bigint { return this.summary.lastExplosion; }
  /**
   * Handles the explosionDelay operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get explosionDelay(): bigint { return this.summary.explosionDelay; }
  /**
   * Handles the moduleId operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get moduleId(): bigint { return this.summary.moduleId; }
  /**
   * Handles the radius operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get radius(): number { return this.summary.radius; }
  /**
   * Handles the damage operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get damage(): number { return this.summary.damage; }
  /**
   * Handles the min operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get min(): EntVector3f | null { return this.summary.min; }
  /**
   * Handles the max operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get max(): EntVector3f | null { return this.summary.max; }
  /**
   * Handles the explosionPositions operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get explosionPositions(): readonly bigint[] { return this.summary.explosionPositions; }
  /**
   * Handles the chain operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get chain(): boolean { return this.summary.chain; }
  /**
   * Handles the cause operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get cause(): number { return this.summary.cause; }

  /**
   * Handles the summary operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
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

  /**
   * Returns a copy updated with Created.
   *
   * @param created - Input value for the withCreated operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCreated(created: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 1, Tags.long(null, created)));
  }

  /**
   * Returns a copy updated with LastExplosion.
   *
   * @param lastExplosion - Input value for the withLastExplosion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLastExplosion(lastExplosion: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 2, Tags.long(null, lastExplosion)));
  }

  /**
   * Returns a copy updated with ExplosionDelay.
   *
   * @param explosionDelay - Input value for the withExplosionDelay operation.
   * @returns The computed StarMade-Decoder value.
   */
  withExplosionDelay(explosionDelay: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 3, Tags.long(null, explosionDelay)));
  }

  /**
   * Returns a copy updated with ModuleId.
   *
   * @param moduleId - Input value for the withModuleId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withModuleId(moduleId: bigint | number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 4, Tags.long(null, moduleId)));
  }

  /**
   * Returns a copy updated with Radius.
   *
   * @param radius - Input value for the withRadius operation.
   * @returns The computed StarMade-Decoder value.
   */
  withRadius(radius: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 5, Tags.int(null, radius)));
  }

  /**
   * Returns a copy updated with Damage.
   *
   * @param damage - Input value for the withDamage operation.
   * @returns The computed StarMade-Decoder value.
   */
  withDamage(damage: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 6, Tags.int(null, damage)));
  }

  /**
   * Returns a copy updated with Bounds.
   *
   * @param min - Input value for the withBounds operation.
   * @param max - Input value for the withBounds operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBounds(min: EntVector3f, max: EntVector3f): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(
      replaceChild(this._tag, 7, Tags.vector3f(null, min.x, min.y, min.z)),
      8,
      Tags.vector3f(null, max.x, max.y, max.z),
    ));
  }

  /**
   * Returns a copy updated with ExplosionPositions.
   *
   * @param positions - Input value for the withExplosionPositions operation.
   * @returns The computed StarMade-Decoder value.
   */
  withExplosionPositions(positions: readonly (bigint | number)[]): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 9, Tags.byteArray(null, writeInt64ListPayload(positions))));
  }

  /**
   * Handles the addExplosionPosition operation used by high-level StarMade object modelling.
   *
   * @param position - Input value for the addExplosionPosition operation.
   * @returns The computed StarMade-Decoder value.
   */
  addExplosionPosition(position: bigint | number): ModuleExplosionState {
    return this.withExplosionPositions([...this.explosionPositions, typeof position === 'number' ? BigInt(position) : position]);
  }

  /**
   * Handles the removeExplosionPosition operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeExplosionPosition operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeExplosionPosition(index: number): ModuleExplosionState {
    const positions = [...this.explosionPositions];
    if (index < 0 || index >= positions.length) throw new RangeError(`Explosion position index ${index} does not exist`);
    positions.splice(index, 1);
    return this.withExplosionPositions(positions);
  }

  /**
   * Returns a copy updated with Chain.
   *
   * @param chain - Input value for the withChain operation.
   * @returns The computed StarMade-Decoder value.
   */
  withChain(chain: boolean): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 10, Tags.byte(null, chain ? 1 : 0)));
  }

  /**
   * Returns a copy updated with Cause.
   *
   * @param cause - Input value for the withCause operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCause(cause: number): ModuleExplosionState {
    return new ModuleExplosionState(replaceChild(this._tag, 11, Tags.byte(null, cause)));
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return this._tag;
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): ModuleExplosionSummary {
    return this.summary;
  }
}

/**
 * Represents the ModuleExplosionsState model used by high-level StarMade object modelling.
 */
export class ModuleExplosionsState extends EntSlotObject {
  /**
   * Creates a ModuleExplosionsState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct(null, [])) {
    super('ModuleExplosionsState', tag);
  }

  /**
   * Handles the explosions operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get explosions(): readonly ModuleExplosionState[] {
    return tagChildren(this.toTag())
      .filter(child => child.type === TagType.STRUCT)
      .map(child => new ModuleExplosionState(child));
  }

  /**
   * Returns a copy updated with Explosion.
   *
   * @param index - Input value for the withExplosion operation.
   * @param explosion - Input value for the withExplosion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withExplosion(index: number, explosion: ModuleExplosionState): ModuleExplosionsState {
    const explosions = tagChildren(this.toTag());
    if (index < 0 || index >= explosions.length) throw new RangeError(`Module explosion index ${index} does not exist`);
    const next = [...explosions];
    next[index] = explosion.toTag();
    return new ModuleExplosionsState(Tags.struct(this.tagName, next));
  }

  /**
   * Handles the addExplosion operation used by high-level StarMade object modelling.
   *
   * @param explosion - Input value for the addExplosion operation.
   * @returns The computed StarMade-Decoder value.
   */
  addExplosion(explosion: ModuleExplosionState): ModuleExplosionsState {
    return new ModuleExplosionsState(Tags.struct(this.tagName, [...tagChildren(this.toTag()), explosion.toTag()]));
  }

  /**
   * Handles the removeExplosion operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the removeExplosion operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeExplosion(index: number): ModuleExplosionsState {
    const explosions = tagChildren(this.toTag());
    if (index < 0 || index >= explosions.length) throw new RangeError(`Module explosion index ${index} does not exist`);
    const next = [...explosions];
    next.splice(index, 1);
    return new ModuleExplosionsState(Tags.struct(this.tagName, next));
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): ModuleExplosionsState {
    return new ModuleExplosionsState(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), explosions: this.explosions };
  }
}

/**
 * Represents the ModDataState model used by high-level StarMade object modelling.
 */
export class ModDataState extends EntSlotObject {
  /**
   * Creates a ModDataState instance.
   *
   * @param tag - Input value for the constructor operation.
   */
  constructor(tag: Tag = Tags.struct('ModMCModules', [])) {
    super('ModDataState', tag);
  }

  /**
   * Handles the moduleCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get moduleCount(): number {
    return this.childCount;
  }

  /**
   * Returns a cleared copy of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  clear(): ModDataState {
    return new ModDataState(Tags.struct(this.tagName, []));
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), moduleCount: this.moduleCount };
  }
}

/**
 * Handles the tagChildren operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the tagChildren operation.
 * @returns The computed StarMade-Decoder value.
 */
function tagChildren(tag: Tag | undefined): Tag[] {
  if (!tag || (tag.type !== TagType.STRUCT && tag.type !== TagType.LIST)) return [];
  return (tag.value as Tag[]).filter(child => child.type !== TagType.FINISH);
}

/**
 * Handles the uniqueSegmentPieceTag operation used by high-level StarMade object modelling.
 *
 * @param piece - Input value for the uniqueSegmentPieceTag operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the quarterTypeName operation used by high-level StarMade object modelling.
 *
 * @param type - Input value for the quarterTypeName operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the managerModuleKind operation used by high-level StarMade object modelling.
 *
 * @param tagId - Input value for the managerModuleKind operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the tagTypeName operation used by high-level StarMade object modelling.
 *
 * @param type - Input value for the tagTypeName operation.
 * @returns The computed StarMade-Decoder value.
 */
function tagTypeName(type: TagType): string {
  return TAG_TYPE_NAMES[type] ?? TagType[type] ?? String(type);
}

/**
 * Handles the matrix4fFromTag operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the matrix4fFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the matrix4fFromArray operation used by high-level StarMade object modelling.
 *
 * @param values - Input value for the matrix4fFromArray operation.
 * @returns The computed StarMade-Decoder value.
 */
function matrix4fFromArray(values: EntMatrix4f): Matrix4f {
  return new Matrix4f(
    values[0], values[1], values[2], values[3],
    values[4], values[5], values[6], values[7],
    values[8], values[9], values[10], values[11],
    values[12], values[13], values[14], values[15],
  );
}

/**
 * Handles the rebuildContainerTag operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the rebuildContainerTag operation.
 * @param children - Input value for the rebuildContainerTag operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the replaceChild operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the replaceChild operation.
 * @param index - Input value for the replaceChild operation.
 * @param replacement - Input value for the replaceChild operation.
 * @returns The computed StarMade-Decoder value.
 */
function replaceChild(tag: Tag, index: number, replacement: Tag): Tag {
  const children = tagChildren(tag);
  while (children.length <= index) children.push(Tags.nothing(null));
  const current = children[index];
  children[index] = current && replacement.name === null
    ? new Tag(replacement.type, current.name, replacement.value, replacement.listType ?? undefined)
    : replacement;
  return rebuildContainerTag(tag.type === TagType.STRUCT || tag.type === TagType.LIST ? tag : Tags.struct(tag.name, []), children);
}

/**
 * Handles the coerceTagValue operation used by high-level StarMade object modelling.
 *
 * @param current - Input value for the coerceTagValue operation.
 * @param value - Input value for the coerceTagValue operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the vector3FromValue operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the vector3FromValue operation.
 * @param key - Input value for the vector3FromValue operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the vector4FromValue operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the vector4FromValue operation.
 * @param key - Input value for the vector4FromValue operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the vector3iFromTag operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the vector3iFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function vector3iFromTag(tag: Tag | undefined): EntVector3i | null {
  if (tag?.type !== TagType.VECTOR3i) return null;
  const v = tag.getVector3i();
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Handles the vector3fFromTag operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the vector3fFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function vector3fFromTag(tag: Tag | undefined): EntVector3f | null {
  if (tag?.type !== TagType.VECTOR3f) return null;
  const v = tag.getVector3f();
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Handles the vector4fFromTag operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the vector4fFromTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function vector4fFromTag(tag: Tag | undefined): EntVector4f | null {
  if (tag?.type !== TagType.VECTOR4f) return null;
  const v = tag.getVector4f();
  return { x: v.x, y: v.y, z: v.z, w: v.w };
}

/**
 * Parses ScanEntityData for high-level StarMade object modelling.
 *
 * @param tag - Input value for the parseScanEntityData operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseScanEntityData(tag: Tag): ScanEntityData {
  const fields = tagChildren(tag);
  return {
    name: fields[0]?.type === TagType.STRING ? fields[0].getString() : '',
    sector: vector3iFromTag(fields[1]) ?? { x: 0, y: 0, z: 0 },
    factionId: fields[2]?.type === TagType.INT ? fields[2].getInt() : 0,
    controllerInfo: fields[3]?.type === TagType.STRING ? fields[3].getString() : '',
  };
}

/**
 * Handles the scanEntityDataToTag operation used by high-level StarMade object modelling.
 *
 * @param data - Input value for the scanEntityDataToTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function scanEntityDataToTag(data: ScanEntityData): Tag {
  return Tags.struct(null, [
    Tags.string(null, data.name),
    Tags.vector3i(null, data.sector.x, data.sector.y, data.sector.z),
    Tags.int(null, data.factionId),
    Tags.string(null, data.controllerInfo),
  ]);
}

/**
 * Parses ScanResourceData for high-level StarMade object modelling.
 *
 * @param tag - Input value for the parseScanResourceData operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Handles the scanResourceDataToTag operation used by high-level StarMade object modelling.
 *
 * @param data - Input value for the scanResourceDataToTag operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Reads Int32BE from the StarMade binary representation.
 *
 * @param bytes - Input value for the readInt32BE operation.
 * @param offset - Input value for the readInt32BE operation.
 * @returns The computed StarMade-Decoder value.
 */
function readInt32BE(bytes: Uint8Array, offset: number): number {
  const unsigned = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

/**
 * Writes Int32BE to the StarMade binary representation.
 *
 * @param bytes - Input value for the writeInt32BE operation.
 * @param offset - Input value for the writeInt32BE operation.
 * @param value - Input value for the writeInt32BE operation.
 */
function writeInt32BE(bytes: Uint8Array, offset: number, value: number): void {
  const unsigned = value >>> 0;
  bytes[offset] = (unsigned >>> 24) & 0xff;
  bytes[offset + 1] = (unsigned >>> 16) & 0xff;
  bytes[offset + 2] = (unsigned >>> 8) & 0xff;
  bytes[offset + 3] = unsigned & 0xff;
}

/**
 * Reads Int64BE from the StarMade binary representation.
 *
 * @param bytes - Input value for the readInt64BE operation.
 * @param offset - Input value for the readInt64BE operation.
 * @returns The computed StarMade-Decoder value.
 */
function readInt64BE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value > 0x7fffffffffffffffn ? value - 0x10000000000000000n : value;
}

/**
 * Writes Int64BE to the StarMade binary representation.
 *
 * @param bytes - Input value for the writeInt64BE operation.
 * @param offset - Input value for the writeInt64BE operation.
 * @param value - Input value for the writeInt64BE operation.
 */
function writeInt64BE(bytes: Uint8Array, offset: number, value: bigint | number): void {
  let unsigned = typeof value === 'number' ? BigInt(value) : value;
  if (unsigned < 0) unsigned += 0x10000000000000000n;
  for (let i = 7; i >= 0; i--) {
    bytes[offset + i] = Number(unsigned & 0xffn);
    unsigned >>= 8n;
  }
}

/**
 * Reads Int64ListPayload from the StarMade binary representation.
 *
 * @param bytes - Input value for the readInt64ListPayload operation.
 * @returns The computed StarMade-Decoder value.
 */
function readInt64ListPayload(bytes: Uint8Array): bigint[] {
  if (bytes.length < 4) return [];
  const count = Math.max(0, readInt32BE(bytes, 0));
  const values: bigint[] = [];
  for (let index = 0; index < count && 4 + index * 8 + 8 <= bytes.length; index++) {
    values.push(readInt64BE(bytes, 4 + index * 8));
  }
  return values;
}

/**
 * Writes Int64ListPayload to the StarMade binary representation.
 *
 * @param values - Input value for the writeInt64ListPayload operation.
 * @returns The computed StarMade-Decoder value.
 */
function writeInt64ListPayload(values: readonly (bigint | number)[]): Uint8Array {
  const bytes = new Uint8Array(4 + values.length * 8);
  writeInt32BE(bytes, 0, values.length);
  values.forEach((value, index) => writeInt64BE(bytes, 4 + index * 8, value));
  return bytes;
}
