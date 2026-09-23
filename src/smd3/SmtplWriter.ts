/**
 * @fileoverview SMtpl Writer
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmtplWriter — encoder for .smtpl (StarMade block templates).
 *
 * Writes the requested version: legacy 1-3, current 4-5, or extended 6.
 * Version 5 matches StarMade-Open e5a3b49. No orientation migration is applied.
 *
 * Java source: CopyArea.save()
 */

import { BufferWriter } from '../core/BufferWriter.js';
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import { encodeBlockWord } from './Smd3Writer.js';
import { BlueprintTemplate, normalizeBlueprintTemplate } from './SmtplParser.js';
import type { SmtplFileInput, TemplateInventoryFilter } from './SmtplParser.js';

/**
 * Writes Smtpl to the StarMade binary representation.
 *
 * @param fileInput - Input value for the writeSmtpl operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writeSmtpl(fileInput: BlueprintTemplate | SmtplFileInput): Buffer {
  const file = normalizeBlueprintTemplate(fileInput);
  const version = boundedInteger(file.version, 'SMTPL version', 6);
  if (version === 0) throw new DecodeError('E_UNSUPPORTED', 'Unsupported SMTPL version 0');
  // Fail on data loss rather than silently dropping sections absent from an older format.
  if (version < 2 && file.texts.size > 0) throw new DecodeError('E_UNSUPPORTED', 'Texts require SMTPL version 2 or later');
  if (version < 3 && (file.filters.length > 0 || file.production.length > 0)) {
    throw new DecodeError('E_UNSUPPORTED', 'Inventory filters and production require SMTPL version 3 or later');
  }
  if (version < 5 && (file.productionLimits.length > 0 || file.fillUpFilters.length > 0)) {
    throw new DecodeError('E_UNSUPPORTED', 'Production limits and fill-up filters require SMTPL version 5 or later');
  }
  const w = new BufferWriter();

  w.writeInt8(version);

  w.writeInt32BE(file.minX); w.writeInt32BE(file.minY); w.writeInt32BE(file.minZ);
  w.writeInt32BE(file.maxX); w.writeInt32BE(file.maxY); w.writeInt32BE(file.maxZ);

  // Piece coordinates are always big-endian; the block word depends on the version.
  w.writeInt32BE(file.pieces.length);
  for (const p of file.pieces) {
    w.writeInt32BE(p.x);
    w.writeInt32BE(p.y);
    w.writeInt32BE(p.z);
    if (version === 6) {
      w.writeUInt32BE(encodeBlockWord(p));
    } else {
      boundedInteger(p.type, 'piece.type', 2047);
      boundedInteger(p.hp, 'piece.hp', version <= 3 ? 255 : 127);
      boundedInteger(p.orientation, 'piece.orientation', version <= 3 ? 15 : 31);
      boundedInteger(p.extra ?? 0, 'piece.extra', 0);
      if (typeof p.active !== 'boolean') throw new DecodeError('E_RANGE', 'piece.active must be boolean');
      if (version <= 3) {
        w.writeUInt8((p.orientation << 4) | (p.active ? 0 : 8) | (p.hp >>> 5));
        w.writeUInt8(((p.hp & 31) << 3) | (p.type >>> 8));
        w.writeUInt8(p.type & 255);
      } else {
        const word = p.type | (p.hp << 11) | ((p.active ? 1 : 0) << 18) | (p.orientation << 19);
        w.writeUInt8(word & 255);
        w.writeUInt8((word >>> 8) & 255);
        w.writeUInt8(word >>> 16);
      }
    }
  }

  // Connexions
  w.writeInt32BE(file.connections.length);
  for (const c of file.connections) {
    w.writeInt64BE(c.from);
    w.writeInt32BE(c.targets.length);
    for (const t of c.targets) w.writeInt64BE(t);
  }

  // Textes
  if (version >= 2) {
    w.writeInt32BE(file.texts.size);
    for (const [key, text] of file.texts) {
      w.writeInt64BE(key);
      w.writeJavaModifiedUTF(text);
    }
  }

  if (version >= 3) {
    writeFilters(w, file.filters);
    w.writeInt32BE(file.production.length);
    for (const entry of file.production) {
      w.writeInt64BE(entry.position);
      w.writeInt16BE(entry.type);
    }
  }

  if (version >= 5) {
    w.writeInt32BE(file.productionLimits.length);
    for (const entry of file.productionLimits) {
      w.writeInt64BE(entry.position);
      w.writeInt32BE(entry.limit);
    }
    writeFilters(w, file.fillUpFilters);
  }

  return w.toBuffer();
}

/**
 * Writes Filters to the StarMade binary representation.
 *
 * @param w - Input value for the writeFilters operation.
 * @param filters - Input value for the writeFilters operation.
 */
function writeFilters(w: BufferWriter, filters: TemplateInventoryFilter[]): void {
  w.writeInt32BE(filters.length);
  for (const filter of filters) {
    w.writeInt64BE(filter.position);
    w.writeInt32BE(filter.entries.length);
    for (const entry of filter.entries) {
      w.writeInt16BE(entry.type);
      w.writeInt32BE(entry.count);
    }
  }
}
