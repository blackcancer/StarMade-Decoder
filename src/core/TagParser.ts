/**
 * @fileoverview Tag Parser
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * TagParser — reader and writer for StarMade binary files.
 *
 * Exact port of Java Tag.readFrom() / Tag.writeTo().
 *
 * Format (non-GZIP) :
 *   short version (2 BE bytes, Java default 0)
 *   root tag body:
 *     signed prType byte  (positive = named, negative = anonymous, 0 = FINISH)
 *     [if named && != FINISH]: readUTF() (uint16 len + Modified UTF-8)
 *     [if != FINISH]: payload by type
 *
 * GZIP detection: magic 0x1F 0x8B → decompress and read without a version prefix.
 *
 * Source: org.schema.schine.resource.tag.Tag.readFrom / writeTo
 */

import { gunzipSync } from 'zlib';

import { TagType, TAG_TYPE_COUNT } from './TagType.js';
import { Tag, FINISH_TAG, NULL_STRING } from './Tag.js';
import { BufferReader } from './BufferReader.js';
import { BufferWriter } from './BufferWriter.js';
import { Vector3b, Vector3i, Vector3f, Vector4f } from '../types/Vectors.js';
import { Matrix3f, Matrix4f } from '../types/Matrices.js';
import { SerializableTagRegister } from '../serializable/SerializableTagRegister.js';
import type { SerializableTagElement } from '../serializable/SerializableTagElement.js';

// ── Reading ────────────────────────────────────────────────────────────────

/**
 * Reads a tag from a binary buffer with automatic GZIP detection.
 * @param data Input bytes.
 * @param options Explicit allocation, decompression and recursion budgets.
 * @returns The decoded root Tag.
 * @throws {Error} On invalid input or exhausted budgets.
 */
