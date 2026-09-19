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
 *   short version (2 BE bytes; new uncompressed files use 0)
 *   root tag body:
 *     signed prType byte  (positive = named, negative = anonymous, 0 = FINISH)
 *     [if named && != FINISH]: readUTF() (uint16 len + UTF-8)
 *     [if != FINISH]: payload by type
 *
 * GZIP detection: magic 0x1F 0x8B → decompress and read without a version prefix.
 *
 * Source: org.schema.schine.resource.tag.Tag.readFrom / writeTo
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import { DecodeError, boundedInteger } from './DecodeError.js';

import { TagType, TAG_TYPE_COUNT } from './TagType.js';
import { Tag, FINISH_TAG, NULL_STRING } from './Tag.js';
import { BufferReader } from './BufferReader.js';
import { BufferWriter } from './BufferWriter.js';
import { Vector3b, Vector3i, Vector3f, Vector4f } from '../types/Vectors.js';
import { Matrix3f, Matrix4f } from '../types/Matrices.js';
import { SerializableTagRegister } from '../serializable/SerializableTagRegister.js';
import type { SerializableTagElement } from '../serializable/SerializableTagElement.js';

// ── Reading ────────────────────────────────────────────────────────────────

/** Limits shared by Tag reads and validation before writing. */
export interface TagReadOptions {
  maxInputBytes?: number;
  maxInflatedBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxListLength?: number;
  /** Root-only API accepts legacy trailing bytes by default; TagDocument preserves them. */
  allowTrailingBytes?: boolean;
}

/** Internal counters are local to one call, never shared across concurrent parsers. */
interface TagBudget {
  maxDepth: number;
  maxListLength: number;
  nodesLeft: number;
}

/**
 * Creates validated per-call traversal counters.
 * @param options - Requested limits.
 * @returns A new budget.
 * @throws {DecodeError} For invalid option values.
 */
function tagBudget(options: TagReadOptions): TagBudget {
  return {
    maxDepth: boundedInteger(options.maxDepth ?? 64, 'maxDepth', 256),
    maxListLength: boundedInteger(options.maxListLength ?? 1_000_000, 'maxListLength'),
    nodesLeft: boundedInteger(options.maxNodes ?? 1_000_000, 'maxNodes'),
  };
}

/**
 * Parses a root Tag with bounded decompression and recursive traversal.
 * @param data - Save-file bytes, optionally GZIP compressed.
 * @param options - Per-call limits; defaults to 256 MiB input/output and depth 64.
 * @returns The root Tag only; use readTagDocument to preserve the file envelope.
 * @throws {DecodeError} For resource limits or disallowed trailing bytes.
 * @throws {Error} For invalid binary values, malformed UTF or missing factories.
 * @remarks writeTo is a canonical root serializer, not a byte-exact file editor.
 */
export function readFrom(data: Buffer | Uint8Array, options: TagReadOptions = {}): Tag {
  return parseRoot(data, options).root;
}

/**
 * Parses a root and captures its surrounding envelope without losing trailing bytes.
 * @param data - Complete save-file bytes.
 * @param options - Bounded parsing options.
 * @returns Root, envelope and trailing bytes.
 * @throws {Error} For malformed input or resource exhaustion.
 */
function parseRoot(data: Buffer | Uint8Array, options: TagReadOptions) {
  const maxInput = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
  const maxInflated = boundedInteger(options.maxInflatedBytes ?? 256 * 1024 * 1024, 'maxInflatedBytes');
  const budget = tagBudget(options);
  if (data.length > maxInput) throw new DecodeError('E_LIMIT', 'Tag input byte budget exceeded');
  let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const compressed = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (compressed) {
    if (maxInflated === 0) throw new DecodeError('E_LIMIT', 'Tag inflation byte budget exceeded');
    try { buf = gunzipSync(buf, { maxOutputLength: maxInflated }); }
    catch (cause) { throw new DecodeError('E_FORMAT', 'Invalid or oversized GZIP Tag payload', { cause }); }
  } else if (buf.length > maxInflated) {
    throw new DecodeError('E_LIMIT', 'Tag payload byte budget exceeded');
  }
  const reader = BufferReader.from(buf);
  const version = compressed ? null : reader.readInt16BE();
  const root = _readTag(reader, budget, 0);
  if (options.allowTrailingBytes === false && !reader.isEOF()) {
    throw new DecodeError('E_FORMAT', 'Trailing bytes after root Tag', { offset: reader.offset });
  }
  return { root, compressed, version, trailing: buf.subarray(reader.offset) };
}

