/**
 * @fileoverview StarSystem business object
 *
 * High-level wrapper around SYSTEMS.INFOS (VARBINARY 8192) and
 * SYSTEMS.RESOURCES (VARBINARY 19).
 *
 * Models the star system grid and resource densities, matching the
 * StellarSystem / VoidSystem pattern from Java.
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import {
  decodeSystemInfos, encodeSystemInfos,
  decodeSystemResources, encodeSystemResources,
  systemCoordsToIndex, systemIndexToCoords,
  SYSTEM_SIZE, SYSTEM_INFOS_SIZE, RESOURCE_COUNT,
  SECTOR_TYPES, PLANET_TYPES, RESOURCE_ITEM_IDS,
  type SectorInfo, type SectorType, type PlanetType, type SystemResource,
} from './SystemDb.js';

export {
  SYSTEM_SIZE, SYSTEM_INFOS_SIZE, RESOURCE_COUNT,
  SECTOR_TYPES, PLANET_TYPES, RESOURCE_ITEM_IDS,
  type SectorInfo, type SectorType, type PlanetType, type SystemResource,
};

// ── StarSystem ────────────────────────────────────────────────────────────────

/**
 * Represents the StarSystem model used by StarMade database object parsing.
 */
export class StarSystem {
  /** Non-VOID sector entries. Full 16³ grid is reconstructed on encode. */
  readonly sectors: ReadonlyArray<SectorInfo>;
  /** Resource densities (index 0–18). */
  readonly resources: ReadonlyArray<SystemResource>;

