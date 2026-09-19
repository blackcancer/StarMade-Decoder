/**
 * @fileoverview Fleet DB — FLEETS.COMMAND and FLEETS.SAVED_REMOTES decoders
 *
 * Covers the two VARBINARY columns of the FLEETS table in the StarMade HSQLDB:
 *
 *   COMMAND      (VARBINARY 1024) — FleetCommand.serializeBytes()
 *   SAVED_REMOTES (VARBINARY 1024) — two distinct formats depending on origin
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import { MAX_DATABASE_BYTES, readDatabase, readZeroPadding } from './DatabaseValidation.js';
import { readJavaBooleanMap, writeJavaBooleanMap } from './JavaBooleanMap.js';

// ── FleetCommandTypes enum (ordinal order from FleetCommandTypes.java) ────────

/**
 * Fleet command type ordinals.
 * Order matches the Java enum declaration in FleetCommandTypes.java.
 */
export const FLEET_COMMAND_TYPES = [
  'IDLE',             // 0
  'MOVE_FLEET',       // 1
  'PATROL_FLEET',     // 2
  'TRADE_FLEET',      // 3
  'REPAIR_FLEET',     // 4
  'FLEET_ATTACK',     // 5
  'FLEET_DEFEND',     // 6
  'ESCORT',           // 7
  'REPAIR',           // 8
  'ARTILLERY',        // 9
  'SENTRY_FORMATION', // 10
  'SENTRY',           // 11
  'FLEET_IDLE_FORMATION', // 12
  'CALL_TO_CARRIER',  // 13
  'MINE_IN_SECTOR',   // 14
  'CLOAK',            // 15
  'UNCLOAK',          // 16
  'JAM',              // 17
  'UNJAM',            // 18
  'ACTIVATE_REMOTE',  // 19
  'INTERDICT',        // 20
  'STOP_INTERDICT',   // 21
] as const;

/**
 * Defines the FleetCommandType type used by StarMade database object parsing.
 */
export type FleetCommandType = typeof FLEET_COMMAND_TYPES[number];

// ── Command arg types (NetUtil constants) ─────────────────────────────────────

/** Arg type IDs from NetUtil.java — shared with the StarMade network protocol. */
export const CMD_TYPES = {
  INT:        1,
  LONG:       2,
  FLOAT:      3,
  STRING:     4,
  BOOLEAN:    5,
  BYTE:       6,
  SHORT:      7,
  BYTE_ARRAY: 8,
  STRUCT:     9,
  VECTOR3i:   10,
  VECTOR3f:   11,
  VECTOR4f:   12,
} as const;

/**
 * Defines the CommandArg type used by StarMade database object parsing.
 */
export type CommandArg =
  | { kind: 'int';    value: number }
  | { kind: 'long';   value: bigint }
  | { kind: 'float';  value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'byte';   value: number }
  | { kind: 'short';  value: number }
  | { kind: 'bytes';  value: Uint8Array }
  | { kind: 'struct'; value: CommandArg[] }
  | { kind: 'vec3i';  x: number; y: number; z: number }
  | { kind: 'vec3f';  x: number; y: number; z: number }
  | { kind: 'vec4f';  x: number; y: number; z: number; w: number };

// ── FleetCommand decoder ──────────────────────────────────────────────────────

/**
 * Describes the FleetCommand data shape used by StarMade database object parsing.
 */
export interface FleetCommand {
  /** Database ID of the fleet this command targets. */
  fleetDbId: bigint;
  /** Command type ordinal. */
  commandOrdinal: number;
  /** Resolved command type name, or undefined if the ordinal is unknown. */
  commandType: FleetCommandType | undefined;
  /** Command arguments. */
  args: CommandArg[];
}

/**
 * Decodes `FLEETS.COMMAND` (VARBINARY 1024).
 *
 * Wire format (FleetCommand.serializeBytes → DataOutput):
 *   long  fleetDbId
 *   int   commandOrdinal
 *   byte  argCount
 *   [argCount × (byte type + value)]
 *
 * Strings use Java Modified UTF-8 (DataOutput.writeUTF).
 * Returns null if the buffer is null or empty.
 */
export function decodeFleetCommand(data: Buffer | Uint8Array | null | undefined): FleetCommand | null {
  if (!data || data.length === 0) return null;
  return readDatabase(data, 'FLEETS.COMMAND', r => {
    const fleetDbId = r.readInt64BE();
    const commandOrdinal = r.readInt32BE();
    const commandType = FLEET_COMMAND_TYPES[commandOrdinal] as FleetCommandType | undefined;
    const args = readCommandArgs(r);
    readZeroPadding(r);
    return { fleetDbId, commandOrdinal, commandType, args };
  });
}

/**
 * Encodes a `FleetCommand` back to VARBINARY bytes (padded to 1024 bytes as Java does).
 */
