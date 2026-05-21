/**
 * @fileoverview StarMade .ent high-level field views
 *
 * These views are aligned with StarMade-Open toTagStructure()/fromTagStructure()
 * slot order. They intentionally expose plain JS values instead of raw Tag
 * instances, so callers can inspect every stored .ent element without depending
 * on the low-level tag tree.
 */

import { Tag } from '../core/Tag.js';
import { TagType, TAG_TYPE_NAMES } from '../core/TagType.js';
import type { TagValue } from '../core/Tag.js';
import { RawElement } from '../serializable/Factories.js';
import { decodeSerializable } from './Serializables.js';

/**
 * Describes the EntityFieldSchemaEntry data shape used by high-level StarMade object modelling.
 */
export interface EntityFieldSchemaEntry {
  readonly key: string;
  readonly description?: string;
}

/**
 * Describes the SerializableFieldValue data shape used by high-level StarMade object modelling.
 */
export interface SerializableFieldValue {
  readonly factoryId: number;
  readonly factoryName: string;
  readonly byteLength: number;
  readonly decoded: unknown;
}

/**
 * Describes the ByteArrayFieldValue data shape used by high-level StarMade object modelling.
 */
export interface ByteArrayFieldValue {
  readonly byteLength: number;
  readonly hexPreview: string;
}

/**
 * Defines the EntityFieldValue type used by high-level StarMade object modelling.
 */
export type EntityFieldValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly EntityFieldValue[]
  | { readonly [key: string]: EntityFieldValue }
  | SerializableFieldValue
  | ByteArrayFieldValue;

/**
 * Describes the EntityFieldView data shape used by high-level StarMade object modelling.
 */
export interface EntityFieldView {
  readonly index: number;
  readonly key: string;
  readonly description?: string;
  readonly tagName: string | null;
  readonly tagType: string;
  readonly present: boolean;
  readonly value: EntityFieldValue;
}

/**
 * Defines the EntityFieldSchema type used by high-level StarMade object modelling.
 */
export type EntityFieldSchema = readonly EntityFieldSchemaEntry[];
/**
 * Defines the EntityFieldSetter type used by high-level StarMade object modelling.
 */
export type EntityFieldSetter<TParent> = (value: unknown, field: EntityField<TParent>) => TParent;
/**
 * Defines the EntityFieldSetterMap type used by high-level StarMade object modelling.
 */
export type EntityFieldSetterMap<TParent> = Readonly<Record<string, EntityFieldSetter<TParent>>>;

/**
 * High-level .ent field object.
 *
 * The field carries only display-safe values. When a setter is attached by an
 * owning entity, withValue()/setValue() returns a new immutable owner instance.
 */
export class EntityField<TParent = never> implements EntityFieldView {
  readonly index: number;
  readonly key: string;
  readonly description?: string;
  readonly tagName: string | null;
  readonly tagType: string;
  readonly present: boolean;
  readonly value: EntityFieldValue;

  private readonly _setter?: EntityFieldSetter<TParent>;

  /**
   * Creates a EntityField instance.
   *
   * @param view - Input value for the constructor operation.
   * @param setter - Input value for the constructor operation.
   */
  constructor(view: EntityFieldView, setter?: EntityFieldSetter<TParent>) {
    this.index = view.index;
    this.key = view.key;
    this.description = view.description;
    this.tagName = view.tagName;
    this.tagType = view.tagType;
    this.present = view.present;
    this.value = view.value;
    Object.defineProperty(this, '_setter', { value: setter, enumerable: false });
  }

