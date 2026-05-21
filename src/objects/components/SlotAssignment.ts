/**
 * @fileoverview Slot Assignment
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SlotAssignment — block assignment to control slots.
 *
 * Port of SlotAssignment.fromTagStructure() Java.
 *
 * Structure Tag :
 *   STRUCT [
 *     [0] BYTE    version
 *     [1] STRUCT  entries [
 *       STRUCT [BYTE slot, LONG blockPos, FINISH]
 *       ...
 *       FINISH
 *     ]
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';

/**
 * Represents the SlotAssignment model used by high-level entity component modelling.
 */
export class SlotAssignment {
  /**
   * Creates a SlotAssignment instance.
   *
   * @param version - Input value for the constructor operation.
   * @param slots - Input value for the constructor operation.
   */
  constructor(
    readonly version: number,
    /** Map<slot (0-9), blockPosIndex> */
    readonly slots: ReadonlyMap<number, bigint>,
  ) {}

  static EMPTY = new SlotAssignment(0, new Map());

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): SlotAssignment {
    const top = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = top[0]?.type === TagType.BYTE ? top[0].getByte() : 0;
    const slots = new Map<number, bigint>();

    if (top[1]?.type === TagType.STRUCT) {
      for (const entry of top[1].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (entry.type !== TagType.STRUCT) continue;
        const v = entry.getStruct().filter(t => t.type !== TagType.FINISH);
        const slot = v[0]?.type === TagType.BYTE ? v[0].getByte() : -1;
        const pos  = v[1]?.type === TagType.LONG ? v[1].getLong() : 0n;
        if (slot >= 0) slots.set(slot, pos);
      }
    }

    return new SlotAssignment(version, slots);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const entryTags: Tag[] = [];
    for (const [slot, pos] of this.slots) {
      entryTags.push(Tags.struct(null, [
        Tags.byte(null, slot),
        Tags.long(null, pos),
      ]));
    }
    entryTags.push(FINISH_TAG);

    return Tags.struct(null, [
      Tags.byte(null, this.version),
      new Tag(TagType.STRUCT, null, entryTags),
    ]);
  }

  /**
   * Handles the assign operation used by high-level entity component modelling.
   *
   * @param slot - Input value for the assign operation.
   * @param blockPos - Input value for the assign operation.
   * @returns The computed StarMade-Decoder value.
   */
  assign(slot: number, blockPos: bigint): SlotAssignment {
    if (slot < 0 || slot > 9) throw new RangeError(`SlotAssignment: slot ${slot} hors limites (0-9)`);
    const m = new Map(this.slots);
    m.set(slot, blockPos);
    return new SlotAssignment(this.version, m);
  }

  /**
   * Handles the unassign operation used by high-level entity component modelling.
   *
   * @param slot - Input value for the unassign operation.
   * @returns The computed StarMade-Decoder value.
   */
  unassign(slot: number): SlotAssignment {
    const m = new Map(this.slots);
    m.delete(slot);
    return new SlotAssignment(this.version, m);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `SlotAssignment(${this.slots.size} slots)`;
  }
}
