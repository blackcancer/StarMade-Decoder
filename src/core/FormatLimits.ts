/** @fileoverview Shared byte/collection budgets for explicit format models. */
import { boundedInteger, DecodeError } from './DecodeError.js';

/** Caller-selected resource ceilings, independent from game/server policy. */
export interface FormatLimits {
  maxBytes?: number;
  maxEntries?: number;
}

/** Validates limits once, retaining zero as a valid empty-only budget. */
export function formatLimits(options: FormatLimits = {}): Required<FormatLimits> {
  return Object.freeze({ maxBytes: boundedInteger(options.maxBytes ?? 16 * 1024 * 1024, 'maxBytes'),
    maxEntries: boundedInteger(options.maxEntries ?? 100000, 'maxEntries') });
}

/** Checks a collection before cloning or allocating its members. */
export function checkEntryCount(count: number, limits: Required<FormatLimits>): void {
  if (count > limits.maxEntries) throw new DecodeError('E_LIMIT', 'Format entry budget exceeded');
}

/** Takes a detached byte snapshot after checking the input/output byte budget. */
export function formatBytes(input: string | Uint8Array, limits: Required<FormatLimits>): Buffer {
  const length = typeof input === 'string' ? Buffer.byteLength(input) : input.byteLength;
  if (length > limits.maxBytes) throw new DecodeError('E_LIMIT', 'Format byte budget exceeded');
  const result = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  if (typeof input === 'string' && result.toString('utf8') !== input) throw new DecodeError('E_FORMAT', 'Invalid Unicode format text');
  return result;
}

/** Decodes text strictly so damaged bytes never become silently substituted characters. */
export function formatText(input: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); }
  catch (cause) { throw new DecodeError('E_FORMAT', 'Invalid UTF-8 format data', { cause }); }
}

/** Private source envelopes are never exposed through a model or its JSON. */
const originals = new WeakMap<object, { raw: Buffer; canonical: Buffer }>();

/** Records the canonical baseline used to recognize unchanged and reverted edits. */
export function rememberFormatSource(model: object, raw: Uint8Array, canonical: Uint8Array): void {
  originals.set(model, { raw: Buffer.from(raw), canonical: Buffer.from(canonical) });
}

/** Retains the original envelope across an immutable edit. */
export function inheritFormatSource<T extends object>(source: object, target: T): T {
  const original = originals.get(source);
  if (original) originals.set(target, original);
  return target;
}

/** Returns original bytes for unchanged data; changed records use the canonical writer. */
export function formatOutput(model: object, canonical: Uint8Array, limits: Required<FormatLimits>): Buffer {
  const original = originals.get(model), bytes = Buffer.from(canonical);
  return formatBytes(original && bytes.equals(original.canonical) ? original.raw : bytes, limits);
}