  /**
   * Reports whether canSet is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get canSet(): boolean {
    return typeof this._setter === 'function';
  }

  /**
   * Returns a copy updated with Value.
   *
   * @param value - Input value for the withValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  withValue(value: unknown): TParent {
    if (!this._setter) {
      throw new TypeError(`Entity field "${this.key}" is read-only in this high-level object`);
    }
    return this._setter(value, this);
  }

  /**
   * Stores Value.
   *
   * @param value - Input value for the setValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  setValue(value: unknown): TParent {
    return this.withValue(value);
  }

  /**
   * Builds a JSON-safe representation of this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toJSON(): EntityFieldView & { readonly canSet: boolean } {
    return {
      index: this.index,
      key: this.key,
      description: this.description,
      tagName: this.tagName,
      tagType: this.tagType,
      present: this.present,
      value: this.value,
      canSet: this.canSet,
    };
  }
}

/**
 * Defines TRANSFORMABLE_FIELD_SCHEMA for high-level StarMade object modelling.
 */
export const TRANSFORMABLE_FIELD_SCHEMA: EntityFieldSchema = [
  { key: 'mass', description: 'SimpleTransformableSendableObject mass' },
  { key: 'transform', description: 'OpenGL Matrix4f transform list' },
  { key: 'aiConfiguration', description: 'AI configuration or noAI byte' },
  { key: 'sectorPosition', description: 'Current sector position (sPos)' },
  { key: 'factionId', description: 'Faction id (fid)' },
  { key: 'owner', description: 'Owning player name (own)' },
  { key: 'spawnController', description: 'Spawn markers/controller state' },
];

/**
 * Defines PLAYER_CHARACTER_FIELD_SCHEMA for high-level StarMade object modelling.
 */
export const PLAYER_CHARACTER_FIELD_SCHEMA: EntityFieldSchema = [
  { key: 'id', description: 'Player character entity id' },
  { key: 'speed', description: 'Movement speed' },
  { key: 'stepHeight', description: 'Step height' },
  { key: 'transformable', description: 'SimpleTransformableSendableObject payload' },
];

/**
 * Defines PLAYER_STATE_FIELD_SCHEMA for high-level StarMade object modelling.
 */
export const PLAYER_STATE_FIELD_SCHEMA: EntityFieldSchema = [
  { key: 'credits' },
  { key: 'spawnData' },
  { key: 'inventory' },
  { key: 'legacyDeathSpawnSector' },
  { key: 'logoutLocalPosition' },
  { key: 'logoutSector' },
  { key: 'factionMembership' },
  { key: 'lastLogin' },
  { key: 'lastLogout' },
  { key: 'hostHistory' },
  { key: 'creativeMode' },
  { key: 'lastEnteredEntity' },
  { key: 'testSector' },
  { key: 'helmetSlot' },
  { key: 'playerAiManager' },
  { key: 'personalSector' },
  { key: 'capsuleInventory' },
  { key: 'microInventory' },
  { key: 'macroInventory' },
  { key: 'lastDeathNotSuicide' },
  { key: 'scanHistory' },
  { key: 'factionPointProtected' },
  { key: 'inventoryBackup' },
  { key: 'savedCoordinates' },
  { key: 'preTutorialTransformPlaceholder' },
  { key: 'preTutorialSectorPlaceholder' },
  { key: 'ignoredPlayers' },
  { key: 'health' },
  { key: 'cargoInventoryBlock' },
  { key: 'infiniteInventoryVolume' },
  { key: 'mineAutoArmSecs' },
];

/**
 * Defines SEGMENT_CONTROLLER_FIELD_SCHEMA for high-level StarMade object modelling.
 */
export const SEGMENT_CONTROLLER_FIELD_SCHEMA: EntityFieldSchema = [
  { key: 'uniqueId' },
  { key: 'minPos' },
  { key: 'maxPos' },
  { key: 'dockingController' },
  { key: 'controlElementMap' },
  { key: 'realName' },
  { key: 'transformable' },
  { key: 'managerContainer' },
  { key: 'creatorId' },
  { key: 'spawner' },
  { key: 'lastModifier' },
  { key: 'seed' },
  { key: 'touched' },
  { key: 'extraTagData' },
  { key: 'npcData' },
  { key: 'textBlocksOrScrap' },
  { key: 'vulnerable' },
  { key: 'minable' },
  { key: 'factionRights' },
  { key: 'railController' },
  { key: 'nonEmptySegments' },
  { key: 'hpController' },
  { key: 'coreTimer' },
  { key: 'virtualBlueprint' },
  { key: 'blueprintInfo' },
  { key: 'currentOwnerLowerCase' },
  { key: 'lastDockerPlayerLowerCase' },
  { key: 'classification' },
  { key: 'itemsToSpawnWith' },
  { key: 'spawnedInDatabaseAsChunk16' },
  { key: 'factionSetFromBlueprint' },
  { key: 'deprecatedPullPermission' },
  { key: 'lastAsked' },
  { key: 'lastAllowed' },
  { key: 'usedOldPower' },
  { key: 'oldPowerBlocks' },
  { key: 'blockKillRecorder' },
  { key: 'lastEditBlocks' },
  { key: 'lastDamageTaken' },
  { key: 'lastAdminCheckFlag' },
  { key: 'tagVersion' },
  { key: 'quarterManager' },
];

/**
 * Defines MANAGER_CONTAINER_FIELD_SCHEMA for high-level StarMade object modelling.
 */
export const MANAGER_CONTAINER_FIELD_SCHEMA: EntityFieldSchema = [
  { key: 'inventories' },
  { key: 'distribution' },
  { key: 'powerAddOn' },
  { key: 'shieldAddOn' },
  { key: 'extra' },
  { key: 'activationStates' },
  { key: 'texts' },
  { key: 'relevantElementCountMap' },
  { key: 'warpGateInfo' },
  { key: 'modules' },
  { key: 'aiConfiguration' },
  { key: 'slotAssignment' },
  { key: 'raceGateInfo' },
  { key: 'unloadedDummies' },
  { key: 'moduleExplosions' },
  { key: 'powerReactor' },
  { key: 'pullPermission' },
  { key: 'modData' },
];

/**
 * Builds EntityFieldViews for high-level StarMade object modelling.
 *
 * @param tags - Input value for the buildEntityFieldViews operation.
 * @param schema - Input value for the buildEntityFieldViews operation.
 * @returns The computed StarMade-Decoder value.
 */
export function buildEntityFieldViews(
  tags: readonly Tag[],
  schema: EntityFieldSchema
): EntityField[] {
  return buildEditableEntityFields(tags, schema);
}

/**
 * Builds EditableEntityFields for high-level StarMade object modelling.
 *
 * @param tags - Input value for the buildEditableEntityFields operation.
 * @param schema - Input value for the buildEditableEntityFields operation.
 * @param setters - Input value for the buildEditableEntityFields operation.
 * @returns The computed StarMade-Decoder value.
 */
export function buildEditableEntityFields<TParent = never>(
  tags: readonly Tag[],
  schema: EntityFieldSchema,
  setters: EntityFieldSetterMap<TParent> = {}
): EntityField<TParent>[] {
  const limit = Math.max(tags.length, schema.length);
  const views: EntityField<TParent>[] = [];
  for (let index = 0; index < limit; index++) {
    const spec = schema[index] ?? { key: `field${index}` };
    const view = toEntityFieldView(index, spec, tags[index]);
    views.push(new EntityField(view, setters[view.key]));
  }
  return views;
}

/**
 * Converts this value to EntityFieldView.
 *
 * @param index - Input value for the toEntityFieldView operation.
 * @param spec - Input value for the toEntityFieldView operation.
 * @param tag - Input value for the toEntityFieldView operation.
 * @returns The computed StarMade-Decoder value.
 */
export function toEntityFieldView(
  index: number,
  spec: EntityFieldSchemaEntry,
  tag: Tag | undefined
): EntityFieldView {
  if (!tag || tag.type === TagType.FINISH) {
    return {
      index,
      key: spec.key,
      description: spec.description,
      tagName: null,
      tagType: tag ? tagTypeName(tag.type) : 'MISSING',
      present: false,
      value: null,
    };
  }

  return {
    index,
    key: spec.key,
    description: spec.description,
    tagName: tag.name,
    tagType: tagTypeName(tag.type),
    present: true,
    value: tagValueToFieldValue(tag),
  };
}

/**
 * Handles the tagValueToFieldValue operation used by high-level StarMade object modelling.
 *
 * @param tag - Input value for the tagValueToFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
export function tagValueToFieldValue(tag: Tag): EntityFieldValue {
  switch (tag.type) {
    case TagType.BYTE:
      return tag.getByte();
    case TagType.SHORT:
      return tag.getShort();
    case TagType.INT:
      return tag.getInt();
    case TagType.LONG:
      return tag.getLong();
    case TagType.FLOAT:
      return tag.getFloat();
    case TagType.DOUBLE:
      return tag.getDouble();
    case TagType.STRING:
      return tag.getString();
    case TagType.VECTOR3i: {
      const v = tag.getVector3i();
      return { x: v.x, y: v.y, z: v.z };
    }
    case TagType.VECTOR3f: {
      const v = tag.getVector3f();
      return { x: v.x, y: v.y, z: v.z };
    }
    case TagType.VECTOR3b: {
      const v = tag.getVector3b();
      return { x: v.x, y: v.y, z: v.z };
    }
    case TagType.VECTOR4f: {
      const v = tag.getVector4f();
      return { x: v.x, y: v.y, z: v.z, w: v.w };
    }
    case TagType.MATRIX3f: {
      const m = tag.getMatrix3f();
      return [
        m.m00, m.m01, m.m02,
        m.m10, m.m11, m.m12,
        m.m20, m.m21, m.m22,
      ];
    }
    case TagType.MATRIX4f: {
      const m = tag.getMatrix4f();
      return [
        m.m00, m.m01, m.m02, m.m03,
        m.m10, m.m11, m.m12, m.m13,
        m.m20, m.m21, m.m22, m.m23,
        m.m30, m.m31, m.m32, m.m33,
      ];
    }
    case TagType.BYTE_ARRAY: {
      const bytes = tag.getByteArray();
      return {
        byteLength: bytes.length,
        hexPreview: Buffer.from(bytes).subarray(0, 64).toString('hex'),
      };
    }
    case TagType.SERIALIZABLE:
      return serializableToFieldValue(tag.value);
    case TagType.STRUCT:
    case TagType.LIST:
      return (tag.value as Tag[])
        .filter(child => child.type !== TagType.FINISH)
        .map((child, index) => toEntityFieldView(index, {
          key: child.name ?? `field${index}`,
        }, child).value);
    case TagType.NOTHING:
    case TagType.FINISH:
      return null;
    default:
      return primitiveFallback(tag.value);
  }
}

/**
 * Handles the serializableToFieldValue operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the serializableToFieldValue operation.
 * @returns The computed StarMade-Decoder value.
 */
function serializableToFieldValue(value: TagValue): SerializableFieldValue {
  const raw = value instanceof RawElement
    ? value
    : new RawElement(-1, new Uint8Array());
  let decoded: unknown = null;
  try {
    decoded = decodeSerializable(raw);
  } catch {
    decoded = null;
  }
  return {
    factoryId: raw.factoryId,
    factoryName: serializableFactoryName(raw.factoryId),
    byteLength: raw.raw.length,
    decoded: decoded instanceof RawElement ? null : decoded,
  };
}

/**
 * Handles the primitiveFallback operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the primitiveFallback operation.
 * @returns The computed StarMade-Decoder value.
 */
function primitiveFallback(value: TagValue): EntityFieldValue {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string'
  ) {
    return value;
  }
  return String(value);
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
 * Handles the serializableFactoryName operation used by high-level StarMade object modelling.
 *
 * @param factoryId - Input value for the serializableFactoryName operation.
 * @returns The computed StarMade-Decoder value.
 */
function serializableFactoryName(factoryId: number): string {
  switch (factoryId) {
    case 0: return 'ControlElementMapper';
    case 1: return 'ElementCountMap';
    case 2: return 'NPCFactionNewsEvent';
    case 3: return 'LongSet';
    case 4: return 'BlockBuffer';
    case 5: return 'Long2Vector3fMap';
    case 6: return 'Long2TransformMap';
    default: return `Factory${factoryId}`;
  }
}

/**
 * Handles the fieldValueAsNumber operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the fieldValueAsNumber operation.
 * @param key - Input value for the fieldValueAsNumber operation.
 * @returns The computed StarMade-Decoder value.
 */
export function fieldValueAsNumber(value: unknown, key: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new TypeError(`Entity field "${key}" expects a finite number`);
}

/**
 * Handles the fieldValueAsInteger operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the fieldValueAsInteger operation.
 * @param key - Input value for the fieldValueAsInteger operation.
 * @returns The computed StarMade-Decoder value.
 */
export function fieldValueAsInteger(value: unknown, key: string): number {
  const number = fieldValueAsNumber(value, key);
  if (!Number.isInteger(number)) {
    throw new TypeError(`Entity field "${key}" expects an integer`);
  }
  return number;
}

/**
 * Handles the fieldValueAsBigInt operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the fieldValueAsBigInt operation.
 * @param key - Input value for the fieldValueAsBigInt operation.
 * @returns The computed StarMade-Decoder value.
 */
export function fieldValueAsBigInt(value: unknown, key: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && value.trim() !== '') return BigInt(value);
  throw new TypeError(`Entity field "${key}" expects an integer bigint value`);
}

/**
 * Handles the fieldValueAsString operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the fieldValueAsString operation.
 * @param key - Input value for the fieldValueAsString operation.
 * @returns The computed StarMade-Decoder value.
 */
export function fieldValueAsString(value: unknown, key: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  throw new TypeError(`Entity field "${key}" expects a string`);
}

/**
 * Handles the fieldValueAsBoolean operation used by high-level StarMade object modelling.
 *
 * @param value - Input value for the fieldValueAsBoolean operation.
 * @param key - Input value for the fieldValueAsBoolean operation.
 * @returns The computed StarMade-Decoder value.
 */
export function fieldValueAsBoolean(value: unknown, key: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  throw new TypeError(`Entity field "${key}" expects a boolean`);
}
