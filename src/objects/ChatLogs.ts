/**
 * @fileoverview Bounded reader for StarMade's plain-text chatlogs/*.txt files.
 *
 * The game's ChannelRouter writes one local-time message per newline. These
 * records are separate from the Tag-based ChatChannelManager.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import { formatText } from '../core/FormatLimits.js';

/** Calendar fields as stored by the game; no timezone is present in a chatlog. */
export interface ChatLogCalendar {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** One valid channel or direct message. */
export interface ChatLogMessage {
  readonly kind: 'message';
  readonly raw: string;
  readonly timestamp: string;
  readonly calendar: ChatLogCalendar;
  readonly author: string;
  /** Present for the game's `[sender -> recipient]` direct-message syntax. */
  readonly recipient?: string;
  readonly message: string;
}

/** A complete line whose syntax or calendar date could not be interpreted. */
export interface ChatLogUnparsed {
  readonly kind: 'unparsed';
  readonly raw: string;
  readonly reason: 'format' | 'date' | 'author';
}

/** Parsed line without silently dropping damaged or unfamiliar records. */
export type ChatLogRecord = ChatLogMessage | ChatLogUnparsed;

/** File record with an absolute byte offset, suitable for panel rendering. */
export type ChatLogFileRecord = ChatLogRecord & { readonly byteOffset: number };

/** Serializable position for incremental polling across panel requests. */
export interface ChatLogCursor {
  readonly offset: number;
  /** Device and inode of the observed file; null when the file is absent. */
  readonly fileId: string | null;
}

/** One bounded history or incremental read. */
export interface ChatLogBatch {
  readonly records: readonly ChatLogFileRecord[];
  readonly cursor: ChatLogCursor;
  /** Older history was skipped to respect a byte or line limit. */
  readonly truncated: boolean;
  /** The previous file was replaced, shortened or removed. */
  readonly reset: boolean;
  /** Additional complete lines remain available without waiting for an append. */
  readonly hasMore: boolean;
}

/** Resource ceilings applied independently to each history or poll call. */
export interface ChatLogReadOptions {
  /** Maximum bytes read in one call, default 1 MiB. */
  readonly maxBytes?: number;
  /** Maximum records returned in one call, default 1,000. */
  readonly maxLines?: number;
  /** Maximum bytes in a single line before its newline, default 64 KiB. */
  readonly maxLineBytes?: number;
}

/** Parses one complete StarMade chatlog line, including direct-message authors. */
export function parseChatLogLine(raw: string): ChatLogRecord {
  if (typeof raw !== 'string') throw new TypeError('Chatlog line must be text');
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) - (\d{2}):(\d{2}):(\d{2}) \[([^\]\r\n]+)\]: (.*)$/.exec(raw);
  if (!match) return { kind: 'unparsed', raw, reason: 'format' };
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59) {
    return { kind: 'unparsed', raw, reason: 'date' };
  }
  const bracket = match[7];
  const arrow = bracket.indexOf(' -> ');
  const author = arrow < 0 ? bracket : bracket.slice(0, arrow);
  const recipient = arrow < 0 ? undefined : bracket.slice(arrow + 4);
  if (!author.trim() || (recipient !== undefined && !recipient.trim())) {
    return { kind: 'unparsed', raw, reason: 'author' };
  }
  const entry: ChatLogMessage = {
    kind: 'message', raw, timestamp: raw.slice(0, 21),
    calendar: { year, month, day, hour, minute, second }, author, message: match[8],
    ...(recipient === undefined ? {} : { recipient }),
  };
  return entry;
}

/** Reads recent history and polls appended complete lines from one safe filename. */
export class ChatLogReader {
  readonly gameDirectory: string;
  readonly fileName: string;
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxLineBytes: number;

  /** Selects a game directory and a single `.txt` basename under chatlogs/. */
  constructor(gameDirectory: string, fileName = 'all.txt', options: ChatLogReadOptions = {}) {
    if (typeof gameDirectory !== 'string' || !gameDirectory.trim() || gameDirectory.includes('\0')) {
      throw new TypeError('A game directory is required');
    }
    if (typeof fileName !== 'string' || !/^[^/\\\x00-\x1f\x7f]+\.txt$/i.test(fileName) ||
        Buffer.byteLength(fileName) > 255) {
      throw new DecodeError('E_RANGE', 'Chatlog filename must be one safe .txt basename');
    }
    this.gameDirectory = path.resolve(gameDirectory);
    this.fileName = fileName;
    this.maxBytes = boundedInteger(options.maxBytes ?? 1024 * 1024, 'maxBytes', 64 * 1024 * 1024);
    this.maxLines = boundedInteger(options.maxLines ?? 1000, 'maxLines', 1_000_000);
    this.maxLineBytes = boundedInteger(options.maxLineBytes ?? 64 * 1024, 'maxLineBytes', 1024 * 1024);
    if (this.maxLineBytes === 0 || this.maxLines === 0 || this.maxBytes <= this.maxLineBytes) {
      throw new DecodeError('E_RANGE', 'Chatlog limits require positive lines and maxBytes > maxLineBytes');
    }
  }

  /** Returns the newest complete lines without loading the full file. */
  readRecent(): ChatLogBatch {
    const opened = this.openFile();
    if (!opened) return emptyBatch(false);
    const { fd, size, fileId } = opened;
    try {
      const start = Math.max(0, size - this.maxBytes);
      const bytes = readWindow(fd, start, size - start);
      let first = 0;
      if (start > 0) {
        const newline = bytes.indexOf(10);
        if (newline < 0) throw new DecodeError('E_LIMIT', 'No complete chatlog line fits in maxBytes');
        first = newline + 1;
      }
      const scanned = scanLines(bytes, start, first, this.maxLines, this.maxLineBytes, true);
      return {
        records: scanned.records, cursor: { offset: scanned.offset, fileId },
        truncated: start > 0 || scanned.dropped, reset: false, hasMore: false,
      };
    } finally { fs.closeSync(fd); }
  }

