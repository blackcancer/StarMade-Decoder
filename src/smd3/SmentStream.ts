/** @fileoverview ZIP32 .sment entity traversal with bounded, disk-backed large regions. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import type { DecodeDiagnostic } from '../core/DecodeError.js';
import { BlueprintReadContext } from './BlueprintReadContext.js';
import { _parseHeaderBuffer } from './SmentParser.js';
import { parseSmbpm } from './SmbpmParser.js';
import type { BlueprintChildOffset } from './SmbpmParser.js';
import { parseSmbpl } from './SmbplParser.js';
import { parseSmbmm } from './SmbmmParser.js';
import { streamDiagnostic, streamSmd3 } from './Smd3Stream.js';
import { BLOCK_COUNT } from './Smd3Parser.js';
import type { BlueprintStreamEvent, BlueprintStreamOptions } from './BlueprintStream.js';
import { ZipStreamIndex } from './ZipStreamIndex.js';
import type { ZipStreamEntry } from './ZipStreamIndex.js';

/** One pending ZIP entity, represented by paths and game docking offsets. */
interface PendingZipEntity {
  relative: string;
  parent: string | null;
  offset: BlueprintChildOffset;
  worldOffset: BlueprintChildOffset;
  depth: number;
}

/** Root offset in entity block coordinates. */
const ZERO: BlueprintChildOffset = Object.freeze({ x: 0, y: 0, z: 0 });

/** Adds stored attachment translations without renderer calculations. */
function addOffset(a: BlueprintChildOffset, b: BlueprintChildOffset): BlueprintChildOffset {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Writes one checked ZIP entry incrementally to an isolated temporary region. */
async function spoolRegion(zip: ZipStreamIndex, entry: ZipStreamEntry, signal?: AbortSignal): Promise<string> {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'starmade-sment-'));
  const filename = path.join(folder, 'region.smd3');
  try {
    const file = await fs.promises.open(filename, 'wx');
    try {
      for await (const chunk of zip.readChunks(entry, signal)) {
        for (let done = 0; done < chunk.length;) {
          const { bytesWritten } = await file.write(chunk, done, chunk.length - done);
          if (bytesWritten === 0) throw new DecodeError('E_IO', 'Temporary SMD3 write made no progress');
          done += bytesWritten;
        }
      }
    } finally { await file.close(); }
    return filename;
  } catch (error) {
    await fs.promises.rm(folder, { recursive: true, force: true });
    throw error;
  }
}

/** Iterates a .sment path using a bounded central index and progressive large-entry extraction. */
export async function* streamSment(filename: string,
  options: BlueprintStreamOptions = {}): AsyncGenerator<BlueprintStreamEvent> {
  const diagnostics: DecodeDiagnostic[] = [];
  let zip: ZipStreamIndex | undefined, entities = 0, segments = 0;
  try {
    const maxEntryBytes = options.maxEntryBytes ?? 32 * 1024 * 1024;
    const context = new BlueprintReadContext({ ...options, maxEntryBytes });
    const maxMetadata = boundedInteger(options.maxMetadataBytes ?? 8 * 1024 * 1024,
      'maxMetadataBytes', 64 * 1024 * 1024);
    const maxBuffered = boundedInteger(options.maxBufferedEntryBytes ?? 4 * 1024 * 1024,
      'maxBufferedEntryBytes');
    if (options.signal?.aborted) {
      yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
    }
    zip = await ZipStreamIndex.open(filename, options);
    const names = zip.names();
    for (const name of names) context.chargeFile();
    const roots = names.filter(name => /^[^/]+\/header\.smbph$/.test(name));
    if (roots.length !== 1) throw new DecodeError('E_FORMAT', 'Sment needs exactly one root header');
    const root = roots[0].split('/')[0];
    const regions = new Map<string, string[]>(), children = new Map<string, Set<string>>();
    for (const name of names) {
      if (!name.startsWith(`${root}/`)) continue;
      const parts = name.split('/').filter(Boolean);
      for (let index = 1; index < parts.length; index++) {
        if (!/^ATTACHED_\d+$/.test(parts[index])) continue;
        const parent = parts.slice(0, index).join('/');
        const entries = children.get(parent) ?? new Set<string>();
        entries.add(parts[index]); children.set(parent, entries);
      }
      if (/\.smd[0-3]$/.test(name) && parts.at(-2) === 'DATA') {
        const entity = parts.slice(0, -2).join('/');
        const entries = regions.get(entity) ?? [];
        entries.push(name); regions.set(entity, entries);
      }
    }
    const pending: PendingZipEntity[] = [{ relative: root, parent: null,
      offset: ZERO, worldOffset: ZERO, depth: 0 }];
    while (pending.length) {
      if (options.signal?.aborted) {
        yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
      }
      const current = pending.pop()!;
      context.enterEntity(current.depth);
      const load = async <T>(name: string, decode: (bytes: Buffer) => T): Promise<T | null> => {
        const entryName = `${current.relative}/${name}`;
        if (!zip!.get(entryName)) return null;
        try {
          const bytes = await zip!.read(entryName, maxMetadata);
          context.chargeBytes(bytes!.length);
          return decode(bytes!);
        } catch (error) {
          if (context.mode === 'strict' || (error instanceof DecodeError && error.code === 'E_LIMIT')) throw error;
          diagnostics.push(streamDiagnostic(error, entryName)); return null;
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
        name: path.posix.basename(current.relative), offset: current.offset,
        worldOffset: current.worldOffset, header, meta, logic, modMappings };
      for (const regionPath of (regions.get(current.relative) ?? []).sort()) {
        if (options.signal?.aborted) {
          yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
        }
        if (!regionPath.endsWith('.smd3')) {
          if (context.mode === 'strict') throw new DecodeError('E_UNSUPPORTED', 'Legacy SMD region needs migration', { path: regionPath });
          diagnostics.push({ code: 'E_UNSUPPORTED', message: 'Legacy SMD region needs migration', path: regionPath });
          continue;
        }
        const entry = zip.get(regionPath)!;
        context.chargeBytes(entry.size);
        let temporary: string | undefined;
        try {
          const source = entry.size > maxBuffered ? (temporary = await spoolRegion(zip, entry, options.signal)) :
            (await zip.read(regionPath))!;
          for await (const event of streamSmd3(source, { ...options.segmentOptions,
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
        } finally {
          if (temporary) await fs.promises.rm(path.dirname(temporary), { recursive: true, force: true });
        }
      }
      const transforms = new Map(meta?.childTransforms.map(t => [path.posix.basename(t.name), t.offset]) ?? []);
      const childNames = [...(children.get(current.relative) ?? [])]
        .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
      for (const name of childNames.reverse()) {
        const offset = transforms.get(name) ?? ZERO;
        pending.push({ relative: `${current.relative}/${name}`, parent: current.relative,
          offset, worldOffset: addOffset(current.worldOffset, offset), depth: current.depth + 1 });
      }
    }
    yield { kind: 'end', status: diagnostics.length ? 'partial' : 'complete', entities, segments, diagnostics };
  } catch (error) {
    if (options.signal?.aborted) {
      yield { kind: 'end', status: 'cancelled', entities, segments, diagnostics }; return;
    }
    yield { kind: 'end', status: 'error', entities, segments, diagnostics: [...diagnostics, streamDiagnostic(error)] };
  } finally { await zip?.close(); }
}
