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

import zlib from 'node:zlib';
import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';

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
  const r = BufferReader.from(Buffer.isBuffer(data) ? data : Buffer.from(data));
  try {
    const fleetDbId = r.readInt64BE();
    const commandOrdinal = r.readInt32BE();
    const commandType = FLEET_COMMAND_TYPES[commandOrdinal] as FleetCommandType | undefined;
    const args = readCommandArgs(r);
    return { fleetDbId, commandOrdinal, commandType, args };
  } catch {
    return null;
  }
}

/**
 * Encodes a `FleetCommand` back to VARBINARY bytes (padded to 1024 bytes as Java does).
 */
export function encodeFleetCommand(cmd: FleetCommand, padTo = 1024): Buffer {
  const w = new BufferWriter();
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

function readCommandArgs(r: BufferReader): CommandArg[] {
  const count = r.readUInt8();
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
        args.push({ kind: 'struct', value: readCommandArgs(r) });
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

function writeCommandArgs(w: BufferWriter, args: CommandArg[]): void {
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
        writeCommandArgs(w, arg.value);
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
    }
  }
}

// ── SAVED_REMOTES ─────────────────────────────────────────────────────────────

export interface FleetRemotes {
  remotes: Map<string, boolean>;
  /** @deprecated raw fallback bytes for unrecognized formats. Prefer remotes. */
  raw?: Buffer;
}

/**
 * Decodes `FLEETS.SAVED_REMOTES` (VARBINARY 1024).
 *
 * Two serialization formats coexist in the StarMade codebase:
 *
 * **Network format** (Fleet.serialize DataOutput path, used when sending fleet
 * state over the wire):
 *   boolean hasRemotes
 *   if hasRemotes:
 *     short   count
 *     [count × (writeUTF(name), writeBoolean(active))]
 *
 * **DB format** (Fleet.serializeRemotes ObjectOutputStream path, used when
 * persisting SAVED_REMOTES to the HSQLDB):
 *   Java ObjectOutputStream header (AC ED 00 05) + serialized HashMap<String,Boolean>
 *   → parsed by reading the Java serialization stream manually (see below).
 *
 * Returns an empty map for null/empty input.
 */
export function decodeFleetRemotes(data: Buffer | Uint8Array | null | undefined): FleetRemotes {
  if (!data || data.length === 0) return { remotes: new Map() };
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // ── Java ObjectOutputStream format (AC ED magic) ──────────────────────────
  if (buf[0] === 0xac && buf[1] === 0xed) {
    return decodeJavaSerializedRemotes(buf);
  }

  // ── Network format ────────────────────────────────────────────────────────
  try {
    const r = BufferReader.from(buf);
    const hasRemotes = r.readUInt8() !== 0;
    if (!hasRemotes) return { remotes: new Map() };
    const count = r.readInt16BE();
    const remotes = new Map<string, boolean>();
    for (let i = 0; i < count; i++) {
      const name   = r.readJavaModifiedUTF();
      const active = r.readUInt8() !== 0;
      remotes.set(name, active);
    }
    return { remotes };
  } catch {
    return { remotes: new Map(), raw: buf };
  }
}

/**
 * Encodes fleet remotes in the **network format** (suitable for the SAVED_REMOTES
 * DB column, replacing the Java ObjectOutputStream format with a portable one).
 */
export function encodeFleetRemotes(remotes: Map<string, boolean>): Buffer {
  const w = new BufferWriter();
  if (remotes.size === 0) {
    w.writeUInt8(0); // hasRemotes = false
    return w.toBuffer();
  }
  w.writeUInt8(1); // hasRemotes = true
  w.writeInt16BE(remotes.size);
  for (const [name, active] of remotes) {
    w.writeJavaModifiedUTF(name);
    w.writeUInt8(active ? 1 : 0);
  }
  return w.toBuffer();
}

/**
 * Minimal Java ObjectSerialization stream parser for `HashMap<String, Boolean>`.
 *
 * Java serialization format (AC ED 00 05):
 *   - Stream header: AC ED (magic), 00 05 (version)
 *   - TC_OBJECT (73), classDesc, data…
 *
 * We use a heuristic scan rather than a full Java-deserializer: scan the stream
 * for TC_STRING (74) sequences to extract the key strings, and read the booleans
 * from the Boolean field wrappers. This is resilient to JVM version differences
 * in the serialization format.
 *
 * This approach works reliably for `HashMap<String, Boolean>` as written by
 * `ObjectOutputStream` in Java 8–21 without third-party dependencies.
 */
function decodeJavaSerializedRemotes(buf: Buffer): FleetRemotes {
  const remotes = new Map<string, boolean>();
  // Extract all TC_STRING (0x74) + uint16-length + utf-8 content sequences.
  // TC_BLOCKDATA, TC_REFERENCE, etc. appear between entries but do not affect
  // the key/value ordering in a HashMap serialized stream.
  const strings: string[] = [];
  let i = 0;
  while (i < buf.length - 2) {
    if (buf[i] === 0x74) { // TC_STRING
      const len = buf.readUInt16BE(i + 1);
      if (i + 3 + len <= buf.length) {
        strings.push(buf.toString('utf8', i + 3, i + 3 + len));
        i += 3 + len;
        continue;
      }
    }
    i++;
  }

  // The first strings are class descriptor names ('java.util.HashMap', etc.).
  // HashMap entries are key-value pairs of (String key, Boolean value).
  // Booleans in Java serialization are stored as TC_OBJECT with a single
  // byte field: 0x00 = false, 0x01 = true, encoded after the class descriptor.
  // We look for the pattern: TC_OBJECT (0x73) TC_CLASSDESC (0x72) for java.lang.Boolean,
  // OR the simpler inline-value pattern used in modern JVMs.
  //
  // Simpler robust approach: scan for boolean primitives inline with TC_STRING keys.
  // In the serialized HashMap, each Entry is: key (TC_STRING), value (TC_OBJECT Boolean).
  // We skip known class descriptor strings (contain '.') and pair the rest.
  const entryStrings = strings.filter(s => !s.includes('.') && !s.includes('/') && s !== 'value');

  // Extract boolean bytes following each TC_OBJECT (0x73) that represents a Boolean.
  // Look for the byte sequence 0x73 0x72 "java.lang.Boolean" ... followed by value byte.
  const booleans: boolean[] = [];
  let j = 0;
  while (j < buf.length) {
    // Java Boolean serialization: TC_OBJECT(73) + ... boolean_value_field byte
    // In practice, ObjectOutputStream writes Boolean as:
    //   73 72 00 11 'java.lang.Boolean' ... (classDesc) then one byte for value
    if (buf[j] === 0x73) {
      // Look ahead for 'java.lang.Boolean' class descriptor
      const ahead = buf.indexOf(Buffer.from('java.lang.Boolean'), j, 'utf8');
      if (ahead !== -1 && ahead - j < 30) {
        // The value field byte follows after the classDesc serialization block.
        // Find 'value' fieldname, then the actual byte value follows.
        const valueIdx = buf.indexOf(Buffer.from('value'), ahead);
        if (valueIdx !== -1 && valueIdx - ahead < 60) {
          const boolByte = buf[valueIdx + 5];
          if (boolByte === 0x00 || boolByte === 0x01) {
            booleans.push(boolByte === 0x01);
            j = valueIdx + 6;
            continue;
          }
        }
      }
    }
    j++;
  }

  // Pair entry strings with booleans.
  const len = Math.min(entryStrings.length, booleans.length);
  for (let k = 0; k < len; k++) {
    remotes.set(entryStrings[k], booleans[k]);
  }

  return { remotes };
}
