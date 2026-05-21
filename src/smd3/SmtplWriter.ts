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
 * Exact inverse of SmtplParser.ts. Always writes version 6 (4-byte).
 *
 * Java source: CopyArea.save()
 */

import { BufferWriter } from '../core/BufferWriter.js';
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
  const w = new BufferWriter();

  // Version (always 6 = 4-byte format)
  w.writeInt8(6);

  w.writeInt32BE(file.minX); w.writeInt32BE(file.minY); w.writeInt32BE(file.minZ);
  w.writeInt32BE(file.maxX); w.writeInt32BE(file.maxY); w.writeInt32BE(file.maxZ);

  // Pieces — 4-byte format
  w.writeInt32BE(file.pieces.length);
  for (const p of file.pieces) {
    w.writeInt32BE(p.x);
    w.writeInt32BE(p.y);
    w.writeInt32BE(p.z);
    // Encode en int 4-byte
    let data = 0;
    data |= (p.type & 0x1FFF);
    data |= ((p.hp & 0x7F) << 13);
    data |= (p.active ? 1 : 0) << 20;
    data |= ((p.orientation & 0x1F) << 21);
    w.writeInt32BE(data);
  }

  // Connexions
  w.writeInt32BE(file.connections.length);
  for (const c of file.connections) {
    w.writeInt64BE(c.from);
    w.writeInt32BE(c.targets.length);
    for (const t of c.targets) w.writeInt64BE(t);
  }

  // Textes
  w.writeInt32BE(file.texts.size);
  for (const [key, text] of file.texts) {
    w.writeInt64BE(key);
    w.writeJavaModifiedUTF(text);
  }

  writeFilters(w, file.filters);

  w.writeInt32BE(file.production.length);
  for (const entry of file.production) {
    w.writeInt64BE(entry.position);
    w.writeInt16BE(entry.type);
  }

  w.writeInt32BE(file.productionLimits.length);
  for (const entry of file.productionLimits) {
    w.writeInt64BE(entry.position);
    w.writeInt32BE(entry.limit);
  }

  writeFilters(w, file.fillUpFilters);

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
