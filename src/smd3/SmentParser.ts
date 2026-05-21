/**
 * @fileoverview StarMade Entity Blueprint Parser
 *
 * Parses .sment blueprint archives, including headers, attached child entities, and available .smd3 segment data.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmentParser handles StarMade entity blueprint archives (.sment).
 *
 * A .sment file is a ZIP archive containing:
 *   {name}/header.smbph        — bounding box, version, and entity type metadata
 *   {name}/meta.smbpm          — manager data (tag-based)
 *   {name}/logic.smbpl         — logic/control wiring
 *   {name}/modmappings.smbmm   — mod mapping data (empty for vanilla blueprints)
 *   {name}/DATA/*.smd3         — main entity block segments
 *   {name}/ATTACHED_N/...      — attached child entities using the same file layout
 *
 * .smbph header format based on BlueprintEntry.readHeader():
 *   int  headerVersion
 *   [if ≥ 5] UTF gameVersion        (DataOutputStream.writeUTF)
 *   int  entityType                 (BlueprintType ordinal)
 *   [if ≥ 3] int classification     (BlueprintClassification ordinal)
 *   float bbMinX, bbMinY, bbMinZ
 *   float bbMaxX, bbMaxY, bbMaxZ
 *   ElementCountMap                 (int size + (short type + int count)×)
 *   [if ≥ 1] boolean hasScore + score payload
 *
 * Java reference: BlueprintEntry.java
 */

import AdmZip from 'adm-zip';
import { parseSmd3 } from './Smd3Parser.js';
import type { Smd3File } from './Smd3Parser.js';
import { parseSmbpm } from './SmbpmParser.js';
import type { BlueprintChildOffset, BlueprintMeta } from './SmbpmParser.js';
import { parseSmbpl } from './SmbplParser.js';
import type { BlueprintLogic } from './SmbplParser.js';
import { BufferReader } from '../core/BufferReader.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Blueprint types matching the Java BlueprintType enum ordinals.
 * Source: org.schema.game.server.data.blueprintnw.BlueprintType
 *   0=SHIP, 1=SHOP, 2=SPACE_STATION, 3=MANAGED_ASTEROID, 4=ASTEROID, 5=PLANET
 */
export const BLUEPRINT_TYPE = [
  'SHIP',             // 0
  'SHOP',             // 1
  'SPACE_STATION',    // 2
  'MANAGED_ASTEROID', // 3
  'ASTEROID',         // 4
  'PLANET',           // 5
] as const;
/**
 * Defines the BlueprintType type used by StarMade blueprint and segment file parsing.
 */
export type BlueprintType = typeof BLUEPRINT_TYPE[number];

/**
 * BlueprintClassification ordinals from StarMade-Open.
 * Source: org.schema.game.server.data.blueprintnw.BlueprintClassification
 */
export const BLUEPRINT_CLASSIFICATION = [
  'NONE',
  'MINING',
  'SUPPORT',
  'CARGO',
  'ATTACK',
  'DEFENSE',
  'CARRIER',
  'SCOUT',
  'SCAVENGER',
  'NONE_STATION',
  'SHIPYARD_STATION',
  'OUTPOST_STATION',
  'DEFENSE_STATION',
  'MINING_STATION',
  'FACTORY_STATION',
  'TRADE_STATION',
  'WAYPOINT_STATION',
  'SHOPPING_STATION',
  'NONE_ASTEROID',
  'NONE_ASTEROID_MANAGED',
  'NONE_PLANET',
  'NONE_SHOP',
  'NONE_ICO',
  'ALL_SHIPS',
] as const;
/**
 * Defines the BlueprintClassification type used by StarMade blueprint and segment file parsing.
 */
export type BlueprintClassification = typeof BLUEPRINT_CLASSIFICATION[number];

/**
 * Describes the BoundingBox data shape used by StarMade blueprint and segment file parsing.
 */
export interface BoundingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/**
 * Describes the BlueprintBlockCount data shape used by StarMade blueprint and segment file parsing.
 */
export interface BlueprintBlockCount {
  type: number;
  count: number;
}

/**
 * Defines the BlueprintScoreField type used by StarMade blueprint and segment file parsing.
 */
export type BlueprintScoreField =
  | 'offensiveIndex'
  | 'defensiveIndex'
  | 'powerIndex'
  | 'mobilityIndex'
  | 'dangerIndex'
  | 'survivabilityIndex'
  | 'supportIndex'
  | 'miningIndex';

/**
 * Defines BLUEPRINT_SCORE_FIELDS for StarMade blueprint and segment file parsing.
 */
