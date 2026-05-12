/**
 * @fileoverview SMBpm Parser
 *
 * Parses or writes StarMade blueprint and segment binary formats.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SmbpmParser — parser for .smbpm files (blueprint meta).
 *
 * Format (BlueprintEntry.readMeta / readMetaNew) :
 *   int  metaVersion
 *   loop on byte dataType until FINISH_BYTE(1) :
 *     2=SEG_MANAGER_BYTE  → Tag.readFrom (tag binaire standard)
 *     3=DOCKING_BYTE      → int size + size×(UTF name + 3×int pos + 3×float size + short style + byte orient)
 *     4=RAIL_BYTE         → 3×float min + 3×float max + [si v≥2] UTF uid + int wirelessSize×... + int childSize×(UTF+int+bytes Tag)
 *     5=AI_CONFIG_BYTE    → int tagSize + bytes Tag
 *     6=RAIL_DOCKER_BYTE  → byte exists + [si exists] int size × VoidUniqueSegmentPiece(3×int pos + short type + byte orient + byte hp)
 *     7=CARGO_BYTE        → byte exists + [if exists] int size × (long pos + double capacity)
 *     8=LOCK_BOX_BYTE     → identique CARGO_BYTE
 *     9=THRUST_CONFIG_BYTE→ Tag.readFrom
 *
 * Java source: BlueprintEntry.java (readMeta / readMetaNew)
 */

import { BufferReader } from '../core/BufferReader.js';
import { readFrom } from '../core/TagParser.js';
import type { Tag } from '../core/Tag.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const FINISH_BYTE       = 1;
const SEG_MANAGER_BYTE  = 2;
const DOCKING_BYTE      = 3;
const RAIL_BYTE         = 4;
const AI_CONFIG_BYTE    = 5;
const RAIL_DOCKER_BYTE  = 6;
const CARGO_BYTE        = 7;
const LOCK_BOX_BYTE     = 8;
const THRUST_CONFIG_BYTE = 9;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DockingEntry {
  name: string;
  posX: number; posY: number; posZ: number;
  sizeX: number; sizeY: number; sizeZ: number;
  style: number;
  orientation: number;
}

export interface CargoPoint {
  posIndex: bigint;
  capacity: number;
}

export interface RailDockerPiece {
  posX: number; posY: number; posZ: number;
  type: number;
  orientation: number;
  hp: number;
}

export interface WirelessMarker {
  /** Rail UID of the destination chain element. */
  marking: string;
  /** Packed element index of the marker location. */
  markerLocation: bigint;
  /** Packed element index of the source activation controller. */
  fromLocation: bigint;
}

export interface SmbpmFile {
  metaVersion: number;
  /** Manager Tag (SegmentController) — null when absent */
  managerTag: Tag | null;
  /** Connexions de docking classiques */
  dockingEntries: DockingEntry[];
  /** Rail UID (for RAIL_BYTE) */
  railUID?: string;
  /** Wireless logic markers (BBWirelessLogicMarker, metaVersion >= 2) */
  wirelessMarkers: WirelessMarker[];
  /** Rail children */
  railChildren: Array<{ name: string; tag: Tag | null }>;
  /** Configuration IA */
  aiTag: Tag | null;
  /** Rail docker pieces */
  railDockerPieces: RailDockerPiece[];
  /** Points de cargo */
  cargoPoints: CargoPoint[];
  /** Lock box (same format as cargo) */
  lockBoxPoints: CargoPoint[];
  /** Thrust configuration */
  thrustTag: Tag | null;
}

// ── Parser principal ──────────────────────────────────────────────────────────

