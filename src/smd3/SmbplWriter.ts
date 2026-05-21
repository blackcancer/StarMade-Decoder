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
import type { SmbplFile, ControlController, ControlLink } from './SmbplParser.js';

// SERIALIZATION_VERSION = 2, isDisk flag → header = -(1024 + 2) = -1026
const DISK_HEADER = -(1024 + 2);

export function writeSmbpl(file: SmbplFile): Buffer {
  const w = new BufferWriter();

  // structureVersion
  w.writeInt32BE(file.structureVersion);

  const controllers = getControllers(file);

  if (controllers.length === 0) {
    // No connections: negative header + keySize=0
    w.writeInt32BE(DISK_HEADER);
    w.writeInt32BE(0);
    return w.toBuffer();
  }

  w.writeInt32BE(DISK_HEADER);
  w.writeInt32BE(controllers.length);

  for (const controller of controllers) {
    // Key position en 3×short (writeIndexAsShortPos)
    w.writeInt16BE(controller.x);
    w.writeInt16BE(controller.y);
    w.writeInt16BE(controller.z);

    // valueSize = number of distinct types
    w.writeInt32BE(controller.groups.length);

    for (const group of controller.groups) {
      w.writeInt16BE(group.type);
      w.writeInt32BE(group.targets.length);
      for (const t of group.targets) {
        w.writeInt16BE(t.x);
        w.writeInt16BE(t.y);
        w.writeInt16BE(t.z);
      }
    }
  }

  return w.toBuffer();
}

function getControllers(file: SmbplFile): ControlController[] {
  if (file.controllers?.length) {
    return file.controllers.map(controller => ({
      x: controller.x,
      y: controller.y,
      z: controller.z,
      groups: controller.groups.map(group => ({
        type: group.type,
        targets: [...group.targets],
      })),
    }));
  }

  return controllersFromLinks(file.links ?? []);
}

function controllersFromLinks(links: ControlLink[]): ControlController[] {
  const byController = new Map<string, ControlController>();

  for (const link of links) {
    const key = `${link.fromX},${link.fromY},${link.fromZ}`;
    let controller = byController.get(key);
    if (!controller) {
      controller = { x: link.fromX, y: link.fromY, z: link.fromZ, groups: [] };
      byController.set(key, controller);
    }
    controller.groups.push({ type: link.type, targets: [...link.targets] });
  }

  return [...byController.values()];
}