const BLUEPRINT_SCORE_FIELDS: BlueprintScoreField[] = [
  'offensiveIndex',
  'defensiveIndex',
  'powerIndex',
  'mobilityIndex',
  'dangerIndex',
  'survivabilityIndex',
  'supportIndex',
  'miningIndex',
];

/**
 * Describes the BlueprintIndexScoreInput data shape used by StarMade blueprint and segment file parsing.
 */
export interface BlueprintIndexScoreInput {
  version?: number;
  legacyOffensiveIndex?: number;
  offensiveIndex?: number;
  defensiveIndex?: number;
  powerIndex?: number;
  mobilityIndex?: number;
  dangerIndex?: number;
  survivabilityIndex?: number;
  supportIndex?: number;
  miningIndex?: number;
}

/**
 * Represents the BlueprintIndexScore model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintIndexScore {
  version: number;
  legacyOffensiveIndex: number;
  offensiveIndex: number;
  defensiveIndex: number;
  powerIndex: number;
  mobilityIndex: number;
  dangerIndex: number;
  survivabilityIndex: number;
  supportIndex: number;
  miningIndex: number;

  /**
   * Creates a BlueprintIndexScore instance.
   *
   * @param input - Input value for the constructor operation.
   */
  constructor(input: BlueprintIndexScoreInput = {}) {
    this.version = input.version === 0 ? 0 : 1;
    this.offensiveIndex = input.offensiveIndex ?? 0;
    this.legacyOffensiveIndex = input.legacyOffensiveIndex ?? this.offensiveIndex;
    this.defensiveIndex = input.defensiveIndex ?? 0;
    this.powerIndex = input.powerIndex ?? 0;
    this.mobilityIndex = input.mobilityIndex ?? 0;
    this.dangerIndex = input.dangerIndex ?? 0;
    this.survivabilityIndex = input.survivabilityIndex ?? 0;
    this.supportIndex = input.supportIndex ?? 0;
    this.miningIndex = input.miningIndex ?? 0;
  }

  /**
   * Reports whether hasMiningIndex is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hasMiningIndex(): boolean {
    return this.version >= 1;
  }

  /**
   * Converts this value to talIndex.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get totalIndex(): number {
    return BLUEPRINT_SCORE_FIELDS.reduce((sum, field) => sum + this[field], 0);
  }

  /**
   * Handles the strongestField operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get strongestField(): BlueprintScoreField {
    return BLUEPRINT_SCORE_FIELDS.reduce((best, field) => this[field] > this[best] ? field : best);
  }

  /**
   * Returns Value.
   *
   * @param field - Input value for the getValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  getValue(field: BlueprintScoreField): number {
    return this[field];
  }

  /**
   * Returns a copy updated with Version.
   *
   * @param version - Input value for the withVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withVersion(version: number): BlueprintIndexScore {
    return new BlueprintIndexScore({ ...this, version });
  }

  /**
   * Returns a copy updated with Value.
   *
   * @param field - Input value for the withValue operation.
   * @param value - Input value for the withValue operation.
   * @returns The computed StarMade-Decoder value.
   */
  withValue(field: BlueprintScoreField, value: number): BlueprintIndexScore {
    return new BlueprintIndexScore({ ...this, [field]: value });
  }

  /**
   * Returns a copy updated with Values.
   *
   * @param values - Input value for the withValues operation.
   * @returns The computed StarMade-Decoder value.
   */
  withValues(values: Partial<BlueprintIndexScoreInput>): BlueprintIndexScore {
    return new BlueprintIndexScore({ ...this, ...values });
  }
}

/**
 * Describes the BlueprintHeaderInput data shape used by StarMade blueprint and segment file parsing.
 */
export interface BlueprintHeaderInput {
  headerVersion: number;
  gameVersion?: string;
  entityType: string;
  classification?: number;
  boundingBox: BoundingBox;
  blockCountByType: BlueprintBlockCount[];
  totalBlockCount?: number;
  score?: BlueprintIndexScore | BlueprintIndexScoreInput | null;
}

