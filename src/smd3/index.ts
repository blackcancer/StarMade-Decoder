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

export {
  parseSment,
  parseSmbph,
  BLUEPRINT_TYPE,
  BLUEPRINT_CLASSIFICATION,
  BlueprintArchive,
  BlueprintEntity,
  BlueprintHeader,
  BlueprintIndexScore,
  _parseHeaderBuffer,
  blueprintClassificationName,
  blueprintTypeOrdinal,
  defaultBlueprintClassification,
  normalizeBlueprintHeader,
} from './SmentParser.js';
export type {
  SmentFile,
  SmentEntity,
  BlueprintBlockCount,
  BlueprintClassification,
  BlueprintHeaderInput,
  BlueprintIndexScoreInput,
  BlueprintScoreField,
  BlueprintType,
  BoundingBox,
} from './SmentParser.js';

export {
  parseSmtpl,
  BlueprintTemplate,
  normalizeBlueprintTemplate,
  templatePositionFromKey,
  templatePositionKey,
} from './SmtplParser.js';
export type {
  SmtplFile,
  SmtplFileInput,
  TemplateConnection,
  TemplateFilterEntry,
  TemplateInventoryFilter,
  TemplatePiece,
  TemplatePosition,
  TemplateProductionEntry,
  TemplateProductionLimit,
} from './SmtplParser.js';

export { parseBlueprintFolder } from './BlueprintFolderParser.js';

export {
  parseSmbpm,
  BlueprintMeta,
  parseAiConfigTag,
  aiConfigToTag,
  parseRailChildRequestFromTag,
  railChildRequestToTag,
  getRailChildOffsetFromTag,
  getRailChildOffsetFromRequest,
} from './SmbpmParser.js';
export type {
  SmbpmFile,
  AiConfig,
  AiConfigEntry,
  DockingEntry,
  CargoPoint,
  RailDockerPiece,
  RailChildEntry,
  RailChildRequest,
  RailPieceRef,
  Vector3f,
  BlueprintChildOffset,
  BlueprintChildTransform,
} from './SmbpmParser.js';

export { parseSmbpl, BlueprintLogic } from './SmbplParser.js';
export type { SmbplFile, ControlController, ControlGroup, ControlLink } from './SmbplParser.js';

export { parseSmbmm } from './SmbmmParser.js';
export type { SmbmmFile, SmbmmFormat, ModMapping } from './SmbmmParser.js';

export { parseSim } from './SimParser.js';
export type { SimFile, SimGroup } from './SimParser.js';

// ── Writers ────────────────────────────────────────────────────────────────
export { writeSmd3, emptySegment, emptySmd3File } from './Smd3Writer.js';
export { writeSmtpl } from './SmtplWriter.js';
export { writeSmbpl } from './SmbplWriter.js';
export { writeSmbph } from './SmbphWriter.js';
export { writeSmbpm } from './SmbpmWriter.js';
export { writeSmbmm, emptyModMappings } from './SmbmmWriter.js';
export { writeSim } from './SimWriter.js';
