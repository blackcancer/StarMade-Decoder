/**
 * @fileoverview Blueprint Folder Parser
 *
 * Parses unpacked StarMade blueprint folders and aggregates entity, segment, and header metadata.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * BlueprintFolderParser — parser for folder-based StarMade blueprints.
 *
 * A folder blueprint has the same structure as an extracted .sment:
 *   {entityName}/
 *     header.smbph
 *     meta.smbpm
 *     logic.smbpl
 *     modmappings.smbmm
 *     DATA/*.smd3
 *     ATTACHED_N/   (recursive, same files)
 *
 * This reuses SmentParser logic while reading from the filesystem.
 */

import fs from 'fs';
import path from 'path';
import { parseSmd3 } from './Smd3Parser.js';
import { BlueprintArchive, BlueprintEntity, BlueprintHeader, _parseHeaderBuffer } from './SmentParser.js';
import { parseSmbpm } from './SmbpmParser.js';
import type { BlueprintChildOffset, BlueprintMeta } from './SmbpmParser.js';
import { parseSmbpl } from './SmbplParser.js';
import type { BlueprintLogic } from './SmbplParser.js';
import type { SmentEntity } from './SmentParser.js';

/**
 * Parses a StarMade blueprint from a filesystem folder.
 * @param folderPath Absolute path of the blueprint root folder
 */
export function parseBlueprintFolder(folderPath: string): BlueprintArchive {
  const rootName = path.basename(folderPath);
  const root = _parseEntityFolder(folderPath, rootName, 0, ZERO_OFFSET, ZERO_OFFSET);
  return new BlueprintArchive(root);
}

function _parseEntityFolder(
  folderPath: string,
  name: string,
  depth: number,
  offset: BlueprintChildOffset,
  worldOffset: BlueprintChildOffset
): BlueprintEntity {
  // Header
  const headerPath = path.join(folderPath, 'header.smbph');
  let header: BlueprintHeader;
  try {
    const hbuf = fs.readFileSync(headerPath);
    header = _parseHeaderBuffer(hbuf);
  } catch {
    header = _emptyHeader();
  }
  const meta = _readMeta(path.join(folderPath, 'meta.smbpm'));
  const logic = _readLogic(path.join(folderPath, 'logic.smbpl'));

  // Segments DATA/*.smd3
  const segments: ReturnType<typeof parseSmd3>[] = [];
  const dataDir = path.join(folderPath, 'DATA');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir).filter(n => n.endsWith('.smd3'))) {
      try {
        const smd3buf = fs.readFileSync(path.join(dataDir, f));
        segments.push(parseSmd3(smd3buf));
      } catch { /* skip */ }
    }
  }

  // ATTACHED_N children
  const children: SmentEntity[] = [];
  if (depth < 5) {
    const childOffsets = _readChildOffsets(meta);
    const childNames = fs.readdirSync(folderPath)
      .filter(n => n.startsWith('ATTACHED_') && fs.statSync(path.join(folderPath, n)).isDirectory())
      .sort((a, b) => {
        const na = parseInt(a.replace('ATTACHED_', ''));
        const nb = parseInt(b.replace('ATTACHED_', ''));
        return na - nb;
      });
    for (const childName of childNames) {
      const childOffset = childOffsets.get(childName) ?? ZERO_OFFSET;
      children.push(_parseEntityFolder(
        path.join(folderPath, childName),
        childName,
        depth + 1,
        childOffset,
        _addOffset(worldOffset, childOffset)
      ));
    }
  }

  return new BlueprintEntity({ name, header, offset, worldOffset, meta, logic, segments, children });
}

function _emptyHeader(): BlueprintHeader {
  return new BlueprintHeader({
    headerVersion: -1,
    entityType: 'UNKNOWN',
    boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    blockCountByType: [],
    totalBlockCount: 0,
  });
}

const ZERO_OFFSET: BlueprintChildOffset = Object.freeze({ x: 0, y: 0, z: 0 });

function _readMeta(metaPath: string): BlueprintMeta | null {
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    return parseSmbpm(fs.readFileSync(metaPath));
  } catch {
    return null;
  }
}

function _readLogic(logicPath: string): BlueprintLogic | null {
  if (!fs.existsSync(logicPath)) {
    return null;
  }

  try {
    return parseSmbpl(fs.readFileSync(logicPath));
  } catch {
    return null;
  }
}

function _readChildOffsets(meta: BlueprintMeta | null): Map<string, BlueprintChildOffset> {
  const offsets = new Map<string, BlueprintChildOffset>();

  if (!meta) {
    return offsets;
  }

  for (const transform of meta.childTransforms) {
    offsets.set(_basenameBlueprintEntityName(transform.name), transform.offset);
  }

  return offsets;
}

function _basenameBlueprintEntityName(name: string): string {
  return name.split('/').filter(Boolean).slice(-1)[0] ?? name;
}

function _addOffset(left: BlueprintChildOffset, right: BlueprintChildOffset): BlueprintChildOffset {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}
