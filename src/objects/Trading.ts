/**
 * @fileoverview Trading
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Trading — business object for TRADING.tag
 *
 * Complete deserialization — no raw tag is kept.
 * All data is directly accessible from TypeScript.
 *
 * Structure Tag (TradeActive.toTagStructure) :
 *   STRUCT [
 *     BYTE  version (= 0)
 *     STRUCT payload [
 *       SERIALIZABLE  blocks (ElementCountMap, factoryId=1)
 *       LONG          blockPrice
 *       LONG          deliveryPrice
 *       LONG          startTime
 *       LONG          fromId
 *       LONG          toId
 *       LONG          fleetId
 *       DOUBLE        volume
 *       VECTOR3i      startSystem
 *       VECTOR3i      targetSystem
 *       VECTOR3i      currentSector
 *       INT           fromFactionId
 *       INT           toFactionId
 *       STRING        fromPlayer
 *       STRING        toPlayer
 *       STRING        fromStation
 *       STRING        toStation
 *       VECTOR3i      startSector
 *       STRUCT        sectorWayPoints [VECTOR3i...]  (listToTagStruct)
 *       FINISH
 *     ]
 *     FINISH
 *   ]
 *
 * TradingManager :
 *   STRUCT [
 *     BYTE   version (= 0)
 *     STRUCT trades (TradeRoute list)
 *     FINISH
 *   ]
 *
 * Source: TradeActive.java, TradeManager.java, TradeActiveMap.java
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import { RawElement } from '../serializable/Factories.js';
import { ElementCountMap } from './Serializables.js';
import type { Vector3i } from '../types/Vectors.js';

// ── TradeRoute ────────────────────────────────────────────────────────────────

/**
 * Represents the TradeRoute model used by high-level StarMade object modelling.
 */
