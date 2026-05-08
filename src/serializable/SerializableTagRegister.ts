/**
 * @fileoverview Serializable Tag Register
 *
 * Implements StarMade SERIALIZABLE tag factories and registration helpers for typed binary payloads.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SerializableTagRegister — port of the matching Java class.
 *
 * Registry indexed by factoryId. It must be populated before reading
 * SERIALIZABLE tags. Empty by default (null entries).
 */

import type { SerializableTagFactory } from './SerializableTagFactory.js';

export class SerializableTagRegister {
  static readonly register: (SerializableTagFactory | null)[] = new Array(16).fill(null);

  static set(id: number, factory: SerializableTagFactory): void {
    SerializableTagRegister.register[id] = factory;
  }
}
