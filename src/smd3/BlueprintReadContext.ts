/**
 * @fileoverview Per-call blueprint parsing budgets and bounded ZIP extraction.
 *
 * Only stored/deflated unencrypted ZIP entries are accepted. Declared sizes are
 * checked before inflation; actual size and CRC32 are checked after inflation.
 * Recovery never suppresses budget exhaustion and always records omissions.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import type AdmZip from 'adm-zip';
import { inflateRawSync } from 'node:zlib';
import { DecodeError, boundedInteger, reportDecodeFailure } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { parseSmd3, BLOCK_COUNT } from './Smd3Parser.js';
import type { Smd3File, Smd3ParseOptions } from './Smd3Parser.js';

/** Budgets are aggregate across one archive, including all attached entities. */
export interface BlueprintParseOptions {
  mode?: 'strict' | 'recover';
  maxInputBytes?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
  maxEntities?: number;
  maxDepth?: number;
  maxBlocks?: number;
  /** Aggregate Tag nodes, FINISH markers and SERIALIZABLE items across all metadata. */
  maxTagNodes?: number;
  segmentOptions?: Omit<Smd3ParseOptions, 'mode' | 'maxBlocks'>;
}

/** CRC lookup table generated once; polynomial is the ZIP CRC32 polynomial. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});

/**
 * Calculates the ZIP CRC32 without allocating intermediate arrays.
 * @param bytes - Uncompressed entry bytes.
 * @returns Unsigned CRC32.
 */
export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Shared parsing context; instantiate once per archive or folder operation. */
export class BlueprintReadContext {
  readonly mode: 'strict' | 'recover';
  readonly diagnostics: DecodeDiagnostic[] = [];
  readonly maxInputBytes: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxEntries: number;
  readonly maxEntities: number;
  readonly maxDepth: number;
  readonly maxBlocks: number;
  /** Nested GZIP Tags share the same byte allowance as archive/folder entries. */
  readonly tagOptions: TagReadOptions;
  private readonly byteBudget: { remainingBytes: number };
  private blocks = 0;
  private entities = 0;
  private files = 0;

  /**
   * Creates validated budgets with conservative configurable defaults.
   * @param options - Operation-local budgets and strict/recovery policy.
   * @throws {DecodeError} For invalid options.
   */
  constructor(private readonly options: BlueprintParseOptions = {}) {
    this.mode = options.mode ?? 'strict';
    if (this.mode !== 'strict' && this.mode !== 'recover') throw new DecodeError('E_RANGE', 'Invalid blueprint parsing mode');
    this.maxInputBytes = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
    this.maxEntryBytes = boundedInteger(options.maxEntryBytes ?? 128 * 1024 * 1024, 'maxEntryBytes');
    this.maxTotalBytes = boundedInteger(options.maxTotalBytes ?? 512 * 1024 * 1024, 'maxTotalBytes');
    this.maxEntries = boundedInteger(options.maxEntries ?? 10000, 'maxEntries');
    this.maxEntities = boundedInteger(options.maxEntities ?? 1024, 'maxEntities');
    this.maxDepth = boundedInteger(options.maxDepth ?? 64, 'maxDepth', 256);
    this.maxBlocks = boundedInteger(options.maxBlocks ?? 16 * 1024 * 1024, 'maxBlocks');
    this.byteBudget = { remainingBytes: this.maxTotalBytes };
    this.tagOptions = {
      maxInflatedBytes: this.maxEntryBytes, sharedInflationBudget: this.byteBudget,
      sharedNodeBudget: { remainingNodes: boundedInteger(options.maxTagNodes ?? 1_000_000, 'maxTagNodes') },
    };
  }

  /**
   * Accounts for an entity before descending into its children.
   * @param depth - Root depth is zero.
   * @throws {DecodeError} If an entity or depth limit is exceeded.
   */
  enterEntity(depth: number): void {
    if (depth > this.maxDepth || ++this.entities > this.maxEntities) throw new DecodeError('E_LIMIT', 'Blueprint entity/depth budget exceeded');
  }

  /**
   * Charges bytes before allocation or decompression.
   * @param size - Declared or filesystem byte length.
   * @throws {DecodeError} If an entry or aggregate byte budget is exceeded.
   */
  chargeBytes(size: number): void {
    boundedInteger(size, 'entry byte length');
    if (size > this.maxEntryBytes || size > this.byteBudget.remainingBytes) throw new DecodeError('E_LIMIT', 'Blueprint byte budget exceeded');
    this.byteBudget.remainingBytes -= size;
  }

  /**
   * Runs one record operation, reporting every recovery omission.
   * @param path - Relative source path.
   * @param operation - Read/parse operation.
   * @param fallback - Value returned only in recovery mode after a failure.
   * @returns The decoded value, or explicit recovery fallback.
   * @throws {DecodeError} In strict mode or on any budget exhaustion.
   */
  attempt<T>(path: string, operation: () => T, fallback: T): T {
    try { return operation(); }
    catch (error) { reportDecodeFailure(error, this.mode, this.diagnostics, { path }); return fallback; }
  }

