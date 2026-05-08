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
export type BlueprintType = typeof BLUEPRINT_TYPE[number];

export interface BoundingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface BlueprintHeader {
  headerVersion: number;
  gameVersion?: string;
  entityType: string;
  classification?: number;
  boundingBox: BoundingBox;
  blockCountByType: Array<{ type: number; count: number }>;
  totalBlockCount: number;
}

export interface SmentEntity {
  /** Folder name inside the zip (for example "Sobek Dreadnought 2025-jun-02" or "ATTACHED_5") */
  name: string;
  header: BlueprintHeader;
  /** Parsed .smd3 files. */
  segments: Smd3File[];
  /** Attached child entities such as turrets or docked modules. */
  children: SmentEntity[];
}

export interface SmentFile {
  /** Root entity, usually the main ship or station. */
  root: SmentEntity;
  /** Total entity count including the root and all recursive children. */
  totalEntities: number;
  /** Total number of .smd3 segments */
  totalSegments: number;
}

// ── Main Parser ───────────────────────────────────────────────────────────────

/**
 * Parses a StarMade .sment blueprint archive.
 * @param data Buffer containing the .sment file bytes.
 */
export function parseSment(data: Buffer | Uint8Array): SmentFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  // Find the root name (first folder)
  const rootName = _findRootName(entries);
  if (!rootName) throw new Error('Unable to find the root folder in the .sment file');

  const root = _parseEntity(zip, entries, rootName, 0);

  let totalEntities = 0;
  let totalSegments = 0;
  const countAll = (e: SmentEntity) => {
    totalEntities++;
    totalSegments += e.segments.length;
    e.children.forEach(countAll);
  };
  countAll(root);

  return { root, totalEntities, totalSegments };
}

// ── Recursive Entity Parser ───────────────────────────────────────────────────

function _parseEntity(
  zip: AdmZip,
  allEntries: AdmZip.IZipEntry[],
  entityPath: string,
  depth: number
): SmentEntity {
  const name = entityPath.split('/').filter(Boolean).slice(-1)[0] ?? entityPath;

  // Header
  const headerBuf = _readEntry(zip, `${entityPath}/header.smbph`);
  const header = headerBuf ? _parseHeader(headerBuf) : _emptyHeader();

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
    const childPaths = new Set<string>();
    for (const entry of allEntries) {
      const rel = entry.entryName.slice(entityPath.length + 1);
      const parts = rel.split('/');
      if (parts[0]?.startsWith('ATTACHED_') && parts.length > 1) {
        childPaths.add(`${entityPath}/${parts[0]}`);
      }
    }
    for (const childPath of [...childPaths].sort()) {
      children.push(_parseEntity(zip, allEntries, childPath, depth + 1));
    }
  }

  return { name, header, segments, children };
}

// ── .smbph Header Parser ─────────────────────────────────────────────────────

/** Exposed for BlueprintFolderParser. */
export function _parseHeaderBuffer(buf: Buffer): BlueprintHeader {
  return _parseHeader(buf);
}

function _parseHeader(buf: Buffer): BlueprintHeader {
  const r = BufferReader.from(buf);

  const headerVersion = r.readInt32BE();

  let gameVersion: string | undefined;
  if (headerVersion >= 5) {
    gameVersion = r.readJavaUTF();
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
  const blockCountByType: Array<{ type: number; count: number }> = [];
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

  return { headerVersion, gameVersion, entityType, classification, boundingBox, blockCountByType, totalBlockCount };
}

function _emptyHeader(): BlueprintHeader {
  return {
    headerVersion: -1,
    entityType: 'UNKNOWN',
    boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    blockCountByType: [],
    totalBlockCount: 0,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _findRootName(entries: AdmZip.IZipEntry[]): string | null {
  for (const e of entries) {
    const parts = e.entryName.split('/');
    if (parts.length >= 2 && parts[1] === 'header.smbph') {
      return parts[0];
    }
  }
  return null;
}

function _readEntry(zip: AdmZip, path: string): Buffer | null {
  try {
    const entry = zip.getEntry(path);
    return entry ? entry.getData() : null;
  } catch {
    return null;
  }
}
