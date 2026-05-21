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
import {
  BlueprintHeader,
  blueprintTypeOrdinal,
  normalizeBlueprintHeader,
} from './SmentParser.js';
import type { BlueprintHeaderInput, BlueprintIndexScore } from './SmentParser.js';

const DEFAULT_GAME_VERSION = '0.203.175_20250426_044402';

export function writeSmbph(
  headerInput: BlueprintHeader | BlueprintHeaderInput,
  gameVersion?: string
): Buffer {
  const header = normalizeBlueprintHeader(headerInput);
  const w = new BufferWriter();

  w.writeInt32BE(5); // headerVersion = 5 (current)
  w.writeJavaModifiedUTF(gameVersion ?? header.gameVersion ?? DEFAULT_GAME_VERSION);

  // entityType ordinal
  const typeIdx = blueprintTypeOrdinal(header.entityType);
  w.writeInt32BE(typeIdx >= 0 ? typeIdx : 0);

  // classification (headerVersion >= 3)
  w.writeInt32BE(header.classificationOrdinal);

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

  if (header.score) {
    w.writeInt8(1);
    writeBlueprintIndexScore(w, header.score);
  } else {
    w.writeInt8(0);
  }

  return w.toBuffer();
}

function writeBlueprintIndexScore(w: BufferWriter, score: BlueprintIndexScore): void {
  w.writeInt16BE(score.version);
  w.writeFloat64BE(score.legacyOffensiveIndex);
  w.writeFloat64BE(score.defensiveIndex);
  w.writeFloat64BE(score.powerIndex);
  w.writeFloat64BE(score.mobilityIndex);
  w.writeFloat64BE(score.dangerIndex);
  w.writeFloat64BE(score.survivabilityIndex);
  w.writeFloat64BE(score.offensiveIndex);
  w.writeFloat64BE(score.supportIndex);
  if (score.version >= 1) {
    w.writeFloat64BE(score.miningIndex);
  }
}
