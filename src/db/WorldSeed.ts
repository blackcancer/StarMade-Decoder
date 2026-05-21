/**
 * @fileoverview World seed file parser
 *
 * Handles server-database/<world>/.seed. StarMade reads and writes this file
 * with Java DataInput/DataOutput long methods, so the payload is exactly one
 * signed 64-bit big-endian integer.
 */

import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';

/**
 * Describes the WorldSeedFile data shape used by StarMade database object parsing.
 */
export interface WorldSeedFile {
  seed: bigint;
}

/**
 * Parses WorldSeed for StarMade database object parsing.
 *
 * @param data - Input value for the parseWorldSeed operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseWorldSeed(data: Buffer | Uint8Array): WorldSeedFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length !== 8) {
    throw new Error(`Invalid world seed size: expected 8 bytes, got ${buf.length}`);
  }
  return { seed: BufferReader.from(buf).readInt64BE() };
}

/**
 * Writes WorldSeed to the StarMade binary representation.
 *
 * @param file - Input value for the writeWorldSeed operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writeWorldSeed(file: WorldSeedFile | bigint | number): Buffer {
  const seed = typeof file === 'object' ? file.seed : BigInt(file);
  const w = new BufferWriter();
  w.writeInt64BE(seed);
  return w.toBuffer();
}
