/**
 * @fileoverview FleetRemotes business object
 *
 * High-level wrapper around FLEETS.SAVED_REMOTES (VARBINARY 1024).
 *
 * Models the savedRemotes HashMap<String, Boolean> from Fleet.java.
 * Stores remote-control toggle states keyed by remote name.
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { decodeFleetRemotes, encodeFleetRemotes, type FleetRemotesDecodeOptions } from './FleetDb.js';
import { DecodeError, type DecodeDiagnostic } from '../core/DecodeError.js';

/**
 * Represents the FleetRemotesObject model used by StarMade database object parsing.
 */
export class FleetRemotesObject {
  readonly remotes: ReadonlyMap<string, boolean>;
  readonly format: 'network' | 'java';
  readonly complete: boolean;
  readonly diagnostics: ReadonlyArray<DecodeDiagnostic>;
  /** Detached bytes of an explicitly incomplete recovery result. */
  readonly raw?: Buffer;

  /**
   * Creates a FleetRemotesObject instance.
   *
   * @param remotes - Input value for the constructor operation.
   * @param raw - Input value for the constructor operation.
   */
  private constructor(remotes: Map<string, boolean>, format: 'network' | 'java' = 'java', complete = true, diagnostics: ReadonlyArray<DecodeDiagnostic> = [], raw?: Buffer) {
    this.remotes = new Map(remotes);
    this.format = format; this.complete = complete; this.diagnostics = diagnostics;
    if (raw) this.raw = Buffer.from(raw);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes FLEETS.SAVED_REMOTES bytes.
   * Supports both the network format and Java ObjectOutputStream format (AC ED).
   * Returns an empty instance for null/empty input.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined, options: FleetRemotesDecodeOptions = {}): FleetRemotesObject {
    const { remotes, format, complete, diagnostics, raw } = decodeFleetRemotes(data, options);
    return new FleetRemotesObject(remotes, format, complete, diagnostics, raw);
  }

  /** Creates an empty FleetRemotesObject. */
  static empty(): FleetRemotesObject {
    return new FleetRemotesObject(new Map());
  }

  /** Creates a FleetRemotesObject from a plain record. */
  static from(entries: Record<string, boolean>): FleetRemotesObject {
    return new FleetRemotesObject(new Map(Object.entries(entries)));
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /** Sets (or adds) a remote state. */
  withRemote(name: string, active: boolean): FleetRemotesObject {
    this.requireComplete();
    const copy = new Map(this.remotes);
    copy.set(name, active);
    return new FleetRemotesObject(copy, this.format);
  }

  /** Toggles a remote. Adds it as active if not present. */
  withToggle(name: string): FleetRemotesObject {
    const current = this.remotes.get(name) ?? false;
    return this.withRemote(name, !current);
  }

  /** Removes a remote. */
  withoutRemote(name: string): FleetRemotesObject {
    this.requireComplete();
    const copy = new Map(this.remotes);
    copy.delete(name);
    return new FleetRemotesObject(copy, this.format);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /**
   * Returns the number of values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get size(): number { return this.remotes.size; }

  /**
   * Reports whether isActive is true for the current value.
   *
   * @param name - Input value for the isActive operation.
   * @returns The computed StarMade-Decoder value.
   */
  isActive(name: string): boolean { return this.remotes.get(name) ?? false; }

  /**
   * Reports whether has is true for the current value.
   *
   * @param name - Input value for the has operation.
   * @returns The computed StarMade-Decoder value.
   */
  has(name: string): boolean { return this.remotes.has(name); }

  /** All active remote names. */
  get activeNames(): string[] {
    return [...this.remotes.entries()].filter(([, v]) => v).map(([k]) => k);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Encodes in the original wire format; newly constructed values use Java DB format.
   * Incomplete recovery results cannot be rewritten or edited.
   */
  toBytes(): Buffer {
    this.requireComplete();
    return encodeFleetRemotes(new Map(this.remotes), this.format);
  }

  /** Refuses editing or serialization after any recovery omission. */
  private requireComplete(): void {
    if (!this.complete) throw new DecodeError('E_INCOMPLETE', 'Cannot edit or serialize incomplete remote states');
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    if (this.remotes.size === 0) return 'FleetRemotes(empty)';
    const entries = [...this.remotes.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
    return `FleetRemotes(${entries})`;
  }
}