export class TradeRoute {
  /**
   * Creates a TradeRoute instance.
   *
   * @param blocks - Input value for the constructor operation.
   * @param blockPrice - Input value for the constructor operation.
   * @param deliveryPrice - Input value for the constructor operation.
   * @param startTime - Input value for the constructor operation.
   * @param fromId - Input value for the constructor operation.
   * @param toId - Input value for the constructor operation.
   * @param fleetId - Input value for the constructor operation.
   * @param volume - Input value for the constructor operation.
   * @param startSystem - Input value for the constructor operation.
   * @param targetSystem - Input value for the constructor operation.
   * @param currentSector - Input value for the constructor operation.
   * @param fromFactionId - Input value for the constructor operation.
   * @param toFactionId - Input value for the constructor operation.
   * @param fromPlayer - Input value for the constructor operation.
   * @param toPlayer - Input value for the constructor operation.
   * @param fromStation - Input value for the constructor operation.
   * @param toStation - Input value for the constructor operation.
   * @param startSector - Input value for the constructor operation.
   * @param sectorWayPoints - Input value for the constructor operation.
   */
  constructor(
    /** Traded blocks with their quantities */
    public blocks: ElementCountMap,
    /** Block prices in credits */
    public blockPrice: bigint,
    /** Delivery price in credits */
    public deliveryPrice: bigint,
    /** Start timestamp */
    public startTime: bigint,
    /** Source entity ID */
    public fromId: bigint,
    /** Destination entity ID */
    public toId: bigint,
    /** Transport fleet ID (-1 when absent) */
    public fleetId: bigint,
    /** Total cargo volume */
    public volume: number,
    /** Source system */
    public startSystem: Vector3i | null,
    /** Target system */
    public targetSystem: Vector3i | null,
    /** Current sector */
    public currentSector: Vector3i | null,
    /** Sender faction ID */
    public fromFactionId: number,
    /** Receiver faction ID */
    public toFactionId: number,
    /** Sender player */
    public fromPlayer: string,
    /** Receiver player */
    public toPlayer: string,
    /** Origin station */
    public fromStation: string,
    /** Station de destination */
    public toStation: string,
    /** Source sector */
    public startSector: Vector3i | null,
    /** Intermediate waypoints */
    public sectorWayPoints: Vector3i[],
  ) {}

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): TradeRoute {
    const outer = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    // outer[0] = BYTE version, outer[1] = STRUCT payload
    const payload = outer[1]?.type === TagType.STRUCT
      ? outer[1].getStruct().filter(t => t.type !== TagType.FINISH)
      : outer; // fallback when there is no version wrapper

    let i = 0;

    // ElementCountMap SERIALIZABLE
    let blocks = new ElementCountMap([]);
    if (payload[i]?.type === TagType.SERIALIZABLE) {
      const elem = payload[i].value as RawElement;
      if (elem.factoryId === 1) blocks = ElementCountMap.fromRaw(elem.raw);
      i++;
    }

    const g = <T>(type: TagType, extractor: (t: Tag) => T, def: T): T => {
      const t = payload[i++];
      return t?.type === type ? extractor(t) : def;
    };

    const blockPrice    = g(TagType.LONG,     t => t.getLong(),    0n);
    const deliveryPrice = g(TagType.LONG,     t => t.getLong(),    0n);
    const startTime     = g(TagType.LONG,     t => t.getLong(),    0n);
    const fromId        = g(TagType.LONG,     t => t.getLong(),    0n);
    const toId          = g(TagType.LONG,     t => t.getLong(),    0n);
    const fleetId       = g(TagType.LONG,     t => t.getLong(),   -1n);
    const volume        = g(TagType.DOUBLE,   t => t.getDouble(),  0);
    const startSystem   = g(TagType.VECTOR3i, t => t.getVector3i(), null);
    const targetSystem  = g(TagType.VECTOR3i, t => t.getVector3i(), null);
    const currentSector = g(TagType.VECTOR3i, t => t.getVector3i(), null);
    const fromFactionId = g(TagType.INT,      t => t.getInt(),     0);
    const toFactionId   = g(TagType.INT,      t => t.getInt(),     0);
    const fromPlayer    = g(TagType.STRING,   t => t.getString(),  '');
    const toPlayer      = g(TagType.STRING,   t => t.getString(),  '');
    const fromStation   = g(TagType.STRING,   t => t.getString(),  '');
    const toStation     = g(TagType.STRING,   t => t.getString(),  '');
    const startSector   = g(TagType.VECTOR3i, t => t.getVector3i(), null);

    // sectorWayPoints : STRUCT [VECTOR3i...] (listToTagStruct)
    const sectorWayPoints: Vector3i[] = [];
    if (payload[i]?.type === TagType.STRUCT) {
      for (const wp of payload[i].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (wp.type === TagType.VECTOR3i) sectorWayPoints.push(wp.getVector3i());
      }
      i++;
    }

    return new TradeRoute(blocks, blockPrice, deliveryPrice, startTime,
      fromId, toId, fleetId, volume, startSystem, targetSystem, currentSector,
      fromFactionId, toFactionId, fromPlayer, toPlayer, fromStation, toStation,
      startSector, sectorWayPoints);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    // Encode the ECM inline (duck typing — works around duplicate ESM modules)
    const counts: Array<{type: number; count: number}> =
      (this.blocks as any).counts ?? [];
    const nonZero = counts.filter(c => c.count > 0);
    const ecmBuf = Buffer.alloc(4 + nonZero.length * 6);
    ecmBuf.writeInt32BE(nonZero.length, 0);
    nonZero.forEach((c, i) => {
      ecmBuf.writeInt16BE(c.type,  4 + i * 6);
      ecmBuf.writeInt32BE(c.count, 6 + i * 6);
    });
    const ecmElem = new RawElement(1, new Uint8Array(ecmBuf));
    const ecmTag  = new Tag(TagType.SERIALIZABLE, null, ecmElem);
    const v3 = (v: Vector3i | null) =>
      v ? Tags.vector3i(null, v.x, v.y, v.z) : Tags.vector3i(null, 0, 0, 0);

    // sectorWayPoints → listToTagStruct
    const wpTags = [...this.sectorWayPoints.map(wp =>
      Tags.vector3i(null, wp.x, wp.y, wp.z)), FINISH_TAG];
    const waypointsStruct = new Tag(TagType.STRUCT, null, wpTags);

    const payload = Tags.struct(null, [
      ecmTag,
      Tags.long(null, this.blockPrice),
      Tags.long(null, this.deliveryPrice),
      Tags.long(null, this.startTime),
      Tags.long(null, this.fromId),
      Tags.long(null, this.toId),
      Tags.long(null, this.fleetId),
      Tags.double(null, this.volume),
      v3(this.startSystem),
      v3(this.targetSystem),
      v3(this.currentSector),
      Tags.int(null, this.fromFactionId),
      Tags.int(null, this.toFactionId),
      Tags.string(null, this.fromPlayer),
      Tags.string(null, this.toPlayer),
      Tags.string(null, this.fromStation),
      Tags.string(null, this.toStation),
      v3(this.startSector),
      waypointsStruct,
    ]);

    return Tags.struct(null, [Tags.byte(null, 0), payload]);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `TradeRoute(${this.fromStation}→${this.toStation}, blocks=${this.blocks.totalBlocks}, price=${this.blockPrice}, fleet=${this.fleetId})`;
  }
}

