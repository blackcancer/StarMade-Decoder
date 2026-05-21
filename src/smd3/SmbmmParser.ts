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
 * Format: empty file for vanilla blueprints. Non-empty files carry old→new
 * block ID mappings. Known mapping streams are big-endian int32 pairs.
 * Unknown payloads are still preserved losslessly through raw.
 *
 * Java source: BlueprintEntry.writeModMappings() / ModMappings
 */

export type SmbmmFormat = 'empty' | 'int32Pairs' | 'unknown';

export interface ModMapping {
  from: number;
  to: number;
}

export interface SmbmmFile {
  /** File size */
  size: number;
  /** True when the file is empty (blueprint vanilla) */
  isEmpty: boolean;
  /** Parsed mapping format. */
  format?: SmbmmFormat;
  /** High-level old→new block ID mappings when the payload is parseable. */
  mappings?: ModMapping[];
  /** @deprecated raw fallback bytes for unknown payloads. Prefer mappings. */
  raw: Uint8Array;
}

export function parseSmbmm(data: Buffer | Uint8Array): SmbmmFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const isEmpty = buf.length === 0;
  const mappings: ModMapping[] = [];
  let format: SmbmmFormat = isEmpty ? 'empty' : 'unknown';

  if (!isEmpty && buf.length % 8 === 0) {
    format = 'int32Pairs';
    for (let offset = 0; offset < buf.length; offset += 8) {
      mappings.push({
        from: buf.readInt32BE(offset),
        to: buf.readInt32BE(offset + 4),
      });
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
