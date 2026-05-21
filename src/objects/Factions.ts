/**
 * @fileoverview Factions
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Factions — object representation of FACTIONS.fac
 *
 * Faithful port of Java FactionManager + Faction + FactionRelation.
 *
 * FactionManager Tag structure (version >= 4):
 *   STRUCT [
 *     [0] BYTE    version
 *     [1] STRUCT  npcFactionPresetManager
 *     [2] STRUCT  factionConfigs
 *     [3] STRUCT  factions list → each entry = STRUCT [INT id, STRUCT faction, FINISH]
 *     [4] STRUCT  invites
 *     [5] STRUCT  news
 *     [6] STRUCT  relations
 *     [7] STRUCT  relationOffers
 *     [8] LONG    lastupdate
 *     [9] STRUCT  npcFactionNews
 *     FINISH
 *   ]
 *
 * Faction Tag structure:
 *   STRUCT [
 *     [0] STRING  code (unused)
 *     [1] STRING  name
 *     [2] STRING  description
 *     [3] LONG    dateCreated
 *     [4] STRUCT  members ("mem") → member tag list
 *     [5] BYTE    openToJoin
 *     [6] STRUCT  roles
 *     [7] STRING  "home" homebaseUID
 *     [8] STRING  "pw"   password
 *     [9] INT     "id"   factionId
 *     [10] BYTE   allyNeutral
 *     [11] BYTE   attackNeutral
 *     ...
 *     [13] BYTE   autoDeclareWar
 *     [15] INT    factionMode
 *     [17] BYTE   showInHub
 *     [18] FLOAT  factionPoints
 *     ...
 *     FINISH
 *   ]
 *
 * FactionRelation structure:
 *   STRUCT [
 *     [0] INT  factionA
 *     [1] INT  factionB
 *     [2] BYTE rel (-1=war, 0=neutral, 1=ally)
 *     FINISH
 *   ]
 *
 * Source: FactionManager.java, Faction.java, FactionRelation.java
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * Defines RELATION_WAR for high-level StarMade object modelling.
 */
export const RELATION_WAR     = -1;
/**
 * Defines RELATION_NEUTRAL for high-level StarMade object modelling.
 */
export const RELATION_NEUTRAL =  0;
/**
 * Defines RELATION_ALLY for high-level StarMade object modelling.
 */
export const RELATION_ALLY    =  1;

/**
 * Defines RELATION_NAMES for high-level StarMade object modelling.
 */
export const RELATION_NAMES: Record<number, string> = {
  [-1]: 'WAR',
  [0]:  'NEUTRAL',
  [1]:  'ALLY',
};

// ── Faction member ──────────────────────────────────────────────────────

/**
 * Represents the FactionMember model used by high-level StarMade object modelling.
 */
export class FactionMember {
  /**
   * Creates a FactionMember instance.
   *
   * @param playerUID - Input value for the constructor operation.
   * @param role - Input value for the constructor operation.
   */
  constructor(
    public playerUID: string,
    public role: number,
  ) {}

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): FactionMember {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    return new FactionMember(
      s[0]?.type === TagType.STRING ? s[0].getString() : '',
      s[1]?.type === TagType.INT    ? s[1].getInt()    : 0,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.string(null, this.playerUID),
      Tags.int(null, this.role),
    ]);
  }
}

// ── Relation between two factions ──────────────────────────────────────────────

/**
 * Represents the FactionRelation model used by high-level StarMade object modelling.
 */
export class FactionRelation {
  /**
   * Creates a FactionRelation instance.
   *
   * @param factionA - Input value for the constructor operation.
   * @param factionB - Input value for the constructor operation.
   * @param relation - Input value for the constructor operation.
   */
  constructor(
    public factionA: number,
    public factionB: number,
    /** -1=WAR, 0=NEUTRAL, 1=ALLY */
    public relation: number,
  ) {}

