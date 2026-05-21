/**
 * @fileoverview Hp State
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * HpState — health state of a StarMade entity.
 *
 * Port of SegmentControllerHpController.fromTagStructure() Java.
 *
 * Structure Tag :
 *   STRUCT [
 *     [0] BYTE   classId  (0=INT, 1=LONG)
 *     [1] STRUCT values [
 *       [0] LONG|INT hp
 *       [1] LONG|INT maxHp
 *       [2] LONG|INT armorHp   (optionnel)
 *       [3] LONG|INT maxArmorHp (optionnel)
 *       [4] LONG rebootStarted
 *       [5] LONG rebootTime
 *       [6] SERIALIZABLE currentHPMatch (ElementCountMap)
 *       [7] BYTE rebootRecover
 *     ]
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';

/**
 * Represents the HpState model used by high-level entity component modelling.
 */
export class HpState {
  static readonly CLASS_INT  = 0;
  static readonly CLASS_LONG = 1;

  /**
   * Creates a HpState instance.
   *
   * @param classId - Input value for the constructor operation.
   * @param hp - Input value for the constructor operation.
   * @param maxHp - Input value for the constructor operation.
   * @param armorHp - Input value for the constructor operation.
   * @param maxArmorHp - Input value for the constructor operation.
   * @param rebootStarted - Input value for the constructor operation.
   * @param rebootTime - Input value for the constructor operation.
   * @param rebootRecover - Input value for the constructor operation.
   */
  constructor(
    readonly classId: number,
    readonly hp: bigint,
    readonly maxHp: bigint,
    readonly armorHp: bigint,
    readonly maxArmorHp: bigint,
    readonly rebootStarted: bigint,
    readonly rebootTime: bigint,
    readonly rebootRecover: boolean,
  ) {}

  static EMPTY = new HpState(HpState.CLASS_INT, 0n, 0n, 0n, 0n, 0n, 0n, false);

  /**
   * Reports whether isAlive is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isAlive(): boolean { return this.hp > 0n; }
  /**
   * Handles the hpPercent operation used by high-level entity component modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hpPercent(): number {
    if (this.maxHp === 0n) return 100;
    return Number(this.hp * 100n / this.maxHp);
  }
  /**
   * Reports whether isRebooting is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isRebooting(): boolean { return this.rebootStarted > 0n; }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): HpState {
    const top = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const classId  = top[0]?.type === TagType.BYTE   ? top[0].getByte() : HpState.CLASS_INT;
    const useLong  = classId === HpState.CLASS_LONG;
    const values   = top[1]?.type === TagType.STRUCT
      ? top[1].getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const readHp = (t: Tag | undefined): bigint => {
      if (!t) return 0n;
      if (t.type === TagType.LONG) return t.getLong();
      if (t.type === TagType.INT)  return BigInt(t.getInt());
      return 0n;
    };

    return new HpState(
      classId,
      readHp(values[0]),
      readHp(values[1]),
      readHp(values[2]),
      readHp(values[3]),
      values[4]?.type === TagType.LONG ? values[4].getLong() : 0n,
      values[5]?.type === TagType.LONG ? values[5].getLong() : 0n,
      values.length > 7 && values[7]?.type === TagType.BYTE ? values[7].getByte() !== 0 : false,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const useLong = this.classId === HpState.CLASS_LONG;
    const makeHp  = (v: bigint): Tag => useLong
      ? Tags.long(null, v)
      : Tags.int(null, Number(v));

    const valueChildren: Tag[] = [
      makeHp(this.hp),
      makeHp(this.maxHp),
      makeHp(this.armorHp),
      makeHp(this.maxArmorHp),
      Tags.long(null, this.rebootStarted),
      Tags.long(null, this.rebootTime),
      // [6] ElementCountMap placeholder (SERIALIZABLE) — omitted when empty
      Tags.byte(null, this.rebootRecover ? 1 : 0),
    ];

    return Tags.struct(null, [
      Tags.byte(null, this.classId),
      Tags.struct(null, valueChildren),
    ]);
  }

  /**
   * Returns a copy updated with Hp.
   *
   * @param hp - Input value for the withHp operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHp(hp: bigint): HpState {
    return new HpState(this.classId, hp, this.maxHp, this.armorHp, this.maxArmorHp,
      this.rebootStarted, this.rebootTime, this.rebootRecover);
  }

  /**
   * Returns a copy updated with MaxHp.
   *
   * @param maxHp - Input value for the withMaxHp operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMaxHp(maxHp: bigint): HpState {
    return new HpState(this.classId, this.hp, maxHp, this.armorHp, this.maxArmorHp,
      this.rebootStarted, this.rebootTime, this.rebootRecover);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `HpState(hp=${this.hp}/${this.maxHp}, armor=${this.armorHp}/${this.maxArmorHp}, rebooting=${this.isRebooting})`;
  }
}