export function readFrom(data: Buffer | Uint8Array, options: TagReadOptions = {}): Tag {
  const limits = { maxInputBytes: 64 * 1024 ** 2, maxInflatedBytes: 128 * 1024 ** 2,
    maxDepth: 128, maxTags: 1_000_000, maxByteArrayBytes: 64 * 1024 ** 2, ...options };
  for (const key of ['maxInputBytes', 'maxInflatedBytes', 'maxDepth', 'maxTags', 'maxByteArrayBytes'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new RangeError(`Invalid ${key}`);
  }
  if (limits.maxDepth > 256) throw new RangeError('Tag maxDepth cannot exceed 256');
  if (data.length > limits.maxInputBytes) throw new RangeError('Tag input byte budget exceeded');
  let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (isGzip) buf = gunzipSync(buf, { maxOutputLength: limits.maxInflatedBytes });
  const reader = BufferReader.from(buf);
  if (!isGzip) reader.readInt16BE();
  const context: TagReadContext = { remaining: limits.maxTags, maxDepth: limits.maxDepth, maxByteArrayBytes: limits.maxByteArrayBytes };
  const tag = _readTag(reader, context, 0);
  if (options.rejectTrailingBytes && !reader.isEOF()) throw new Error(`Trailing Tag bytes at ${reader.offset}`);
  return tag;
}

/** Limits apply to each root Tag document, including nested lists/structures. */
export interface TagReadOptions {
  maxInputBytes?: number;
  maxInflatedBytes?: number;
  maxDepth?: number;
  maxTags?: number;
  maxByteArrayBytes?: number;
  /** Java permits trailing envelope bytes; enable this for standalone documents. */
  rejectTrailingBytes?: boolean;
}
/** Per-document mutable recursion/allocation budget. */
interface TagReadContext { remaining: number; maxDepth: number; maxByteArrayBytes: number; }

/**
 * Reads a tag from a BufferReader for internal recursive use.
 */
function _readTag(reader: BufferReader, context: TagReadContext, depth: number): Tag {
  if (--context.remaining < 0) throw new RangeError('Tag node budget exceeded');
  const prType = reader.readInt8();
  const typeOrd = Math.abs(prType);
  const hasName = prType > 0;

  if (typeOrd === TagType.FINISH) {
    return FINISH_TAG;
  }

  if (typeOrd < 0 || typeOrd >= TAG_TYPE_COUNT) {
    throw new Error(`Unknown tag type ordinal: ${typeOrd} at offset ${reader.offset}`);
  }

  const type = typeOrd as TagType;

  let name: string | null = null;
  if (hasName) {
    name = reader.readJavaUTF();
  }

  const { value, listType } = _readPayload(reader, type, context, depth);

  return new Tag(type, name, value, listType);
}

/**
 * Reads a tag payload according to its type.
 * Port of Tag.readPayload().
 */
function _readPayload(
  reader: BufferReader,
  type: TagType,
  context: TagReadContext,
  depth: number
): { value: Tag['value']; listType?: TagType } {

  if (depth > context.maxDepth) throw new RangeError('Tag depth budget exceeded');
  switch (type) {
    case TagType.FINISH:
      return { value: null };

    case TagType.BYTE:
      return { value: reader.readInt8() };

    case TagType.SHORT:
      return { value: reader.readInt16BE() };

    case TagType.INT:
      return { value: reader.readInt32BE() };

    case TagType.LONG:
      return { value: reader.readInt64BE() };

    case TagType.FLOAT:
      return { value: reader.readFloat32BE() };

    case TagType.DOUBLE:
      return { value: reader.readFloat64BE() };

    case TagType.BYTE_ARRAY: {
      const len = reader.readInt32BE();
      if (len < 0 || len > context.maxByteArrayBytes) throw new RangeError('Invalid Tag byte array length');
      return { value: reader.readBytes(len) };
    }

    case TagType.STRING:
      return { value: reader.readJavaUTF() };

    case TagType.VECTOR3f:
      return { value: new Vector3f(reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE()) };

    case TagType.VECTOR3i:
      return { value: new Vector3i(reader.readInt32BE(), reader.readInt32BE(), reader.readInt32BE()) };

    case TagType.VECTOR3b:
      return { value: new Vector3b(reader.readInt8(), reader.readInt8(), reader.readInt8()) };

    case TagType.LIST: {
      const listTypeOrd = reader.readUInt8() as TagType;
      const count = reader.readInt32BE();
      if (listTypeOrd >= TAG_TYPE_COUNT || count < 0 || count > context.remaining) throw new RangeError('Invalid Tag list type/count or node budget');
      const items: Tag[] = [];
      for (let i = 0; i < count; i++) {
        context.remaining--;
        const { value: itemVal, listType: itemListType } = _readPayload(reader, listTypeOrd, context, depth + 1);
        items.push(new Tag(listTypeOrd, null, itemVal, itemListType));
      }
      return { value: items, listType: listTypeOrd };
    }

    case TagType.STRUCT: {
      const children: Tag[] = [];
      // Read until FINISH
      while (true) {
        const child = _readTag(reader, context, depth + 1);
        children.push(child);
        if (child.type === TagType.FINISH) break;
      }
      return { value: children };
    }

    case TagType.SERIALIZABLE: {
      const factoryId = reader.readUInt8();
      const factory = SerializableTagRegister.register[factoryId];
      if (!factory) {
        throw new Error(`No SerializableTagFactory registered for id: ${factoryId}. ` +
          `Call registerAllFactories() from src/serializable/Factories.ts before parsing.`);
      }
      return { value: factory.create(reader) as import('../serializable/SerializableTagElement.js').SerializableTagElement };
    }

    case TagType.VECTOR4f:
      return { value: new Vector4f(
        reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE()
      )};

    case TagType.MATRIX4f: {
      const m = new Matrix4f(
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
      );
      return { value: m };
    }

    case TagType.NOTHING:
      return { value: null };

    case TagType.MATRIX3f: {
      const m = new Matrix3f(
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
        reader.readFloat32BE(), reader.readFloat32BE(), reader.readFloat32BE(),
      );
      return { value: m };
    }

    default:
      throw new Error(`Unhandled tag type: ${type}`);
  }
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * Serializes a root tag to a binary buffer.
 * Port of Tag.writeTo() — writes short version=0 followed by the tag.
 */
export function writeTo(tag: Tag): Buffer {
  validateTagTree(tag);
  const writer = new BufferWriter();
  writer.writeInt16BE(0); // version (Java default = 0)
  _writeTag(writer, tag);
  return writer.toBuffer();
}

/**
 * Validates writable tree invariants before allocating output.
 * @param root Tag document.
 * @throws {Error} For cycles, excessive depth, heterogeneous lists or unterminated structures.
 */
function validateTagTree(root: Tag): void {
  const ancestors = new Set<Tag>();
  let nodes = 0;
  const visit = (tag: Tag, depth: number): void => {
    if (++nodes > 1_000_000 || depth > 128) throw new RangeError('Tag write depth/node budget exceeded');
    if (ancestors.has(tag)) throw new Error('Cyclic Tag tree');
    if (!tag || !Number.isInteger(tag.type) || tag.type < 0 || tag.type >= TAG_TYPE_COUNT) throw new TypeError('Invalid Tag type');
    if (tag.type !== TagType.STRUCT && tag.type !== TagType.LIST) return;
    if (!Array.isArray(tag.value)) throw new TypeError('Tag container requires a Tag array');
    const items = tag.value;
    if (tag.type === TagType.STRUCT) {
      if (items.length === 0 || items.at(-1)?.type !== TagType.FINISH ||
          items.slice(0, -1).some(item => item.type === TagType.FINISH)) throw new Error('STRUCT requires exactly one final FINISH Tag');
    } else {
      const type = tag.listType ?? TagType.NOTHING;
      if (!Number.isInteger(type) || type < 0 || type >= TAG_TYPE_COUNT || items.some(item => item.type !== type)) {
        throw new Error('LIST requires a valid homogeneous element type');
      }
    }
    ancestors.add(tag);
    for (const item of items) visit(item, depth + 1);
    ancestors.delete(tag);
  };
  visit(root, 0);
}

/**
 * Writes a tag into the writer.
 */
function _writeTag(writer: BufferWriter, tag: Tag): void {
  const hasName = tag.name !== null && tag.name !== NULL_STRING;

  // prType: positive when named, negative when anonymous
  // FINISH => 0 whether named or not (Java always writes -0 = 0)
  if (tag.type === TagType.FINISH) {
    writer.writeInt8(0);
    return;
  }

  writer.writeInt8(hasName ? tag.type : -tag.type);

  if (hasName) {
    writer.writeJavaUTF(tag.name!);
  }

  _writePayload(writer, tag);
}

/**
 * Writes a tag payload.
 * Port of Tag.writePayload().
 */
function _writePayload(writer: BufferWriter, tag: Tag): void {
  switch (tag.type) {
    case TagType.FINISH:
      break;

    case TagType.BYTE:
      writer.writeInt8(tag.value as number);
      break;

    case TagType.SHORT:
      writer.writeInt16BE(tag.value as number);
      break;

    case TagType.INT:
      writer.writeInt32BE(tag.value as number);
      break;

    case TagType.LONG:
      writer.writeInt64BE(tag.value as bigint);
      break;

    case TagType.FLOAT:
      writer.writeFloat32BE(tag.value as number);
      break;

    case TagType.DOUBLE:
      writer.writeFloat64BE(tag.value as number);
      break;

    case TagType.BYTE_ARRAY: {
      const ba = tag.value as Uint8Array;
      writer.writeInt32BE(ba.length);
      writer.writeBytes(ba);
      break;
    }

    case TagType.STRING:
      writer.writeJavaUTF(tag.value as string);
      break;

    case TagType.NOTHING:
      break;

    case TagType.VECTOR3f: {
      const v = tag.value as Vector3f;
      writer.writeFloat32BE(v.x); writer.writeFloat32BE(v.y); writer.writeFloat32BE(v.z);
      break;
    }

    case TagType.VECTOR3i: {
      const v = tag.value as Vector3i;
      writer.writeInt32BE(v.x); writer.writeInt32BE(v.y); writer.writeInt32BE(v.z);
      break;
    }

    case TagType.VECTOR3b: {
      const v = tag.value as Vector3b;
      writer.writeInt8(v.x); writer.writeInt8(v.y); writer.writeInt8(v.z);
      break;
    }

    case TagType.SERIALIZABLE: {
      const se = tag.value as import('../serializable/SerializableTagElement.js').SerializableTagElement;
      writer.writeUInt8(se.getFactoryId());
      se.writeToTag(writer);
      break;
    }

    case TagType.LIST: {
      const items = tag.value as Tag[];
      const lt = tag.listType ?? TagType.NOTHING;
      writer.writeUInt8(lt);
      writer.writeInt32BE(items.length);
      for (const item of items) {
        _writePayload(writer, item);
      }
      break;
    }

    case TagType.STRUCT: {
      const subtags = tag.value as Tag[];
      for (const sub of subtags) {
        _writeTag(writer, sub);
      }
      break;
    }

    case TagType.VECTOR4f: {
      const v = tag.value as Vector4f;
      writer.writeFloat32BE(v.x); writer.writeFloat32BE(v.y);
      writer.writeFloat32BE(v.z); writer.writeFloat32BE(v.w);
      break;
    }

    case TagType.MATRIX4f: {
      const m = tag.value as Matrix4f;
      writer.writeFloat32BE(m.m00); writer.writeFloat32BE(m.m01);
      writer.writeFloat32BE(m.m02); writer.writeFloat32BE(m.m03);
      writer.writeFloat32BE(m.m10); writer.writeFloat32BE(m.m11);
      writer.writeFloat32BE(m.m12); writer.writeFloat32BE(m.m13);
      writer.writeFloat32BE(m.m20); writer.writeFloat32BE(m.m21);
      writer.writeFloat32BE(m.m22); writer.writeFloat32BE(m.m23);
      writer.writeFloat32BE(m.m30); writer.writeFloat32BE(m.m31);
      writer.writeFloat32BE(m.m32); writer.writeFloat32BE(m.m33);
      break;
    }

    case TagType.MATRIX3f: {
      const m = tag.value as Matrix3f;
      writer.writeFloat32BE(m.m00); writer.writeFloat32BE(m.m01); writer.writeFloat32BE(m.m02);
      writer.writeFloat32BE(m.m10); writer.writeFloat32BE(m.m11); writer.writeFloat32BE(m.m12);
      writer.writeFloat32BE(m.m20); writer.writeFloat32BE(m.m21); writer.writeFloat32BE(m.m22);
      break;
    }

    default:
      throw new Error(`Unhandled tag type in writePayload: ${tag.type}`);
  }
}
