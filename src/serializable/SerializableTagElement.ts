/**
 * @fileoverview Serializable Tag Element
 *
 * Implements StarMade SERIALIZABLE tag factories and registration helpers for typed binary payloads.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SerializableTagElement — port of the matching Java interface.
 *
 * Factory IDs match the Java constants:
 *   CONTROL_ELEMENT_MAPPER = 0
 *   ELEMENT_COUNT_MAP      = 1
 *   NPC_FACTION_NEWS_EVENT = 2
 *   LONG_SET               = 3
 *   BLOCK_BUFFER           = 4
 *   LONG_2_VECTOR3f_MAP    = 5
 *   LONG_2_TRANSFORM_MAP   = 6
 */

import type { BufferWriter } from '../core/BufferWriter.js';

export const FACTORY_IDS = {
  CONTROL_ELEMENT_MAPPER:  0,
  ELEMENT_COUNT_MAP:       1,
  NPC_FACTION_NEWS_EVENT:  2,
  LONG_SET:                3,
  BLOCK_BUFFER:            4,
  LONG_2_VECTOR3f_MAP:     5,
  LONG_2_TRANSFORM_MAP:    6,
} as const;

export interface SerializableTagElement {
  getFactoryId(): number;
  writeToTag(writer: BufferWriter): void;
}
