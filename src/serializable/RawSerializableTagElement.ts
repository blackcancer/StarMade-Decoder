/**
 * @fileoverview Raw Serializable Tag Element
 *
 * Implements StarMade SERIALIZABLE tag factories and registration helpers for typed binary payloads.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * RawSerializableTagElement — opaque SERIALIZABLE implementation.
 *
 * Stores the raw bytes read from the stream after the factoryId.
 * Allows perfect round-tripping without implementing complex factories.
 *
 * To interpret the actual data, dedicated factories must be implemented
 * specific (ControlElementMap, ElementCountMap, NPCFactionNewsEvent, etc.)
 */

import type { SerializableTagElement } from './SerializableTagElement.js';
import type { BufferWriter } from '../core/BufferWriter.js';

/**
 * Represents the RawSerializableTagElement model used by StarMade SERIALIZABLE payload handling.
 */
export class RawSerializableTagElement implements SerializableTagElement {
  readonly factoryId: number;
  readonly rawBytes: Uint8Array;

  /**
   * Creates a RawSerializableTagElement instance.
   *
   * @param factoryId - Input value for the constructor operation.
   * @param rawBytes - Input value for the constructor operation.
   */
  constructor(factoryId: number, rawBytes: Uint8Array) {
    this.factoryId = factoryId;
    this.rawBytes  = rawBytes;
  }

  /**
   * Returns FactoryId.
   *
   * @returns The computed StarMade-Decoder value.
   */
  getFactoryId(): number {
    return this.factoryId;
  }

  /**
   * Writes ToTag to the StarMade binary representation.
   *
   * @param writer - Input value for the writeToTag operation.
   */
  writeToTag(writer: BufferWriter): void {
    writer.writeBytes(this.rawBytes);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `RawSerializable(factoryId=${this.factoryId}, ${this.rawBytes.length} bytes)`;
  }
}
