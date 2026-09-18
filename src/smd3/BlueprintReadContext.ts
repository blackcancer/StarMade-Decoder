/**
 * @fileoverview Shared strict/recovery policy and resource budgets for blueprints.
 * ZIP and folder readers share the same decoded-segment budget. Recovery never
 * conceals omitted files and never bypasses resource limits.
 * @author InitSysRev
 * @version 1.5.0
 */
import { parseSmd3 } from './Smd3Parser.js';
import type { Smd3File, Smd3ParseOptions } from './Smd3Parser.js';

/** A skipped or incompletely decoded blueprint resource. */
export interface BlueprintDiagnostic { path: string; message: string; }
/** Limits apply to the entire archive/folder tree, not to each child separately. */
export interface BlueprintParseOptions extends Smd3ParseOptions {
  /** Maximum compressed archive bytes; default 256 MiB. */
  maxArchiveBytes?: number;
  /** Maximum declared uncompressed bytes across files; default 512 MiB. */
  maxTotalBytes?: number;
  /** Maximum uncompressed bytes per file; default 64 MiB. */
  maxEntryBytes?: number;
  /** Maximum ZIP/filesystem entries; default 20000. */
  maxEntries?: number;
  /** Maximum entity count; default 4096. */
  maxEntities?: number;
  /** Maximum attachment depth, root=0; default 64, hard maximum 256. */
  maxDepth?: number;
}
/** Internal per-parse mutable budget, never shared across independent reads. */
export class BlueprintReadContext {
  readonly diagnostics: BlueprintDiagnostic[] = [];
  readonly options: Required<Pick<BlueprintParseOptions, 'mode' | 'maxArchiveBytes' |
    'maxTotalBytes' | 'maxEntryBytes' | 'maxEntries' | 'maxEntities' | 'maxDepth' | 'maxSegments'>> & BlueprintParseOptions;
  private entities = 0;
  private entries = 0;
  private bytes = 0;
  private segments = 0;

  /** @param options Caller-defined policy and limits. @throws {RangeError} For invalid limits. */
  constructor(options: BlueprintParseOptions = {}) {
    this.options = { mode: 'strict', maxArchiveBytes: 256 * 1024 ** 2,
      maxTotalBytes: 512 * 1024 ** 2, maxEntryBytes: 64 * 1024 ** 2,
      maxEntries: 20000, maxEntities: 4096, maxDepth: 64, maxSegments: 4096, ...options };
    if (!['strict', 'recover'].includes(this.options.mode)) throw new TypeError('Invalid blueprint parsing mode');
    for (const name of ['maxArchiveBytes', 'maxTotalBytes', 'maxEntryBytes', 'maxEntries',
      'maxEntities', 'maxDepth', 'maxSegments'] as const) {
      if (!Number.isSafeInteger(this.options[name]) || this.options[name] < 0) throw new RangeError(`Invalid ${name}`);
    }
    if (this.options.maxDepth > 256) throw new RangeError('maxDepth cannot exceed 256');
  }

  /** @param size Declared file length. @throws {RangeError} If an archive budget is exhausted. */
  entry(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.options.maxEntryBytes) throw new RangeError('Blueprint entry byte budget exceeded');
    this.bytes += size;
    if (++this.entries > this.options.maxEntries || this.bytes > this.options.maxTotalBytes) throw new RangeError('Blueprint total entry/byte budget exceeded');
  }

  /** @param depth Attachment depth. @throws {RangeError} If the tree exceeds limits. */
  entity(depth: number): void {
    if (depth > this.options.maxDepth || ++this.entities > this.options.maxEntities) throw new RangeError('Blueprint entity/depth budget exceeded');
  }

  /**
   * Executes one resource read, recording recovery failures with their path.
   * @param path Resource identifier.
   * @param operation Strict reader.
   * @param fallback Value returned only in explicit recovery mode.
   * @returns The parsed value or recovery fallback.
   * @throws {Error} If parsing fails in strict mode.
   */
  read<T>(path: string, operation: () => T, fallback: T): T {
    try { return operation(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Resource exhaustion is never recoverable: it must stop further work.
      if (this.options.mode !== 'recover' || /budget exceeded/.test(message)) {
        throw new Error(`Blueprint ${path}: ${message}`, { cause });
      }
      this.diagnostics.push({ path, message });
      return fallback;
    }
  }

  /** @param path Resource identifier. @param data Region bytes. @returns The decoded region. */
  smd3(path: string, data: Buffer): Smd3File {
    const result = parseSmd3(data, { ...this.options,
      maxSegments: Math.min(4096, Math.max(0, this.options.maxSegments - this.segments)) });
    this.segments += result.usedSlots;
    if (this.segments > this.options.maxSegments) throw new RangeError('Blueprint decoded segment budget exceeded');
    for (const diagnostic of result.diagnostics ?? []) {
      this.diagnostics.push({ path: `${path}#slot=${diagnostic.slot}`, message: diagnostic.message });
    }
    return result;
  }
}
