/**
 * @fileoverview SMBmm Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbmmParser — parser for .smbmm files (blueprint mod mappings).
 *
 * Format: empty file for vanilla blueprints. Non-empty game files contain modName~blockName~shortId text, optionally
 * zlib-compressed in older files. The earlier SDK integer-pair layout requires
 * explicit compatibility mode; opaque preservation is also explicitly selected.
 *
 * Java source: BlueprintEntry.writeModMappings() / ModMappings
 */

import { BlueprintModMappings, type NamespacedBlockMapping } from './BlueprintModMappings.js';
import { DecodeError } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, type FormatLimits } from '../core/FormatLimits.js';

/** Actual namespace text and explicit compatibility/opaque payload categories. */
export type SmbmmFormat = 'empty' | 'text' | 'zlibText' | 'int32Pairs' | 'unknown';

/** Explicit compatibility/recovery choices; current game text is the strict default. */
export interface SmbmmParseOptions extends FormatLimits {
  legacyInt32Pairs?: boolean;
  mode?: 'strict' | 'preserve';
}

/**
 * Describes the ModMapping data shape used by StarMade blueprint and segment file parsing.
 */
export interface ModMapping {
  from: number;
  to: number;
}

/**
 * Describes the SmbmmFile data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmbmmFile {
  /** File size */
  size: number;
  /** True when the file is empty (blueprint vanilla) */
  isEmpty: boolean;
  /** Parsed mapping format. */
  format?: SmbmmFormat;
  /** High-level old→new block ID mappings when the payload is parseable. */
  mappings?: ModMapping[];
  /** Actual game-format namespace records, separate from the older SDK's invented integer pairs. */
  namespacedMappings?: NamespacedBlockMapping[];
  /** @deprecated raw fallback bytes for unknown payloads. Prefer mappings. */
  raw: Uint8Array;
}

/**
 * Parses Smbmm for StarMade blueprint and segment file parsing.
 *
 * @param data - Input value for the parseSmbmm operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSmbmm(data: Buffer | Uint8Array, options: SmbmmParseOptions = {}): SmbmmFile {
  const limits = formatLimits(options);
  const buf = formatBytes(data, limits);
  if (options.mode !== undefined && options.mode !== 'strict' && options.mode !== 'preserve') throw new DecodeError('E_RANGE','Invalid mapping read mode');
  const isEmpty = buf.length === 0;
  const mappings: ModMapping[] = [];
  let format: SmbmmFormat = isEmpty ? 'empty' : 'unknown';

  if (options.legacyInt32Pairs && !isEmpty && buf.length % 8 === 0) {
    format = 'int32Pairs';
    checkEntryCount(buf.length / 8, limits);
    for (let offset = 0; offset < buf.length; offset += 8) {
      mappings.push({
        from: buf.readInt32BE(offset),
        to: buf.readInt32BE(offset + 4),
      });
    }
  } else if (!isEmpty) {
    try {
      const document = BlueprintModMappings.fromBuffer(buf, options);
      return { size: buf.length, isEmpty, format: document.compression === 'zlib' ? 'zlibText' : 'text',
        mappings, namespacedMappings: document.mappings, raw: new Uint8Array(buf) };
    } catch (error) {
      if (options.mode !== 'preserve' || error instanceof DecodeError && error.code === 'E_LIMIT') throw error;
    }
  }

  return {
    size: buf.length,
    isEmpty,
    format,
    mappings,
    raw: new Uint8Array(buf),
  };
}