export function encodeFleetCommand(cmd: FleetCommand, padTo = 1024): Buffer {
  boundedInteger(padTo, 'command padding', MAX_DATABASE_BYTES);
  const w = new BufferWriter(256, MAX_DATABASE_BYTES);
  w.writeInt64BE(cmd.fleetDbId);
  w.writeInt32BE(cmd.commandOrdinal);
  writeCommandArgs(w, cmd.args);
  const buf = w.toBuffer();
  if (buf.length >= padTo) return buf;
  const padded = Buffer.alloc(padTo);
  buf.copy(padded);
  return padded;
}

// ── Command args read/write (Command.serialize / deserialize) ─────────────────

/**
 * Reads CommandArgs from the StarMade binary representation.
 *
 * @param r - Input value for the readCommandArgs operation.
 * @returns The computed StarMade-Decoder value.
 */
function readCommandArgs(r: BufferReader, depth = 0, budget = { remaining: 65536 }): CommandArg[] {
  if (depth > 64) throw new DecodeError('E_LIMIT', 'Command nesting budget exceeded');
  const count = r.readUInt8();
  if (count > budget.remaining) throw new DecodeError('E_LIMIT', 'Command argument budget exceeded');
  budget.remaining -= count;
  const args: CommandArg[] = [];
  for (let i = 0; i < count; i++) {
    const type = r.readUInt8();
    switch (type) {
      case CMD_TYPES.INT:        args.push({ kind: 'int',     value: r.readInt32BE() }); break;
      case CMD_TYPES.LONG:       args.push({ kind: 'long',    value: r.readInt64BE() }); break;
      case CMD_TYPES.FLOAT:      args.push({ kind: 'float',   value: r.readFloat32BE() }); break;
      case CMD_TYPES.STRING:     args.push({ kind: 'string',  value: r.readJavaModifiedUTF() }); break;
      case CMD_TYPES.BOOLEAN:    args.push({ kind: 'boolean', value: r.readUInt8() !== 0 }); break;
      case CMD_TYPES.BYTE:       args.push({ kind: 'byte',    value: r.readInt8() }); break;
      case CMD_TYPES.SHORT:      args.push({ kind: 'short',   value: r.readInt16BE() }); break;
      case CMD_TYPES.BYTE_ARRAY: {
        const len = r.readInt32BE();
        args.push({ kind: 'bytes', value: r.readBytes(len) });
        break;
      }
      case CMD_TYPES.STRUCT:
        args.push({ kind: 'struct', value: readCommandArgs(r, depth + 1, budget) });
        break;
      case CMD_TYPES.VECTOR3i:
        args.push({ kind: 'vec3i', x: r.readInt32BE(), y: r.readInt32BE(), z: r.readInt32BE() });
        break;
      case CMD_TYPES.VECTOR3f:
        args.push({ kind: 'vec3f', x: r.readFloat32BE(), y: r.readFloat32BE(), z: r.readFloat32BE() });
        break;
      case CMD_TYPES.VECTOR4f:
        args.push({ kind: 'vec4f', x: r.readFloat32BE(), y: r.readFloat32BE(), z: r.readFloat32BE(), w: r.readFloat32BE() });
        break;
      default:
        throw new Error(`Unknown command arg type ${type} at arg ${i}`);
    }
  }
  return args;
}

/**
 * Writes CommandArgs to the StarMade binary representation.
 *
 * @param w - Input value for the writeCommandArgs operation.
 * @param args - Input value for the writeCommandArgs operation.
 */
function writeCommandArgs(w: BufferWriter, args: CommandArg[], depth = 0, budget = { remaining: 65536 }): void {
  if (depth > 64) throw new DecodeError('E_LIMIT', 'Command nesting budget exceeded');
  if (args.length > budget.remaining) throw new DecodeError('E_LIMIT', 'Command argument budget exceeded');
  budget.remaining -= args.length;
  if (args.length > 255) throw new RangeError(`Too many command args: ${args.length}`);
  w.writeUInt8(args.length);
  for (const arg of args) {
    switch (arg.kind) {
      case 'int':     w.writeUInt8(CMD_TYPES.INT);     w.writeInt32BE(arg.value);   break;
      case 'long':    w.writeUInt8(CMD_TYPES.LONG);    w.writeInt64BE(arg.value);   break;
      case 'float':   w.writeUInt8(CMD_TYPES.FLOAT);   w.writeFloat32BE(arg.value); break;
      case 'string':  w.writeUInt8(CMD_TYPES.STRING);  w.writeJavaModifiedUTF(arg.value); break;
      case 'boolean': w.writeUInt8(CMD_TYPES.BOOLEAN); w.writeUInt8(arg.value ? 1 : 0);   break;
      case 'byte':    w.writeUInt8(CMD_TYPES.BYTE);    w.writeInt8(arg.value);      break;
      case 'short':   w.writeUInt8(CMD_TYPES.SHORT);   w.writeInt16BE(arg.value);   break;
      case 'bytes':
        w.writeUInt8(CMD_TYPES.BYTE_ARRAY);
        w.writeInt32BE(arg.value.length);
        w.writeBytes(arg.value);
        break;
      case 'struct':
        w.writeUInt8(CMD_TYPES.STRUCT);
        writeCommandArgs(w, arg.value, depth + 1, budget);
        break;
      case 'vec3i':
        w.writeUInt8(CMD_TYPES.VECTOR3i);
        w.writeInt32BE(arg.x); w.writeInt32BE(arg.y); w.writeInt32BE(arg.z);
        break;
      case 'vec3f':
        w.writeUInt8(CMD_TYPES.VECTOR3f);
        w.writeFloat32BE(arg.x); w.writeFloat32BE(arg.y); w.writeFloat32BE(arg.z);
        break;
      case 'vec4f':
        w.writeUInt8(CMD_TYPES.VECTOR4f);
        w.writeFloat32BE(arg.x); w.writeFloat32BE(arg.y); w.writeFloat32BE(arg.z); w.writeFloat32BE(arg.w);
        break;
      default: throw new DecodeError('E_UNSUPPORTED', 'Unknown command argument kind');
    }
  }
}

