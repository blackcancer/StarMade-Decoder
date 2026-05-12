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

import {
  decodeFleetCommand, encodeFleetCommand,
  FLEET_COMMAND_TYPES,
  type FleetCommandType,
  type CommandArg,
} from './FleetDb.js';

export { FLEET_COMMAND_TYPES, type FleetCommandType, type CommandArg };

export class FleetCommandObject {
  readonly fleetDbId: bigint;
  readonly commandOrdinal: number;
  readonly commandType: FleetCommandType | undefined;
  readonly args: ReadonlyArray<CommandArg>;

  private constructor(
    fleetDbId: bigint,
    commandOrdinal: number,
    args: CommandArg[],
  ) {
    this.fleetDbId      = fleetDbId;
    this.commandOrdinal = commandOrdinal;
    this.commandType    = FLEET_COMMAND_TYPES[commandOrdinal] as FleetCommandType | undefined;
    this.args           = Object.freeze([...args]);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes FLEETS.COMMAND bytes into a FleetCommandObject.
   * Returns null for null / empty / malformed input.
   */
  static fromBytes(data: Buffer | Uint8Array | null | undefined): FleetCommandObject | null {
    const raw = decodeFleetCommand(data);
    if (!raw) return null;
    return new FleetCommandObject(raw.fleetDbId, raw.commandOrdinal, raw.args);
  }

  /**
   * Creates a new FleetCommandObject from scratch.
   *
   * @param fleetDbId  Database ID of the target fleet.
   * @param type       Command type (name from FLEET_COMMAND_TYPES).
   * @param args       Command arguments.
   */
  static create(
    fleetDbId: bigint,
    type: FleetCommandType,
    args: CommandArg[] = [],
  ): FleetCommandObject {
    const ordinal = FLEET_COMMAND_TYPES.indexOf(type);
    if (ordinal === -1) throw new RangeError(`Unknown fleet command type: ${type}`);
    return new FleetCommandObject(fleetDbId, ordinal, args);
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  withFleetDbId(id: bigint): FleetCommandObject {
    return new FleetCommandObject(id, this.commandOrdinal, [...this.args]);
  }

  withCommand(type: FleetCommandType, args: CommandArg[] = []): FleetCommandObject {
    const ordinal = FLEET_COMMAND_TYPES.indexOf(type);
    if (ordinal === -1) throw new RangeError(`Unknown fleet command type: ${type}`);
    return new FleetCommandObject(this.fleetDbId, ordinal, args);
  }

  withArgs(args: CommandArg[]): FleetCommandObject {
    return new FleetCommandObject(this.fleetDbId, this.commandOrdinal, args);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** First string argument, if any (convenience for ACTIVATE_REMOTE name). */
  get firstStringArg(): string | undefined {
    const a = this.args.find(a => a.kind === 'string');
    return a?.kind === 'string' ? a.value : undefined;
  }

  /** First vec3i argument, if any (convenience for MOVE_FLEET / PATROL_FLEET target). */
  get firstVec3iArg(): { x: number; y: number; z: number } | undefined {
    const a = this.args.find(a => a.kind === 'vec3i');
    return a?.kind === 'vec3i' ? { x: a.x, y: a.y, z: a.z } : undefined;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Encodes to VARBINARY bytes for FLEETS.COMMAND.
   * @param padTo Byte padding (default 1024, matching Java).
   */
  toBytes(padTo = 1024): Buffer {
    return encodeFleetCommand(
      { fleetDbId: this.fleetDbId, commandOrdinal: this.commandOrdinal, commandType: this.commandType, args: [...this.args] },
      padTo,
    );
  }

  toString(): string {
    const type = this.commandType ?? `#${this.commandOrdinal}`;
    const arg = this.firstStringArg ?? this.firstVec3iArg
      ? (this.firstStringArg ?? `(${this.firstVec3iArg!.x},${this.firstVec3iArg!.y},${this.firstVec3iArg!.z})`)
      : '';
    return `FleetCommand(fleet=${this.fleetDbId}, type=${type}${arg ? `, arg=${arg}` : ''})`;
  }
}
