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
  readonly #sectors: SectorInfo[];
  readonly #resources: SystemResource[];
  readonly #includeVoid: boolean;

  /** Detached sector view; VOID entries are hidden unless includeVoid was requested. */
  get sectors(): ReadonlyArray<SectorInfo> {
    return this.#sectors.filter(sector => this.#includeVoid || sector.sectorType !== 'VOID').map(sector => ({ ...sector }));
  }

  /** Detached resource densities in index order (0–18), including absent resources. */
  get resources(): ReadonlyArray<SystemResource> { return this.#resources.map(resource => ({ ...resource })); }

  /**
   * Creates a StarSystem instance.
   *
   * @param sectors - Input value for the constructor operation.
   * @param resources - Input value for the constructor operation.
   */
  private constructor(sectors: SectorInfo[], resources: SystemResource[], includeVoid = false) {
    this.#sectors = sectors.map(sector => ({ ...sector }));
    this.#resources = RESOURCE_ITEM_IDS.map(meta => ({ index: meta.index, itemId: meta.id, name: meta.name,
      density: resources.find(resource => resource.index === meta.index)?.density ?? 0 }));
    this.#includeVoid = includeVoid;
    Object.freeze(this);
  }

  // ── Named constructors ─────────────────────────────────────────────────────

  /**
   * Decodes both SYSTEMS.INFOS and SYSTEMS.RESOURCES bytes.
   * Returns null for absent/empty INFOS; malformed cells throw.
   */
  static fromBytes(
    infos: Buffer | Uint8Array | null | undefined,
    resources: Buffer | Uint8Array | null | undefined,
    options: { includeVoid?: boolean } = {},
  ): StarSystem | null {
    if (!infos || infos.length === 0) return null;
    // Keep the complete wire grid independently of the caller's filtered view.
    const sectors = decodeSystemInfos(infos, { includeVoid: true });
    const res = decodeSystemResources(resources, { includeAbsent: true });
    return new StarSystem(sectors, res, options.includeVoid);
  }

  /** Creates a fully-VOID empty star system with zero resources. */
  static empty(): StarSystem {
    return new StarSystem([], []);
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
    return this.#resources[index]?.density ?? 0;
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
    validateSectorInfo(info);
    const rest = this.#sectors.filter(sector => sector.index !== info.index);
    const entry = { ...info };
    if (info.sectorType === 'PLANET' || info.sectorType === 'GAS_PLANET') {
      entry.planetType = PLANET_TYPES[Math.min(PLANET_TYPES.length - 1, info.metadata)];
    }
    return new StarSystem([...rest, entry], this.#resources, this.#includeVoid);
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
    return this.withSector(info);
  }

  /** Clears a sector to VOID. */
  withoutSector(x: number, y: number, z: number): StarSystem {
    return this.withSectorType(x, y, z, 'VOID');
  }

  /** Sets the density of a resource by index. */
  withResourceDensity(index: number, density: number): StarSystem {
    validateSystemInteger(index, RESOURCE_COUNT - 1, 'Resource index');
    validateSystemInteger(density, 255, 'Resource density');
    const resources = this.#resources.map((resource, i) => i === index ? { ...resource, density } : resource);
    return new StarSystem(this.#sectors, resources, this.#includeVoid);
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
    return encodeSystemInfos(this.#sectors);
  }

  /** Encodes to SYSTEMS.RESOURCES bytes (19 bytes). */
  resourcesToBytes(): Buffer {
    return encodeSystemResources(this.#resources);
  }

  /** Complete detached JSON projection, including VOID metadata hidden by the sector view. */
  toJSON(): { sectors: SectorInfo[]; resources: ReadonlyArray<SystemResource> } {
    return { sectors: this.#sectors.map(sector => ({ ...sector })), resources: this.resources };
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

/** Checks unsigned integer fields before the low-level codec's byte writes. */
function validateSystemInteger(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} must be an integer in [0, ${maximum}]`);
}

/** Rejects contradictory derived fields while preserving unknown wire ordinals. */
function validateSectorInfo(info: SectorInfo): void {
  for (const coordinate of [info.x, info.y, info.z]) validateSystemInteger(coordinate, SYSTEM_SIZE - 1, 'Sector coordinate');
  validateSystemInteger(info.sectorTypeOrdinal, 255, 'Sector type ordinal');
  validateSystemInteger(info.metadata, 255, 'Sector metadata');
  if (info.index !== systemCoordsToIndex(info.x, info.y, info.z)) throw new RangeError('Sector index does not match its coordinates');
  const type = SECTOR_TYPES[info.sectorTypeOrdinal] ?? 'UNKNOWN';
  if (info.sectorType !== type) throw new RangeError('Sector type does not match its ordinal');
  const planetType = type === 'PLANET' || type === 'GAS_PLANET'
    ? PLANET_TYPES[Math.min(PLANET_TYPES.length - 1, info.metadata)] : undefined;
  if (info.planetType !== undefined && info.planetType !== planetType) throw new RangeError('Planet type does not match sector metadata');
}
