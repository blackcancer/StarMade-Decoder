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
import type { Tag } from '../core/Tag.js';
import {
  aiConfigToTag,
  getRailChildInternals,
  getSmbpmInternals,
  parseAiConfigTag,
  parseRailChildRequestFromTag,
  railChildRequestToTag,
  type AiConfig,
  type RailChildRequest,
  type SmbpmFile,
} from './SmbpmParser.js';

/**
 * Defines FINISH_BYTE for StarMade blueprint and segment file parsing.
 */
const FINISH_BYTE        = 1;
/**
 * Defines SEG_MANAGER_BYTE for StarMade blueprint and segment file parsing.
 */
const SEG_MANAGER_BYTE   = 2;
/**
 * Defines DOCKING_BYTE for StarMade blueprint and segment file parsing.
 */
const DOCKING_BYTE       = 3;
/**
 * Defines RAIL_BYTE for StarMade blueprint and segment file parsing.
 */
const RAIL_BYTE          = 4;
/**
 * Defines AI_CONFIG_BYTE for StarMade blueprint and segment file parsing.
 */
const AI_CONFIG_BYTE     = 5;
/**
 * Defines RAIL_DOCKER_BYTE for StarMade blueprint and segment file parsing.
 */
const RAIL_DOCKER_BYTE   = 6;
/**
 * Defines CARGO_BYTE for StarMade blueprint and segment file parsing.
 */
const CARGO_BYTE         = 7;
/**
 * Defines LOCK_BOX_BYTE for StarMade blueprint and segment file parsing.
 */
const LOCK_BOX_BYTE      = 8;
/**
 * Defines THRUST_CONFIG_BYTE for StarMade blueprint and segment file parsing.
 */
const THRUST_CONFIG_BYTE = 9;

/**
 * Writes Smbpm to the StarMade binary representation.
 *
 * @param file - Input value for the writeSmbpm operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writeSmbpm(file: SmbpmFile): Buffer {
  const w = new BufferWriter();
  const internals = getSmbpmInternals(file);

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
      w.writeInt8(p.active ? 1 : 0);
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

  const railRootMin = file.railRootMin ?? { x: 0, y: 0, z: 0 };
  const railRootMax = file.railRootMax ?? { x: 0, y: 0, z: 0 };
  w.writeFloat32BE(railRootMin.x); w.writeFloat32BE(railRootMin.y); w.writeFloat32BE(railRootMin.z);
  w.writeFloat32BE(railRootMax.x); w.writeFloat32BE(railRootMax.y); w.writeFloat32BE(railRootMax.z);

  if (file.metaVersion >= 2) {
    w.writeJavaUTF(file.railUID ?? '');

    // Wireless markers (BBWirelessLogicMarker: UTF + long + long)
    const markers = file.wirelessMarkers ?? [];
    w.writeInt32BE(markers.length);
    for (const m of markers) {
      w.writeJavaUTF(m.marking);
      w.writeInt64BE(m.markerLocation);
      w.writeInt64BE(m.fromLocation);
    }
  }

  // Rail children (UTF name + int tagSize + bytes)
  w.writeInt32BE(file.railChildren.length);
  for (const child of file.railChildren) {
    w.writeJavaUTF(child.name);
    const childInternals = getRailChildInternals(child);
    const tag = selectRailChildTag(child.request, childInternals.tag ?? null);
    const rawTagBytes = tag === childInternals.tag ? childInternals.tagRaw : null;
    if (rawTagBytes) {
      const tagBytes = Buffer.from(rawTagBytes);
      w.writeInt32BE(tagBytes.length);
      w.writeBytes(tagBytes);
    } else if (tag) {
      const tagBytes = writeTo(tag);
      w.writeInt32BE(tagBytes.length);
      w.writeBytes(tagBytes);
    } else {
      w.writeInt32BE(0);
    }
  }

  // ── AI_CONFIG_BYTE ──────────────────────────────────────────────────────────
  const aiTag = selectAiTag(file.aiConfig, internals.aiTag ?? null);
  if (aiTag) {
    w.writeInt8(AI_CONFIG_BYTE);
    const tagBytes = aiTag === internals.aiTag && internals.aiRaw
      ? Buffer.from(internals.aiRaw)
      : writeTo(aiTag);
    w.writeInt32BE(tagBytes.length);
    w.writeBytes(tagBytes);
  }

  // ── SEG_MANAGER_BYTE / THRUST_CONFIG_BYTE / FINISH ─────────────────────────
  const managerTag = internals.managerTag ?? file.manager?.toTag() ?? null;
  const thrustTag = internals.thrustTag ?? file.thrustConfig?.toTag() ?? null;
  if (internals.managerRaw || managerTag) {
    w.writeInt8(SEG_MANAGER_BYTE);
    const tagBytes = internals.managerRaw && (!managerTag || managerTag === internals.managerTag)
      ? Buffer.from(internals.managerRaw)
      : writeTo(managerTag!);
    w.writeBytes(tagBytes); // raw tag, no size prefix — ends the stream
  } else if (internals.thrustRaw || thrustTag) {
    w.writeInt8(THRUST_CONFIG_BYTE);
    const tagBytes = internals.thrustRaw && (!thrustTag || thrustTag === internals.thrustTag)
      ? Buffer.from(internals.thrustRaw)
      : writeTo(thrustTag!);
    w.writeBytes(tagBytes); // raw tag, no size prefix — ends the stream
  } else {
    w.writeInt8(FINISH_BYTE);
  }

  return w.toBuffer();
}

/**
 * Handles the selectRailChildTag operation used by StarMade blueprint and segment file parsing.
 *
 * @param request - Input value for the selectRailChildTag operation.
 * @param fallback - Input value for the selectRailChildTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function selectRailChildTag(request: RailChildRequest | null | undefined, fallback: Tag | null): Tag | null {
  if (!request) {
    return fallback;
  }
  if (fallback && isRailRequestUnchanged(request, fallback)) {
    return fallback;
  }
  return railChildRequestToTag(request, fallback);
}

/**
 * Handles the selectAiTag operation used by StarMade blueprint and segment file parsing.
 *
 * @param config - Input value for the selectAiTag operation.
 * @param fallback - Input value for the selectAiTag operation.
 * @returns The computed StarMade-Decoder value.
 */
