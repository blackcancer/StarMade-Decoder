/** @fileoverview Immutable health state preserving independent integer widths and opaque controller extensions. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { copyTagModel, rememberTagModel, renderTagModel, inheritTagModel, tagModelOptions } from '../../core/TagModel.js';
import { DecodeError } from '../../core/DecodeError.js';
import type { SerializableTagElement } from '../../serializable/SerializableTagElement.js';
import { RawElement } from '../../serializable/Factories.js';
import { ElementCountMap } from '../Serializables.js';

/** Widths concern stored values, not the health-controller class identifier (always 1). */
export interface HpStateOptions extends TagReadOptions { hpType?: TagType.INT | TagType.LONG; armorType?: TagType.INT | TagType.LONG; }
/** All editable persisted health fields; no health or armor values are recalculated. */
export interface HpStateFields {
  hp: bigint; maxHp: bigint; armorHp: bigint; maxArmorHp: bigint;
  rebootStarted: bigint; rebootTime: bigint; rebootRecover: boolean; currentHPMatch: SerializableTagElement;
}
/** Validates signed values before any bigint conversion or narrowing can lose data. */
function integer(value: bigint, type: TagType): Tag {
  const bits = type === TagType.INT ? 32n : 64n;
  if (typeof value !== 'bigint' || value < -(1n << (bits - 1n)) || value >= (1n << (bits - 1n))) throw new DecodeError('E_RANGE', 'Health value exceeds its signed wire width');
  return type === TagType.INT ? Tags.int(null, Number(value)) : Tags.long(null, value);
}
/** Removes the sole validated terminal marker without changing field positions. */
function parts(tag: Tag): Tag[] { return tag.getStruct().filter(t => t.type !== TagType.FINISH); }
/** Health-controller class 1, including historical INT health and optional reboot recovery. */
export class HpState implements HpStateFields {
  /** Legacy constructor selector for INT fields; never a persisted controller class. */
  static readonly CLASS_INT = 0;
  /** Legacy constructor selector for LONG fields; never a persisted controller class. */
  static readonly CLASS_LONG = 1;
  readonly classId = 1;
  readonly hpType: TagType.INT | TagType.LONG;
  readonly armorType: TagType.INT | TagType.LONG;
  #payload: Buffer;
  #values = {};
  #sourced = false;
  #options: TagReadOptions;
  /** The first argument retains the old SDK width selector; explicit widths override it. */
  constructor(width: number, readonly hp: bigint, readonly maxHp: bigint, readonly armorHp: bigint,
    readonly maxArmorHp: bigint, readonly rebootStarted: bigint, readonly rebootTime: bigint,
    readonly rebootRecover: boolean, currentHPMatch: SerializableTagElement = new RawElement(1, new Uint8Array(4)), options: HpStateOptions = {}) {
    if (width !== 0 && width !== 1) throw new DecodeError('E_UNSUPPORTED', 'Unsupported health width selector');
    this.hpType = options.hpType ?? (width === 0 ? TagType.INT : TagType.LONG);
    this.armorType = options.armorType ?? this.hpType;
    if (![TagType.INT, TagType.LONG].includes(this.hpType) || ![TagType.INT, TagType.LONG].includes(this.armorType)) throw new DecodeError('E_FORMAT', 'Health requires INT or LONG pairs');
    if (typeof rebootRecover !== 'boolean' || currentHPMatch.getFactoryId() !== 1) throw new DecodeError('E_FORMAT', 'Health requires a boolean and ElementCountMap');
    this.#options = Object.freeze(tagModelOptions(options));
    this.#payload = writeTo(new Tag(TagType.SERIALIZABLE, null, currentHPMatch), this.#options).subarray(4);
    ElementCountMap.fromRaw(this.#payload, {maxBytes: options.maxInflatedBytes ?? 256 * 1024 * 1024, maxEntries: Math.min(options.maxNodes ?? 1000000, options.maxListLength ?? 1000000)});
    writeTo(Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [...this.fields().values()])]), this.#options); Object.freeze(this);
  }
  /** Fresh immutable empty state using the historical INT constructor selector. */
  static readonly EMPTY = new HpState(HpState.CLASS_INT, 0n, 0n, 0n, 0n, 0n, 0n, false);
  /** Detached serialized block-count payload. */
  get currentHPMatch(): SerializableTagElement { return new RawElement(1, Buffer.from(this.#payload)); }
  /** Whether the stored HP value is positive. */
  get isAlive(): boolean { return this.hp > 0n; }
  /** Integer percentage of stored values, with the historical empty maximum convention. */
  get hpPercent(): number { return this.maxHp === 0n ? 100 : Number(this.hp * 100n / this.maxHp); }
  /** Whether a nonzero positive reboot start is stored. */
  get isRebooting(): boolean { return this.rebootStarted > 0n; }
  /** Reads class 1 with two independent, homogeneous INT/LONG pairs. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): HpState {
    const root = copyTagModel(tag, options), top = parts(root);
    if (top[0]?.type !== TagType.BYTE || top[1]?.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Invalid health controller structure');
    if (top[0].getByte() !== 1) throw new DecodeError('E_UNSUPPORTED', 'Unsupported health controller class');
    const values = parts(top[1]);
    for (const index of [0, 2]) if (![TagType.INT, TagType.LONG].includes(values[index]?.type) || values[index + 1]?.type !== values[index].type) throw new DecodeError('E_FORMAT', 'Invalid health integer pair');
    if (values[4]?.type !== TagType.LONG || values[5]?.type !== TagType.LONG || values[6]?.type !== TagType.SERIALIZABLE || (values[7] && values[7].type !== TagType.BYTE)) throw new DecodeError('E_FORMAT', 'Invalid health reboot or count-map field');
    const result = new HpState(1, ...values.slice(0, 6).map(t => BigInt(t.value as bigint | number)) as [bigint,bigint,bigint,bigint,bigint,bigint],
      values[7] ? values[7].getByte() !== 0 : false, values[6].getSerializable(), {...options, hpType: values[0].type as TagType.INT | TagType.LONG, armorType: values[2].type as TagType.INT | TagType.LONG});
    result.#sourced = true;
    rememberTagModel(result.#values, top[1], result.fields(), result.#options);
    rememberTagModel(result, root, new Map([[1, result.valuesTag()]]), result.#options); return result;
  }
  /** Semantic baseline for positional patching; SERIALIZABLE data is copied on every call. */
  private fields(): Map<number, Tag> {
    return new Map([integer(this.hp, this.hpType), integer(this.maxHp, this.hpType), integer(this.armorHp, this.armorType), integer(this.maxArmorHp, this.armorType),
      integer(this.rebootStarted, TagType.LONG), integer(this.rebootTime, TagType.LONG), new Tag(TagType.SERIALIZABLE, null, this.currentHPMatch), Tags.bool(null, this.rebootRecover)].map((tag, index) => [index, tag]));
  }
  /** Retains names, omitted optional recovery and every nested extension. */
  private valuesTag(): Tag {
    const fields = this.fields(), initial = Tags.struct(null, [...fields.values()]);
    return this.#sourced ? renderTagModel(this.#values, fields, initial, this.#options) : initial;
  }
  /** Returns a detached tree, replacing only explicitly changed values. */
  toTag(): Tag {
    const values = this.valuesTag(), initial = Tags.struct(null, [Tags.byte(null, 1), values]);
    const result = this.#sourced ? renderTagModel(this, new Map([[1, values]]), initial, this.#options) : initial;
    writeTo(result, this.#options); return result;
  }
  /** Edits stored fields while retaining widths and source extensions. */
  with(changes: Partial<HpStateFields>): HpState {
    const f = {hp:this.hp,maxHp:this.maxHp,armorHp:this.armorHp,maxArmorHp:this.maxArmorHp,rebootStarted:this.rebootStarted,rebootTime:this.rebootTime,rebootRecover:this.rebootRecover,currentHPMatch:this.currentHPMatch,...changes};
    const result = new HpState(1,f.hp,f.maxHp,f.armorHp,f.maxArmorHp,f.rebootStarted,f.rebootTime,f.rebootRecover,f.currentHPMatch,{...this.#options,hpType:this.hpType,armorType:this.armorType});
    result.#sourced = this.#sourced;
    inheritTagModel(this.#values, result.#values); inheritTagModel(this, result); result.toTag(); return result;
  }
  /** Edits the persisted current HP only. */
  withHp(hp: bigint): HpState { return this.with({hp}); }
  /** Edits the persisted maximum HP only. */
  withMaxHp(maxHp: bigint): HpState { return this.with({maxHp}); }
  /** Human-readable stored values. */
  toString(): string { return `HpState(hp=${this.hp}/${this.maxHp}, armor=${this.armorHp}/${this.maxArmorHp}, rebooting=${this.isRebooting})`; }
}
