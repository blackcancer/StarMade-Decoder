/** @fileoverview Bounded immutable JSON collections for StarLoader .smdat files. */
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, formatOutput, formatText,
  inheritFormatSource, rememberFormatSource, type FormatLimits } from '../core/FormatLimits.js';
import { parsePersistentObjects, writePersistentObjects, type PersistentObjectEntry, type PersistentObjectFile } from './PersistentObjects.js';

/** Additional aggregate JSON resource budgets. */
export interface PersistentObjectLimits extends FormatLimits { maxNodes?: number; maxDepth?: number; }

/** Creates a detached JSON value while rejecting lossy or recursively unsafe input. */
function jsonSnapshot(value: unknown, budget: { left: number; depth: number }, depth = 0): unknown {
  if (--budget.left < 0 || depth > budget.depth) throw new DecodeError('E_LIMIT', 'Persistent JSON budget exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new DecodeError('E_RANGE', 'JSON number cannot be represented exactly');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > budget.left) throw new DecodeError('E_LIMIT', 'Persistent JSON budget exceeded');
    if (Object.keys(value).length !== value.length) throw new DecodeError('E_FORMAT', 'Sparse or extended arrays are not JSON collections');
    return Object.freeze(value.map(item => jsonSnapshot(item, budget, depth + 1)));
  }
  if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new DecodeError('E_FORMAT', 'Persistent objects require JSON-compatible values');
  }
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSnapshot(item, budget, depth + 1)])));
}

/** Immutable class-grouped JSON data; no application classes are instantiated. */
export class PersistentObjectDocument implements PersistentObjectFile {
  private readonly data: readonly PersistentObjectEntry[];
  private readonly limits: Required<PersistentObjectLimits>;
  /** Validates and snapshots all JSON members with one aggregate resource budget. */
  constructor(entries: readonly PersistentObjectEntry[] = [], options: PersistentObjectLimits = {}) {
    this.limits = { ...formatLimits(options), maxNodes: boundedInteger(options.maxNodes ?? 100000, 'maxNodes'),
      maxDepth: boundedInteger(options.maxDepth ?? 64, 'maxDepth', 256) };
    checkEntryCount(entries.length, this.limits);
    const budget = { left: this.limits.maxNodes, depth: this.limits.maxDepth };
    this.data = Object.freeze(entries.map(entry => {
      if (typeof entry.className !== 'string' || !entry.className || entry.className.trim() !== entry.className || /[\r\n]/.test(entry.className) || entry.className.startsWith('_end_')) {
        throw new DecodeError('E_FORMAT', 'Invalid persistent class name');
      }
      formatBytes(entry.className, this.limits);
      if (!Array.isArray(entry.objects)) throw new DecodeError('E_FORMAT', 'Persistent class members must be an array');
      return Object.freeze({ className: entry.className, objects: jsonSnapshot(entry.objects, budget) as unknown[] });
    }));
    Object.freeze(this);
  }
  /** Parses bounded strict UTF-8 and validates every decoded JSON value. */
  static fromBuffer(input: string | Uint8Array, options: PersistentObjectLimits = {}): PersistentObjectDocument {
    const bytes = formatBytes(input, formatLimits(options));
    const result = new PersistentObjectDocument(parsePersistentObjects(formatText(bytes)).entries, options);
    rememberFormatSource(result, bytes, writePersistentObjects(result)); return result;
  }
  /** Detached entries retain repeated class blocks and their original ordering. */
  get entries(): PersistentObjectEntry[] { return structuredClone(this.data) as PersistentObjectEntry[]; }
  /** All matching JSON objects, including repeated class blocks, without shared mutable references. */
  objectsFor(className: string): unknown[] { return this.entries.filter(entry => entry.className === className).flatMap(entry => entry.objects); }
  /** Replaces one class's complete collection at its first occurrence, retaining unrelated class order. */
  withClass(className: string, objects: readonly unknown[]): PersistentObjectDocument {
    const entries = this.entries, index = entries.findIndex(entry => entry.className === className);
    const remaining = entries.filter(entry => entry.className !== className);
    remaining.splice(index < 0 ? remaining.length : index, 0, { className, objects: [...objects] });
    return inheritFormatSource(this, new PersistentObjectDocument(remaining, this.limits));
  }
  /** Removes all blocks of one class without affecting the original document. */
  withoutClass(className: string): PersistentObjectDocument {
    return inheritFormatSource(this, new PersistentObjectDocument(this.entries.filter(entry => entry.className !== className), this.limits));
  }
  /** Writes validated JSON, preserving exact source bytes for unchanged or reverted data. */
  toBuffer(): Buffer { return formatOutput(this, writePersistentObjects(this), this.limits); }
  /** Detached plain JSON projection. */
  toJSON(): PersistentObjectFile { return { entries: this.entries }; }
}
