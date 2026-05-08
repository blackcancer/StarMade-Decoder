/**
 * @fileoverview SMD3  Module  Exports
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Public exports for the smd3 module.
 */
export {
  parseSmd3,
  indexToPos,
  posToIndex,
  getBlock,
  CHUNK_DIM,
  BLOCK_COUNT,
  DATA_AVAILABLE,
  DATA_EMPTY,
  DATA_SINGLE,
  DATA_BITMAP,
  DATA_SINGLE_SIDE_EDGE,
  VERSION_4BYTE,
} from './Smd3Parser.js';

export type { Smd3File, SegmentData, BlockData } from './Smd3Parser.js';

export { parseSment, BLUEPRINT_TYPE, _parseHeaderBuffer } from './SmentParser.js';
export type { SmentFile, SmentEntity, BlueprintHeader, BoundingBox } from './SmentParser.js';

export { parseSmtpl } from './SmtplParser.js';
export type { SmtplFile, TemplatePiece, TemplateConnection } from './SmtplParser.js';

export { parseBlueprintFolder } from './BlueprintFolderParser.js';

export { parseSmbpm } from './SmbpmParser.js';
export type { SmbpmFile, DockingEntry, CargoPoint, RailDockerPiece } from './SmbpmParser.js';

export { parseSmbpl } from './SmbplParser.js';
export type { SmbplFile, ControlLink } from './SmbplParser.js';

export { parseSmbmm } from './SmbmmParser.js';
export type { SmbmmFile } from './SmbmmParser.js';

export { parseSim } from './SimParser.js';
export type { SimFile, SimGroup } from './SimParser.js';

// ── Writers ────────────────────────────────────────────────────────────────
export { writeSmd3, emptySegment, emptySmd3File } from './Smd3Writer.js';
export { writeSmtpl } from './SmtplWriter.js';
export { writeSmbpl } from './SmbplWriter.js';
export { writeSmbph } from './SmbphWriter.js';
