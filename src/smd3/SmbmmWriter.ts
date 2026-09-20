/**
 * @fileoverview SmbmmWriter
 *
 * Encoder for .smbmm files (blueprint mod mappings).
 * For vanilla blueprints: empty buffer.
 * For modded blueprints: write high-level mappings when available, otherwise
 * preserve raw bytes from parse.
 *
 * Java source: BlueprintEntry.writeModMappings()
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import type { SmbmmFile } from './SmbmmParser.js';
import { BlueprintModMappings } from './BlueprintModMappings.js';
import { checkEntryCount, formatBytes, formatLimits, type FormatLimits } from '../core/FormatLimits.js';
import { DecodeError } from '../core/DecodeError.js';

/**
 * Encodes a .smbmm file.
 * Vanilla blueprints (isEmpty=true) produce an empty buffer.
 * Modded blueprints prefer typed old→new mappings and preserve raw bytes as
 * fallback for unknown payloads.
 */
export function writeSmbmm(file: SmbmmFile, options: FormatLimits = {}): Buffer {
  const limits = formatLimits(options);
  formatBytes(file.raw, limits);
  if (file.namespacedMappings) {
    const compression = file.format === 'zlibText' ? 'zlib' : 'none';
    const encoded = new BlueprintModMappings(file.namespacedMappings, { ...limits, compression }).toBuffer();
    // Parsed envelopes remain exact until namespace data changes.
    if (file.raw.length) {
      const original = BlueprintModMappings.fromBuffer(file.raw, limits);
      if (JSON.stringify(original.mappings) === JSON.stringify(file.namespacedMappings)) return Buffer.from(file.raw);
    }
    return encoded;
  }
  const mappings = file.mappings ?? [];
  if (mappings.length > 0) {
    if (file.format !== 'int32Pairs') throw new DecodeError('E_UNSUPPORTED', 'Integer-pair mappings require explicit old-SDK format');
    checkEntryCount(mappings.length, limits);
    if (mappings.length > Math.floor(limits.maxBytes / 8)) throw new DecodeError('E_LIMIT','Mapping output byte budget exceeded');
    const buf = Buffer.alloc(mappings.length * 8);
    mappings.forEach((mapping, index) => {
      if (!Number.isInteger(mapping.from) || !Number.isInteger(mapping.to)) throw new DecodeError('E_RANGE','Legacy mapping IDs must be integers');
      const offset = index * 8;
      buf.writeInt32BE(mapping.from, offset);
      buf.writeInt32BE(mapping.to, offset + 4);
    });
    return buf;
  }
  if (file.isEmpty || file.raw.length === 0) return Buffer.alloc(0);
  return Buffer.from(file.raw);
}

/** Convenience: produces an empty .smbmm (vanilla blueprint). */
export function emptyModMappings(): Buffer {
  return Buffer.alloc(0);
}