// ── TradingManager ────────────────────────────────────────────────────────────

/**
 * Represents the TradingManager model used by high-level StarMade object modelling.
 */
export class TradingManager {
  /**
   * Creates a TradingManager instance.
   *
   * @param version - Input value for the constructor operation.
   * @param routes - Input value for the constructor operation.
   */
  constructor(
    public version: number,
    public routes: TradeRoute[],
  ) {}

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Handles the routesFrom operation used by high-level StarMade object modelling.
   *
   * @param factionId - Input value for the routesFrom operation.
   * @returns The computed StarMade-Decoder value.
   */
  routesFrom(factionId: number): TradeRoute[] { return this.routes.filter(r => r.fromFactionId === factionId); }
  /**
   * Handles the routesTo operation used by high-level StarMade object modelling.
   *
   * @param factionId - Input value for the routesTo operation.
   * @returns The computed StarMade-Decoder value.
   */
  routesTo(factionId: number):   TradeRoute[] { return this.routes.filter(r => r.toFactionId   === factionId); }
  /**
   * Handles the routesBetween operation used by high-level StarMade object modelling.
   *
   * @param a - Input value for the routesBetween operation.
   * @param b - Input value for the routesBetween operation.
   * @returns The computed StarMade-Decoder value.
   */
  routesBetween(a: number, b: number): TradeRoute[] {
    return this.routes.filter(r =>
      (r.fromFactionId === a && r.toFactionId === b) ||
      (r.fromFactionId === b && r.toFactionId === a));
  }

  // ── Immutable updates ───────────────────────────────────────────────

  /**
   * Handles the addRoute operation used by high-level StarMade object modelling.
   *
   * @param route - Input value for the addRoute operation.
   * @returns The computed StarMade-Decoder value.
   */
  addRoute(route: TradeRoute): TradingManager {
    return new TradingManager(this.version, [...this.routes, route]);
  }

  /**
   * Handles the removeRoute operation used by high-level StarMade object modelling.
   *
   * @param idx - Input value for the removeRoute operation.
   * @returns The computed StarMade-Decoder value.
   */
  removeRoute(idx: number): TradingManager {
    return new TradingManager(this.version, this.routes.filter((_, i) => i !== idx));
  }

  /**
   * Handles the updateRoute operation used by high-level StarMade object modelling.
   *
   * @param idx - Input value for the updateRoute operation.
   * @param route - Input value for the updateRoute operation.
   * @returns The computed StarMade-Decoder value.
   */
  updateRoute(idx: number, route: TradeRoute): TradingManager {
    return new TradingManager(this.version, this.routes.map((r, i) => i === idx ? route : r));
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): TradingManager {
    if (root.type !== TagType.STRUCT) throw new TypeError('TradingManager: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    const routes: TradeRoute[] = [];

    if (s[1]?.type === TagType.STRUCT) {
      for (const child of s[1].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (child.type === TagType.STRUCT) {
          try { routes.push(TradeRoute.fromTag(child)); } catch { /* skip corrupted */ }
        }
      }
    }
    return new TradingManager(version, routes);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    const routeTags = [...this.routes.map(r => r.toTag()), FINISH_TAG];
    return Tags.struct(null, [
      Tags.byte(null, this.version),
      new Tag(TagType.STRUCT, null, routeTags),
    ]);
  }

  /** Encodes to binary for TRADING.tag. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /**
   * Creates a value from Buffer.
   *
   * @param data - Input value for the fromBuffer operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromBuffer(data: Buffer | Uint8Array): TradingManager {
    return TradingManager.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `TradingManager(v${this.version}, ${this.routes.length} routes)`;
  }
}
