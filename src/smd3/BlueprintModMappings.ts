/** @fileoverview Namespaced blueprint block IDs in plain or legacy zlib-compressed SMBMM text. */
import { deflateSync, inflateSync } from 'node:zlib';
import { DecodeError } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, formatOutput, formatText,
  inheritFormatSource, rememberFormatSource, type FormatLimits } from '../core/FormatLimits.js';

/** One persisted mod-name, block-name and signed-short ID record. */
export interface NamespacedBlockMapping { modName: string; blockName: string; id: number; }
/** Compression controls encoding; byte and entry limits remain caller policies. */
export interface ModMappingOptions extends FormatLimits { compression?: 'none' | 'zlib'; }

/** Immutable bidirectional namespaced block index; no block placement/rendering policy is applied. */
export class BlueprintModMappings {
  private readonly byId = new Map<number, NamespacedBlockMapping>();
  private readonly byName = new Map<string, NamespacedBlockMapping>();
  private readonly limits: Required<FormatLimits>;
  readonly compression: 'none' | 'zlib';
  /** Validates reversible identities and snapshots caller-owned mapping records. */
  constructor(mappings: readonly NamespacedBlockMapping[] = [], options: ModMappingOptions = {}) {
    this.limits = formatLimits(options); checkEntryCount(mappings.length, this.limits);
    this.compression = options.compression ?? 'none';
    if (this.compression !== 'none' && this.compression !== 'zlib') throw new DecodeError('E_UNSUPPORTED', 'Unsupported mapping compression');
    for (const entry of mappings) {
      const key = BlueprintModMappings.key(entry.modName, entry.blockName);
      if (!Number.isInteger(entry.id) || entry.id < -32768 || entry.id > 32767) throw new DecodeError('E_RANGE', 'Mapping ID must be a signed short');
      if (this.byId.has(entry.id) || this.byName.has(key)) throw new DecodeError('E_FORMAT', 'Ambiguous duplicate mod mapping');
      const copy = Object.freeze({ ...entry }); this.byId.set(copy.id, copy); this.byName.set(key, copy);
    }
    Object.freeze(this);
  }
  /** Reads actual SMBMM text, including bounded legacy zlib streams. */
  static fromBuffer(input: Uint8Array, options: FormatLimits = {}): BlueprintModMappings {
    const limits = formatLimits(options), raw = formatBytes(input, limits);
    const compressed = raw.length >= 2 && (raw[0] & 15) === 8 && ((raw[0] << 8) + raw[1]) % 31 === 0;
    let bytes = raw;
    if (compressed) {
      try {
        const result = inflateSync(raw, { info: true, maxOutputLength: Math.max(1, limits.maxBytes) }) as unknown as {
          buffer: Buffer; engine: { bytesWritten: number };
        };
        if (result.engine.bytesWritten !== raw.length) throw new DecodeError('E_FORMAT', 'Trailing compressed mapping bytes');
        bytes = formatBytes(result.buffer, limits);
      } catch (cause) {
        if (cause instanceof DecodeError) throw cause;
        const code = (cause as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? 'E_LIMIT' : 'E_FORMAT';
        throw new DecodeError(code, 'Invalid or oversized compressed mod mappings', { cause });
      }
    }
    const mappings: NamespacedBlockMapping[] = [];
    for (const line of formatText(bytes).split(/\r?\n/)) {
      if (!line.trim()) continue;
      checkEntryCount(mappings.length + 1, limits);
      const fields = line.split('~');
      if (fields.length !== 3 || !/^[+-]?\d+$/.test(fields[2])) throw new DecodeError('E_FORMAT', 'Expected modName~blockName~shortId');
      mappings.push({ modName: fields[0], blockName: fields[1], id: Number(fields[2]) });
    }
    const model = new BlueprintModMappings(mappings, { ...options, compression: compressed ? 'zlib' : 'none' });
    rememberFormatSource(model, raw, model.encode()); return model;
  }
  /** Detached mappings in file order. */
  get mappings(): NamespacedBlockMapping[] { return [...this.byId.values()].map(entry => ({ ...entry })); }
  /** Number of mappings. */
  get size(): number { return this.byId.size; }
  /** Constant-time lookup of a namespace by its stored ID. */
  get(id: number): NamespacedBlockMapping | undefined { const found = this.byId.get(id); return found && { ...found }; }
  /** Constant-time lookup using the exact two namespace components. */
  idOf(modName: string, blockName: string): number | undefined { return this.byName.get(BlueprintModMappings.key(modName, blockName))?.id; }
  /** Replaces a namespace's ID or adds it; conflicting IDs fail atomically. */
  withMapping(entry: NamespacedBlockMapping): BlueprintModMappings {
    const key = BlueprintModMappings.key(entry.modName, entry.blockName), data = this.mappings;
    const index = data.findIndex(item => BlueprintModMappings.key(item.modName, item.blockName) === key);
    if (index < 0) data.push(entry); else data[index] = entry;
    return inheritFormatSource(this, new BlueprintModMappings(data, { ...this.limits, compression: this.compression }));
  }
  /** Removes one stored ID while preserving unrelated namespaces. */
  withoutId(id: number): BlueprintModMappings {
    return inheritFormatSource(this, new BlueprintModMappings(this.mappings.filter(item => item.id !== id), { ...this.limits, compression: this.compression }));
  }
  /** Resolves an explicit source-to-target ID translation; missing namespaces fail instead of guessing. */
  translationTo(target: BlueprintModMappings): ReadonlyMap<number, number> {
    const result = new Map<number, number>();
    for (const entry of this.byId.values()) {
      const id = target.idOf(entry.modName, entry.blockName);
      if (id === undefined) throw new DecodeError('E_FORMAT', 'Target mappings lack a source namespace');
      result.set(entry.id, id);
    }
    return result;
  }
  /** Writes current data, retaining original compression bytes for unchanged/reverted records. */
  toBuffer(): Buffer { return formatOutput(this, this.encode(), this.limits); }
  /** Detached namespace/ID JSON; the original binary envelope stays private. */
  toJSON(): { mappings: NamespacedBlockMapping[]; compression: 'none' | 'zlib' } {
    return { mappings: this.mappings, compression: this.compression };
  }
  /** Canonical serializer enforces the uncompressed byte budget before compression. */
  private encode(): Buffer {
    const text = this.mappings.map(item => `${item.modName}~${item.blockName}~${item.id}\n`).join('');
    const bytes = formatBytes(text, this.limits);
    return this.compression === 'zlib' ? deflateSync(bytes) : bytes;
  }
  /** Validates the actual separator-delimited namespace without imposing naming policy. */
  private static key(modName: string, blockName: string): string {
    for (const name of [modName, blockName]) {
      if (typeof name !== 'string' || !name || /[~\r\n]/.test(name)) throw new DecodeError('E_FORMAT', 'Invalid mod/block namespace');
    }
    return `${modName}~${blockName}`;
  }
}