  /**
   * Handles the relationName operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get relationName(): string { return RELATION_NAMES[this.relation] ?? 'UNKNOWN'; }
  /**
   * Reports whether isWar is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isWar():     boolean { return this.relation === RELATION_WAR; }
  /**
   * Reports whether isNeutral is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isNeutral(): boolean { return this.relation === RELATION_NEUTRAL; }
  /**
   * Reports whether isAlly is true for the current value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get isAlly():    boolean { return this.relation === RELATION_ALLY; }

  /**
   * Creates a value from Tag.
   *
   * @param tag - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(tag: Tag): FactionRelation {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    return new FactionRelation(
      s[0]?.type === TagType.INT  ? s[0].getInt()  : 0,
      s[1]?.type === TagType.INT  ? s[1].getInt()  : 0,
      s[2]?.type === TagType.BYTE ? s[2].getByte() : 0,
    );
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    return Tags.struct(null, [
      Tags.int(null, this.factionA),
      Tags.int(null, this.factionB),
      Tags.byte(null, this.relation),
    ]);
  }
}

// ── Faction ───────────────────────────────────────────────────────────────────

/**
 * Represents the Faction model used by high-level StarMade object modelling.
 */
export class Faction {
  /**
   * Creates a Faction instance.
   *
   * @param id - Input value for the constructor operation.
   * @param name - Input value for the constructor operation.
   * @param description - Input value for the constructor operation.
   * @param dateCreated - Input value for the constructor operation.
   * @param members - Input value for the constructor operation.
   * @param openToJoin - Input value for the constructor operation.
   * @param homebaseUID - Input value for the constructor operation.
   * @param password - Input value for the constructor operation.
   * @param allyNeutral - Input value for the constructor operation.
   * @param attackNeutral - Input value for the constructor operation.
   * @param factionPoints - Input value for the constructor operation.
   * @param factionMode - Input value for the constructor operation.
   * @param showInHub - Input value for the constructor operation.
   * @param isNPC - Input value for the constructor operation.
   */
  constructor(
    public id: number,
    public name: string,
    public description: string,
    public dateCreated: bigint,
    public members: FactionMember[],
    public openToJoin: boolean,
    public homebaseUID: string,
    public password: string,
    public allyNeutral: boolean,
    public attackNeutral: boolean,
    public factionPoints: number,
    public factionMode: number,
    public showInHub: boolean,
    public isNPC: boolean,
  ) {}

  /**
   * Handles the memberCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get memberCount(): number { return this.members.length; }

  /** Rebuilds a faction tag as stored in the file. */
  toTag(): Tag {
    const memberTags = [...this.members.map(m => m.toTag()), FINISH_TAG];
    return Tags.struct(null, [
      Tags.string(null, ''),                            // [0] code (unused)
      Tags.string(null, this.name),                     // [1] name
      Tags.string(null, this.description),              // [2] description
      Tags.long(null, this.dateCreated),                // [3] dateCreated
      new Tag(TagType.STRUCT, 'mem', memberTags),       // [4] members
      Tags.byte(null, this.openToJoin ? 1 : 0),        // [5] openToJoin
      Tags.struct(null, []),                            // [6] roles (empty)
      Tags.string('home', this.homebaseUID),            // [7] homebaseUID
      Tags.string('pw', this.password),                 // [8] password
      Tags.int('id', this.id),                          // [9] factionId
      Tags.byte(null, this.allyNeutral ? 1 : 0),       // [10] allyNeutral
      Tags.byte(null, this.attackNeutral ? 1 : 0),     // [11] attackNeutral
      Tags.byte(null, 0),                               // [12] placeholder
      Tags.byte(null, 0),                               // [13] autoDeclareWar
      Tags.byte(null, 0),                               // [14] placeholder
      Tags.int(null, this.factionMode),                 // [15] factionMode
      Tags.byte(null, 0),                               // [16] placeholder
      Tags.byte(null, this.showInHub ? 1 : 0),         // [17] showInHub
      Tags.float(null, this.factionPoints),             // [18] factionPoints
    ]);
  }