/**
 * Represents the BlueprintHeader model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintHeader {
  headerVersion: number;
  gameVersion?: string;
  entityType: string;
  classification?: number;
  boundingBox: BoundingBox;
  blockCountByType: BlueprintBlockCount[];
  totalBlockCount: number;
  score: BlueprintIndexScore | null;

  /**
   * Creates a BlueprintHeader instance.
   *
   * @param input - Input value for the constructor operation.
   */
  constructor(input: BlueprintHeaderInput) {
    this.headerVersion = input.headerVersion;
    this.gameVersion = input.gameVersion;
    this.entityType = input.entityType;
    this.classification = input.classification;
    this.boundingBox = { ...input.boundingBox };
    this.blockCountByType = normalizeBlockCounts(input.blockCountByType);
    this.totalBlockCount = input.totalBlockCount ?? sumBlockCounts(this.blockCountByType);
    this.score = normalizeBlueprintScore(input.score);
  }

  /**
   * Handles the entityTypeOrdinal operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entityTypeOrdinal(): number {
    return blueprintTypeOrdinal(this.entityType);
  }

  /**
   * Handles the classificationOrdinal operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get classificationOrdinal(): number {
    return this.classification ?? defaultBlueprintClassification(this.entityType);
  }

  /**
   * Handles the classificationName operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get classificationName(): string {
    return blueprintClassificationName(this.classificationOrdinal);
  }

  /**
   * Reports whether hasScore is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get hasScore(): boolean {
    return this.score !== null;
  }

  /**
   * Handles the blockTypeCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get blockTypeCount(): number {
    return this.blockCountByType.length;
  }

  /**
   * Reports whether isEmpty is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isEmpty(): boolean {
    return this.totalBlockCount <= 0;
  }

  /**
   * Handles the boundsSize operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get boundsSize(): { x: number; y: number; z: number } {
    const box = this.boundingBox;
    return {
      x: box.maxX - box.minX,
      y: box.maxY - box.minY,
      z: box.maxZ - box.minZ,
    };
  }

  /**
   * Handles the boundsCenter operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get boundsCenter(): { x: number; y: number; z: number } {
    const box = this.boundingBox;
    return {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      z: (box.minZ + box.maxZ) / 2,
    };
  }

  /**
   * Handles the boundsVolume operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get boundsVolume(): number {
    const size = this.boundsSize;
    return size.x * size.y * size.z;
  }

  /**
   * Handles the blockCountOf operation used by StarMade blueprint and segment file parsing.
   *
   * @param type - Input value for the blockCountOf operation.
   * @returns The computed StarMade-Decoder value.
   */
  blockCountOf(type: number): number {
    return this.blockCountByType.find(entry => entry.type === type)?.count ?? 0;
  }

  /**
   * Reports whether hasBlockType is true for the current value.
   *
   * @param type - Input value for the hasBlockType operation.
   * @returns The computed StarMade-Decoder value.
   */
  hasBlockType(type: number): boolean {
    return this.blockCountOf(type) > 0;
  }

  /**
   * Handles the blockShare operation used by StarMade blueprint and segment file parsing.
   *
   * @param type - Input value for the blockShare operation.
   * @returns The computed StarMade-Decoder value.
   */
  blockShare(type: number): number {
    return this.totalBlockCount > 0 ? this.blockCountOf(type) / this.totalBlockCount : 0;
  }

  /**
   * Converts this value to pBlockTypes.
   *
   * @param limit - Input value for the topBlockTypes operation.
   * @returns The computed StarMade-Decoder value.
   */
  topBlockTypes(limit = 10): BlueprintBlockCount[] {
    return [...this.blockCountByType].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  /**
   * Returns a copy updated with HeaderVersion.
   *
   * @param headerVersion - Input value for the withHeaderVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHeaderVersion(headerVersion: number): BlueprintHeader {
    return new BlueprintHeader({ ...this, headerVersion });
  }

  /**
   * Returns a copy updated with GameVersion.
   *
   * @param gameVersion - Input value for the withGameVersion operation.
   * @returns The computed StarMade-Decoder value.
   */
  withGameVersion(gameVersion: string | undefined): BlueprintHeader {
    return new BlueprintHeader({ ...this, gameVersion });
  }

  /**
   * Returns a copy updated with EntityType.
   *
   * @param entityType - Input value for the withEntityType operation.
   * @param classification - Input value for the withEntityType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withEntityType(entityType: string, classification = defaultBlueprintClassification(entityType)): BlueprintHeader {
    return new BlueprintHeader({ ...this, entityType, classification });
  }

  /**
   * Returns a copy updated with Classification.
   *
   * @param classification - Input value for the withClassification operation.
   * @returns The computed StarMade-Decoder value.
   */
  withClassification(classification: number | undefined): BlueprintHeader {
    return new BlueprintHeader({ ...this, classification });
  }

  /**
   * Returns a copy updated with BoundingBox.
   *
   * @param boundingBox - Input value for the withBoundingBox operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBoundingBox(boundingBox: BoundingBox): BlueprintHeader {
    return new BlueprintHeader({ ...this, boundingBox });
  }

  /**
   * Returns a copy updated with BlockCounts.
   *
   * @param blockCountByType - Input value for the withBlockCounts operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBlockCounts(blockCountByType: BlueprintBlockCount[]): BlueprintHeader {
    return new BlueprintHeader({ ...this, blockCountByType, totalBlockCount: undefined });
  }

  /**
   * Returns a copy updated with BlockCount.
   *
   * @param type - Input value for the withBlockCount operation.
   * @param count - Input value for the withBlockCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  withBlockCount(type: number, count: number): BlueprintHeader {
    const withoutType = this.blockCountByType.filter(entry => entry.type !== type);
    return this.withBlockCounts(count > 0 ? [...withoutType, { type, count }] : withoutType);
  }

  /**
   * Returns a copy updated with outBlockType.
   *
   * @param type - Input value for the withoutBlockType operation.
   * @returns The computed StarMade-Decoder value.
   */
  withoutBlockType(type: number): BlueprintHeader {
    return this.withBlockCount(type, 0);
  }

  /**
   * Returns a copy updated with Score.
   *
   * @param score - Input value for the withScore operation.
   * @returns The computed StarMade-Decoder value.
   */
  withScore(score: BlueprintIndexScore | BlueprintIndexScoreInput | null): BlueprintHeader {
    return new BlueprintHeader({ ...this, score });
  }
}