/**
 * A save-file envelope that preserves legacy trailing data and original bytes.
 * Unchanged documents are returned byte-for-byte, including GZIP headers. Edits
 * preserve the envelope kind/version and trailing bytes, but recompress GZIP.
 */
export class TagDocument {
  private readonly original: Buffer;
  private readonly canonical: Buffer;
  private readonly trailing: Buffer;
  readonly root: Tag;
  readonly compressed: boolean;
  readonly version: number | null;
  private readonly options: TagReadOptions;

  /**
   * Parses and snapshots a complete document.
   * @param data - Original file contents.
   * @param options - Resource budgets applied to reading and later writing.
   * @throws {Error} For invalid input or resource exhaustion.
   */
  constructor(data: Buffer | Uint8Array, options: TagReadOptions = {}) {
    const parsed = parseRoot(data, options);
    this.root = parsed.root;
    this.compressed = parsed.compressed;
    this.version = parsed.version;
    this.trailing = Buffer.from(parsed.trailing);
    this.original = Buffer.from(data);
    this.options = { ...options };
    this.canonical = writeTo(parsed.root, options).subarray(2);
  }

  /** @returns A defensive copy of the bytes following the root Tag. */
  get trailingData(): Buffer { return Buffer.from(this.trailing); }

  /**
   * Saves the original or an edited root while preserving its file envelope.
   * @param root - Replacement root, or the document's root by default.
   * @returns A new buffer; no input buffer is modified.
   * @throws {Error} For an invalid tree or an exceeded output budget.
   */
  toBuffer(root: Tag = this.root): Buffer {
    const payload = writeTo(root, this.options).subarray(2);
    if (payload.equals(this.canonical)) return Buffer.from(this.original);
    const maxOutput = this.options.maxInflatedBytes ?? 256 * 1024 * 1024;
    const size = payload.length + this.trailing.length + (this.compressed ? 0 : 2);
    if (size > maxOutput) throw new DecodeError('E_LIMIT', 'Tag document output byte budget exceeded');
    const body = Buffer.concat([payload, this.trailing]);
    if (this.compressed) return gzipSync(body);
    const version = Buffer.alloc(2);
    version.writeInt16BE(this.version!, 0);
    return Buffer.concat([version, body]);
  }
}

/**
 * Opens an envelope-preserving save-file editor.
 * @param data - Complete save-file bytes.
 * @param options - Per-document resource limits.
 * @returns A document supporting byte-exact unmodified output.
 * @throws {Error} For invalid input or resource exhaustion.
 */
export function readTagDocument(data: Buffer | Uint8Array, options: TagReadOptions = {}): TagDocument {
  return new TagDocument(data, options);
}

/**
 * Reads a tag from a BufferReader for internal recursive use.
 */
function _readTag(reader: BufferReader, budget: TagBudget, depth: number): Tag {
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

  const { value, listType } = _readPayload(reader, type, budget, depth);

  return new Tag(type, name, value, listType);
}

/**
 * Reads a tag payload according to its type.
 * Port of Tag.readPayload().
 */
