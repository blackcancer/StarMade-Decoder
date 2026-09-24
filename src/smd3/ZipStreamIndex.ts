/** @fileoverview Bounded random-access ZIP32 index for .sment demand reads. */
import fs from 'node:fs';
import path from 'node:path';
import { createInflateRaw, inflateRawSync } from 'node:zlib';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import { crc32 } from './BlueprintReadContext.js';
import type { BlueprintStreamOptions } from './BlueprintStream.js';

/** A validated central record sufficient to locate one complete entry. */
export interface ZipStreamEntry {
  readonly name: string;
  readonly directory: boolean;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

/** Reads an exact archive range without allocating beyond the requested length. */
async function readRange(handle: fs.promises.FileHandle, offset: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  for (let done = 0; done < length;) {
    const { bytesRead } = await handle.read(bytes, done, length - done, offset + done);
    if (bytesRead === 0) throw new DecodeError('E_IO', 'ZIP archive truncated during read', { offset });
    done += bytesRead;
  }
  return bytes;
}

/** Validates one unnormalized ZIP entry path. */
function validateName(name: string): void {
  const clean = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!name || name.length > 4096 || /[\\\0:]/.test(name) ||
      clean.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new DecodeError('E_FORMAT', 'Unsafe ZIP entry name', { path: name });
  }
}

/** ZIP32 archive with bounded central index and one-entry-at-a-time extraction. */
export class ZipStreamIndex {
  private readonly entriesMap = new Map<string, ZipStreamEntry>();
  /** Retains one descriptor and its validated index until close(). */
  private constructor(private readonly handle: fs.promises.FileHandle,
    private readonly filename: string,
    private readonly size: number, private readonly initial: fs.BigIntStats,
    private readonly directoryOffset: number, private readonly maxEntryBytes: number) {}