/**
 * Describes the SmentEntity data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmentEntity {
  /** Folder name inside the zip (for example "Sobek Dreadnought 2025-jun-02" or "ATTACHED_5") */
  name: string;
  header: BlueprintHeader;
  /** Local entity offset relative to its parent blueprint entity. Root is always 0,0,0. */
  offset: BlueprintChildOffset;
  /** Accumulated offset from the root blueprint entity. Root is always 0,0,0. */
  worldOffset: BlueprintChildOffset;
  /** Parsed meta.smbpm, when present and parseable. */
  meta: BlueprintMeta | null;
  /** Parsed logic.smbpl control network, when present and parseable. */
  logic: BlueprintLogic | null;
  /** Parsed .smd3 files. */
  segments: Smd3File[];
  /** Attached child entities such as turrets or docked modules. */
  children: SmentEntity[];
}

/**
 * Describes the SmentFile data shape used by StarMade blueprint and segment file parsing.
 */
export interface SmentFile {
  /** Root entity, usually the main ship or station. */
  root: SmentEntity;
  /** Total entity count including the root and all recursive children. */
  totalEntities: number;
  /** Total number of .smd3 segments */
  totalSegments: number;
}

/**
 * Represents the BlueprintEntity model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintEntity implements SmentEntity {
  name: string;
  header: BlueprintHeader;
  offset: BlueprintChildOffset;
  worldOffset: BlueprintChildOffset;
  meta: BlueprintMeta | null;
  logic: BlueprintLogic | null;
  segments: Smd3File[];
  children: SmentEntity[];

  /**
   * Creates a BlueprintEntity instance.
   *
   * @param input - Input value for the constructor operation.
   */
  constructor(input: SmentEntity) {
    this.name = input.name;
    this.header = input.header instanceof BlueprintHeader
      ? input.header
      : new BlueprintHeader(input.header);
    this.offset = input.offset;
    this.worldOffset = input.worldOffset;
    this.meta = input.meta;
    this.logic = input.logic;
    this.segments = [...input.segments];
    this.children = [...input.children];
  }

  /**
   * Handles the entityType operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entityType(): string {
    return this.header.entityType;
  }

  /**
   * Handles the directBlockCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get directBlockCount(): number {
    return this.segments.reduce(
      (sum, smd3) => sum + smd3.segments.reduce((inner, segment) => inner + segment.blockCount, 0),
      0
    );
  }

  /**
   * Handles the declaredBlockCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get declaredBlockCount(): number {
    return this.header.totalBlockCount;
  }

  /**
   * Handles the segmentFileCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get segmentFileCount(): number {
    return this.segments.length;
  }

  /**
   * Handles the attachmentCount operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get attachmentCount(): number {
    return this.children.length;
  }

  /**
   * Handles the child operation used by StarMade blueprint and segment file parsing.
   *
   * @param name - Input value for the child operation.
   * @returns The computed StarMade-Decoder value.
   */
  child(name: string): SmentEntity | null {
    const wanted = basenameBlueprintEntityName(name);
    return this.children.find(child => child.name === name || basenameBlueprintEntityName(child.name) === wanted) ?? null;
  }

  /**
   * Handles the allEntities operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  allEntities(): SmentEntity[] {
    const result: SmentEntity[] = [this];
    for (const child of this.children) {
      if (child instanceof BlueprintEntity) {
        result.push(...child.allEntities());
      } else {
        result.push(child);
      }
    }
    return result;
  }

  /**
   * Finds Entity in StarMade blueprint and segment file parsing.
   *
   * @param name - Input value for the findEntity operation.
   * @returns The computed StarMade-Decoder value.
   */
  findEntity(name: string): SmentEntity | null {
    const wanted = basenameBlueprintEntityName(name);
    return this.allEntities().find(entity =>
      entity.name === name || basenameBlueprintEntityName(entity.name) === wanted
    ) ?? null;
  }

  /**
   * Returns a copy updated with Meta.
   *
   * @param meta - Input value for the withMeta operation.
   * @returns The computed StarMade-Decoder value.
   */
  withMeta(meta: BlueprintMeta | null): BlueprintEntity {
    return new BlueprintEntity({ ...this, meta });
  }

  /**
   * Returns a copy updated with Logic.
   *
   * @param logic - Input value for the withLogic operation.
   * @returns The computed StarMade-Decoder value.
   */
  withLogic(logic: BlueprintLogic | null): BlueprintEntity {
    return new BlueprintEntity({ ...this, logic });
  }

  /**
   * Returns a copy updated with Header.
   *
   * @param header - Input value for the withHeader operation.
   * @returns The computed StarMade-Decoder value.
   */
  withHeader(header: BlueprintHeader | BlueprintHeaderInput): BlueprintEntity {
    return new BlueprintEntity({ ...this, header: normalizeBlueprintHeader(header) });
  }

  /**
   * Returns a copy updated with Children.
   *
   * @param children - Input value for the withChildren operation.
   * @returns The computed StarMade-Decoder value.
   */
  withChildren(children: SmentEntity[]): BlueprintEntity {
    return new BlueprintEntity({ ...this, children });
  }
}

