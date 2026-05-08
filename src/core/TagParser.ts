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
 *   short version (2 BE bytes, value 1)
 *   root tag body:
 *     signed prType byte  (positive = named, negative = anonymous, 0 = FINISH)
 *     [if named && != FINISH]: readUTF() (uint16 len + UTF-8)
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
 */
export function readFrom(data: Buffer | Uint8Array): Tag {
  let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // GZIP detection (magic bytes 0x1F 0x8B)
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (isGzip) {
    buf = gunzipSync(buf);
    // GZIP : no leading short version; read the root tag directly
    const reader = BufferReader.from(buf);
    return _readTag(reader);
  }

  // Non-GZIP: read and ignore the short version
  const reader = BufferReader.from(buf);
  reader.readInt16BE(); // version (ignored, typical value = 1)
  return _readTag(reader);
}

/**
 * Reads a tag from a BufferReader for internal recursive use.
 */
function _readTag(reader: BufferReader): Tag {
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

  const { value, listType } = _readPayload(reader, type);

  return new Tag(type, name, value, listType);
}

/**
 * Reads a tag payload according to its type.
 * Port of Tag.readPayload().
 */
function _readPayload(
  reader: BufferReader,
  type: TagType
): { value: Tag['value']; listType?: TagType } {

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
      const items: Tag[] = [];
      for (let i = 0; i < count; i++) {
        const { value: itemVal, listType: itemListType } = _readPayload(reader, listTypeOrd);
        items.push(new Tag(listTypeOrd, null, itemVal, itemListType));
      }
      return { value: items, listType: listTypeOrd };
    }

    case TagType.STRUCT: {
      const children: Tag[] = [];
      // Read until FINISH
      while (true) {
        const child = _readTag(reader);
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
 * Port of Tag.writeTo() — writes short version=1 followed by the tag.
 */
export function writeTo(tag: Tag): Buffer {
  const writer = new BufferWriter();
  writer.writeInt16BE(0); // version (Java default = 0)
  _writeTag(writer, tag);
  return writer.toBuffer();
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
