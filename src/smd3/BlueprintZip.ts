/**
 * @fileoverview Lossless bounded ZIP carrier for complete blueprint resources.
 * Java's FolderZipper uses ZipOutputStream with UTF-8 names and DEFLATE data
 * descriptors. Both those records and ordinary stored ZIP entries are retained.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import { BlueprintReadContext, crc32 } from './BlueprintReadContext.js';
import type { BlueprintParseOptions } from './BlueprintReadContext.js';

/** One validated central-directory entry and its complete physical local record. */
interface ZipRecord {
  name: string;
  value: Buffer | null;
  central: Buffer;
  local: Buffer;
  offset: number;
  end: number;
  headerLength: number;
  descriptorLength: number;
  method: number;
}

/**
 * Locates the exact ZIP end record; preflightArchive has already validated it.
 * @param bytes - Archive with a conventional end record and optional comment.
 * @returns Offset of the end record.
 */
function endOffset(bytes: Buffer): number {
  let offset = bytes.length - 22;
  while (bytes.readUInt32LE(offset) !== 0x06054b50 || offset + 22 + bytes.readUInt16LE(offset + 20) !== bytes.length) offset--;
  return offset;
}

/**
 * Validates paths and file/directory relationships without normalizing names.
 * @param names - Exact ZIP names, including trailing slashes on directories.
 * @throws {DecodeError} For unsafe, duplicate or conflicting resource paths.
 */
function validatePaths(names: Iterable<string>): void {
  const entries = new Set<string>(), files = new Set<string>(), parents = new Set<string>();
  for (const name of names) {
    const directory = name.endsWith('/'), clean = directory ? name.slice(0, -1) : name;
    const parts = clean.split('/');
    if (!name || name.length > 4096 || /[\\\0:]/.test(name) || parts.some(part => part === '' || part === '.' || part === '..') ||
      Buffer.from(name).toString('utf8') !== name) throw new DecodeError('E_FORMAT', 'Unsafe ZIP resource path', { path: name });
    if (entries.has(name)) throw new DecodeError('E_FORMAT', 'Duplicate ZIP resource path', { path: name });
    entries.add(name);
    if (directory) parents.add(clean); else files.add(clean);
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join('/'));
  }
  for (const file of files) {
    if (parents.has(file)) throw new DecodeError('E_FORMAT', 'ZIP file conflicts with a directory or parent path', { path: file });
  }
}

/**
 * Checks extra-field framing and rejects ZIP64 before interpreting narrow fields.
 * @param extra - Local or central extra-field bytes.
 * @param name - Resource path for errors.
 */
function validateExtra(extra: Buffer, name: string): void {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw new DecodeError('E_FORMAT', 'Truncated ZIP extra field', { path: name });
    const kind = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2);
    if (kind === 1) throw new DecodeError('E_UNSUPPORTED', 'ZIP64 resource extras are not supported', { path: name });
    offset += 4 + size;
    if (offset > extra.length) throw new DecodeError('E_FORMAT', 'Truncated ZIP extra payload', { path: name });
  }
}

/**
 * Clones caller-owned entry data after checking the complete requested inventory.
 * @param entries - Replacement resource map.
 * @param options - Limits for the resulting resource set.
 * @returns Detached values retaining the caller's iteration order.
 */
function snapshotEntries(entries: ReadonlyMap<string, Buffer | null>, options: BlueprintParseOptions): Map<string, Buffer | null> {
  const context = new BlueprintReadContext(options), result = new Map<string, Buffer | null>();
  validatePaths(entries.keys());
  for (const [name, value] of entries) {
    context.chargeFile();
    if (name.endsWith('/') !== (value === null) || (value !== null && !Buffer.isBuffer(value))) {
      throw new DecodeError('E_FORMAT', 'ZIP directories require null and files require Buffer values', { path: name });
    }
    context.chargeBytes(value === null ? 0 : value.length);
    result.set(name, value === null ? null : Buffer.from(value));
  }
  return result;
}

/**
 * Encodes a replacement local record while retaining headers, names and extras.
 * @param record - Existing record or a deterministic new-entry template.
 * @param value - New bytes; null denotes an empty directory.
 * @param maximum - Maximum compressed allocation allowed for this output.
 * @returns Detached local and central records with updated CRC and lengths.
 */