/**
 * Represents the BlueprintArchive model used by StarMade blueprint and segment file parsing.
 */
export class BlueprintArchive implements SmentFile {
  root: BlueprintEntity;
  totalEntities: number;
  totalSegments: number;

  /**
   * Creates a BlueprintArchive instance.
   *
   * @param root - Input value for the constructor operation.
   */
  constructor(root: SmentEntity) {
    this.root = root instanceof BlueprintEntity ? root : new BlueprintEntity(root);
    this.totalEntities = countEntities(root);
    this.totalSegments = countSegmentFiles(root);
  }

  /**
   * Handles the entities operation used by StarMade blueprint and segment file parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get entities(): SmentEntity[] {
    return this.root instanceof BlueprintEntity
      ? this.root.allEntities()
      : collectEntities(this.root);
  }

  /**
   * Converts this value to talBlockCount.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get totalBlockCount(): number {
    return this.entities.reduce((sum, entity) =>
      sum + entity.segments.reduce((smd3Sum, smd3) =>
        smd3Sum + smd3.segments.reduce((segmentSum, segment) => segmentSum + segment.blockCount, 0),
        0
      ),
      0
    );
  }

  /**
   * Finds Entity in StarMade blueprint and segment file parsing.
   *
   * @param name - Input value for the findEntity operation.
   * @returns The computed StarMade-Decoder value.
   */
  findEntity(name: string): SmentEntity | null {
    return this.root instanceof BlueprintEntity
      ? this.root.findEntity(name)
      : collectEntities(this.root).find(entity => entity.name === name) ?? null;
  }
}

// ── Main Parser ───────────────────────────────────────────────────────────────

/**
 * Parses a StarMade .sment blueprint archive.
 * @param data Buffer containing the .sment file bytes.
 */
export function parseSment(data: Buffer | Uint8Array): BlueprintArchive {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  // Find the root name (first folder)
  const rootName = _findRootName(entries);
  if (!rootName) throw new Error('Unable to find the root folder in the .sment file');

  const root = _parseEntity(zip, entries, rootName, 0, ZERO_OFFSET, ZERO_OFFSET);
  return new BlueprintArchive(root);
}

// ── Recursive Entity Parser ───────────────────────────────────────────────────

/**
 * Parses Entity for StarMade blueprint and segment file parsing.
 *
 * @param zip - Input value for the _parseEntity operation.
 * @param allEntries - Input value for the _parseEntity operation.
 * @param entityPath - Input value for the _parseEntity operation.
 * @param depth - Input value for the _parseEntity operation.
 * @param offset - Input value for the _parseEntity operation.
 * @param worldOffset - Input value for the _parseEntity operation.
 * @returns The computed StarMade-Decoder value.
 */
