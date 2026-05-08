/**
 * @fileoverview SMBph Writer
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbphWriter — encoder for .smbph (blueprint header).
 *
 * Exact inverse of _parseHeader() in SmentParser.ts.
 * Always writes current headerVersion 5.
 *
 * Java source: BlueprintEntry.writeHeader()
 */

import { BufferWriter } from '../core/BufferWriter.js';
import { BLUEPRINT_TYPE } from './SmentParser.js';
import type { BlueprintHeader } from './SmentParser.js';

export function writeSmbph(header: BlueprintHeader, gameVersion = '0.203.175_20250426_044402'): Buffer {
  const w = new BufferWriter();

  w.writeInt32BE(5); // headerVersion = 5 (current)
  w.writeJavaUTF(header.gameVersion ?? gameVersion);

  // entityType ordinal
  const typeIdx = BLUEPRINT_TYPE.indexOf(header.entityType as any);
  w.writeInt32BE(typeIdx >= 0 ? typeIdx : 0);

  // classification (headerVersion >= 3)
  w.writeInt32BE(header.classification ?? 0);

  // BoundingBox
  const bb = header.boundingBox;
  w.writeFloat32BE(bb.minX); w.writeFloat32BE(bb.minY); w.writeFloat32BE(bb.minZ);
  w.writeFloat32BE(bb.maxX); w.writeFloat32BE(bb.maxY); w.writeFloat32BE(bb.maxZ);

  // ElementCountMap: int existingTypeCount + (short type + int count)×
  const nonZero = header.blockCountByType.filter(e => e.count > 0);
  w.writeInt32BE(nonZero.length);
  for (const e of nonZero) {
    w.writeInt16BE(e.type);
    w.writeInt32BE(e.count);
  }

  // hasScore = false
  w.writeInt8(0);

  return w.toBuffer();
}