function _readPayload(
  reader: BufferReader,
  type: TagType,
  budget: TagBudget,
  depth: number
): { value: Tag['value']; listType?: TagType } {

  if (depth > budget.maxDepth || --budget.nodesLeft < 0) throw new DecodeError('E_LIMIT', 'Tag traversal budget exceeded');
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
      const len = reader.readCount(1, reader.remaining());
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
      if (listTypeOrd >= TAG_TYPE_COUNT) throw new DecodeError('E_FORMAT', `Unknown list type ${listTypeOrd}`);
      const count = reader.readCount(0, budget.maxListLength);
      if (count > budget.nodesLeft) throw new DecodeError('E_LIMIT', 'Tag node budget exceeded by list');
      const items: Tag[] = [];
      for (let i = 0; i < count; i++) {
        const { value: itemVal, listType: itemListType } = _readPayload(reader, listTypeOrd, budget, depth + 1);
        items.push(new Tag(listTypeOrd, null, itemVal, itemListType));
      }
      return { value: items, listType: listTypeOrd };
    }

    case TagType.STRUCT: {
      const children: Tag[] = [];
      // Read until FINISH
      while (true) {
        const child = _readTag(reader, budget, depth + 1);
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

  }
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * Serializes a root tag to a binary buffer.
 * Writes a canonical short version=0 followed by the tag.
 * @param tag - Root to serialize.
 * @param options - Tree and output byte budgets.
 * @returns Canonical uncompressed bytes. Use TagDocument to preserve a file envelope.
 * @throws {Error} For malformed trees, cycles, invalid values or budget exhaustion.
 */
export function writeTo(tag: Tag, options: TagReadOptions = {}): Buffer {
  validateWritableTree(tag, tagBudget(options));
  const maximum = boundedInteger(options.maxInflatedBytes ?? 256 * 1024 * 1024, 'maxInflatedBytes');
  if (maximum < 3) throw new DecodeError('E_LIMIT', 'Tag output budget is too small');
  const writer = new BufferWriter(Math.min(4096, maximum), maximum);
  writer.writeInt16BE(0); // version (Java default = 0)
  _writeTag(writer, tag);
  return writer.toBuffer();
}

/**
 * Rejects invalid heterogeneous lists, missing terminators and recursive cycles.
 * @param root - Root to validate before any bytes are written.
 * @param budget - Per-write traversal limits.
 * @throws {DecodeError} For invalid structure or resource exhaustion.
 */
function validateWritableTree(root: Tag, budget: TagBudget): void {
  const ancestors = new Set<Tag>();
  const stack: { tag: Tag; depth: number; exit: boolean }[] = [{ tag: root, depth: 0, exit: false }];
  while (stack.length) {
    const frame = stack.pop()!;
    const tag = frame.tag;
    if (frame.exit) { ancestors.delete(tag); continue; }
    if (frame.depth > budget.maxDepth || --budget.nodesLeft < 0) throw new DecodeError('E_LIMIT', 'Tag write traversal budget exceeded');
    if (!(tag instanceof Tag) || !Number.isInteger(tag.type) || tag.type < 0 || tag.type >= TAG_TYPE_COUNT) throw new DecodeError('E_FORMAT', 'Invalid Tag type');
    if (ancestors.has(tag)) throw new DecodeError('E_FORMAT', 'Cyclic Tag tree');
    if (tag.type !== TagType.STRUCT && tag.type !== TagType.LIST) continue;
    const items = tag.value;
    if (!Array.isArray(items) || items.length > budget.maxListLength) throw new DecodeError('E_RANGE', 'Invalid Tag collection');
    if (tag.type === TagType.STRUCT) {
      if (!items.length || items[items.length - 1].type !== TagType.FINISH || items.slice(0, -1).some(t => t.type === TagType.FINISH)) {
        throw new DecodeError('E_FORMAT', 'STRUCT requires exactly one final FINISH tag');
      }
    } else {
      const type = tag.listType ?? TagType.NOTHING;
      if (!Number.isInteger(type) || type < 0 || type >= TAG_TYPE_COUNT || items.some(t => t.type !== type)) {
        throw new DecodeError('E_FORMAT', 'LIST payloads must match their declared type');
      }
    }
    if (items.length > budget.nodesLeft) throw new DecodeError('E_LIMIT', 'Tag write node budget exceeded');
    ancestors.add(tag);
    stack.push({ tag, depth: frame.depth, exit: true });
    for (let i = items.length - 1; i >= 0; i--) stack.push({ tag: items[i], depth: frame.depth + 1, exit: false });
  }
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
