/**
 * @fileoverview Serializable Tag Factory
 *
 * Implements StarMade SERIALIZABLE tag factories and registration helpers for typed binary payloads.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SerializableTagFactory — port of the matching Java interface.
 * A factory reads from a BufferReader and returns a SerializableTagElement.
 */

import type { BufferReader } from '../core/BufferReader.js';
import type { SerializableTagElement } from './SerializableTagElement.js';

/**
 * Describes the SerializableTagFactory data shape used by StarMade SERIALIZABLE payload handling.
 */
export interface SerializableTagFactory {
  /**
   * Builds a value for StarMade SERIALIZABLE payload handling.
   *
   * @param reader - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
  create(reader: BufferReader): SerializableTagElement;
}
