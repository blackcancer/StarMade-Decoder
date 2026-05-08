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
import { _parseHeaderBuffer } from './SmentParser.js';
import type { SmentEntity, SmentFile, BlueprintHeader } from './SmentParser.js';

/**
 * Parses a StarMade blueprint from a filesystem folder.
 * @param folderPath Absolute path of the blueprint root folder
 */
export function parseBlueprintFolder(folderPath: string): SmentFile {
  const rootName = path.basename(folderPath);
  const root = _parseEntityFolder(folderPath, rootName, 0);

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

function _parseEntityFolder(folderPath: string, name: string, depth: number): SmentEntity {
  // Header
  const headerPath = path.join(folderPath, 'header.smbph');
  let header: BlueprintHeader;
  try {
    const hbuf = fs.readFileSync(headerPath);
    header = _parseHeaderBuffer(hbuf);
  } catch {
    header = _emptyHeader();
  }

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
    const childNames = fs.readdirSync(folderPath)
      .filter(n => n.startsWith('ATTACHED_') && fs.statSync(path.join(folderPath, n)).isDirectory())
      .sort((a, b) => {
        const na = parseInt(a.replace('ATTACHED_', ''));
        const nb = parseInt(b.replace('ATTACHED_', ''));
        return na - nb;
      });
    for (const childName of childNames) {
      children.push(_parseEntityFolder(path.join(folderPath, childName), childName, depth + 1));
    }
  }

  return { name, header, segments, children };
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
