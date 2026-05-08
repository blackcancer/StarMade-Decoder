/**
 * @fileoverview SMBpl Writer
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbplWriter — encoder for .smbpl (blueprint logic).
 *
 * Exact inverse of SmbplParser.ts.
 * Writes the serializeForDisk format (isDisk=true, version -1026).
 *
 * Java source: BlueprintEntry.writeStructure() → ControlElementMap.serializeForDisk()
 */

import { BufferWriter } from '../core/BufferWriter.js';
import type { SmbplFile, ControlLink } from './SmbplParser.js';

// SERIALIZATION_VERSION = 2, isDisk flag → header = -(1024 + 2) = -1026
const DISK_HEADER = -(1024 + 2);

export function writeSmbpl(file: SmbplFile): Buffer {
  const w = new BufferWriter();

  // structureVersion
  w.writeInt32BE(file.structureVersion);

  if (file.links.length === 0) {
    // No connections: negative header + keySize=0
    w.writeInt32BE(DISK_HEADER);
    w.writeInt32BE(0);
    return w.toBuffer();
  }

  // Group links by controller (from pos)
  const byController = new Map<string, ControlLink[]>();
  for (const link of file.links) {
    const key = `${link.fromX},${link.fromY},${link.fromZ}`;
    if (!byController.has(key)) byController.set(key, []);
    byController.get(key)!.push(link);
  }

  w.writeInt32BE(DISK_HEADER);
  w.writeInt32BE(byController.size);

  for (const links of byController.values()) {
    const first = links[0];
    // Key position en 3×short (writeIndexAsShortPos)
    w.writeInt16BE(first.fromX);
    w.writeInt16BE(first.fromY);
    w.writeInt16BE(first.fromZ);

    // valueSize = number of distinct types
    w.writeInt32BE(links.length);

    for (const link of links) {
      w.writeInt16BE(link.type);
      w.writeInt32BE(link.targets.length);
      for (const t of link.targets) {
        w.writeInt16BE(t.x);
        w.writeInt16BE(t.y);
        w.writeInt16BE(t.z);
      }
    }
  }

  return w.toBuffer();
}
