/**
 * @fileoverview System DB — SYSTEMS.INFOS and SYSTEMS.RESOURCES decoders/encoders
 *
 * Covers the two VARBINARY columns of the SYSTEMS table in the StarMade HSQLDB.
 *
 * SYSTEMS.INFOS (VARBINARY = 16³ × 2 = 8192 bytes)
 *   Flat byte array of sector placement info within a star system.
 *   Written by StellarSystem (Java field `protected byte[] infos`).
 *   Indexed by: (z * 16 * 16 + y * 16 + x) * DATA_SIZE
 *   Each sector entry = 2 bytes:
 *     byte[0] sectorType  — SectorType ordinal (see SECTOR_TYPES)
 *     byte[1] metadata    — varies by type (e.g. PlanetType ordinal for PLANET)
 *
 * SYSTEMS.RESOURCES (VARBINARY = 16 current / 19 extended bytes)
 *   Flat byte array of resource densities.
 *   Current VoidSystem stores 16 slots; the canonical SDK view also supports three extended slots.
 *   Index = position in ElementKeyMap.resources array.
 *   Value = resource density (0 = absent).
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { DecodeError } from '../core/DecodeError.js';

/** System grid side length (VoidSystem.SYSTEM_SIZE = 16). */
export const SYSTEM_SIZE = 16;

/** Bytes per sector entry (StellarSystem.DATA_SIZE = 2). */
export const SECTOR_DATA_SIZE = 2;

/** Expected size of SYSTEMS.INFOS in bytes. */
export const SYSTEM_INFOS_SIZE = SYSTEM_SIZE * SYSTEM_SIZE * SYSTEM_SIZE * SECTOR_DATA_SIZE; // 8192

/** Canonical SDK resource slots; the current game stores the first 16. */
export const RESOURCE_COUNT = 19;

import { SECTOR_TYPES, PLANET_TYPES, getDatabaseProfile, type DatabaseProfile, type SectorType, type PlanetType } from './DatabaseProfile.js';
export { SECTOR_TYPES, PLANET_TYPES, type SectorType, type PlanetType };

// ── Resource index → item ID mapping ─────────────────────────────────────────

/**
 * Maps 16 current resource indices plus three historical extended slots to item IDs.
 * Source: ElementKeyMap.java static initializer.
 */
export const RESOURCE_ITEM_IDS: ReadonlyArray<{ index: number; id: number; name: string }> = [
  { index: 0,  id: 480, name: 'Hattel Crystal' },
  { index: 1,  id: 481, name: 'Sintyr Crystal' },
  { index: 2,  id: 482, name: 'Mattise Crystal' },
  { index: 3,  id: 483, name: 'Rammet Crystal' },
  { index: 4,  id: 484, name: 'Varat Crystal' },
  { index: 5,  id: 485, name: 'Bastyn Crystal' },
  { index: 6,  id: 486, name: 'Parsen Crystal' },
  { index: 7,  id: 487, name: 'Nocx Crystal' },
  { index: 8,  id: 488, name: 'Threns Ore' },
  { index: 9,  id: 489, name: 'Jisper Ore' },
  { index: 10, id: 490, name: 'Zercaner Ore' },
  { index: 11, id: 491, name: 'Sertise Ore' },
  { index: 12, id: 492, name: 'Hital Ore' },
  { index: 13, id: 493, name: 'Fertikeen Ore' },
  { index: 14, id: 494, name: 'Parstun Ore' },
  { index: 15, id: 495, name: 'Nacht Ore' },
  { index: 16, id: 255, name: 'Quantanium' },
  { index: 17, id: 256, name: 'Metate' },
  { index: 18, id: 257, name: 'Exogen' },
];

// ── Sector info entry ─────────────────────────────────────────────────────────

/**
 * Describes the SectorInfo data shape used by StarMade database object parsing.
 */
export interface SectorInfo {
  /** Local X coordinate within the system (0–15). */
  x: number;
  /** Local Y coordinate within the system (0–15). */
  y: number;
  /** Local Z coordinate within the system (0–15). */
  z: number;
  /** Linear index within the system grid. */
  index: number;
  /** Sector type ordinal. */
  sectorTypeOrdinal: number;
  /** Resolved sector type name. */
  sectorType: SectorType | 'UNKNOWN';
  /** Second byte — interpretation depends on sectorType. For PLANET: PlanetType ordinal. */
  metadata: number;
  /** Resolved metadata name (planet type if sectorType is PLANET, undefined otherwise). */
  planetType?: PlanetType | 'UNKNOWN';
}

// ── SYSTEMS.INFOS decoder/encoder ─────────────────────────────────────────────

/**
 * Decodes `SYSTEMS.INFOS` (VARBINARY 8192 bytes).
 *
 * Returns only non-VOID sectors by default; options select includeVoid and the explicit profile.
 * Returns empty array for absent/empty input; malformed lengths throw.
 */