  /** Reads the next complete lines; a changed or shortened file restarts at byte zero. */
  poll(cursor: ChatLogCursor): ChatLogBatch {
    if (!cursor || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 ||
        (cursor.fileId !== null && (typeof cursor.fileId !== 'string' || !/^\d+:\d+$/.test(cursor.fileId)))) {
      throw new DecodeError('E_RANGE', 'Invalid chatlog cursor');
    }
    const opened = this.openFile();
    if (!opened) return emptyBatch(cursor.fileId !== null || cursor.offset !== 0);
    const { fd, size, fileId } = opened;
    try {
      const reset = cursor.fileId !== fileId || size < cursor.offset;
      const start = reset ? 0 : cursor.offset;
      const bytes = readWindow(fd, start, Math.min(this.maxBytes, size - start));
      const scanned = scanLines(bytes, start, 0, this.maxLines, this.maxLineBytes, false);
      return {
        records: scanned.records, cursor: { offset: scanned.offset, fileId },
        truncated: false, reset, hasMore: scanned.hasUnread || size > start + bytes.length,
      };
    } finally { fs.closeSync(fd); }
  }

  /** Opens a regular file under a real, non-symlinked game/chatlogs directory. */
  private openFile(): { fd: number; size: number; fileId: string } | null {
    const root = this.gameDirectory;
    requireDirectory(root, false);
    const directory = path.join(root, 'chatlogs');
    if (!requireDirectory(directory, true)) return null;
    const filename = path.join(directory, this.fileName);
    let initial: fs.BigIntStats;
    try { initial = fs.lstatSync(filename, { bigint: true }); }
    catch (error) {
      if (missing(error)) return null;
      throw new DecodeError('E_IO', 'Cannot inspect chatlog file', { path: filename, cause: error });
    }
    if (!initial.isFile() || initial.isSymbolicLink()) {
      throw new DecodeError('E_IO', 'Chatlog path must be a regular file', { path: filename });
    }
    let fd: number;
    try { fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) {
      if (missing(error)) return null;
      throw new DecodeError('E_IO', 'Cannot open chatlog file', { path: filename, cause: error });
    }
    try {
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino) {
        throw new DecodeError('E_IO', 'Chatlog file changed before reading', { path: filename });
      }
      if (opened.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new DecodeError('E_LIMIT', 'Chatlog file is too large to address safely', { path: filename });
      }
      return { fd, size: Number(opened.size), fileId: `${opened.dev}:${opened.ino}` };
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }
}

/** Empty result for a missing chatlogs directory or file. */
function emptyBatch(reset: boolean): ChatLogBatch {
  return { records: [], cursor: { offset: 0, fileId: null }, truncated: false, reset, hasMore: false };
}

/** True only for a file or directory that disappeared. */
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Checks each directory component before following a selected filename. */
function requireDirectory(directory: string, mayBeAbsent: boolean): boolean {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(directory); }
  catch (error) {
    if (mayBeAbsent && missing(error)) return false;
    throw new DecodeError('E_IO', 'Cannot inspect chatlog directory', { path: directory, cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
    throw new DecodeError('E_IO', 'Chatlog directory must not contain symlinks', { path: directory });
  }
  return true;
}

/** Reads an exact bounded file window and detects concurrent truncation. */
function readWindow(fd: number, start: number, length: number): Buffer {
  const before = fs.fstatSync(fd, { bigint: true });
  const bytes = Buffer.alloc(length);
  for (let filled = 0; filled < bytes.length;) {
    const count = fs.readSync(fd, bytes, filled, bytes.length - filled, start + filled);
    if (count === 0) throw new DecodeError('E_IO', 'Chatlog was truncated while reading');
    filled += count;
  }
  const after = fs.fstatSync(fd, { bigint: true });
  if (after.size < before.size || (after.size === before.size && after.mtimeNs !== before.mtimeNs)) {
    throw new DecodeError('E_IO', 'Chatlog changed while reading');
  }
  return bytes;
}

/** Parses complete lines, retaining either the newest or the next N records. */
function scanLines(bytes: Buffer, start: number, first: number, maxLines: number, maxLineBytes: number,
  newest: boolean): { records: ChatLogFileRecord[]; offset: number; dropped: boolean; hasUnread: boolean } {
  const records: ChatLogFileRecord[] = [];
  let position = first, count = 0;
  while (true) {
    const newline = bytes.indexOf(10, position);
    if (newline < 0) break;
    if (newline - position > maxLineBytes) throw new DecodeError('E_LIMIT', 'Chatlog line exceeds maxLineBytes');
    const end = newline > position && bytes[newline - 1] === 13 ? newline - 1 : newline;
    const raw = formatText(bytes.subarray(position, end));
    const record = { ...parseChatLogLine(raw), byteOffset: start + position };
    if (newest) {
      if (records.length < maxLines) records.push(record);
      else records[count % maxLines] = record;
    } else {
      records.push(record);
    }
    count++;
    position = newline + 1;
    if (!newest && count === maxLines) break;
  }
  if (bytes.indexOf(10, position) < 0 && bytes.length - position > maxLineBytes) {
    throw new DecodeError('E_LIMIT', 'Incomplete chatlog line exceeds maxLineBytes');
  }
  const rotated = newest && count > maxLines
    ? records.slice(count % maxLines).concat(records.slice(0, count % maxLines)) : records;
  return {
    records: rotated, offset: start + position, dropped: count > maxLines,
    hasUnread: bytes.indexOf(10, position) >= 0,
  };
}
