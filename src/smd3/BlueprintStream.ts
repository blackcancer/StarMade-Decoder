/** @fileoverview Demand-driven blueprint entity and segment traversal. */
import fs from 'node:fs';
import path from 'node:path';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import { BlueprintReadContext } from './BlueprintReadContext.js';
import type { BlueprintParseOptions } from './BlueprintReadContext.js';
import { _parseHeaderBuffer } from './SmentParser.js';
import type { BlueprintHeader } from './SmentParser.js';
import { parseSmbpm } from './SmbpmParser.js';
import type { BlueprintChildOffset, BlueprintMeta } from './SmbpmParser.js';
import { parseSmbpl } from './SmbplParser.js';
import type { BlueprintLogic } from './SmbplParser.js';
import { parseSmbmm } from './SmbmmParser.js';
import type { SmbmmFile } from './SmbmmParser.js';
import { streamDiagnostic, streamSmd3 } from './Smd3Stream.js';
import type { Smd3StreamOptions, Smd3StreamSegment, StreamEnd } from './Smd3Stream.js';
import { BLOCK_COUNT } from './Smd3Parser.js';

/** Resource limits and cancellation for folder or archive streaming. */
export interface BlueprintStreamOptions extends BlueprintParseOptions {
  signal?: AbortSignal;
  /** Per-region SMD3 decoding and slot limits. */
  segmentOptions?: Smd3StreamOptions;
  /** Maximum bytes allocated for one header/metadata/logic resource, default 8 MiB. */
  maxMetadataBytes?: number;
  /** Maximum ZIP central-directory bytes indexed for a .sment, default 8 MiB. */
  maxCentralDirectoryBytes?: number;
  /** Largest .sment geometry entry kept in memory, default 4 MiB; larger entries spool to disk. */
  maxBufferedEntryBytes?: number;
}

/** One blueprint entity; children reference its path as their parentPath. */
export interface BlueprintStreamEntity {
  readonly kind: 'entity';
  readonly path: string;
  readonly parentPath: string | null;
  readonly name: string;
  readonly offset: BlueprintChildOffset;
  readonly worldOffset: BlueprintChildOffset;
  readonly header: BlueprintHeader | null;
  readonly meta: BlueprintMeta | null;
  readonly logic: BlueprintLogic | null;
  readonly modMappings: SmbmmFile | null;
}

/** One compact segment linked to its owning entity and source region. */
export interface BlueprintStreamSegment extends Smd3StreamSegment {
  readonly entityPath: string;
  readonly regionPath: string;
}

/** Terminal blueprint outcome with count and all recovery diagnostics. */
export interface BlueprintStreamEnd extends StreamEnd {
  readonly entities: number;
}

/** Events consumed by StarMade-3D in yield order. */
export type BlueprintStreamEvent = BlueprintStreamEntity | BlueprintStreamSegment | BlueprintStreamEnd;

/** Iterative work item; keeping paths rather than entity trees bounds retained geometry. */
interface PendingEntity {
  folder: string;
  relative: string;
  parent: string | null;
  offset: BlueprintChildOffset;
  worldOffset: BlueprintChildOffset;
  depth: number;
}

/** Root offset in entity block coordinates. */
const ZERO: BlueprintChildOffset = Object.freeze({ x: 0, y: 0, z: 0 });

/** Adds child docking offsets without applying any renderer transform. */
function addOffset(a: BlueprintChildOffset, b: BlueprintChildOffset): BlueprintChildOffset {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Rejects symlinked and non-directory blueprint paths. */
async function requireDirectory(folder: string): Promise<void> {
  const stat = await fs.promises.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.promises.realpath(folder) !== folder) {
    throw new DecodeError('E_FORMAT', 'Blueprint folder must be a regular non-symlinked directory', { path: folder });
  }
}

/** Reads exactly one bounded metadata file, checking identity after I/O. */
async function readMetadata(filename: string, limit: number, context: BlueprintReadContext): Promise<Buffer> {
  const initial = await fs.promises.lstat(filename, { bigint: true });
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > BigInt(limit)) {
    throw new DecodeError('E_LIMIT', 'Invalid or oversized blueprint metadata file', { path: filename });
  }
  context.chargeBytes(Number(initial.size));
  const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size !== initial.size) {
      throw new DecodeError('E_IO', 'Blueprint metadata file changed before reading', { path: filename });
    }
    const bytes = Buffer.alloc(Number(opened.size));
    for (let done = 0; done < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, done, bytes.length - done, done);
      if (!bytesRead) throw new DecodeError('E_IO', 'Blueprint metadata file truncated', { path: filename });
      done += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) {
      throw new DecodeError('E_IO', 'Blueprint metadata file changed while reading', { path: filename });
    }
    return bytes;
  } finally { await handle.close(); }
}

/** Enumerates one directory under the aggregate entry budget. */
async function namesIn(folder: string, context: BlueprintReadContext): Promise<string[]> {
  const names: string[] = [];
  const directory = await fs.promises.opendir(folder);
  try {
    for await (const entry of directory) {
      context.chargeFile();
      if (entry.isSymbolicLink() || entry.name === '.' || entry.name === '..') {
        throw new DecodeError('E_FORMAT', 'Blueprint symlink or unsafe entry', { path: path.join(folder, entry.name) });
      }
      names.push(entry.name);
    }
  } finally { await directory.close().catch(() => undefined); }
  return names;
}