  /** Opens and validates the ZIP32 central directory without loading the archive. */
  static async open(filename: string, options: BlueprintStreamOptions = {}): Promise<ZipStreamIndex> {
    const absolute = path.resolve(filename);
    const initial = await fs.promises.lstat(absolute, { bigint: true });
    if (!initial.isFile() || initial.isSymbolicLink() || await fs.promises.realpath(absolute) !== absolute) {
      throw new DecodeError('E_FORMAT', 'Sment source must be a regular non-symlinked file', { path: absolute });
    }
    const handle = await fs.promises.open(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino ||
          opened.size !== initial.size || opened.mtimeNs !== initial.mtimeNs) {
        throw new DecodeError('E_IO', 'Sment source changed before reading', { path: absolute });
      }
      const maxInput = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
      if (opened.size > BigInt(maxInput)) throw new DecodeError('E_LIMIT', 'Sment input byte budget exceeded');
      const size = Number(opened.size);
      const maxEntry = boundedInteger(options.maxEntryBytes ?? 32 * 1024 * 1024, 'maxEntryBytes');
      const maxCentral = boundedInteger(options.maxCentralDirectoryBytes ?? 8 * 1024 * 1024,
        'maxCentralDirectoryBytes', 64 * 1024 * 1024);
      const maxEntries = boundedInteger(options.maxEntries ?? 10000, 'maxEntries');
      if (size < 22) throw new DecodeError('E_TRUNCATED', 'Missing ZIP end record');
      const tailStart = Math.max(0, size - 65557);
      const tail = await readRange(handle, tailStart, size - tailStart);
      let end = -1;
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
          end = tailStart + i; break;
        }
      }
      if (end < 0) throw new DecodeError('E_FORMAT', 'Missing ZIP end-of-directory record');
      const p = end - tailStart;
      const count = tail.readUInt16LE(p + 10), directorySize = tail.readUInt32LE(p + 12);
      const directoryOffset = tail.readUInt32LE(p + 16);
      if (tail.readUInt16LE(p + 4) !== 0 || tail.readUInt16LE(p + 6) !== 0 ||
          tail.readUInt16LE(p + 8) !== count || count === 0xffff ||
          directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
        throw new DecodeError('E_UNSUPPORTED', 'Multi-disk and ZIP64 archives are not supported');
      }
      if (count > maxEntries || directorySize > maxCentral) throw new DecodeError('E_LIMIT', 'ZIP index budget exceeded');
      if (directoryOffset + directorySize > end) throw new DecodeError('E_FORMAT', 'ZIP central directory overlaps end record');
      const index = new ZipStreamIndex(handle, absolute, size, opened, directoryOffset, maxEntry);
      const central = await readRange(handle, directoryOffset, directorySize);
      let cursor = 0;
      for (let i = 0; i < count; i++) {
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
          throw new DecodeError('E_FORMAT', 'Malformed ZIP central directory');
        }
        const flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10);
        const nameLength = central.readUInt16LE(cursor + 28), extra = central.readUInt16LE(cursor + 30);
        const comment = central.readUInt16LE(cursor + 32), length = 46 + nameLength + extra + comment;
        if (cursor + length > central.length) throw new DecodeError('E_TRUNCATED', 'Truncated ZIP central entry');
        if (flags & 1 || (method !== 0 && method !== 8) || central.readUInt16LE(cursor + 34) !== 0) {
          throw new DecodeError('E_UNSUPPORTED', 'Encrypted, multi-disk or unsupported ZIP entry');
        }
        const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength);
        const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName);
        validateName(name);
        if (index.entriesMap.has(name)) throw new DecodeError('E_FORMAT', 'Duplicate ZIP entry', { path: name });
        const type = (central.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
        if (type === 0xa000) throw new DecodeError('E_FORMAT', 'ZIP symlink entries are unsupported', { path: name });
        const entry: ZipStreamEntry = { name, directory: name.endsWith('/'), method,
          crc: central.readUInt32LE(cursor + 16), compressedSize: central.readUInt32LE(cursor + 20),
          size: central.readUInt32LE(cursor + 24), localOffset: central.readUInt32LE(cursor + 42) };
        if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff || entry.localOffset === 0xffffffff) {
          throw new DecodeError('E_UNSUPPORTED', 'ZIP64 entry is unsupported', { path: name });
        }
        index.entriesMap.set(name, entry);
        cursor += length;
      }
      if (cursor !== central.length) throw new DecodeError('E_FORMAT', 'ZIP central directory has trailing data');
      const files = new Set([...index.entriesMap.values()].filter(entry => !entry.directory).map(entry => entry.name));
      for (const file of files) {
        for (let slash = file.indexOf('/'); slash >= 0; slash = file.indexOf('/', slash + 1)) {
          if (files.has(file.slice(0, slash))) throw new DecodeError('E_FORMAT', 'ZIP file conflicts with directory', { path: file });
        }
        if (index.entriesMap.has(`${file}/`)) throw new DecodeError('E_FORMAT', 'ZIP file/directory conflict', { path: file });
      }
      return index;
    } catch (error) { await handle.close(); throw error; }
  }

  /** Lists indexed resource paths without inflating entry contents. */
  names(): readonly string[] { return [...this.entriesMap.keys()]; }

  /** Returns one known central record, if present. */
  get(name: string): ZipStreamEntry | undefined { return this.entriesMap.get(name); }

  /** Inflates one bounded entry, validating local name, size and CRC. */
  async read(name: string, maxBytes = this.maxEntryBytes): Promise<Buffer | null> {
    const entry = this.entriesMap.get(name);
    if (!entry) return null;
    if (entry.directory) throw new DecodeError('E_FORMAT', 'Cannot read ZIP directory as file', { path: name });
    const maximum = boundedInteger(maxBytes, 'maxEntryBytes', this.maxEntryBytes);
    if (entry.size > maximum || entry.compressedSize > this.maxEntryBytes) {
      throw new DecodeError('E_LIMIT', 'ZIP entry exceeds stream byte budget', { path: name });
    }
    const header = await readRange(this.handle, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method) {
      throw new DecodeError('E_FORMAT', 'ZIP local header disagrees with central directory', { path: name });
    }
    const nameLength = header.readUInt16LE(26), extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > this.directoryOffset) {
      throw new DecodeError('E_FORMAT', 'ZIP entry overlaps central directory', { path: name });
    }
    const localName = await readRange(this.handle, entry.localOffset + 30, nameLength);
    if (!localName.equals(Buffer.from(name))) throw new DecodeError('E_FORMAT', 'ZIP local filename disagrees', { path: name });
    const compressed = await readRange(this.handle, dataOffset, entry.compressedSize);
    let bytes: Buffer;
    try { bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: maximum }); }
    catch (cause) { throw new DecodeError('E_FORMAT', 'ZIP entry inflation failed', { path: name, cause }); }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) {
      throw new DecodeError('E_FORMAT', 'ZIP entry size or checksum mismatch', { path: name });
    }
    const after = await this.handle.stat({ bigint: true });
    if (after.size !== this.initial.size || after.mtimeNs !== this.initial.mtimeNs || after.ino !== this.initial.ino) {
      throw new DecodeError('E_IO', 'Sment source changed during streaming');
    }
    return bytes;
  }

  /** Verifies and yields one ZIP entry in bounded chunks for disk-backed regions. */
  async *readChunks(entry: ZipStreamEntry, signal?: AbortSignal): AsyncGenerator<Buffer> {
    if (entry.directory) throw new DecodeError('E_FORMAT', 'Cannot stream ZIP directory', { path: entry.name });
    if (entry.size > this.maxEntryBytes || entry.compressedSize > this.maxEntryBytes) {
      throw new DecodeError('E_LIMIT', 'ZIP entry exceeds stream byte budget', { path: entry.name });
    }
    const header = await readRange(this.handle, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method) {
      throw new DecodeError('E_FORMAT', 'ZIP local header disagrees with central directory', { path: entry.name });
    }
    const nameLength = header.readUInt16LE(26), extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > this.directoryOffset) {
      throw new DecodeError('E_FORMAT', 'ZIP entry overlaps central directory', { path: entry.name });
    }
    const localName = await readRange(this.handle, entry.localOffset + 30, nameLength);
    if (!localName.equals(Buffer.from(entry.name))) {
      throw new DecodeError('E_FORMAT', 'ZIP local filename disagrees', { path: entry.name });
    }
    if (signal?.aborted) throw new DecodeError('E_IO', 'ZIP extraction cancelled');
    let size = 0, checksum = 0;
    if (entry.compressedSize > 0) {
      const fd = fs.openSync(this.filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let same: fs.BigIntStats;
      try { same = fs.fstatSync(fd, { bigint: true }); }
      catch (error) { fs.closeSync(fd); throw error; }
      if (same.dev !== this.initial.dev || same.ino !== this.initial.ino ||
          same.size !== this.initial.size || same.mtimeNs !== this.initial.mtimeNs) {
        fs.closeSync(fd);
        throw new DecodeError('E_IO', 'Sment source changed before entry extraction');
      }
      const input = fs.createReadStream('', { fd, autoClose: true,
        start: dataOffset, end: dataOffset + entry.compressedSize - 1, highWaterMark: 64 * 1024 });
      const output = entry.method === 8 ? input.pipe(createInflateRaw()) : input;
      try {
        for await (const chunk of output) {
          if (signal?.aborted) throw new DecodeError('E_IO', 'ZIP extraction cancelled');
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > entry.size || size > this.maxEntryBytes) {
            throw new DecodeError('E_LIMIT', 'ZIP entry inflated beyond declared byte budget', { path: entry.name });
          }
          checksum = crc32(bytes, checksum ^ 0xffffffff);
          yield bytes;
        }
      } catch (cause) {
        if (cause instanceof DecodeError) throw cause;
        throw new DecodeError('E_FORMAT', 'ZIP entry inflation failed', { path: entry.name, cause });
      } finally { output.destroy(); input.destroy(); }
    }
    if (size !== entry.size || checksum !== entry.crc) {
      throw new DecodeError('E_FORMAT', 'ZIP entry size or checksum mismatch', { path: entry.name });
    }
    const after = await this.handle.stat({ bigint: true });
    if (after.size !== this.initial.size || after.mtimeNs !== this.initial.mtimeNs || after.ino !== this.initial.ino) {
      throw new DecodeError('E_IO', 'Sment source changed during streaming');
    }
  }

  /** Releases the archive descriptor on completion or iterator cancellation. */
  async close(): Promise<void> { await this.handle.close(); }
}