// ── SAVED_REMOTES ─────────────────────────────────────────────────────────────

/** Complete or explicitly recovered remote-control states. */
export interface FleetRemotes {
  remotes: Map<string, boolean>;
  format: 'network' | 'java';
  complete: boolean;
  diagnostics: DecodeDiagnostic[];
  /** Detached original bytes for an incomplete recovery result. */
  raw?: Buffer;
}

/** Strict by default; recovery exposes an incomplete result and never hides resource-limit errors. */
export interface FleetRemotesDecodeOptions { mode?: 'strict' | 'recover'; }

/**
 * Decodes network remotes or the exact JDK HashMap<String,Boolean> database stream.
 * @param data Cell bytes; absent/empty input denotes no remotes.
 * @param options Explicit recovery policy.
 * @returns Complete states or an incomplete result carrying diagnostics and original bytes.
 */
export function decodeFleetRemotes(data: Buffer | Uint8Array | null | undefined, options: FleetRemotesDecodeOptions = {}): FleetRemotes {
  const mode = options.mode ?? 'strict';
  if (mode !== 'strict' && mode !== 'recover') throw new DecodeError('E_RANGE', 'Invalid database parsing mode');
  const format = data && data[0] === 0xac ? 'java' : 'network';
  const result: FleetRemotes = { remotes: new Map(), format, complete: true, diagnostics: [] };
  if (!data || data.length === 0) return result;
  try {
    result.remotes = readDatabase(data, 'FLEETS.SAVED_REMOTES', r => {
      let remotes: Map<string, boolean>;
      if (format === 'java') remotes = readJavaBooleanMap(r);
      else {
        remotes = new Map();
        const hasRemotes = r.readUInt8();
        if (hasRemotes > 1) throw new DecodeError('E_FORMAT', 'Invalid remote presence flag');
        if (hasRemotes) {
          const count = r.readInt16BE();
          if (count < 0) throw new DecodeError('E_FORMAT', 'Negative remote count');
          for (let i = 0; i < count; i++) {
            const name = r.readJavaModifiedUTF(), active = r.readUInt8();
            if (active > 1) throw new DecodeError('E_FORMAT', 'Invalid remote boolean');
            if (remotes.has(name)) throw new DecodeError('E_FORMAT', 'Duplicate remote key');
            remotes.set(name, active === 1);
          }
        }
      }
      readZeroPadding(r); return remotes;
    });
    return result;
  } catch (error) {
    // readDatabase normalizes decoder errors before this policy boundary.
    const failure = error as DecodeError;
    if (mode === 'strict' || failure.code === 'E_LIMIT') throw failure;
    result.complete = false;
    result.diagnostics.push({ code: failure.code, message: failure.message, path: failure.path, offset: failure.offset });
    result.raw = Buffer.from(data);
    return result;
  }
}

/**
 * Encodes remotes in the explicitly selected format.
 * Network bytes are not a replacement for the Java SAVED_REMOTES database stream.
 * @param remotes Non-null string/boolean map.
 * @param format Network for the wire protocol; java for Fleet.deserializeRemotes.
 */
export function encodeFleetRemotes(remotes: Map<string, boolean>, format: 'network' | 'java' = 'network'): Buffer {
  boundedInteger(remotes.size, 'remote count', 32767);
  const w = new BufferWriter(256, MAX_DATABASE_BYTES);
  if (format === 'java') writeJavaBooleanMap(w, remotes);
  else {
    if (format !== 'network') throw new DecodeError('E_RANGE', 'Invalid remote output format');
    w.writeUInt8(remotes.size === 0 ? 0 : 1);
    if (remotes.size > 0) {
      w.writeInt16BE(remotes.size);
      for (const [name, active] of remotes) {
        if (typeof name !== 'string' || typeof active !== 'boolean') throw new DecodeError('E_RANGE', 'Remote entries must be string/boolean pairs');
        w.writeJavaModifiedUTF(name); w.writeUInt8(active ? 1 : 0);
      }
    }
  }
  return w.toBuffer();
}
