/** @fileoverview Demand-driven SMD3 region reads with compact block words. */
import fs from 'node:fs';
import path from 'node:path';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import { BLOCK_COUNT, HEADER_SIZE, HEADER_SLOT_COUNT, OFFSET_SHIFT, SEGMENT_SECTOR,
  decodeSmd3RecordWords } from './Smd3Parser.js';
import type { Smd3ParseOptions } from './Smd3Parser.js';

/** Source-bound options; one yielded segment owns 128 KiB of block words. */
export interface Smd3StreamOptions extends Smd3ParseOptions {
  /** Stop before the next I/O or segment decode when aborted. */
  signal?: AbortSignal;
  /** Maximum non-empty table slots to visit, default 4,096. */
  maxSegments?: number;
}

/** One complete region record, converted to the SDK's canonical v7 word layout. */
export interface Smd3StreamSegment {
  readonly kind: 'segment';
  readonly slot: number;
  readonly headerVersion: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lastChanged: bigint;
  readonly version: number;
  readonly blockCount: number;
  readonly words: Uint32Array;
}

/** Terminal outcome; an error is never mislabeled as complete. */
export interface StreamEnd {
  readonly kind: 'end';
  readonly status: 'complete' | 'partial' | 'error' | 'cancelled';
  readonly segments: number;
  readonly diagnostics: readonly DecodeDiagnostic[];
}

/** Events yielded by a standalone SMD3 stream. */
export type Smd3StreamEvent = Smd3StreamSegment | StreamEnd;

/** Converts a thrown read/format error into a stable diagnostic. */
export function streamDiagnostic(error: unknown, location?: string): DecodeDiagnostic {
  return { code: error instanceof DecodeError ? error.code : 'E_IO',
    message: error instanceof Error ? error.message : String(error),
    ...(location ? { path: location } : {}),
    ...(error instanceof DecodeError && error.offset !== undefined ? { offset: error.offset } : {}) };
}

/** Reads a full range or throws; never returns a truncated record. */
async function readExact(handle: fs.promises.FileHandle, offset: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  for (let done = 0; done < length;) {
    const { bytesRead } = await handle.read(bytes, done, length - done, offset + done);
    if (bytesRead === 0) throw new DecodeError('E_IO', 'SMD3 file truncated during read', { offset });
    done += bytesRead;
  }
  return bytes;
}

/** Yields complete segments on request, followed by an explicit terminal status. */
export async function* streamSmd3(source: string | Uint8Array,
  options: Smd3StreamOptions = {}): AsyncGenerator<Smd3StreamEvent> {
  const diagnostics: DecodeDiagnostic[] = [];
  let handle: fs.promises.FileHandle | undefined, count = 0;
  try {
    const mode = options.mode ?? 'strict';
    if (mode !== 'strict' && mode !== 'recover') throw new DecodeError('E_RANGE', 'Invalid SMD3 stream mode');
    const maxInput = boundedInteger(options.maxInputBytes ?? 256 * 1024 * 1024, 'maxInputBytes');
    const maxBlocks = boundedInteger(options.maxBlocks ?? 16 * 1024 * 1024, 'maxBlocks');
    const maxSegments = boundedInteger(options.maxSegments ?? HEADER_SLOT_COUNT, 'maxSegments', HEADER_SLOT_COUNT);
    if (options.signal?.aborted) {
      yield { kind: 'end', status: 'cancelled', segments: 0, diagnostics }; return;
    }
    let size: number, read: (offset: number, length: number) => Promise<Buffer>;
    if (typeof source === 'string') {
      const filename = path.resolve(source);
      const initial = await fs.promises.lstat(filename, { bigint: true });
      if (!initial.isFile() || initial.isSymbolicLink() || await fs.promises.realpath(filename) !== filename) {
        throw new DecodeError('E_FORMAT', 'SMD3 source must be a regular non-symlinked file', { path: filename });
      }
      handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino ||
          opened.size !== initial.size || opened.mtimeNs !== initial.mtimeNs) {
        throw new DecodeError('E_IO', 'SMD3 file changed before reading', { path: filename });
      }
      if (opened.size > BigInt(maxInput)) throw new DecodeError('E_LIMIT', 'SMD3 input byte budget exceeded');
      size = Number(opened.size);
      read = async (offset, length) => {
        const bytes = await readExact(handle!, offset, length);
        const after = await handle!.stat({ bigint: true });
        if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ino !== opened.ino) {
          throw new DecodeError('E_IO', 'SMD3 file changed during streaming', { path: filename });
        }
        return bytes;
      };
    } else {
      const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
      size = bytes.length;
      read = async (offset, length) => bytes.subarray(offset, offset + length);
    }
    if (size > maxInput) throw new DecodeError('E_LIMIT', 'SMD3 input byte budget exceeded');
    if (size < HEADER_SIZE) throw new DecodeError('E_TRUNCATED', 'Truncated SMD3 region header');
    const header = await read(0, HEADER_SIZE);
    const sectors = new Set<number>();
    let used = 0;
    for (let slot = 0; slot < HEADER_SLOT_COUNT; slot++) {
      if (options.signal?.aborted) {
        yield { kind: 'end', status: 'cancelled', segments: count, diagnostics }; return;
      }
      const entry = 4 + slot * 4, sector = header.readInt16BE(entry), length = header.readUInt16BE(entry + 2);
      if (sector === 0 || length === 0) continue;
      used++;
      const offset = HEADER_SIZE + (sector - OFFSET_SHIFT) * SEGMENT_SECTOR;
      try {
        if (used > maxSegments || used * BLOCK_COUNT > maxBlocks) {
          throw new DecodeError('E_LIMIT', 'SMD3 stream segment/block budget exceeded', { offset });
        }
        if (sector < 1 || length < 22 || length > SEGMENT_SECTOR || sectors.has(sector)) {
          throw new DecodeError('E_FORMAT', 'Invalid or duplicate SMD3 table entry', { offset: entry });
        }
        sectors.add(sector);
        if (offset + length > size) throw new DecodeError('E_TRUNCATED', 'Truncated SMD3 segment', { offset });
        const record = await read(offset, length);
        if (options.signal?.aborted) {
          yield { kind: 'end', status: 'cancelled', segments: count, diagnostics }; return;
        }
        const compact = decodeSmd3RecordWords(record, options);
        count++;
        yield { kind: 'segment', slot, headerVersion: header[0], ...compact };
      } catch (error) {
        if (mode === 'strict' || (error instanceof DecodeError && error.code === 'E_LIMIT')) throw error;
        diagnostics.push(streamDiagnostic(error, `segment[${slot}]`));
      }
    }
    yield { kind: 'end', status: diagnostics.length ? 'partial' : 'complete', segments: count, diagnostics };
  } catch (error) {
    yield { kind: 'end', status: 'error', segments: count, diagnostics: [...diagnostics, streamDiagnostic(error)] };
  } finally {
    await handle?.close();
  }
}
