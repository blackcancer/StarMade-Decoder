/**
 * @fileoverview Catalog
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Catalog — object representation of the CATALOG.cat file
 *
 * Faithful port of Java CatalogManager + CatalogPermission.
 *
 * Tag structure (cv0):
 *   STRUCT "cv0" [
 *     STRUCT "pv0"  — list of CatalogPermission entries
 *     STRUCT "r0"   — ratings
 *     FINISH
 *   ]
 *
 * CatalogPermission structure:
 *   STRUCT null [
 *     [0] STRING uid
 *     [1] STRING ownerUID
 *     [2] STRUCT permTag (wave permissions)
 *     [3] LONG   price
 *     [4] STRING description
 *     [5] LONG   dateCreated
 *     [6] LONG   timeSpawned
 *     [7] FLOAT  mass
 *     [8] INT    blueprintType (ordinal BlueprintType)
 *     [9] STRUCT waveTag
 *     [10] BYTE  classification
 *     FINISH
 *   ]
 *
 * Source: CatalogManager.java, CatalogPermission.java
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import { BLUEPRINT_TYPE } from '../smd3/SmentParser.js';

// ── Catalog entry ──────────────────────────────────────────────────────────

/**
 * Represents the CatalogEntry model used by high-level StarMade object modelling.
 */
export class CatalogEntry {
  /**
   * Creates a CatalogEntry instance.
   *
   * @param uid - Input value for the constructor operation.
   * @param ownerUID - Input value for the constructor operation.
   * @param price - Input value for the constructor operation.
   * @param description - Input value for the constructor operation.
   * @param mass - Input value for the constructor operation.
   * @param blueprintType - Input value for the constructor operation.
   * @param dateCreated - Input value for the constructor operation.
   * @param timeSpawned - Input value for the constructor operation.
   * @param classification - Input value for the constructor operation.
   */
  constructor(
    /** Unique blueprint identifier (= blueprint name) */
    public uid: string,
    /** Owner */
    public ownerUID: string,
    /** Price in credits */
    public price: bigint,
    /** Description */
    public description: string,
    /** Total mass */
    public mass: number,
    /** Blueprint type */
    public blueprintType: string,
    /** Creation date (timestamp ms) */
    public dateCreated: bigint,
    /** Last spawn time */
    public timeSpawned: bigint,
    /** Classification (BlueprintClassification ordinal) */
    public classification: number,
  ) {}

  /** Rebuilds the Tag for this entry. */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.string(null, this.uid),
      Tags.string(null, this.ownerUID),
      Tags.struct(null, []),                // empty permTag
      Tags.long(null, this.price),
      Tags.string(null, this.description),
      Tags.long(null, this.dateCreated),
      Tags.long(null, this.timeSpawned),
      Tags.float(null, this.mass),
      Tags.int(null, BLUEPRINT_TYPE.indexOf(this.blueprintType as any) >= 0
        ? BLUEPRINT_TYPE.indexOf(this.blueprintType as any) : 0),
      Tags.struct(null, []),                // empty waveTag
      Tags.byte(null, this.classification),
    ]);
  }

  /** Parses a CatalogPermission from its Tag. */
  static fromTag(tag: Tag): CatalogEntry {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const uid           = s[0]?.type === TagType.STRING ? s[0].getString() : '';
    const ownerUID      = s[1]?.type === TagType.STRING ? s[1].getString() : '';
    const price         = s[3]?.type === TagType.LONG   ? s[3].getLong()   :
                          s[3]?.type === TagType.INT    ? BigInt(s[3].getInt()) : 0n;
    const description   = s[4]?.type === TagType.STRING ? s[4].getString() : '';
    const dateCreated   = s[5]?.type === TagType.LONG   ? s[5].getLong()   : 0n;
    const timeSpawned   = s[6]?.type === TagType.LONG   ? s[6].getLong()   : 0n;
    const mass          = s[7]?.type === TagType.FLOAT  ? s[7].getFloat()  : 0;
    const typeOrd       = s[8]?.type === TagType.INT    ? s[8].getInt()    : 0;
    const blueprintType = BLUEPRINT_TYPE[typeOrd] ?? `UNKNOWN(${typeOrd})`;
    const classification = s[10]?.type === TagType.BYTE ? s[10].getByte()  : 0;

    return new CatalogEntry(uid, ownerUID, price, description, mass, blueprintType,
                            dateCreated, timeSpawned, classification);
  }
}

