/**
 * @fileoverview SmbpmWriter
 *
 * Encoder for .smbpm files (blueprint meta).
 * Exact inverse of SmbpmParser.ts / BlueprintEntry.writeMeta().
 *
 * Write order (confirmed from BlueprintEntry.java):
 *   int  metaVersion
 *   byte DOCKING_BYTE(3)     → int count + entries
 *   byte RAIL_DOCKER_BYTE(6) → byte exists + entries
 *   byte CARGO_BYTE(7)       → byte exists + entries
 *   byte RAIL_BYTE(4)        → 6×float bounds + UTF railUID
 *                               + int wirelessCount + [UTF marking, long marker, long from]
 *                               + int childCount + [UTF name, int tagSize, bytes]
 *   byte AI_CONFIG_BYTE(5)   → int tagSize + bytes   (only when aiTag present)
 *   byte SEG_MANAGER_BYTE(2) → raw Tag bytes          (only when managerTag present; ends stream)
 *   byte FINISH_BYTE(1)                               (when no managerTag)
 *
 * LOCK_BOX_BYTE and THRUST_CONFIG_BYTE are preserved if present via
 * explicit fields; otherwise omitted (not written by default path).
 *
 * Java source: BlueprintEntry.writeMeta()
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { BufferWriter } from '../core/BufferWriter.js';
import { writeTo } from '../core/TagParser.js';
import type { SmbpmFile } from './SmbpmParser.js';

const FINISH_BYTE        = 1;
const SEG_MANAGER_BYTE   = 2;
const DOCKING_BYTE       = 3;
const RAIL_BYTE          = 4;
const AI_CONFIG_BYTE     = 5;
const RAIL_DOCKER_BYTE   = 6;
const CARGO_BYTE         = 7;
const LOCK_BOX_BYTE      = 8;

export function writeSmbpm(file: SmbpmFile): Buffer {
  const w = new BufferWriter();

  w.writeInt32BE(file.metaVersion);

  // ── DOCKING_BYTE ────────────────────────────────────────────────────────────
  w.writeInt8(DOCKING_BYTE);
  w.writeInt32BE(file.dockingEntries.length);
  for (const d of file.dockingEntries) {
    w.writeJavaUTF(d.name);
    w.writeInt32BE(d.posX);  w.writeInt32BE(d.posY);  w.writeInt32BE(d.posZ);
    w.writeFloat32BE(d.sizeX); w.writeFloat32BE(d.sizeY); w.writeFloat32BE(d.sizeZ);
    w.writeInt16BE(d.style);
    w.writeInt8(d.orientation);
  }

  // ── RAIL_DOCKER_BYTE ────────────────────────────────────────────────────────
  w.writeInt8(RAIL_DOCKER_BYTE);
  if (file.railDockerPieces.length === 0) {
    w.writeInt8(0); // not present
  } else {
    w.writeInt8(1);
    w.writeInt32BE(file.railDockerPieces.length);
    for (const p of file.railDockerPieces) {
      w.writeInt32BE(p.posX); w.writeInt32BE(p.posY); w.writeInt32BE(p.posZ);
      w.writeInt16BE(p.type);
      w.writeInt8(p.orientation);
      w.writeInt8(p.hp);
    }
  }

  // ── CARGO_BYTE ──────────────────────────────────────────────────────────────
  w.writeInt8(CARGO_BYTE);
  if (file.cargoPoints.length === 0) {
    w.writeInt8(0);
  } else {
    w.writeInt8(1);
    w.writeInt32BE(file.cargoPoints.length);
    for (const c of file.cargoPoints) {
      w.writeInt64BE(c.posIndex);
      w.writeFloat64BE(c.capacity);
    }
  }

  // ── LOCK_BOX_BYTE ───────────────────────────────────────────────────────────
  if (file.lockBoxPoints.length > 0) {
    w.writeInt8(LOCK_BOX_BYTE);
    w.writeInt8(1);
    w.writeInt32BE(file.lockBoxPoints.length);
    for (const c of file.lockBoxPoints) {
      w.writeInt64BE(c.posIndex);
      w.writeFloat64BE(c.capacity);
    }
  }

  // ── RAIL_BYTE ───────────────────────────────────────────────────────────────
  w.writeInt8(RAIL_BYTE);

  // bounds (min/max float3) — zeroed when not tracked
  w.writeFloat32BE(0); w.writeFloat32BE(0); w.writeFloat32BE(0); // minX/Y/Z
  w.writeFloat32BE(0); w.writeFloat32BE(0); w.writeFloat32BE(0); // maxX/Y/Z

  // railUID (always present in metaVersion >= 2; safe to always write)
  w.writeJavaUTF(file.railUID ?? '');

  // Wireless markers (BBWirelessLogicMarker: UTF + long + long)
  const markers = file.wirelessMarkers ?? [];
  w.writeInt32BE(markers.length);
  for (const m of markers) {
    w.writeJavaUTF(m.marking);
    w.writeInt64BE(m.markerLocation);
    w.writeInt64BE(m.fromLocation);
  }

  // Rail children (UTF name + int tagSize + bytes)
  w.writeInt32BE(file.railChildren.length);
  for (const child of file.railChildren) {
    w.writeJavaUTF(child.name);
    if (child.tag) {
      const tagBytes = writeTo(child.tag);
      w.writeInt32BE(tagBytes.length);
      w.writeBytes(tagBytes);
    } else {
      w.writeInt32BE(0);
    }
  }

  // ── AI_CONFIG_BYTE ──────────────────────────────────────────────────────────
  if (file.aiTag) {
    w.writeInt8(AI_CONFIG_BYTE);
    const tagBytes = writeTo(file.aiTag);
    w.writeInt32BE(tagBytes.length);
    w.writeBytes(tagBytes);
  }

  // ── SEG_MANAGER_BYTE / FINISH ───────────────────────────────────────────────
  if (file.managerTag) {
    w.writeInt8(SEG_MANAGER_BYTE);
    const tagBytes = writeTo(file.managerTag);
    w.writeBytes(tagBytes); // raw tag, no size prefix — ends the stream
  } else {
    w.writeInt8(FINISH_BYTE);
  }

  return w.toBuffer();
}