  /**
   * Creates a StarSystem instance.
   *
   * @param sectors - Input value for the constructor operation.
   * @param resources - Input value for the constructor operation.
   */
  private constructor(sectors: SectorInfo[], resources: SystemResource[]) {
    this.sectors   = Object.freeze([...sectors]);
    this.resources = Object.freeze([...resources]);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes both SYSTEMS.INFOS and SYSTEMS.RESOURCES bytes.
   * Returns null if INFOS is null or undersized.
   */
  static fromBytes(
    infos: Buffer | Uint8Array | null | undefined,
    resources: Buffer | Uint8Array | null | undefined,
    options: { includeVoid?: boolean } = {},
  ): StarSystem | null {
    const sectors = decodeSystemInfos(infos, options);
    if (!infos || infos.length < SYSTEM_INFOS_SIZE) return null;
    const res = decodeSystemResources(resources, { includeAbsent: true });
    return new StarSystem(sectors, res);
  }

  /** Creates a fully-VOID empty star system with zero resources. */
  static empty(): StarSystem {
    return new StarSystem([], new Array(RESOURCE_COUNT).fill(null).map((_, i) => ({
      index: i,
      itemId: RESOURCE_ITEM_IDS[i].id,
      name:   RESOURCE_ITEM_IDS[i].name,
      density: 0,
    })));
  }

  // ── Sector accessors ───────────────────────────────────────────────────────

  /** Returns the sector info at local (x, y, z), or undefined if VOID/absent. */
  getSector(x: number, y: number, z: number): SectorInfo | undefined {
    return this.sectors.find(s => s.x === x && s.y === y && s.z === z);
  }

  /** Returns the sector info at a flat index, or undefined if VOID/absent. */
  getSectorByIndex(index: number): SectorInfo | undefined {
    return this.sectors.find(s => s.index === index);
  }

  /** All sectors of a given type. */
  bySectorType(type: SectorType): SectorInfo[] {
    return this.sectors.filter(s => s.sectorType === type);
  }

  /**
   * Handles the sunSectors operation used by StarMade database object parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get sunSectors():    SectorInfo[] { return this.bySectorType('SUN'); }
  /**
   * Handles the planets operation used by StarMade database object parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get planets():       SectorInfo[] { return this.bySectorType('PLANET'); }
  /**
   * Handles the gasPlanets operation used by StarMade database object parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get gasPlanets():    SectorInfo[] { return this.bySectorType('GAS_PLANET'); }
  /**
   * Handles the asteroidFields operation used by StarMade database object parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get asteroidFields():SectorInfo[] { return this.bySectorType('ASTEROID'); }
  /**
   * Handles the stations operation used by StarMade database object parsing.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get stations():      SectorInfo[] { return this.bySectorType('SPACE_STATION'); }

  // ── Resource accessors ─────────────────────────────────────────────────────

  /** Resource density by index (0–18). 0 = absent. */
  getResourceDensity(index: number): number {
    return this.resources[index]?.density ?? 0;
  }

  /** Resource density by item ID. */
  getResourceDensityById(itemId: number): number {
    const meta = RESOURCE_ITEM_IDS.find(r => r.id === itemId);
    return meta ? this.getResourceDensity(meta.index) : 0;
  }

  /** All resources with density > 0. */
  get presentResources(): SystemResource[] {
    return this.resources.filter(r => r.density > 0);
  }

  // ── Immutable mutations ────────────────────────────────────────────────────

  /**
   * Sets the sector info at (x, y, z).
   * Replaces if already present; adds otherwise.
   */
  withSector(info: SectorInfo): StarSystem {
    const rest = this.sectors.filter(s => s.x !== info.x || s.y !== info.y || s.z !== info.z);
    const sectors = info.sectorType === 'VOID' ? rest : [...rest, info];
    return new StarSystem(sectors, [...this.resources]);
  }

  /**
   * Convenience: set a sector type at (x, y, z) with optional metadata.
   */
  withSectorType(
    x: number, y: number, z: number,
    type: SectorType,
    metadata = 0,
  ): StarSystem {
    const ordinal = SECTOR_TYPES.indexOf(type);
    if (ordinal === -1) throw new RangeError(`Unknown sector type: ${type}`);
    const index = systemCoordsToIndex(x, y, z);
    const info: SectorInfo = { x, y, z, index, sectorTypeOrdinal: ordinal, sectorType: type, metadata };
    if (type === 'PLANET' || type === 'GAS_PLANET') {
      info.planetType = (PLANET_TYPES[Math.min(PLANET_TYPES.length - 1, metadata)] ?? 'UNKNOWN') as PlanetType;
    }
    return this.withSector(info);
  }

  /** Clears a sector to VOID. */
  withoutSector(x: number, y: number, z: number): StarSystem {
    return new StarSystem(
      this.sectors.filter(s => s.x !== x || s.y !== y || s.z !== z),
      [...this.resources],
    );
  }

  /** Sets the density of a resource by index. */
  withResourceDensity(index: number, density: number): StarSystem {
    if (index < 0 || index >= RESOURCE_COUNT) throw new RangeError(`Resource index out of range: ${index}`);
    const resources = this.resources.map((r, i) =>
      i === index ? { ...r, density: Math.max(0, Math.min(255, density)) } : r,
    );
    return new StarSystem([...this.sectors], resources);
  }

  /** Sets the density of a resource by item ID. */
  withResourceDensityById(itemId: number, density: number): StarSystem {
    const meta = RESOURCE_ITEM_IDS.find(r => r.id === itemId);
    if (!meta) throw new RangeError(`Unknown resource item ID: ${itemId}`);
    return this.withResourceDensity(meta.index, density);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Encodes to SYSTEMS.INFOS bytes (8192 bytes, VOID-filled). */
  infosToBytes(): Buffer {
    return encodeSystemInfos([...this.sectors]);
  }

  /** Encodes to SYSTEMS.RESOURCES bytes (19 bytes). */
  resourcesToBytes(): Buffer {
    return encodeSystemResources([...this.resources]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    const sun    = this.sunSectors.length;
    const planet = this.planets.length + this.gasPlanets.length;
    const res    = this.presentResources.map(r => r.name).join(', ') || 'none';
    return `StarSystem(sun=${sun}, planets=${planet}, sectors=${this.sectors.length}, resources=[${res}])`;
  }
}
