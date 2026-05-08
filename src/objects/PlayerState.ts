/**
 * @fileoverview Player State
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * PlayerState — business object for ENTITY_PLAYERSTATE_*.ent
 *
 * Source: PlayerState.fromTagStructure() Java
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import type { Vector3i, Vector3f } from '../types/Vectors.js';

export class PlayerState {
  constructor(
    public credits: bigint,
    public currentSector: Vector3i | null,
    public logoutSector: Vector3i | null,
    public logoutLocalPos: Vector3f | null,
    public lastLogin: bigint,
    public lastLogout: bigint,
    public hasCreativeMode: boolean,
    public lastEnteredEntity: string,
    public factionId: number,
    public factionRank: number,
    /** Complete root Tag for lossless re-serialization */
    private _rootTag: Tag,
  ) {}

  // ── Updates (returns a modified PlayerState) ────────────────────────

  withCredits(credits: bigint): PlayerState {
    const newTag = Tags.setField(this._rootTag, 'credits', Tags.long('credits', credits));
    return PlayerState.fromTag(newTag);
  }

  withCreativeMode(enabled: boolean): PlayerState {
    if (this._rootTag.type !== TagType.STRUCT) return this;
    const children = this._rootTag.getStruct();
    // hasCreativeMode = index 10 in the PlayerState structure (BYTE anonymous)
    const newChildren = [...children];
    if (newChildren[10]?.type === TagType.BYTE) {
      newChildren[10] = Tags.byte(null, enabled ? 1 : 0);
    }
    const newTag = new (this._rootTag.constructor as any)(TagType.STRUCT, this._rootTag.name, newChildren);
    return PlayerState.fromTag(newTag);
  }

  withFaction(id: number, rank = 0): PlayerState {
    // The faction is in a child struct — search by name
    let tag = this._rootTag;
    const factionTag = tag.findByName('pFac-v0') ?? tag.findByName('pFac');
    if (factionTag && factionTag.type === TagType.STRUCT) {
      const newFacTag = Tags.struct(factionTag.name, [
        Tags.int(null, id),
        Tags.int(null, rank),
      ]);
      tag = Tags.setField(tag, factionTag.name!, newFacTag);
    }
    return PlayerState.fromTag(tag);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toTag(): Tag { return this._rootTag; }
  toBuffer(): Buffer { return writeTo(this._rootTag); }

  static fromTag(root: Tag): PlayerState {
    const s = root.type === TagType.STRUCT
      ? root.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const credits      = s[0]?.type === TagType.LONG ? s[0].getLong() : 0n;
    const lastLogin    = s.length > 7 && s[7]?.type === TagType.LONG ? s[7].getLong() : 0n;
    const lastLogout   = s.length > 8 && s[8]?.type === TagType.LONG ? s[8].getLong() : 0n;
    const creativeMode = s.length > 10 && s[10]?.type === TagType.BYTE ? s[10].getByte() !== 0 : false;
    const lastEntered  = s.length > 11 && s[11]?.type === TagType.STRING ? s[11].getString() : '';

    let currentSector:  Vector3i | null = null;
    let logoutSector:   Vector3i | null = null;
    let logoutLocalPos: Vector3f | null = null;
    let factionId = 0, factionRank = 0;

    for (const t of s) {
      if (t.name === 'lsector'  && t.type === TagType.VECTOR3i) logoutSector   = t.getVector3i();
      if (t.name === 'lspawn'   && t.type === TagType.VECTOR3f) logoutLocalPos = t.getVector3f();
      if (t.name === 'sector'   && t.type === TagType.VECTOR3i) currentSector  = t.getVector3i();
    }
    if (s[3]?.type === TagType.VECTOR3i) currentSector = s[3].getVector3i();

    const facTag = s.find(t => (t.name === 'pFac-v0' || t.name === 'pFac') && t.type === TagType.STRUCT);
    if (facTag) {
      const fs = facTag.getStruct().filter(t => t.type !== TagType.FINISH);
      if (fs[0]?.type === TagType.INT) factionId   = fs[0].getInt();
      if (fs[1]?.type === TagType.INT) factionRank = fs[1].getInt();
    }

    return new PlayerState(credits, currentSector, logoutSector, logoutLocalPos,
      lastLogin, lastLogout, creativeMode, lastEntered, factionId, factionRank, root);
  }

  static fromBuffer(data: Buffer | Uint8Array): PlayerState {
    return PlayerState.fromTag(readFrom(data));
  }

  toString(): string {
    return `PlayerState(credits=${this.credits}, sector=${JSON.stringify(this.currentSector)}, creative=${this.hasCreativeMode})`;
  }
}
