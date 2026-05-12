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
 * SYSTEMS.RESOURCES (VARBINARY = 19 bytes)
 *   Flat byte array of resource densities.
 *   Written by VoidSystem.setSystemResources().
 *   Index = position in ElementKeyMap.resources array.
 *   Value = resource density (0 = absent).
 *
 * @author InitSysRev
 * @version 1.1.0
 */

/** System grid side length (VoidSystem.SYSTEM_SIZE = 16). */
export const SYSTEM_SIZE = 16;

/** Bytes per sector entry (StellarSystem.DATA_SIZE = 2). */
export const SECTOR_DATA_SIZE = 2;

/** Expected size of SYSTEMS.INFOS in bytes. */
export const SYSTEM_INFOS_SIZE = SYSTEM_SIZE * SYSTEM_SIZE * SYSTEM_SIZE * SECTOR_DATA_SIZE; // 8192

/** Number of resource types (VoidSystem.RESOURCES = 19). */
export const RESOURCE_COUNT = 19;

// ── SectorType enum (SectorInformation.SectorType, ordinal order) ─────────────

/**
 * Sector type ordinals from SectorInformation.SectorType.java.
 * Index = byte value stored in INFOS[offset].
 */
export const SECTOR_TYPES = [
  'SPACE_STATION', // 0
  'ASTEROID',      // 1
  'PLANET',        // 2
  'GAS_PLANET',    // 3
  'MAIN',          // 4
  'SUN',           // 5
  'BLACK_HOLE',    // 6
  'VOID',          // 7
  'LOW_ASTEROID',  // 8
  'GIANT',         // 9
  'DOUBLE_STAR',   // 10
] as const;

export type SectorType = typeof SECTOR_TYPES[number];

// ── PlanetType enum (StellarSystem.PlanetType, ordinal order) ─────────────────

// Retrieved from StellarSystem.java (getPlanetType uses values()[min(len-1, infos[dataIndex+1])]).
// The enum declaration order determines ordinals. Based on StarMade-Open source:
export const PLANET_TYPES = [
  'ICE',
  'DESERT',
  'TERRAN',
  'GAS_GIANT',
  'TOXIC',
  'LAVA',
  'BARREN',
] as const;

export type PlanetType = typeof PLANET_TYPES[number];

// ── Resource index → item ID mapping ─────────────────────────────────────────

/**
 * Maps resource array index (0–18) to StarMade block/resource item IDs.
 * Source: ElementKeyMap.java static initializer.
 */
export const RESOURCE_ITEM_IDS: ReadonlyArray<{ index: number; id: number; name: string }> = [
  { index: 0,  id: 480, name: 'Hattel Crystal' },
  { index: 1,  id: 481, name: 'Sintyr Crystal' },
  { index: 2,  id: 482, name: 'Mattise Crystal' },
  { index: 3,  id: 483, name: 'Rammet Crystal' },
  { index: 4,  id: 484, name: 'Varat Crystal' },
  { index: 5,  id: 485, name: 'Bastyn Gas' },
  { index: 6,  id: 486, name: 'Common Crystal' },
  { index: 7,  id: 487, name: 'Nocx Crystal' },
  { index: 8,  id: 488, name: 'Threns Ore' },
  { index: 9,  id: 489, name: 'Jisper Ore' },
  { index: 10, id: 490, name: 'Zercaner Gas' },
  { index: 11, id: 491, name: 'Sertise Ore' },
  { index: 12, id: 492, name: 'Hylat Ore' },
  { index: 13, id: 493, name: 'Fertikeen Ore' },
  { index: 14, id: 494, name: 'Sapsun Ore' },
  { index: 15, id: 495, name: 'Common Metal' },
  { index: 16, id: 255, name: 'Quantanium' },
  { index: 17, id: 256, name: 'Metate' },
  { index: 18, id: 257, name: 'Exogen' },
];

// ── Sector info entry ─────────────────────────────────────────────────────────

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
 * Returns only non-VOID sectors by default (pass `includeVoid=true` for all).
 * Returns empty array for null/undersized input.
 */
export function decodeSystemInfos(
  data: Buffer | Uint8Array | null | undefined,
  options: { includeVoid?: boolean } = {},
): SectorInfo[] {
  if (!data || data.length < SYSTEM_INFOS_SIZE) return [];
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const results: SectorInfo[] = [];

  for (let idx = 0; idx < SYSTEM_SIZE * SYSTEM_SIZE * SYSTEM_SIZE; idx++) {
    const offset = idx * SECTOR_DATA_SIZE;
    const sectorTypeOrdinal = buf[offset];
    const metadata          = buf[offset + 1];

    const sectorType = (SECTOR_TYPES[sectorTypeOrdinal] ?? 'UNKNOWN') as SectorType | 'UNKNOWN';
    if (!options.includeVoid && sectorType === 'VOID') continue;

    const z = Math.floor(idx / (SYSTEM_SIZE * SYSTEM_SIZE));
    const y = Math.floor((idx % (SYSTEM_SIZE * SYSTEM_SIZE)) / SYSTEM_SIZE);
    const x = idx % SYSTEM_SIZE;

    const entry: SectorInfo = { x, y, z, index: idx, sectorTypeOrdinal, sectorType, metadata };
    if (sectorType === 'PLANET' || sectorType === 'GAS_PLANET') {
      const pt = PLANET_TYPES[Math.min(PLANET_TYPES.length - 1, metadata)];
      entry.planetType = pt ?? 'UNKNOWN';
    }
    results.push(entry);
  }
  return results;
}

/**
 * Encodes a system infos grid back to VARBINARY bytes.
 *
 * Produces a full 8192-byte buffer initialized to VOID (ordinal 7).
 * Entries in the list overwrite their corresponding positions.
 * Entries not in the list remain VOID.
 */
export function encodeSystemInfos(entries: SectorInfo[]): Buffer {
  const VOID_ORDINAL = SECTOR_TYPES.indexOf('VOID'); // = 7
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
 * Decodes `SYSTEMS.RESOURCES` (VARBINARY 19 bytes).
 *
 * Returns only resources with density > 0 by default.
 * Returns empty array for null/undersized input.
 */
export function decodeSystemResources(
  data: Buffer | Uint8Array | null | undefined,
  options: { includeAbsent?: boolean } = {},
): SystemResource[] {
  if (!data || data.length < RESOURCE_COUNT) return [];
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const results: SystemResource[] = [];
  for (let i = 0; i < RESOURCE_COUNT; i++) {
    const density = buf[i];
    if (!options.includeAbsent && density === 0) continue;
    const meta = RESOURCE_ITEM_IDS[i];
    results.push({ index: i, itemId: meta.id, name: meta.name, density });
  }
  return results;
}

/**
 * Encodes resource densities back to VARBINARY bytes for `SYSTEMS.RESOURCES`.
 */
export function encodeSystemResources(resources: SystemResource[]): Buffer {
  const buf = Buffer.alloc(RESOURCE_COUNT, 0);
  for (const r of resources) {
    if (r.index >= 0 && r.index < RESOURCE_COUNT) {
      buf[r.index] = r.density & 0xff;
    }
  }
  return buf;
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
