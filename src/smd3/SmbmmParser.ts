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
 * Format: trivial — empty file for vanilla blueprints.
 * For modified blueprints, contains an undocumented old→new ID mapping.
 * The raw bytes are simply stored.
 *
 * Java source: BlueprintEntry.writeModMappings() / ModMappings
 */

export interface SmbmmFile {
  /** File size */
  size: number;
  /** True when the file is empty (blueprint vanilla) */
  isEmpty: boolean;
  /** Raw bytes (when non-empty) */
  raw: Uint8Array;
}

export function parseSmbmm(data: Buffer | Uint8Array): SmbmmFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return {
    size: buf.length,
    isEmpty: buf.length === 0,
    raw: new Uint8Array(buf),
  };
}