function _parseEntity(
  zip: AdmZip,
  allEntries: AdmZip.IZipEntry[],
  entityPath: string,
  depth: number,
  offset: BlueprintChildOffset,
  worldOffset: BlueprintChildOffset
): BlueprintEntity {
  const name = entityPath.split('/').filter(Boolean).slice(-1)[0] ?? entityPath;

  // Header
  const headerBuf = _readEntry(zip, `${entityPath}/header.smbph`);
  const header = headerBuf ? parseSmbph(headerBuf) : _emptyHeader();
  const meta = _parseMetaBuffer(_readEntry(zip, `${entityPath}/meta.smbpm`));
  const logic = _parseLogicBuffer(_readEntry(zip, `${entityPath}/logic.smbpl`));

  // Segments .smd3
  const segments: Smd3File[] = [];
  const dataPrefix = `${entityPath}/DATA/`;
  for (const entry of allEntries) {
    if (entry.entryName.startsWith(dataPrefix) && entry.entryName.endsWith('.smd3')) {
      try {
        const smd3buf = entry.getData();
        segments.push(parseSmd3(smd3buf));
      } catch { /* skip corrupt segment */ }
    }
  }

  // ATTACHED_N children (depth is capped at 5 to avoid loops)
  const children: SmentEntity[] = [];
  if (depth < 5) {
    const childOffsets = _readChildOffsets(meta);
    const childPaths = new Set<string>();
    for (const entry of allEntries) {
      const rel = entry.entryName.slice(entityPath.length + 1);
      const parts = rel.split('/');
      if (parts[0]?.startsWith('ATTACHED_') && parts.length > 1) {
        childPaths.add(`${entityPath}/${parts[0]}`);
      }
    }
    for (const childPath of [...childPaths].sort()) {
      const childName = childPath.split('/').filter(Boolean).slice(-1)[0] ?? childPath;
      const childOffset = childOffsets.get(childName) ?? ZERO_OFFSET;
      children.push(_parseEntity(zip, allEntries, childPath, depth + 1, childOffset, _addOffset(worldOffset, childOffset)));
    }
  }

  return new BlueprintEntity({ name, header, offset, worldOffset, meta, logic, segments, children });
}

// ── .smbph Header Parser ─────────────────────────────────────────────────────

/** Exposed for BlueprintFolderParser. */
export function _parseHeaderBuffer(buf: Buffer): BlueprintHeader {
  return parseSmbph(buf);
}

/**
 * Parses Smbph for StarMade blueprint and segment file parsing.
 *
 * @param data - Input value for the parseSmbph operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSmbph(data: Buffer | Uint8Array): BlueprintHeader {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const headerVersion = r.readInt32BE();

  let gameVersion: string | undefined;
  if (headerVersion >= 5) {
    gameVersion = r.readJavaModifiedUTF();
  }

  const entityTypeOrd = r.readInt32BE();
  const entityType = BLUEPRINT_TYPE[entityTypeOrd] ?? `UNKNOWN(${entityTypeOrd})`;

  let classification: number | undefined;
  if (headerVersion >= 3) {
    classification = r.readInt32BE();
  }

  const minX = r.readFloat32BE(), minY = r.readFloat32BE(), minZ = r.readFloat32BE();
  const maxX = r.readFloat32BE(), maxY = r.readFloat32BE(), maxZ = r.readFloat32BE();
  const boundingBox: BoundingBox = { minX, minY, minZ, maxX, maxY, maxZ };

  // ElementCountMap: int size + (short type + int count)×
  const blockCountByType: BlueprintBlockCount[] = [];
  let totalBlockCount = 0;
  if (!r.isEOF()) {
    try {
      const size = r.readInt32BE();
      for (let i = 0; i < size && !r.isEOF(); i++) {
        const type  = r.readInt16BE();
        const count = r.readInt32BE();
        if (count > 0) {
          blockCountByType.push({ type, count });
          totalBlockCount += count;
        }
      }
    } catch { /* truncated header */ }
  }

  let score: BlueprintIndexScore | null = null;
  if (headerVersion >= 1 && !r.isEOF()) {
    try {
      const hasScore = r.readUInt8() !== 0;
      score = hasScore ? readBlueprintIndexScore(r) : null;
    } catch { /* truncated score */ }
  }

  return new BlueprintHeader({
    headerVersion,
    gameVersion,
    entityType,
    classification,
    boundingBox,
    blockCountByType,
    totalBlockCount,
    score,
  });
}