function encodeRecord(record: ZipRecord, value: Buffer | null, maximum: number): ZipRecord {
  const bytes = value === null ? Buffer.alloc(0) : value;
  let compressed: Buffer;
  try {
    compressed = record.method === 0 ? bytes : deflateRawSync(bytes, { level: 6, maxOutputLength: Math.max(1, maximum) });
  } catch (cause) { throw new DecodeError('E_LIMIT', 'ZIP compression exceeds output budget', { path: record.name, cause }); }
  const checksum = crc32(bytes), central = Buffer.from(record.central), header = Buffer.from(record.local.subarray(0, record.headerLength));
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24);
  const descriptor = Buffer.alloc(record.descriptorLength);
  if (descriptor.length !== 0) {
    header.writeUInt32LE(0, 14); header.writeUInt32LE(0, 18); header.writeUInt32LE(0, 22);
    if (descriptor.length === 16) descriptor.writeUInt32LE(0x08074b50, 0);
    const start = descriptor.length - 12;
    descriptor.writeUInt32LE(checksum, start); descriptor.writeUInt32LE(compressed.length, start + 4); descriptor.writeUInt32LE(bytes.length, start + 8);
  } else {
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22);
  }
  return { ...record, value, central, local: Buffer.concat([header, compressed, descriptor]) };
}

/**
 * Creates a stable ZIP32 header template, using 1980-01-01 and UTF-8 paths.
 * @param name - Validated relative resource path.
 * @returns Empty template suitable for encodeRecord.
 */
function newRecord(name: string): ZipRecord {
  const encodedName = Buffer.from(name), directory = name.endsWith('/'), method = directory ? 0 : 8;
  const local = Buffer.alloc(30 + encodedName.length), central = Buffer.alloc(46 + encodedName.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(method, 8); local.writeUInt16LE(0x21, 12); local.writeUInt16LE(encodedName.length, 26); encodedName.copy(local, 30);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10); central.writeUInt16LE(0x21, 14);
  central.writeUInt16LE(encodedName.length, 28); central.writeUInt32LE(directory ? 0x10 : 0, 38); encodedName.copy(central, 46);
  return { name, value: null, central, local, offset: 0, end: 0, headerLength: local.length, descriptorLength: 0, method };
}

/** Lossless archive carrier; resource inspection never exposes mutable internal bytes. */
export class BlueprintZip {
  private readonly original: Buffer;
  private readonly options: BlueprintParseOptions;
  private readonly records: ZipRecord[] = [];
  private readonly directoryOffset: number;
  private readonly directoryEnd: number;
  private readonly end: number;

  /**
   * Validates every entry, including unknown resources, before retaining a snapshot.
   * @param data - Complete ZIP32 archive with stored or deflated entries.
   * @param options - Aggregate input, entry-count and decoded-byte limits.
   * @throws {DecodeError} For malformed, unsupported, overlapping or oversized data.
   */
  constructor(data: Buffer | Uint8Array, options: BlueprintParseOptions = {}) {
    this.options = { ...options };
    const context = new BlueprintReadContext(this.options);
    if (data.length > context.maxInputBytes) throw new DecodeError('E_LIMIT', 'Blueprint ZIP input budget exceeded');
    this.original = Buffer.from(data);
    context.preflightArchive(this.original);
    this.end = endOffset(this.original);
    this.directoryOffset = this.original.readUInt32LE(this.end + 16);
    this.directoryEnd = this.directoryOffset + this.original.readUInt32LE(this.end + 12);
    let offset = this.directoryOffset;
    while (offset < this.directoryEnd) {
      const length = 46 + this.original.readUInt16LE(offset + 28) + this.original.readUInt16LE(offset + 30) + this.original.readUInt16LE(offset + 32);
      this.records.push(this.readRecord(this.original.subarray(offset, offset + length), context));
      offset += length;
    }
    validatePaths(this.records.map(record => record.name));
    const physical = [...this.records].sort((left, right) => left.offset - right.offset);
    let previousEnd = 0;
    for (const record of physical) {
      if (record.offset < previousEnd) throw new DecodeError('E_FORMAT', 'Overlapping ZIP local records', { path: record.name });
      previousEnd = record.end;
    }
  }

