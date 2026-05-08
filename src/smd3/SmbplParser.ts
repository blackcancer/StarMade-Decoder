/**
 * @fileoverview SMBpl Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbplParser — parser for .smbpl files (blueprint logic / connections).
 *
 * Format (BlueprintEntry.readStructure) :
 *   int   structureVersion   (currently always 0)
 *   [data ControlElementMap.deserialize]
 *     Same format as factory id=0 (ControlElementMapper) :
 *     int header (negative)
 *     int keySize
 *     for each key : 3×short pos + int valueSize + (short type + int elemSize + elemSize×3×short)
 *
 * For empty files (size = 0 or only the int version): no connection.
 *
 * Java source: BlueprintEntry.readStructure()
 */

import { BufferReader } from '../core/BufferReader.js';

export interface ControlLink {
  /** Controller block position (local to the segment) */
  fromX: number; fromY: number; fromZ: number;
  /** Controlled block type */
  type: number;
  /** Controlled block positions */
  targets: Array<{ x: number; y: number; z: number }>;
}

export interface SmbplFile {
  structureVersion: number;
  /** Control links (ControlElementMap) */
  links: ControlLink[];
  /** Controller block count */
  controllerCount: number;
}

export function parseSmbpl(data: Buffer | Uint8Array): SmbplFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result: SmbplFile = { structureVersion: 0, links: [], controllerCount: 0 };

  if (buf.length < 4) return result;

  const r = BufferReader.from(buf);
  result.structureVersion = r.readInt32BE();

  if (r.isEOF()) return result;

  // ControlElementMap.deserialize — port of factory id=0 parser
  try {
    const header = r.readInt32BE(); // negative
    if (header >= 0) {
      // Very old format without versioning (shift=8), cannot be parsed without context
      return result;
    }

    const version = -header;
    const isDisk = version > 1024;
    const keySize = r.readInt32BE();

    result.controllerCount = keySize;

    for (let i = 0; i < keySize; i++) {
      const fromX = r.readInt16BE();
      const fromY = r.readInt16BE();
      const fromZ = r.readInt16BE();

      const valueSize = r.readInt32BE();

      for (let v = 0; v < valueSize; v++) {
        const type = r.readInt16BE();
        const elemSize = r.readInt32BE();

        const targets: Array<{ x: number; y: number; z: number }> = [];

        if (isDisk) {
          // serializeForDisk : 3×short per element
          for (let e = 0; e < elemSize; e++) {
            const tx = r.readInt16BE();
            const ty = r.readInt16BE();
            const tz = r.readInt16BE();
            targets.push({ x: tx, y: ty, z: tz });
          }
        } else {
          // network format : compressed
          const bigX = r.readInt8() !== 0;
          const bigY = r.readInt8() !== 0;
          const bigZ = r.readInt8() !== 0;
          const mX = r.readInt16BE(), mY = r.readInt16BE(), mZ = r.readInt16BE();
          for (let e = 0; e < elemSize; e++) {
            const tx = (bigX ? r.readInt16BE() : r.readInt8()) + mX;
            const ty = (bigY ? r.readInt16BE() : r.readInt8()) + mY;
            const tz = (bigZ ? r.readInt16BE() : r.readInt8()) + mZ;
            targets.push({ x: tx, y: ty, z: tz });
          }
        }

        result.links.push({ fromX, fromY, fromZ, type, targets });
      }
    }
  } catch { /* unknown or truncated format */ }

  return result;
}
