/** @fileoverview Immutable SMSKIN texture archives using the existing lossless ZIP carrier. */
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import { BlueprintZip } from '../smd3/BlueprintZip.js';

/** Texture roles stored in a player skin; no image decoding or rendering is performed. */
export type SkinTexture = 'mainDiffuse' | 'mainEmission' | 'helmetDiffuse' | 'helmetEmission';
/** Canonical names written by the game's skin archive creator. */
export const SKIN_TEXTURE_FILES: Readonly<Record<SkinTexture, string>> = Object.freeze({
  mainDiffuse: 'skin_main_diff.png', mainEmission: 'skin_main_em.png',
  helmetDiffuse: 'skin_helmet_diff.png', helmetEmission: 'skin_helmet_em.png',
});
/** All four caller-supplied PNG payloads; the document snapshots these bytes. */
export type SkinTextures = Readonly<Record<SkinTexture, Uint8Array>>;
/** Archive resource ceilings, independent of server upload policy or image dimensions. */
export interface SkinOptions {
  maxInputBytes?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
  maxOutputBytes?: number;
}
/** A detached description; PNG image metadata and pixels remain opaque. */
export interface SkinTextureInfo { name: string; byteLength: number; }
/** PNG signature only: image interpretation belongs to an image codec in the consumer. */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Validates every supplied ceiling and snapshots options for later revisions. */
function limits(options: SkinOptions): Required<SkinOptions> {
  return Object.freeze({
    maxInputBytes: boundedInteger(options.maxInputBytes ?? 16 * 1024 * 1024, 'maxInputBytes'),
    maxEntryBytes: boundedInteger(options.maxEntryBytes ?? 4 * 1024 * 1024, 'maxEntryBytes'),
    maxTotalBytes: boundedInteger(options.maxTotalBytes ?? 16 * 1024 * 1024, 'maxTotalBytes'),
    maxEntries: boundedInteger(options.maxEntries ?? 64, 'maxEntries'),
    maxOutputBytes: boundedInteger(options.maxOutputBytes ?? 16 * 1024 * 1024, 'maxOutputBytes', 0xfffffffe),
  });
}
/** Checks byte limits before copying any caller-owned resource. */
function bytes(input: Uint8Array, options: Required<SkinOptions>): Buffer {
  if (!(input instanceof Uint8Array)) throw new DecodeError('E_FORMAT', 'Skin resources require bytes');
  if (input.byteLength > options.maxEntryBytes) throw new DecodeError('E_LIMIT', 'Skin entry byte budget exceeded');
  return Buffer.from(input);
}

/** Four indexed PNG resources plus the original ZIP envelope and unknown entries. */
export class SkinDocument {
  readonly #archive: BlueprintZip;
  readonly #files: ReadonlyMap<string, Buffer | null>;
  readonly #names: Readonly<Record<SkinTexture, string>>;
  readonly #options: Required<SkinOptions>;

  /** Accepts private resource snapshots after complete archive and role validation. */
  private constructor(archive: BlueprintZip, files: ReadonlyMap<string, Buffer | null>, options: Required<SkinOptions>) {
    this.#archive = archive; this.#files = files; this.#options = options;
    const names = {} as Record<SkinTexture, string>;
    for (const role of Object.keys(SKIN_TEXTURE_FILES) as SkinTexture[]) {
      const suffix = SKIN_TEXTURE_FILES[role].slice(4);
      const matches = [...files.keys()].filter(name => !name.includes('/') && name.endsWith(suffix));
      if (matches.length === 0) throw new DecodeError('E_INCOMPLETE', `Missing skin texture: ${role}`);
      if (matches.length !== 1) throw new DecodeError('E_FORMAT', `Ambiguous skin texture: ${role}`);
      const value = files.get(matches[0])!;
      if (value === null || !value.subarray(0, 8).equals(PNG_SIGNATURE)) throw new DecodeError('E_FORMAT', `Skin texture lacks a PNG signature: ${role}`);
      names[role] = matches[0];
    }
    this.#names = Object.freeze(names);
    // The shared ZIP writer checks paths, entry counts, aggregate bytes and output bounds.
    this.toBuffer(); Object.freeze(this);
  }

  /** Reads a bounded ZIP32 archive and verifies its entries, CRCs and four texture roles. */
  static fromBuffer(input: Uint8Array, options: SkinOptions = {}): SkinDocument {
    const checked = limits(options), archive = new BlueprintZip(input, checked);
    return new SkinDocument(archive, archive.getEntries(), checked);
  }

  /** Creates an archive using the game's four canonical names without modifying image bytes. */
  static create(textures: SkinTextures, options: SkinOptions = {}): SkinDocument {
    const checked = limits(options), empty = Buffer.alloc(22);
    empty.writeUInt32LE(0x06054b50);
    const files = new Map<string, Buffer>();
    for (const role of Object.keys(SKIN_TEXTURE_FILES) as SkinTexture[]) files.set(SKIN_TEXTURE_FILES[role], bytes(textures[role], checked));
    return new SkinDocument(new BlueprintZip(empty, checked), files, checked);
  }

  /** Detached bytes for every file; null retains an explicit directory entry. */
  get files(): Map<string, Buffer | null> {
    return new Map([...this.#files].map(([name, value]) => [name, value === null ? null : Buffer.from(value)]));
  }

  /** Resolves a role to its exact stored filename and byte length. */
  textureInfo(role: SkinTexture): SkinTextureInfo {
    if (!Object.hasOwn(SKIN_TEXTURE_FILES, role)) throw new DecodeError('E_RANGE', 'Unknown skin texture role');
    const name = this.#names[role]; return { name, byteLength: this.#files.get(name)!.length };
  }

  /** Returns a detached PNG payload suitable for a consumer's image decoder. */
  texture(role: SkinTexture): Buffer { return Buffer.from(this.#files.get(this.textureInfo(role).name)!); }

  /** Replaces one PNG while retaining its original filename, other entries and ZIP metadata. */
  withTexture(role: SkinTexture, png: Uint8Array): SkinDocument {
    return this.withFile(this.textureInfo(role).name, png);
  }

  /** Adds or replaces a resource; malformed paths, ambiguous roles and budgets fail atomically. */
  withFile(name: string, data: Uint8Array | null): SkinDocument {
    const files = new Map(this.#files); files.set(name, data === null ? null : bytes(data, this.#options));
    return new SkinDocument(this.#archive, files, this.#options);
  }

  /** Removes an ancillary entry; removing a required texture fails without changing the document. */
  withoutFile(name: string): SkinDocument {
    const files = new Map(this.#files); files.delete(name);
    return new SkinDocument(this.#archive, files, this.#options);
  }

  /** Returns exact original bytes when unchanged/reverted, otherwise preserves untouched ZIP records. */
  toBuffer(): Buffer { return this.#archive.toBuffer(this.#files, this.#options.maxOutputBytes); }

  /** Describes resources without embedding images or exposing mutable internal buffers. */
  toJSON(): { textures: Record<SkinTexture, SkinTextureInfo>; files: string[] } {
    return { textures: Object.fromEntries((Object.keys(SKIN_TEXTURE_FILES) as SkinTexture[]).map(role => [role, this.textureInfo(role)])) as Record<SkinTexture, SkinTextureInfo>, files: [...this.#files.keys()].sort() };
  }
}