  /**
   * Returns detached snapshots of every file and explicit directory entry.
   * @returns Resource map in the original central-directory order.
   */
  getEntries(): Map<string, Buffer | null> {
    return new Map(this.records.map(record => [record.name, record.value === null ? null : Buffer.from(record.value)]));
  }

  /**
   * Serializes edits while retaining untouched compressed records and ZIP metadata.
   * @param entries - Complete desired resource inventory; omissions remove entries.
   * @param maxOutputBytes - Output limit, defaulting to the archive input limit.
   * @returns Detached ZIP bytes; unchanged inventories reproduce the original exactly.
   * @throws {DecodeError} For invalid edits, output limits or opaque directory trailers.
   */
  toBuffer(entries: ReadonlyMap<string, Buffer | null>, maxOutputBytes?: number): Buffer {
    const maximum = boundedInteger(maxOutputBytes ?? this.options.maxInputBytes ?? 256 * 1024 * 1024, 'maxOutputBytes', 0xfffffffe);
    const values = snapshotEntries(entries, this.options);
    if (values.size >= 0xffff) throw new DecodeError('E_UNSUPPORTED', 'ZIP64 entry counts are not supported');
    const unchanged = (record: ZipRecord): boolean => values.has(record.name) &&
      (record.value === null ? values.get(record.name) === null : record.value.equals(values.get(record.name)!));
    if (values.size === this.records.length && this.records.every(unchanged)) {
      if (this.original.length > maximum) throw new DecodeError('E_LIMIT', 'Blueprint ZIP output budget exceeded');
      return Buffer.from(this.original);
    }
    if (this.directoryEnd !== this.end) throw new DecodeError('E_UNSUPPORTED', 'Cannot edit an opaque ZIP central-directory trailer');
    const chunks: Buffer[] = [], outputRecords = new Map<string, ZipRecord>();
    let length = 0;
    const append = (bytes: Buffer): void => {
      if (length + bytes.length > maximum) throw new DecodeError('E_LIMIT', 'Blueprint ZIP output budget exceeded');
      chunks.push(bytes); length += bytes.length;
    };
    const appendRecord = (record: ZipRecord): void => {
      const offset = length;
      append(record.local);
      const central = Buffer.from(record.central); central.writeUInt32LE(offset, 42);
      outputRecords.set(record.name, { ...record, central });
    };
    let cursor = 0;
    for (const record of [...this.records].sort((left, right) => left.offset - right.offset)) {
      append(this.original.subarray(cursor, record.offset));
      if (values.has(record.name)) appendRecord(unchanged(record) ? record : encodeRecord(record, values.get(record.name)!, maximum - length));
      cursor = record.end;
    }
    append(this.original.subarray(cursor, this.directoryOffset));
    const known = new Set(this.records.map(record => record.name));
    for (const name of [...values.keys()].filter(name => !known.has(name)).sort()) {
      appendRecord(encodeRecord(newRecord(name), values.get(name)!, maximum - length));
    }
    const directoryOffset = length;
    for (const record of this.records) {
      const updated = outputRecords.get(record.name);
      if (updated) { append(updated.central); outputRecords.delete(record.name); }
    }
    for (const record of outputRecords.values()) append(record.central);
    const end = Buffer.from(this.original.subarray(this.end));
    end.writeUInt16LE(values.size, 8); end.writeUInt16LE(values.size, 10);
    end.writeUInt32LE(length - directoryOffset, 12); end.writeUInt32LE(directoryOffset, 16);
    append(end);
    return Buffer.concat(chunks, length);
  }