export function decodeSystemInfos(
  data: Buffer | Uint8Array | null | undefined,
  options: { includeVoid?: boolean; profile?: DatabaseProfile } = {},
): SectorInfo[] {
  const contract = getDatabaseProfile(options.profile);
  if (!data || data.length === 0) return [];
  if (data.length !== SYSTEM_INFOS_SIZE) throw new DecodeError('E_FORMAT', 'Invalid SYSTEMS.INFOS byte size', { path: 'SYSTEMS.INFOS' });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const results: SectorInfo[] = [];

  for (let idx = 0; idx < SYSTEM_SIZE * SYSTEM_SIZE * SYSTEM_SIZE; idx++) {
    const offset = idx * SECTOR_DATA_SIZE;
    const sectorTypeOrdinal = buf[offset];
    const metadata          = buf[offset + 1];

    const sectorType = (contract.sectorTypes[sectorTypeOrdinal] ?? 'UNKNOWN') as SectorType | 'UNKNOWN';
    if (!options.includeVoid && sectorType === 'VOID') continue;

    const z = Math.floor(idx / (SYSTEM_SIZE * SYSTEM_SIZE));
    const y = Math.floor((idx % (SYSTEM_SIZE * SYSTEM_SIZE)) / SYSTEM_SIZE);
    const x = idx % SYSTEM_SIZE;

    const entry: SectorInfo = { x, y, z, index: idx, sectorTypeOrdinal, sectorType, metadata };
    if (sectorType === 'PLANET' || sectorType === 'GAS_PLANET') {
      const pt = contract.planetTypes[Math.min(contract.planetTypes.length - 1, metadata)];
      // The byte index is clamped into the non-empty PLANET_TYPES table.
      entry.planetType = pt;
    }
    results.push(entry);
  }
  return results;
}

/**
 * Encodes a system infos grid back to VARBINARY bytes.
 *
 * Produces a full 8192-byte buffer initialized to the selected profile's VOID ordinal.
 * Entries in the list overwrite their corresponding positions.
 * Entries not in the list remain VOID.
 */
export function encodeSystemInfos(entries: SectorInfo[], profile: DatabaseProfile = 'current'): Buffer {
  const VOID_ORDINAL = getDatabaseProfile(profile).sectorTypes.indexOf('VOID');
  const buf = Buffer.alloc(SYSTEM_INFOS_SIZE, 0);
  // Fill with VOID first
  for (let i = 0; i < SYSTEM_SIZE ** 3; i++) {
    buf[i * SECTOR_DATA_SIZE] = VOID_ORDINAL;
  }
  for (const e of entries) {
    const idx = e.z * SYSTEM_SIZE * SYSTEM_SIZE + e.y * SYSTEM_SIZE + e.x;
    const offset = idx * SECTOR_DATA_SIZE;
    buf[offset]     = e.sectorTypeOrdinal & 0xff;
    buf[offset + 1] = e.metadata          & 0xff;
  }
  return buf;
}

// ── Resource density ──────────────────────────────────────────────────────────

/**
 * Describes the SystemResource data shape used by StarMade database object parsing.
 */
export interface SystemResource {
  /** Resource array index (0–18). */
  index: number;
  /** StarMade item ID. */
  itemId: number;
  /** Resource name. */
  name: string;
  /** Density byte (0 = absent). */
  density: number;
}

/**
 * Decodes `SYSTEMS.RESOURCES` (16-byte current or 19-byte extended cells).
 *
 * Returns only resources with density > 0 by default.
 * Returns empty array for absent/empty input; malformed lengths throw.
 */
export function decodeSystemResources(
  data: Buffer | Uint8Array | null | undefined,
  options: { includeAbsent?: boolean } = {},
): SystemResource[] {
  if (!data || data.length === 0) return [];
  if (data.length !== 16 && data.length !== RESOURCE_COUNT) throw new DecodeError('E_FORMAT', 'Invalid SYSTEMS.RESOURCES byte size', { path: 'SYSTEMS.RESOURCES' });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const results: SystemResource[] = [];
  for (let i = 0; i < buf.length; i++) {
    const density = buf[i];
    if (!options.includeAbsent && density === 0) continue;
    const meta = RESOURCE_ITEM_IDS[i];
    results.push({ index: i, itemId: meta.id, name: meta.name, density });
  }
  return results;
}

/**
 * Encodes densities to 16 bytes by default; explicit 19-byte output is supported and lossy writes throw.
 */
export function encodeSystemResources(resources: SystemResource[], resourceSize: 16 | 19 = 16): Buffer {
  if (resourceSize !== 16 && resourceSize !== 19) throw new RangeError('Resource size must be 16 or 19 bytes');
  const buf = Buffer.alloc(RESOURCE_COUNT, 0);
  for (const r of resources) {
    if (r.index >= 0 && r.index < RESOURCE_COUNT) {
      buf[r.index] = r.density & 0xff;
    }
  }
  if (buf.subarray(resourceSize).some(density => density !== 0)) throw new RangeError('Cannot discard extended resources in a 16-byte cell');
  return buf.subarray(0, resourceSize);
}

/**
 * Helper: convert a flat index to (x, y, z) local coordinates.
 */
export function systemIndexToCoords(index: number): { x: number; y: number; z: number } {
  const z = Math.floor(index / (SYSTEM_SIZE * SYSTEM_SIZE));
  const y = Math.floor((index % (SYSTEM_SIZE * SYSTEM_SIZE)) / SYSTEM_SIZE);
  const x = index % SYSTEM_SIZE;
  return { x, y, z };
}

/**
 * Helper: convert (x, y, z) local coordinates to a flat index.
 */
export function systemCoordsToIndex(x: number, y: number, z: number): number {
  return z * SYSTEM_SIZE * SYSTEM_SIZE + y * SYSTEM_SIZE + x;
}