/** Streams one folder blueprint, yielding entity metadata before its segments. */
export async function* streamBlueprintFolder(folderPath: string,
  options: BlueprintStreamOptions = {}): AsyncGenerator<BlueprintStreamEvent> {
  const diagnostics: DecodeDiagnostic[] = [];
  let entities = 0, segments = 0;
  try {
    const context = new BlueprintReadContext(options);
    const maxMetadata = boundedInteger(options.maxMetadataBytes ?? 8 * 1024 * 1024,
      'maxMetadataBytes', 64 * 1024 * 1024);
    const root = path.resolve(folderPath);
    if (options.signal?.aborted) {
      yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
    }
    await requireDirectory(root);
    context.chargeFile();
    const pending: PendingEntity[] = [{ folder: root, relative: path.basename(root),
      parent: null, offset: ZERO, worldOffset: ZERO, depth: 0 }];
    while (pending.length) {
      if (options.signal?.aborted) {
        yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
      }
      const current = pending.pop()!;
      context.enterEntity(current.depth);
      await requireDirectory(current.folder);
      const names = await namesIn(current.folder, context);
      const has = (name: string): boolean => names.includes(name);
      const load = async <T>(name: string, decode: (bytes: Buffer) => T): Promise<T | null> => {
        if (!has(name)) return null;
        const filename = path.join(current.folder, name);
        try { return decode(await readMetadata(filename, maxMetadata, context)); }
        catch (error) {
          if (context.mode === 'strict' || (error instanceof DecodeError && error.code === 'E_LIMIT')) throw error;
          diagnostics.push(streamDiagnostic(error, `${current.relative}/${name}`)); return null;
        }
      };
      const header = await load('header.smbph', _parseHeaderBuffer);
      if (!header) {
        if (context.mode === 'strict') throw new DecodeError('E_FORMAT', 'Missing or invalid blueprint header');
        diagnostics.push({ code: 'E_FORMAT', message: 'Missing or invalid blueprint header', path: `${current.relative}/header.smbph` });
      }
      const meta = await load('meta.smbpm', bytes => parseSmbpm(bytes, context.tagOptions));
      const logic = await load('logic.smbpl', parseSmbpl);
      const modMappings = await load('modmappings.smbmm', parseSmbmm);
      entities++;
      yield { kind: 'entity', path: current.relative, parentPath: current.parent,
        name: path.basename(current.folder), offset: current.offset, worldOffset: current.worldOffset,
        header, meta, logic, modMappings };
      const dataDir = path.join(current.folder, 'DATA');
      if (has('DATA')) {
        await requireDirectory(dataDir);
        for (const name of (await namesIn(dataDir, context)).filter(value => /\.smd[0-3]$/.test(value)).sort()) {
          if (options.signal?.aborted) {
            yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
          }
          const regionPath = `${current.relative}/DATA/${name}`;
          if (!name.endsWith('.smd3')) {
            if (context.mode === 'strict') throw new DecodeError('E_UNSUPPORTED', 'Legacy SMD region needs migration', { path: regionPath });
            diagnostics.push({ code: 'E_UNSUPPORTED', message: 'Legacy SMD region needs migration', path: regionPath });
            continue;
          }
          const filename = path.join(dataDir, name);
          const stat = await fs.promises.lstat(filename);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new DecodeError('E_FORMAT', 'Invalid segment file', { path: filename });
          context.chargeBytes(stat.size);
          for await (const event of streamSmd3(filename, { ...options.segmentOptions,
            mode: context.mode, maxBlocks: context.maxBlocks, signal: options.signal })) {
            if (event.kind === 'segment') {
              if ((segments + 1) * BLOCK_COUNT > context.maxBlocks) throw new DecodeError('E_LIMIT', 'Blueprint block budget exceeded');
              segments++;
              yield { ...event, entityPath: current.relative, regionPath };
            } else if (event.status === 'partial') diagnostics.push(...event.diagnostics);
            else if (event.status === 'error') {
              if (context.mode === 'recover' && event.diagnostics[0]?.code !== 'E_LIMIT') {
                diagnostics.push(...event.diagnostics.map(diagnostic => ({ ...diagnostic, path: regionPath })));
              } else {
                const diagnostic = event.diagnostics[0]!;
                throw new DecodeError(diagnostic.code, diagnostic.message, { path: regionPath });
              }
            }
            else if (event.status === 'cancelled') {
              yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
            }
          }
        }
      }
      const transforms = new Map(meta?.childTransforms.map(t => [path.basename(t.name), t.offset]) ?? []);
      const children = names.filter(name => /^ATTACHED_\d+$/.test(name))
        .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
      for (const name of children.reverse()) {
        const offset = transforms.get(name) ?? ZERO;
        pending.push({ folder: path.join(current.folder, name), relative: `${current.relative}/${name}`,
          parent: current.relative, offset, worldOffset: addOffset(current.worldOffset, offset), depth: current.depth + 1 });
      }
    }
    yield { kind: 'end', status: diagnostics.length ? 'partial' : 'complete', entities, segments, diagnostics };
  } catch (error) {
    yield { kind: 'end', status: 'error', entities, segments, diagnostics: [...diagnostics, streamDiagnostic(error)] };
  }
}
