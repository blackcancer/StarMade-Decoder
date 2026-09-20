/** @fileoverview Validated signed-int64 world seeds with byte and JSON representations. */
import { DecodeError } from '../core/DecodeError.js';
import { formatBytes, formatLimits, type FormatLimits } from '../core/FormatLimits.js';
import { parseWorldSeed, writeWorldSeed, type WorldSeedFile } from './WorldSeed.js';

/** Immutable .seed value; the wire representation contains exactly one signed int64. */
export class WorldSeedDocument implements WorldSeedFile {
  private readonly limits: Required<FormatLimits>;
  /** Creates an exact seed without accepting imprecise JavaScript numbers. */
  constructor(readonly seed: bigint, options: FormatLimits = {}) {
    this.limits = formatLimits(options);
    if (typeof seed !== 'bigint' || seed < -0x8000000000000000n || seed > 0x7fffffffffffffffn) {
      throw new DecodeError('E_RANGE', 'World seed must be a signed int64 bigint');
    }
    this.toBuffer(); Object.freeze(this);
  }
  /** Parses exactly eight bytes within a caller-selected byte budget. */
  static fromBuffer(input: Uint8Array, options: FormatLimits = {}): WorldSeedDocument {
    return new WorldSeedDocument(parseWorldSeed(formatBytes(input, formatLimits(options))).seed, options);
  }
  /** Returns a new value retaining the caller's limits. */
  withSeed(seed: bigint): WorldSeedDocument { return new WorldSeedDocument(seed, this.limits); }
  /** Returns detached big-endian bytes, identical for equal seed values. */
  toBuffer(): Buffer { return formatBytes(writeWorldSeed(this.seed), this.limits); }
  /** JSON decimal strings retain the full signed 64-bit value. */
  toJSON(): { seed: string } { return { seed: this.seed.toString() }; }
}
