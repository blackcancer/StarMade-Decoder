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

import { decodeFleetRemotes, encodeFleetRemotes } from './FleetDb.js';

/**
 * Represents the FleetRemotesObject model used by StarMade database object parsing.
 */
export class FleetRemotesObject {
  readonly remotes: ReadonlyMap<string, boolean>;
  /** @deprecated raw fallback bytes for unrecognized formats. Prefer remotes. */
  readonly raw?: Buffer;

  /**
   * Creates a FleetRemotesObject instance.
   *
   * @param remotes - Input value for the constructor operation.
   * @param raw - Input value for the constructor operation.
   */
  private constructor(remotes: Map<string, boolean>, raw?: Buffer) {
    this.remotes = new Map(remotes);
    if (raw) this.raw = raw;
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes FLEETS.SAVED_REMOTES bytes.
   * Supports both the network format and Java ObjectOutputStream format (AC ED).
   * Returns an empty instance for null/empty input.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined): FleetRemotesObject {
    const { remotes, raw } = decodeFleetRemotes(data);
    return new FleetRemotesObject(remotes, raw);
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
    const copy = new Map(this.remotes);
    copy.set(name, active);
    return new FleetRemotesObject(copy);
  }

  /** Toggles a remote. Adds it as active if not present. */
  withToggle(name: string): FleetRemotesObject {
    const current = this.remotes.get(name) ?? false;
    return this.withRemote(name, !current);
  }

  /** Removes a remote. */
  withoutRemote(name: string): FleetRemotesObject {
    const copy = new Map(this.remotes);
    copy.delete(name);
    return new FleetRemotesObject(copy);
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
   * Encodes to the portable network format for FLEETS.SAVED_REMOTES.
   * Always writes the DataOutput format — never ObjectOutputStream.
   */
  toBytes(): Buffer {
    return encodeFleetRemotes(new Map(this.remotes));
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