// ── Catalogue complet ─────────────────────────────────────────────────────────

/**
 * Represents the Catalog model used by high-level StarMade object modelling.
 */
export class Catalog {
  /**
   * Creates a Catalog instance.
   *
   * @param entries - Input value for the constructor operation.
   * @param systemEntries - Input value for the constructor operation.
   */
  constructor(
    /** Player entries (pv0) */
    public entries: CatalogEntry[],
    /** System/NPC entries (r0 — other section) */
    public systemEntries: CatalogEntry[],
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Parses a root Tag from CATALOG.cat */
  static fromTag(root: Tag): Catalog {
    if (root.type !== TagType.STRUCT) {
      throw new TypeError('Catalog.fromTag: expected STRUCT root');
    }

    const entries: CatalogEntry[] = [];
    const systemEntries: CatalogEntry[] = [];

    const sections = root.getStruct().filter(t => t.type !== TagType.FINISH);
    for (const section of sections) {
      if (section.type !== TagType.STRUCT) continue;
      const target = section.name?.startsWith('pv') ? entries : systemEntries;
      const perms = section.getStruct().filter(t => t.type !== TagType.FINISH);
      for (const perm of perms) {
        if (perm.type === TagType.STRUCT) {
          try { target.push(CatalogEntry.fromTag(perm)); } catch { /* skip malformed data */ }
        }
      }
    }

    return new Catalog(entries, systemEntries);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────────

  /** All entries (player + system). */
  get all(): CatalogEntry[] { return [...this.entries, ...this.systemEntries]; }

  /** Finds an entry by UID. */
  find(uid: string): CatalogEntry | undefined {
    return this.all.find(e => e.uid === uid);
  }

  /** Filters by owner. */
  byOwner(ownerUID: string): CatalogEntry[] {
    return this.all.filter(e => e.ownerUID.toLowerCase() === ownerUID.toLowerCase());
  }

  /** Filters by type. */
  byType(type: string): CatalogEntry[] {
    return this.all.filter(e => e.blueprintType === type);
  }

  // ── Updates ───────────────────────────────────────────────────────────

  /** Adds an entry (to player entries). */
  addEntry(entry: CatalogEntry): Catalog {
    return new Catalog([...this.entries, entry], this.systemEntries);
  }

  /** Removes an entry by UID. */
  removeEntry(uid: string): Catalog {
    return new Catalog(
      this.entries.filter(e => e.uid !== uid),
      this.systemEntries.filter(e => e.uid !== uid),
    );
  }

  /** Replaces an entry by UID. */
  updateEntry(uid: string, updated: CatalogEntry): Catalog {
    return new Catalog(
      this.entries.map(e => e.uid === uid ? updated : e),
      this.systemEntries.map(e => e.uid === uid ? updated : e),
    );
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Rebuilds the root Tag ready for writeTo(). */
  toTag(): Tag {
    const pvTags = [...this.entries.map(e => e.toTag()), FINISH_TAG];
    const rvTags = [...this.systemEntries.map(e => e.toTag()), FINISH_TAG];

    return Tags.struct(null, [
      new Tag(TagType.STRUCT, 'pv0', pvTags),
      new Tag(TagType.STRUCT, 'r0', rvTags),
    ]);
  }

  // ── Display ──────────────────────────────────────────────────────────────

  /** Encodes to binary for CATALOG.cat. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /** Named constructor from binary file. */
  static fromBuffer(data: Buffer | Uint8Array): Catalog {
    return Catalog.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `Catalog(${this.entries.length} player entries, ${this.systemEntries.length} system entries)`;
  }
}
