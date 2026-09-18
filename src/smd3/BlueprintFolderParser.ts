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
import { BlueprintReadContext } from './BlueprintReadContext.js';
import type { BlueprintParseOptions } from './BlueprintReadContext.js';
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
 * @param folderPath Absolute path of the blueprint root folder.
 * @param options Strict/recovery policy and shared resource limits.
 * @throws {Error} On malformed files, symbolic links or exhausted budgets.
 */
export function parseBlueprintFolder(folderPath: string, options: BlueprintParseOptions = {}): BlueprintArchive {
  const context = new BlueprintReadContext(options);
  const rootName = path.basename(folderPath);
  const root = _parseEntityFolder(folderPath, rootName, 0, ZERO_OFFSET, ZERO_OFFSET, context);
  const archive = new BlueprintArchive(root);
  archive.diagnostics = context.diagnostics;
  archive.complete = context.diagnostics.length === 0;
  return archive;
}

/**
 * Parses EntityFolder for StarMade blueprint and segment file parsing.
 *
 * @param folderPath - Input value for the _parseEntityFolder operation.
 * @param name - Input value for the _parseEntityFolder operation.
 * @param depth - Input value for the _parseEntityFolder operation.
 * @param offset - Input value for the _parseEntityFolder operation.
 * @param worldOffset - Input value for the _parseEntityFolder operation.
 * @returns The computed StarMade-Decoder value.
 */
function _parseEntityFolder(
  folderPath: string,
  name: string,
  depth: number,
  offset: BlueprintChildOffset,
  worldOffset: BlueprintChildOffset,
  context: BlueprintReadContext
): BlueprintEntity {
  context.entity(depth);
  if (fs.lstatSync(folderPath).isSymbolicLink()) throw new Error(`Blueprint symbolic link is not allowed: ${folderPath}`);
  // Inspect all directory entries and reject symbolic links before reading.
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Blueprint symbolic link is not allowed: ${entry.name}`);
    if (entry.isFile()) context.entry(fs.statSync(path.join(folderPath, entry.name)).size);
    else context.entry(0);
  }
  const headerPath = path.join(folderPath, 'header.smbph');
  const header = context.read(headerPath, () => _parseHeaderBuffer(fs.readFileSync(headerPath)), _emptyHeader());
  const metaPath = path.join(folderPath, 'meta.smbpm');
  const logicPath = path.join(folderPath, 'logic.smbpl');
  const meta = context.read<BlueprintMeta | null>(metaPath,
    () => fs.existsSync(metaPath) ? parseSmbpm(fs.readFileSync(metaPath)) : null, null);
  const logic = context.read<BlueprintLogic | null>(logicPath,
    () => fs.existsSync(logicPath) ? parseSmbpl(fs.readFileSync(logicPath)) : null, null);
  const segments: ReturnType<typeof parseSmd3>[] = [];
  const dataDir = path.join(folderPath, 'DATA');
  if (fs.existsSync(dataDir)) {
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      const file = path.join(dataDir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Blueprint symbolic link is not allowed: ${file}`);
      context.entry(entry.isFile() ? fs.statSync(file).size : 0);
      if (entry.isFile() && /\.smd[012]$/.test(entry.name)) {
        context.read(file, () => { throw new Error('Unsupported legacy segment resource; explicit migration is required'); }, null);
      }
      if (entry.isFile() && entry.name.endsWith('.smd3')) {
        const result = context.read<ReturnType<typeof parseSmd3> | null>(file,
          () => context.smd3(file, fs.readFileSync(file)), null);
        if (result) segments.push(result);
      }
    }
  }

  // ATTACHED_N children
  const children: SmentEntity[] = [];
  {
    const childOffsets = _readChildOffsets(meta);
    const childNames = fs.readdirSync(folderPath)
      .filter(n => /^ATTACHED_\d+$/.test(n) && fs.statSync(path.join(folderPath, n)).isDirectory())
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
        _addOffset(worldOffset, childOffset),
        context
      ));
    }
  }

  return new BlueprintEntity({ name, header, offset, worldOffset, meta, logic, segments, children });
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
 * Defines ZERO_OFFSET for StarMade blueprint and segment file parsing.
 */
const ZERO_OFFSET: BlueprintChildOffset = Object.freeze({ x: 0, y: 0, z: 0 });

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
    offsets.set(_basenameBlueprintEntityName(transform.name), transform.offset);
  }

  return offsets;
}

/**
 * Handles the basenameBlueprintEntityName operation used by StarMade blueprint and segment file parsing.
 *
 * @param name - Input value for the _basenameBlueprintEntityName operation.
 * @returns The computed StarMade-Decoder value.
 */
function _basenameBlueprintEntityName(name: string): string {
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