  /**
   * Creates a value from Tag.
   *
   * @param factionTag - Input value for the fromTag operation.
   * @param id - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(factionTag: Tag, id: number): Faction {
    const s = factionTag.getStruct().filter(t => t.type !== TagType.FINISH);

    const name          = s[1]?.type === TagType.STRING ? s[1].getString() : '';
    const description   = s[2]?.type === TagType.STRING ? s[2].getString() : '';
    const dateCreated   = s[3]?.type === TagType.LONG   ? s[3].getLong()   : 0n;
    const openToJoin    = s[5]?.type === TagType.BYTE   ? s[5].getByte() === 1 : false;
    const homebaseUID   = s[7]?.type === TagType.STRING ? s[7].getString() : '';
    const password      = s[8]?.type === TagType.STRING ? s[8].getString() : '';
    const factionId     = s[9]?.type === TagType.INT    ? s[9].getInt()    : id;
    const allyNeutral   = s[10]?.type === TagType.BYTE  ? s[10].getByte() === 1 : false;
    const attackNeutral = s[11]?.type === TagType.BYTE  ? s[11].getByte() === 1 : false;
    const factionMode   = s[15]?.type === TagType.INT   ? s[15].getInt()   : 0;
    const showInHub     = s[17]?.type === TagType.BYTE  ? s[17].getByte() === 1 : false;
    const factionPoints = s[18]?.type === TagType.FLOAT ? s[18].getFloat() : 0;
    const isNPC         = factionId < 0;

    // Members : sub[4] = STRUCT "mem"
    const members: FactionMember[] = [];
    if (s[4]?.type === TagType.STRUCT) {
      for (const m of s[4].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (m.type === TagType.STRUCT) {
          try { members.push(FactionMember.fromTag(m)); } catch { /* skip */ }
        }
      }
    }

    return new Faction(factionId, name, description, dateCreated, members,
      openToJoin, homebaseUID, password, allyNeutral, attackNeutral,
      factionPoints, factionMode, showInHub, isNPC);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `Faction(id=${this.id}, name="${this.name}", members=${this.memberCount}, npc=${this.isNPC})`;
  }
}

// ── FactionManager (the full file) ──────────────────────────────────────

/**
 * Represents the FactionManager model used by high-level StarMade object modelling.
 */
export class FactionManager {
  /**
   * Creates a FactionManager instance.
   *
   * @param version - Input value for the constructor operation.
   * @param factions - Input value for the constructor operation.
   * @param relations - Input value for the constructor operation.
   * @param lastUpdate - Input value for the constructor operation.
   */
  constructor(
    public version: number,
    public factions: Map<number, Faction>,
    public relations: FactionRelation[],
    public lastUpdate: bigint,
  ) {}

  // ── Accessors ──────────────────────────────────────────────────────────────────

  /**
   * Returns the requested value.
   *
   * @param id - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(id: number): Faction | undefined { return this.factions.get(id); }

  /**
   * Returns all values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get all(): Faction[] { return [...this.factions.values()]; }
  /**
   * Handles the playerFactions operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get playerFactions(): Faction[] { return this.all.filter(f => !f.isNPC); }
  /**
   * Handles the npcFactions operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get npcFactions(): Faction[] { return this.all.filter(f => f.isNPC); }

  /**
   * Returns Relation.
   *
   * @param a - Input value for the getRelation operation.
   * @param b - Input value for the getRelation operation.
   * @returns The computed StarMade-Decoder value.
   */
  getRelation(a: number, b: number): FactionRelation | undefined {
    return this.relations.find(r =>
      (r.factionA === a && r.factionB === b) ||
      (r.factionA === b && r.factionB === a)
    );
  }

  /**
   * Returns RelationsOf.
   *
   * @param id - Input value for the getRelationsOf operation.
   * @returns The computed StarMade-Decoder value.
   */
  getRelationsOf(id: number): FactionRelation[] {
    return this.relations.filter(r => r.factionA === id || r.factionB === id);
  }

  // ── Updates ───────────────────────────────────────────────────────────

  /** Adds or replaces a faction. */
  setFaction(faction: Faction): FactionManager {
    const newMap = new Map(this.factions);
    newMap.set(faction.id, faction);
    return new FactionManager(this.version, newMap, this.relations, this.lastUpdate);
  }