  /**
   * Checks the ZIP central directory before AdmZip allocates entry objects.
   * @param bytes - Complete archive bytes.
   * @throws {DecodeError} For invalid directories, unsupported ZIP64/multi-disk archives or entry-budget exhaustion.
   */
  preflightArchive(bytes: Buffer): void {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0) throw new DecodeError('E_FORMAT', 'Missing ZIP end-of-directory record');
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    if (count === 0xffff || size === 0xffffffff || start === 0xffffffff ||
        bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 ||
        bytes.readUInt16LE(end + 8) !== count) {
      throw new DecodeError('E_UNSUPPORTED', 'ZIP64 and multi-disk blueprints are not supported');
    }
    if (count > this.maxEntries) throw new DecodeError('E_LIMIT', 'ZIP entry count budget exceeded');
    if (start + size > end) throw new DecodeError('E_TRUNCATED', 'Invalid ZIP directory bounds');
    let offset = start;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50) throw new DecodeError('E_FORMAT', 'Invalid ZIP directory entry');
      offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
      if (offset > start + size) throw new DecodeError('E_TRUNCATED', 'Truncated ZIP directory entry');
    }
    if (offset !== start + size) throw new DecodeError('E_FORMAT', 'ZIP directory entry count mismatch');
  }

  /**
   * Charges one filesystem input file before opening it.
   * @throws {DecodeError} If the per-operation file count is exceeded.
   */
  chargeFile(): void {
    if (++this.files > this.maxEntries) throw new DecodeError('E_LIMIT', 'Blueprint file count budget exceeded');
  }

  /**
   * Validates a ZIP inventory before any entry is decompressed.
   * @param entries - Complete central directory entries.
   * @throws {DecodeError} For duplicate, unsafe or oversized paths/entries.
   */
  validateEntries(entries: AdmZip.IZipEntry[]): void {
    if (entries.length > this.maxEntries) throw new DecodeError('E_LIMIT', 'ZIP entry count budget exceeded');
    const names = new Set<string>();
    let total = 0;
    for (const entry of entries) {
      const name = entry.entryName;
      const parts = name.replace(/\/$/, '').split('/');
      if (!name || name.length > 4096 || /[\\\0:]/.test(name) || parts.some(p => p === '' || p === '.' || p === '..')) {
        throw new DecodeError('E_FORMAT', 'Unsafe or ambiguous ZIP entry path', { path: name });
      }
      if (names.has(name)) throw new DecodeError('E_FORMAT', 'Duplicate ZIP entry name', { path: name });
      names.add(name);
      const size = boundedInteger(entry.header.size, 'ZIP entry size');
      total += size;
      if (size > this.maxEntryBytes || total > this.maxTotalBytes) throw new DecodeError('E_LIMIT', 'ZIP declared byte budget exceeded', { path: name });
    }
  }

  /**
   * Inflates an entry with a hard output bound and verifies its checksum.
   * @param entry - An unmodified ZIP entry validated by validateEntries.
   * @returns Exact entry contents.
   * @throws {DecodeError} For unsupported compression, invalid CRC/length, or a budget limit.
   */
  readZipEntry(entry: AdmZip.IZipEntry): Buffer {
    const header = entry.header;
    this.chargeBytes(header.size);
    if ((header.flags & 1) !== 0) throw new DecodeError('E_UNSUPPORTED', 'Encrypted ZIP entries are not supported');
    const compressed = entry.getCompressedData();
    if (compressed.length !== header.compressedSize) throw new DecodeError('E_TRUNCATED', 'Truncated ZIP compressed data');
    let data: Buffer;
    if (header.method === 0) {
      if (compressed.length !== header.size) throw new DecodeError('E_FORMAT', 'Invalid stored ZIP entry size');
      data = Buffer.from(compressed);
    }
    else if (header.method === 8) {
      try { data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, header.size) }); }
      catch (cause) { throw new DecodeError('E_FORMAT', 'Invalid or oversized ZIP payload', { cause }); }
    } else throw new DecodeError('E_UNSUPPORTED', `ZIP method ${header.method} is not supported`);
    if (data.length !== header.size || crc32(data) !== (header.crc >>> 0)) throw new DecodeError('E_FORMAT', 'ZIP entry size or CRC32 mismatch');
    return data;
  }

  /**
   * Decodes a region while sharing the archive-wide block budget.
   * @param data - Region bytes.
   * @param path - Relative entry path for diagnostics.
   * @returns The region, including completeness flags in recovery mode.
   * @throws {DecodeError} For strict failures or block-budget exhaustion.
   */
  readSegments(data: Buffer, path: string): Smd3File {
    const file = parseSmd3(data, { ...this.options.segmentOptions, mode: this.mode, maxBlocks: this.maxBlocks - this.blocks });
    this.blocks += file.usedSlots * BLOCK_COUNT;
    if (this.blocks > this.maxBlocks) throw new DecodeError('E_LIMIT', 'Blueprint block budget exceeded');
    for (const d of file.diagnostics!) this.diagnostics.push({ ...d, path: `${path}:${d.path}` });
    return file;
  }
}
