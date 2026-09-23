/**
 * @fileoverview FleetCommand business object
 *
 * High-level wrapper around FLEETS.COMMAND (VARBINARY 1024).
 *
 * Mirrors the FleetCommand / SimpleCommand pattern from Java:
 *   - Immutable mutations via with*() methods
 *   - Named constructors: fromBytes(), create()
 *   - toBytes() for round-trip back to DB
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { getDatabaseProfile, type DatabaseProfile } from './DatabaseProfile.js';

import {
  decodeFleetCommand, encodeFleetCommand,
  FLEET_COMMAND_TYPES,
  type FleetCommandType,
  type CommandArg,
} from './FleetDb.js';

export { FLEET_COMMAND_TYPES, type FleetCommandType, type CommandArg };

/**
 * Represents the FleetCommandObject model used by StarMade database object parsing.
 */
export class FleetCommandObject {
  /** Explicit ordinal contract retained across edits. */
  readonly profile: DatabaseProfile;
  readonly fleetDbId: bigint;
  readonly commandOrdinal: number;
  readonly commandType: FleetCommandType | undefined;
  readonly #args: CommandArg[];

  /** Detached argument tree, including nested structs and byte arrays. */
  get args(): ReadonlyArray<CommandArg> { return structuredClone(this.#args); }

  /**
   * Creates a FleetCommandObject instance.
   *
   * @param fleetDbId - Input value for the constructor operation.
   * @param commandOrdinal - Input value for the constructor operation.
   * @param args - Command arguments. @param profile Explicit ordinal contract.
   */
  private constructor(
    fleetDbId: bigint,
    commandOrdinal: number,
    args: CommandArg[],
    profile: DatabaseProfile,
  ) {
    this.profile = profile;
    this.fleetDbId      = fleetDbId;
    this.commandOrdinal = commandOrdinal;
    this.commandType    = getDatabaseProfile(profile).fleetCommands[commandOrdinal] as FleetCommandType | undefined;
    // Reuse the wire codec's integer, UTF, nesting, argument-count and byte budgets.
    encodeFleetCommand({ fleetDbId, commandOrdinal, commandType: this.commandType, args }, 0);
    validateCommandValues(args);
    this.#args = structuredClone(args);
    Object.freeze(this);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes FLEETS.COMMAND with the selected profile (current by default).
   * Returns null for absent/empty input; malformed data throws with column/offset context.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined, profile: DatabaseProfile = 'current'): FleetCommandObject | null {
    const raw = decodeFleetCommand(data, profile);
    if (!raw) return null;
    return new FleetCommandObject(raw.fleetDbId, raw.commandOrdinal, raw.args, profile);
  }

  /**
   * Creates a new FleetCommandObject from scratch.
   *
   * @param fleetDbId  Database ID of the target fleet.
   * @param type       Command type (name from FLEET_COMMAND_TYPES).
   * @param args       Command arguments. @param profile Current game or historical SDK ordinal contract.
   */
  static create(
    fleetDbId: bigint,
    type: FleetCommandType,
    args: CommandArg[] = [],
    profile: DatabaseProfile = 'current',
  ): FleetCommandObject {
    const ordinal = getDatabaseProfile(profile).fleetCommands.indexOf(type);
    if (ordinal === -1) throw new RangeError(`Unknown fleet command type: ${type}`);
    return new FleetCommandObject(fleetDbId, ordinal, args, profile);
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Returns a copy updated with FleetDbId.
   *
   * @param id - Input value for the withFleetDbId operation.
   * @returns The computed StarMade-Decoder value.
   */
  withFleetDbId(id: bigint): FleetCommandObject {
    return new FleetCommandObject(id, this.commandOrdinal, [...this.#args], this.profile);
  }

  /**
   * Returns a copy updated with Command.
   *
   * @param type - Input value for the withCommand operation.
   * @param args - Input value for the withCommand operation.
   * @returns The computed StarMade-Decoder value.
   */
  withCommand(type: FleetCommandType, args: CommandArg[] = []): FleetCommandObject {
    const ordinal = getDatabaseProfile(this.profile).fleetCommands.indexOf(type);
    if (ordinal === -1) throw new RangeError(`Unknown fleet command type: ${type}`);
    return new FleetCommandObject(this.fleetDbId, ordinal, args, this.profile);
  }

  /**
   * Returns a copy updated with Args.
   *
   * @param args - Input value for the withArgs operation.
   * @returns The computed StarMade-Decoder value.
   */
  withArgs(args: CommandArg[]): FleetCommandObject {
    return new FleetCommandObject(this.fleetDbId, this.commandOrdinal, args, this.profile);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** First string argument, if any (convenience for ACTIVATE_REMOTE name). */
  get firstStringArg(): string | undefined {
    const a = this.#args.find(a => a.kind === 'string');
    return a?.kind === 'string' ? a.value : undefined;
  }

  /** First vec3i argument, if any (convenience for MOVE_FLEET / PATROL_FLEET target). */
  get firstVec3iArg(): { x: number; y: number; z: number } | undefined {
    const a = this.#args.find(a => a.kind === 'vec3i');
    return a?.kind === 'vec3i' ? { x: a.x, y: a.y, z: a.z } : undefined;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Encodes to VARBINARY bytes for FLEETS.COMMAND.
   * @param padTo Byte padding (default 1024, matching Java).
   */
  toBytes(padTo = 1024): Buffer {
    return encodeFleetCommand(
      { fleetDbId: this.fleetDbId, commandOrdinal: this.commandOrdinal, commandType: this.commandType, args: [...this.#args] },
      padTo,
    );
  }

  /** JSON projection with decimal long values and detached byte arrays. Nonfinite floats remain explicit strings. */
  toJSON(): { fleetDbId: string; commandOrdinal: number; commandType: FleetCommandType | undefined; args: unknown[] } {
    return {
      fleetDbId: this.fleetDbId.toString(), commandOrdinal: this.commandOrdinal, commandType: this.commandType,
      args: JSON.parse(JSON.stringify(this.#args, (_key, value: unknown) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Uint8Array) return [...value];
        if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
        return value;
      })) as unknown[],
    };
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    const type = this.commandType ?? `#${this.commandOrdinal}`;
    const arg = this.firstStringArg ?? this.firstVec3iArg
      ? (this.firstStringArg ?? `(${this.firstVec3iArg!.x},${this.firstVec3iArg!.y},${this.firstVec3iArg!.z})`)
      : '';
    return `FleetCommand(fleet=${this.fleetDbId}, type=${type}${arg ? `, arg=${arg}` : ''})`;
  }
}

/** Rejects runtime coercions that the primitive codec would otherwise accept. */
function validateCommandValues(args: CommandArg[]): void {
  for (const arg of args) {
    switch (arg.kind) {
      case 'boolean':
        if (typeof arg.value !== 'boolean') throw new TypeError('Command boolean must be a boolean');
        break;
      case 'bytes':
        if (!(arg.value instanceof Uint8Array)) throw new TypeError('Command bytes must be a Uint8Array');
        break;
      case 'float': validateCommandFloat(arg.value); break;
      case 'vec3f':
        validateCommandFloat(arg.x); validateCommandFloat(arg.y); validateCommandFloat(arg.z);
        break;
      case 'vec4f':
        validateCommandFloat(arg.x); validateCommandFloat(arg.y); validateCommandFloat(arg.z); validateCommandFloat(arg.w);
        break;
      case 'struct': validateCommandValues(arg.value); break;
    }
  }
}

/** Accepts IEEE-754 float values and rejects coercion or finite overflow. */
function validateCommandFloat(value: number): void {
  if (typeof value !== 'number' || (Number.isFinite(value) && !Number.isFinite(Math.fround(value)))) {
    throw new RangeError('Command float must be a number representable as float32');
  }
}