export function parseSmbpm(data: Buffer | Uint8Array): SmbpmFile {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = BufferReader.from(buf);

  const metaVersion = r.readInt32BE();
  const isOldChunk16 = metaVersion < 4;

  const result: SmbpmFile = {
    metaVersion,
    managerTag: null,
    dockingEntries: [],
    wirelessMarkers: [],
    railChildren: [],
    aiTag: null,
    railDockerPieces: [],
    cargoPoints: [],
    lockBoxPoints: [],
    thrustTag: null,
  };

  while (!r.isEOF()) {
    const dataType = r.readInt8();
    if (dataType === FINISH_BYTE) break;

    switch (dataType) {

      case SEG_MANAGER_BYTE: {
        // Complete binary Tag — use the remaining slice
        const tagBuf = buf.slice(r.offset);
        try {
          result.managerTag = readFrom(tagBuf);
        } catch { /* tag invalid, on continue */ }
        return result; // SEG_MANAGER_BYTE ends reading
      }

      case DOCKING_BYTE: {
        const size = r.readInt32BE();
        for (let i = 0; i < size; i++) {
          const name = r.readJavaUTF();
          const posX = r.readInt32BE(), posY = r.readInt32BE(), posZ = r.readInt32BE();
          const sizeX = r.readFloat32BE(), sizeY = r.readFloat32BE(), sizeZ = r.readFloat32BE();
          const style = r.readInt16BE();
          const orientation = r.readInt8();
          result.dockingEntries.push({ name, posX, posY, posZ, sizeX, sizeY, sizeZ, style, orientation });
        }
        break;
      }

      case RAIL_BYTE: {
        // min/max float3
        r.readFloat32BE(); r.readFloat32BE(); r.readFloat32BE(); // railRootMin
        r.readFloat32BE(); r.readFloat32BE(); r.readFloat32BE(); // railRootMax

        if (metaVersion >= 2) {
          result.railUID = r.readJavaUTF();
          const wirelessSize = r.readInt32BE();
          for (let i = 0; i < wirelessSize; i++) {
            const marking        = r.readJavaUTF();
            const markerLocation = r.readInt64BE();
            const fromLocation   = r.readInt64BE();
            result.wirelessMarkers.push({ marking, markerLocation, fromLocation });
          }
        }

        const size = r.readInt32BE();
        for (let i = 0; i < size; i++) {
          const name = r.readJavaUTF();
          const tagSize = r.readInt32BE();
          let childTag: Tag | null = null;
          if (tagSize > 0 && tagSize < 100_000_000) {
            const tagBytes = r.readBytes(tagSize);
            try { childTag = readFrom(tagBytes); } catch { /* skip */ }
          }
          result.railChildren.push({ name, tag: childTag });
        }
        break;
      }

      case AI_CONFIG_BYTE: {
        const tagSize = r.readInt32BE();
        if (tagSize > 0 && tagSize < 100_000_000) {
          const tagBytes = r.readBytes(tagSize);
          try { result.aiTag = readFrom(tagBytes); } catch { /* skip */ }
        }
        break;
      }

      case RAIL_DOCKER_BYTE: {
        const exists = r.readInt8() > 0;
        if (exists) {
          const size = r.readInt32BE();
          for (let i = 0; i < size; i++) {
            const posX = r.readInt32BE(), posY = r.readInt32BE(), posZ = r.readInt32BE();
            const type = r.readInt16BE();
            const orientation = r.readInt8();
            const hp = r.readInt8();
            result.railDockerPieces.push({ posX, posY, posZ, type, orientation, hp });
          }
        }
        break;
      }

      case CARGO_BYTE:
      case LOCK_BOX_BYTE: {
        const exists = r.readInt8() > 0;
        const target = dataType === CARGO_BYTE ? result.cargoPoints : result.lockBoxPoints;
        if (exists) {
          const size = r.readInt32BE();
          for (let i = 0; i < size; i++) {
            const posIndex = r.readInt64BE();
            const capacity = r.readFloat64BE();
            target.push({ posIndex, capacity });
          }
        }
        break;
      }

      case THRUST_CONFIG_BYTE: {
        const tagBuf = buf.slice(r.offset);
        try { result.thrustTag = readFrom(tagBuf); } catch { /* skip */ }
        return result; // tag consumes the rest of the stream
      }

      default:
        // Unknown type — cannot continue without knowing the size
        return result;
    }
  }

  return result;
}