/**
 * Handles the emptyHeader operation used by StarMade blueprint and segment file parsing.
 *
 * @returns The computed StarMade-Decoder value.
 */
function _emptyHeader(): BlueprintHeader {
  return new BlueprintHeader({
    headerVersion: -1,
    entityType: 'UNKNOWN',
    boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    blockCountByType: [],
    totalBlockCount: 0,
  });
}

/**
 * Normalizes BlueprintHeader for StarMade blueprint and segment file parsing.
 *
 * @param header - Input value for the normalizeBlueprintHeader operation.
 * @returns The computed StarMade-Decoder value.
 */
export function normalizeBlueprintHeader(header: BlueprintHeader | BlueprintHeaderInput): BlueprintHeader {
  return header instanceof BlueprintHeader ? header : new BlueprintHeader(header);
}

/**
 * Handles the blueprintTypeOrdinal operation used by StarMade blueprint and segment file parsing.
 *
 * @param entityType - Input value for the blueprintTypeOrdinal operation.
 * @returns The computed StarMade-Decoder value.
 */
export function blueprintTypeOrdinal(entityType: string): number {
  return BLUEPRINT_TYPE.indexOf(entityType as BlueprintType);
}

/**
 * Handles the blueprintClassificationName operation used by StarMade blueprint and segment file parsing.
 *
 * @param classification - Input value for the blueprintClassificationName operation.
 * @returns The computed StarMade-Decoder value.
 */
export function blueprintClassificationName(classification: number | undefined): string {
  return classification !== undefined && BLUEPRINT_CLASSIFICATION[classification]
    ? BLUEPRINT_CLASSIFICATION[classification]
    : `UNKNOWN(${classification ?? -1})`;
}

/**
 * Handles the defaultBlueprintClassification operation used by StarMade blueprint and segment file parsing.
 *
 * @param entityType - Input value for the defaultBlueprintClassification operation.
 * @returns The computed StarMade-Decoder value.
 */
export function defaultBlueprintClassification(entityType: string): number {
  switch (entityType) {
    case 'SHOP': return 21; // NONE_SHOP
    case 'SPACE_STATION': return 9; // NONE_STATION
    case 'MANAGED_ASTEROID': return 19; // NONE_ASTEROID_MANAGED
    case 'ASTEROID': return 18; // NONE_ASTEROID
    case 'PLANET': return 20; // NONE_PLANET
    case 'SHIP':
    default:
      return 0; // NONE
  }
}

/**
 * Normalizes BlockCounts for StarMade blueprint and segment file parsing.
 *
 * @param entries - Input value for the normalizeBlockCounts operation.
 * @returns The computed StarMade-Decoder value.
 */
function normalizeBlockCounts(entries: BlueprintBlockCount[]): BlueprintBlockCount[] {
  return entries
    .filter(entry => entry.count > 0)
    .map(entry => ({ type: entry.type, count: entry.count }));
}

/**
 * Handles the sumBlockCounts operation used by StarMade blueprint and segment file parsing.
 *
 * @param entries - Input value for the sumBlockCounts operation.
 * @returns The computed StarMade-Decoder value.
 */
