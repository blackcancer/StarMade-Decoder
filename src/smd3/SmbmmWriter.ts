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

/**
 * Encodes a .smbmm file.
 * Vanilla blueprints (isEmpty=true) produce an empty buffer.
 * Modded blueprints prefer typed old→new mappings and preserve raw bytes as
 * fallback for unknown payloads.
 */
export function writeSmbmm(file: SmbmmFile): Buffer {
  const mappings = file.mappings ?? [];
  if (mappings.length > 0 && (file.format === 'int32Pairs' || file.raw.length === 0 || file.isEmpty)) {
    const buf = Buffer.alloc(mappings.length * 8);
    mappings.forEach((mapping, index) => {
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
