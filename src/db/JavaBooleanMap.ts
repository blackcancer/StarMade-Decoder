/**
 * @fileoverview Bounded Java ObjectStream codec for Fleet's HashMap<String, Boolean>.
 * Only the JDK HashMap/Boolean descriptors are accepted; no classes are loaded.
 * Reference: Fleet.serializeRemotes, StarMade-Open decf3a1990f29b9505041f122188bf19489bcf7e.
 */
import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';
import { DecodeError } from '../core/DecodeError.js';

/** Exact JDK serial descriptors, including serialVersionUID, fields and superclass terminator. */
const DESCRIPTORS = {
  map: Buffer.from('00116a6176612e7574696c2e486173684d61700507dac1c31660d103000246000a6c6f6164466163746f724900097468726573686f6c647870', 'hex'),
  boolean: Buffer.from('00116a6176612e6c616e672e426f6f6c65616ecd207280d59cfaee0200015a000576616c75657870', 'hex'),
};
/** Descriptor handles cannot be mistaken for application strings or boolean objects. */
const MAP_DESCRIPTOR = Symbol('HashMap descriptor'), BOOLEAN_DESCRIPTOR = Symbol('Boolean descriptor');

/**
 * Reads the exact supported ObjectOutputStream map, including shared Boolean handles.
 * @param reader Reader positioned before the stream magic.
 * @returns Complete map; invalid or unsupported objects always throw.
 */
export function readJavaBooleanMap(reader: BufferReader): Map<string, boolean> {
  const handles: unknown[] = [];
  /** Reads a typed stream reference without resolving arbitrary classes. */
  const reference = (): unknown => {
    const index = reader.readInt32BE() - 0x7e0000;
    if (index < 0 || index >= handles.length) throw new DecodeError('E_FORMAT', 'Invalid Java object handle');
    return handles[index];
  };
  /** Accepts only the canonical descriptor or an earlier handle of the same class. */
  const descriptor = (kind: keyof typeof DESCRIPTORS): void => {
    const token = reader.readUInt8(), identity = kind === 'map' ? MAP_DESCRIPTOR : BOOLEAN_DESCRIPTOR;
    if (token === 0x71) {
      if (reference() !== identity) throw new DecodeError('E_FORMAT', 'Wrong Java class descriptor reference');
    } else {
      if (token !== 0x72) throw new DecodeError('E_UNSUPPORTED', 'Unsupported Java class descriptor');
      const expected = DESCRIPTORS[kind];
      if (!Buffer.from(reader.readBytes(expected.length)).equals(expected)) {
        throw new DecodeError('E_UNSUPPORTED', 'Unsupported Java class schema');
      }
      handles.push(identity);
    }
  };
  /** Decodes a key or Boolean with strict reference-type validation. */
  const value = (kind: 'string' | 'boolean'): string | boolean => {
    const token = reader.readUInt8();
    let decoded: unknown;
    if (token === 0x71) decoded = reference();
    else if (kind === 'string' && token === 0x74) {
      decoded = reader.readJavaModifiedUTF(); handles.push(decoded);
    } else if (kind === 'boolean' && token === 0x73) {
      descriptor('boolean');
      const byte = reader.readUInt8();
      if (byte > 1) throw new DecodeError('E_FORMAT', 'Invalid serialized Boolean');
      decoded = byte === 1; handles.push(decoded);
    } else throw new DecodeError('E_UNSUPPORTED', `Unsupported Java ${kind} token ${token}`);
    if (typeof decoded !== kind) throw new DecodeError('E_FORMAT', `Wrong Java ${kind} reference`);
    return decoded as string | boolean;
  };
  if (reader.readUInt32BE() !== 0xaced0005 || reader.readUInt8() !== 0x73) {
    throw new DecodeError('E_FORMAT', 'Invalid Java map stream header');
  }
  descriptor('map'); handles.push(Symbol('map object'));
  const loadFactor = reader.readFloat32BE(), threshold = reader.readInt32BE();
  if (!Number.isFinite(loadFactor) || loadFactor <= 0 || threshold < 0) throw new DecodeError('E_FORMAT', 'Invalid HashMap metadata');
  const blockToken = reader.readUInt8();
  if (blockToken !== 0x77 && blockToken !== 0x7a) throw new DecodeError('E_FORMAT', 'Missing HashMap block data');
  const blockSize = blockToken === 0x77 ? reader.readUInt8() : reader.readInt32BE();
  if (blockSize !== 8) throw new DecodeError('E_FORMAT', 'Invalid HashMap block size');
  if (reader.readInt32BE() < 0) throw new DecodeError('E_FORMAT', 'Invalid HashMap capacity');
  const count = reader.readCount(8, 32767);
  const result = new Map<string, boolean>();
  for (let i = 0; i < count; i++) {
    const key = value('string') as string, active = value('boolean') as boolean;
    if (result.has(key)) throw new DecodeError('E_FORMAT', 'Duplicate remote key');
    result.set(key, active);
  }
  if (reader.readUInt8() !== 0x78) throw new DecodeError('E_FORMAT', 'Missing HashMap end marker');
  return result;
}

/**
 * Writes a genuine Java HashMap stream readable by Fleet.deserializeRemotes.
 * @param writer Bounded destination.
 * @param remotes Supported non-null string/boolean entries.
 */
export function writeJavaBooleanMap(writer: BufferWriter, remotes: Map<string, boolean>): void {
  writer.writeUInt32BE(0xaced0005); writer.writeUInt8(0x73); writer.writeUInt8(0x72);
  writer.writeBytes(DESCRIPTORS.map);
  writer.writeFloat32BE(0.75); writer.writeInt32BE(0);
  writer.writeUInt8(0x77); writer.writeUInt8(8); writer.writeInt32BE(16); writer.writeInt32BE(remotes.size);
  // HashMap descriptor and root object occupy handles zero and one.
  let nextHandle = 2, booleanDescriptor: number | undefined;
  const booleans = new Map<boolean, number>();
  for (const [key, active] of remotes) {
    if (typeof key !== 'string' || typeof active !== 'boolean') throw new DecodeError('E_RANGE', 'Remote entries must be string/boolean pairs');
    writer.writeUInt8(0x74); writer.writeJavaModifiedUTF(key); nextHandle++;
    const previous = booleans.get(active);
    if (previous !== undefined) {
      writer.writeUInt8(0x71); writer.writeInt32BE(0x7e0000 + previous);
    } else {
      writer.writeUInt8(0x73);
      if (booleanDescriptor === undefined) {
        writer.writeUInt8(0x72); writer.writeBytes(DESCRIPTORS.boolean); booleanDescriptor = nextHandle++;
      } else {
        writer.writeUInt8(0x71); writer.writeInt32BE(0x7e0000 + booleanDescriptor);
      }
      booleans.set(active, nextHandle++); writer.writeUInt8(active ? 1 : 0);
    }
  }
  writer.writeUInt8(0x78);
}
