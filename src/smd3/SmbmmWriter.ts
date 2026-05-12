/**
 * @fileoverview SmbmmWriter
 *
 * Encoder for .smbmm files (blueprint mod mappings).
 * For vanilla blueprints: empty buffer.
 * For modded blueprints: raw bytes preserved from parse.
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
 * Modded blueprints preserve the raw bytes as-is.
 */
export function writeSmbmm(file: SmbmmFile): Buffer {
  if (file.isEmpty || file.raw.length === 0) return Buffer.alloc(0);
  return Buffer.from(file.raw);
}

/** Convenience: produces an empty .smbmm (vanilla blueprint). */
export function emptyModMappings(): Buffer {
  return Buffer.alloc(0);
}