  /** Removes a faction by id. */
  removeFaction(id: number): FactionManager {
    const newMap = new Map(this.factions);
    newMap.delete(id);
    return new FactionManager(this.version, newMap,
      this.relations.filter(r => r.factionA !== id && r.factionB !== id),
      this.lastUpdate);
  }

  /** Defines or replaces a relation between two factions. */
  setRelation(a: number, b: number, relation: number): FactionManager {
    const filtered = this.relations.filter(r =>
      !((r.factionA === a && r.factionB === b) || (r.factionA === b && r.factionB === a))
    );
    return new FactionManager(this.version, this.factions,
      [...filtered, new FactionRelation(a, b, relation)],
      this.lastUpdate);
  }

  // ── Parsing / Serialization ──────────────────────────────────────────────────

  /**
   * Creates a value from Tag.
   *
   * @param root - Input value for the fromTag operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromTag(root: Tag): FactionManager {
    if (root.type !== TagType.STRUCT) {
      throw new TypeError('FactionManager.fromTag: expected STRUCT root');
    }

    const subs = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const version    = subs[0]?.type === TagType.BYTE ? subs[0].getByte() : 0;
    const lastUpdate = subs[8]?.type === TagType.LONG ? subs[8].getLong() : 0n;

    const factions = new Map<number, Faction>();
    const relations: FactionRelation[] = [];

    // subs[3] = factions list: STRUCT of STRUCT values [INT id, STRUCT factionData, FINISH]
    if (subs[3]?.type === TagType.STRUCT) {
      for (const entry of subs[3].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (entry.type !== TagType.STRUCT) continue;
        const entryChildren = entry.getStruct().filter(t => t.type !== TagType.FINISH);
        const id  = entryChildren[0]?.type === TagType.INT  ? entryChildren[0].getInt() : 0;
        const fac = entryChildren[1]?.type === TagType.STRUCT ? entryChildren[1] : null;
        if (fac) {
          try {
            const faction = Faction.fromTag(fac, id);
            factions.set(faction.id, faction);
          } catch { /* skip malformed data */ }
        }
      }
    }

    // subs[6] = relations : STRUCT de FactionRelation tags
    if (subs[6]?.type === TagType.STRUCT) {
      for (const rel of subs[6].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (rel.type === TagType.STRUCT) {
          try { relations.push(FactionRelation.fromTag(rel)); } catch { /* skip */ }
        }
      }
    }

    return new FactionManager(version, factions, relations, lastUpdate);
  }

  /**
   * Converts this value to Tag.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toTag(): Tag {
    // Root Tag reconstruction (current version = 0)
    const factionEntries: Tag[] = [];
    for (const faction of this.factions.values()) {
      // Each entry = STRUCT [INT id, STRUCT factionData, FINISH]
      factionEntries.push(Tags.struct(null, [
        Tags.int(null, faction.id),
        faction.toTag(),
      ]));
    }
    factionEntries.push(FINISH_TAG);

    const relTags = [...this.relations.map(r => r.toTag()), FINISH_TAG];

    return Tags.struct('factions-v2', [
      Tags.byte(null, this.version),                           // [0] version
      Tags.struct(null, []),                                   // [1] npcFactionPresetManager
      Tags.struct(null, []),                                   // [2] factionConfigs
      new Tag(TagType.STRUCT, null, factionEntries),           // [3] factions
      Tags.struct(null, []),                                   // [4] invites
      Tags.struct(null, []),                                   // [5] news
      new Tag(TagType.STRUCT, null, relTags),                  // [6] relations
      Tags.struct(null, []),                                   // [7] relationOffers
      Tags.long(null, this.lastUpdate),                        // [8] lastupdate
      Tags.struct(null, []),                                   // [9] npcFactionNews
    ]);
  }

  /** Encodes to binary for FACTIONS.fac. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  /** Named constructor from binary file. */
  static fromBuffer(data: Buffer | Uint8Array): FactionManager {
    return FactionManager.fromTag(readFrom(data));
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `FactionManager(v${this.version}, ${this.factions.size} factions, ${this.relations.length} relations)`;
  }
}