function selectAiTag(config: AiConfig | null | undefined, fallback: Tag | null): Tag | null {
  if (!config) {
    return fallback;
  }
  if (fallback && isAiConfigUnchanged(config, fallback)) {
    return fallback;
  }
  return aiConfigToTag(config, fallback);
}

/**
 * Reports whether isAiConfigUnchanged is true for the current value.
 *
 * @param config - Input value for the isAiConfigUnchanged operation.
 * @param fallback - Input value for the isAiConfigUnchanged operation.
 * @returns The computed StarMade-Decoder value.
 */
function isAiConfigUnchanged(config: AiConfig, fallback: Tag): boolean {
  const parsed = parseAiConfigTag(fallback);
  if (!parsed || parsed.entries.length !== config.entries.length) {
    return false;
  }

  return parsed.entries.every((entry, index) =>
    entry.id === config.entries[index]?.id &&
    entry.value === config.entries[index]?.value
  );
}

/**
 * Reports whether isRailRequestUnchanged is true for the current value.
 *
 * @param request - Input value for the isRailRequestUnchanged operation.
 * @param fallback - Input value for the isRailRequestUnchanged operation.
 * @returns The computed StarMade-Decoder value.
 */
function isRailRequestUnchanged(request: RailChildRequest, fallback: Tag): boolean {
  const parsed = parseRailChildRequestFromTag(fallback);
  if (!parsed) {
    return false;
  }

  return JSON.stringify(normalizeRailRequest(parsed)) === JSON.stringify(normalizeRailRequest(request));
}

/**
 * Normalizes RailRequest for StarMade blueprint and segment file parsing.
 *
 * @param request - Input value for the normalizeRailRequest operation.
 * @returns The computed StarMade-Decoder value.
 */
function normalizeRailRequest(request: RailChildRequest): unknown {
  return {
    railTagType: request.railTagType,
    rail: request.rail,
    docked: request.docked,
    railTransform: normalizeMatrix4f(request.railTransform),
    dockedTransform: normalizeMatrix4f(request.dockedTransform),
    railContact: request.railContact,
    movingAtDockTransform: normalizeMatrix4f(request.movingAtDockTransform),
    flags: request.flags,
  };
}

/**
 * Normalizes Matrix4f for StarMade blueprint and segment file parsing.
 *
 * @param matrix - Input value for the normalizeMatrix4f operation.
 * @returns The computed StarMade-Decoder value.
 */
function normalizeMatrix4f(matrix: RailChildRequest['railTransform']): number[] | null {
  if (!matrix) {
    return null;
  }
  return [
    matrix.m00, matrix.m01, matrix.m02, matrix.m03,
    matrix.m10, matrix.m11, matrix.m12, matrix.m13,
    matrix.m20, matrix.m21, matrix.m22, matrix.m23,
    matrix.m30, matrix.m31, matrix.m32, matrix.m33,
  ];
}