function sumBlockCounts(entries: BlueprintBlockCount[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * Normalizes BlueprintScore for StarMade blueprint and segment file parsing.
 *
 * @param score - Input value for the normalizeBlueprintScore operation.
 * @returns The computed StarMade-Decoder value.
 */
function normalizeBlueprintScore(
  score: BlueprintIndexScore | BlueprintIndexScoreInput | null | undefined
): BlueprintIndexScore | null {
  if (!score) {
    return null;
  }
  return score instanceof BlueprintIndexScore ? score : new BlueprintIndexScore(score);
}

/**
 * Reads BlueprintIndexScore from the StarMade binary representation.
 *
 * @param r - Input value for the readBlueprintIndexScore operation.
 * @returns The computed StarMade-Decoder value.
 */
function readBlueprintIndexScore(r: BufferReader): BlueprintIndexScore {
  const version = r.readInt16BE();
  const legacyOffensiveIndex = r.readFloat64BE();
  const defensiveIndex = r.readFloat64BE();
  const powerIndex = r.readFloat64BE();
  const mobilityIndex = r.readFloat64BE();
  const dangerIndex = r.readFloat64BE();
  const survivabilityIndex = r.readFloat64BE();
  const offensiveIndex = r.readFloat64BE();
  const supportIndex = r.readFloat64BE();
  const miningIndex = version >= 1 && !r.isEOF() ? r.readFloat64BE() : 0;

  return new BlueprintIndexScore({
    version,
    legacyOffensiveIndex,
    offensiveIndex,
    defensiveIndex,
    powerIndex,
    mobilityIndex,
    dangerIndex,
    survivabilityIndex,
    supportIndex,
    miningIndex,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds RootName in StarMade blueprint and segment file parsing.
 *
 * @param entries - Input value for the _findRootName operation.
 * @returns The computed StarMade-Decoder value.
 */
function _findRootName(entries: AdmZip.IZipEntry[]): string | null {
  for (const e of entries) {
    const parts = e.entryName.split('/');
    if (parts.length >= 2 && parts[1] === 'header.smbph') {
      return parts[0];
    }
  }
  return null;
}

/**
 * Reads Entry from the StarMade binary representation.
 *
 * @param zip - Input value for the _readEntry operation.
 * @param path - Input value for the _readEntry operation.
 * @returns The computed StarMade-Decoder value.
 */
function _readEntry(zip: AdmZip, path: string): Buffer | null {
  try {
    const entry = zip.getEntry(path);
    return entry ? entry.getData() : null;
  } catch {
    return null;
  }
}

/**
 * Defines ZERO_OFFSET for StarMade blueprint and segment file parsing.
 */
const ZERO_OFFSET: BlueprintChildOffset = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * Parses MetaBuffer for StarMade blueprint and segment file parsing.
 *
 * @param metaBuffer - Input value for the _parseMetaBuffer operation.
 * @returns The computed StarMade-Decoder value.
 */
function _parseMetaBuffer(metaBuffer: Buffer | null): BlueprintMeta | null {
  if (!metaBuffer) {
    return null;
  }

  try {
    return parseSmbpm(metaBuffer);
  } catch {
    return null;
  }
}

/**
 * Parses LogicBuffer for StarMade blueprint and segment file parsing.
 *
 * @param logicBuffer - Input value for the _parseLogicBuffer operation.
 * @returns The computed StarMade-Decoder value.
 */
function _parseLogicBuffer(logicBuffer: Buffer | null): BlueprintLogic | null {
  if (!logicBuffer) {
    return null;
  }

  try {
    return parseSmbpl(logicBuffer);
  } catch {
    return null;
  }
}

/**
 * Reads ChildOffsets from the StarMade binary representation.
 *
 * @param meta - Input value for the _readChildOffsets operation.
 * @returns The computed StarMade-Decoder value.
 */
function _readChildOffsets(meta: BlueprintMeta | null): Map<string, BlueprintChildOffset> {
  const offsets = new Map<string, BlueprintChildOffset>();

  if (!meta) {
    return offsets;
  }

  for (const transform of meta.childTransforms) {
    offsets.set(basenameBlueprintEntityName(transform.name), transform.offset);
  }

  return offsets;
}

/**
 * Handles the basenameBlueprintEntityName operation used by StarMade blueprint and segment file parsing.
 *
 * @param name - Input value for the basenameBlueprintEntityName operation.
 * @returns The computed StarMade-Decoder value.
 */
function basenameBlueprintEntityName(name: string): string {
  return name.split('/').filter(Boolean).slice(-1)[0] ?? name;
}

/**
 * Handles the addOffset operation used by StarMade blueprint and segment file parsing.
 *
 * @param left - Input value for the _addOffset operation.
 * @param right - Input value for the _addOffset operation.
 * @returns The computed StarMade-Decoder value.
 */
function _addOffset(left: BlueprintChildOffset, right: BlueprintChildOffset): BlueprintChildOffset {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

/**
 * Handles the countEntities operation used by StarMade blueprint and segment file parsing.
 *
 * @param entity - Input value for the countEntities operation.
 * @returns The computed StarMade-Decoder value.
 */
function countEntities(entity: SmentEntity): number {
  return 1 + entity.children.reduce((sum, child) => sum + countEntities(child), 0);
}

/**
 * Handles the countSegmentFiles operation used by StarMade blueprint and segment file parsing.
 *
 * @param entity - Input value for the countSegmentFiles operation.
 * @returns The computed StarMade-Decoder value.
 */
function countSegmentFiles(entity: SmentEntity): number {
  return entity.segments.length + entity.children.reduce((sum, child) => sum + countSegmentFiles(child), 0);
}

/**
 * Handles the collectEntities operation used by StarMade blueprint and segment file parsing.
 *
 * @param entity - Input value for the collectEntities operation.
 * @returns The computed StarMade-Decoder value.
 */
function collectEntities(entity: SmentEntity): SmentEntity[] {
  return [entity, ...entity.children.flatMap(collectEntities)];
}