  /**
   * Checks central/local agreement, descriptor boundaries, decompressed size and CRC.
   * @param central - Exactly one central directory record.
   * @param context - Shared limits charged before decompression.
   * @returns Validated local record and detached decoded payload.
   */
  private readRecord(central: Buffer, context: BlueprintReadContext): ZipRecord {
    const rawName = central.subarray(46, 46 + central.readUInt16LE(28)), name = rawName.toString('utf8');
    if (!Buffer.from(name).equals(rawName)) throw new DecodeError('E_UNSUPPORTED', 'Non-UTF-8 ZIP names are not supported');
    const flags = central.readUInt16LE(8), method = central.readUInt16LE(10), checksum = central.readUInt32LE(16);
    const compressedSize = central.readUInt32LE(20), size = central.readUInt32LE(24), offset = central.readUInt32LE(42);
    if ((flags & ~0x080e) !== 0 || (method !== 0 && method !== 8) || central.readUInt16LE(34) !== 0 ||
      compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new DecodeError('E_UNSUPPORTED', 'Unsupported ZIP encryption, compression, disk or ZIP64 entry', { path: name });
    }
    validateExtra(central.subarray(46 + rawName.length, 46 + rawName.length + central.readUInt16LE(30)), name);
    context.chargeFile(); context.chargeBytes(size);
    if (offset + 30 > this.directoryOffset || this.original.readUInt32LE(offset) !== 0x04034b50) {
      throw new DecodeError('E_TRUNCATED', 'Invalid ZIP local header bounds or signature', { path: name, offset });
    }
    const local = this.original.subarray(offset), headerLength = 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    let end = offset + headerLength + compressedSize;
    if (end > this.directoryOffset) throw new DecodeError('E_TRUNCATED', 'ZIP payload overlaps the central directory', { path: name, offset });
    if (!local.subarray(30, 30 + local.readUInt16LE(26)).equals(rawName) ||
      !local.subarray(4, 14).equals(central.subarray(6, 16))) {
      throw new DecodeError('E_FORMAT', 'ZIP local and central headers disagree', { path: name, offset });
    }
    validateExtra(local.subarray(30 + rawName.length, headerLength), name);
    const descriptorFlag = (flags & 8) !== 0;
    for (const [field, expected] of [[14, checksum], [18, compressedSize], [22, size]]) {
      const actual = local.readUInt32LE(field);
      if (actual !== expected && (!descriptorFlag || actual !== 0)) throw new DecodeError('E_FORMAT', 'ZIP local sizes or CRC disagree', { path: name, offset });
    }
    let descriptorLength = 0;
    if (descriptorFlag) {
      // A bare descriptor's CRC may itself equal the optional signature.
      const signed = end + 16 <= this.directoryOffset && this.original.readUInt32LE(end) === 0x08074b50 &&
        this.original.readUInt32LE(end + 4) === checksum && this.original.readUInt32LE(end + 8) === compressedSize &&
        this.original.readUInt32LE(end + 12) === size;
      descriptorLength = signed ? 16 : 12;
      const start = end + descriptorLength - 12;
      if (end + descriptorLength > this.directoryOffset || this.original.readUInt32LE(start) !== checksum ||
        this.original.readUInt32LE(start + 4) !== compressedSize || this.original.readUInt32LE(start + 8) !== size) {
        throw new DecodeError('E_FORMAT', 'Invalid ZIP data descriptor', { path: name, offset: end });
      }
      end += descriptorLength;
    }
    const compressed = this.original.subarray(offset + headerLength, offset + headerLength + compressedSize);
    let value: Buffer;
    try { value = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) }); }
    catch (cause) { throw new DecodeError('E_FORMAT', 'Invalid or oversized ZIP payload', { path: name, cause }); }
    if (value.length !== size || crc32(value) !== checksum || (name.endsWith('/') && value.length !== 0)) {
      throw new DecodeError('E_FORMAT', 'ZIP size, CRC or directory payload mismatch', { path: name });
    }
    return { name, value: name.endsWith('/') ? null : value, central, local: this.original.subarray(offset, end), offset, end, headerLength, descriptorLength, method };
  }
}

/**
 * Builds a deterministic new ZIP from a complete resource map.
 * @param entries - File buffers and null-valued explicit directory paths.
 * @param options - Input/output and aggregate resource limits.
 * @returns ZIP32 bytes with stable ordering, timestamps and compression settings.
 */
export function createBlueprintZip(entries: ReadonlyMap<string, Buffer | null>, options: BlueprintParseOptions = {}): Buffer {
  const empty = Buffer.alloc(22); empty.writeUInt32LE(0x06054b50, 0);
  return new BlueprintZip(empty, options).toBuffer(entries);
}
