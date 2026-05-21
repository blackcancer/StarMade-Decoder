/**
 * @fileoverview Simulation
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.1.0
 */

/**
 * NPCFactionManager — business object for NPCFACTIONS_*.tag
 *
 * Tag structure (NPCFactionManager.toTagStructure — Java source):
 *   STRUCT [
 *     BYTE  version  (= 0)
 *     FINISH
 *   ]
 *
 * Note: NPC factions are not stored here — they live in FACTIONS.fac as
 * regular Faction entries with isNPC()==true. This file only carries the
 * manager version byte written by the server at shutdown.
 *
 * SimulationGroup structure (SimulationGroup.toTagStructure):
 *   STRUCT [
 *     BYTE     version
 *     INT      type
 *     STRUCT   members — STRING list
 *     LONG     startTime
 *     VECTOR3i startSector
 *     INT      programId
 *     FINISH
 *   ]
 *
 * SimulationState structure (SimulationManager.toTagStructure):
 *   STRUCT SimulationState [
 *     BYTE    version
 *     STRUCT  groups — SimulationGroup list
 *     LONG    lastUpdate
 *     FINISH
 *   ]
 *
 * Source: NPCFactionManager.java, SimulationManager.java
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import type { Vector3i } from '../types/Vectors.js';

// ── SimulationGroup ────────────────────────────────────────────────────────────

export class SimulationGroup {
  constructor(
    public version: number,
    public type: number,
    public members: string[],
    public startTime: bigint,
    public startSector: Vector3i | null,
    public programId: number,
  ) {}

  static fromTag(tag: Tag): SimulationGroup {
    const s = tag.getStruct().filter(t => t.type !== TagType.FINISH);
    const version     = s[0]?.type === TagType.BYTE    ? s[0].getByte()     : 0;
    const type        = s[1]?.type === TagType.INT     ? s[1].getInt()      : 0;
    const members: string[] = [];
    if (s[2]?.type === TagType.STRUCT) {
      for (const m of s[2].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (m.type === TagType.STRING) members.push(m.getString());
      }
    }
    const startTime   = s[3]?.type === TagType.LONG     ? s[3].getLong()     : 0n;
    const startSector = s[4]?.type === TagType.VECTOR3i ? s[4].getVector3i() : null;
    const programId   = s[5]?.type === TagType.INT      ? s[5].getInt()      : 0;
    return new SimulationGroup(version, type, members, startTime, startSector, programId);
  }

  toTag(): Tag {
    const memberTags = [...this.members.map(m => Tags.string(null, m)), FINISH_TAG];
    const children: Tag[] = [
      Tags.byte(null, this.version),
      Tags.int(null, this.type),
      new Tag(TagType.STRUCT, null, memberTags),
      Tags.long(null, this.startTime),
    ];
    if (this.startSector) {
      children.push(Tags.vector3i(null, this.startSector.x, this.startSector.y, this.startSector.z));
    }
    children.push(Tags.int(null, this.programId));
    return Tags.struct(null, children);
  }

  toString(): string {
    return `SimulationGroup(type=${this.type}, members=${this.members.length}, sector=${JSON.stringify(this.startSector)})`;
  }
}

// ── NPCFactionManager ─────────────────────────────────────────────────────────

export class NPCFactionManager {
  constructor(
    /** File format version (always 0 in current StarMade). */
    public version: number,
  ) {}

  // ── Serialization ─────────────────────────────────────────────────────────

  static fromTag(root: Tag): NPCFactionManager {
    if (root.type !== TagType.STRUCT) throw new TypeError('NPCFactionManager: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    return new NPCFactionManager(version);
  }

  toTag(): Tag {
    return Tags.struct(null, [Tags.byte(null, this.version)]);
  }

  /** Encodes to binary for NPCFACTIONS_*.tag. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  static fromBuffer(data: Buffer | Uint8Array): NPCFactionManager {
    return NPCFactionManager.fromTag(readFrom(data));
  }

  toString(): string { return `NPCFactionManager(v${this.version})`; }
}

// ── SimulationState ────────────────────────────────────────────────────────────

export class SimulationState {
  constructor(
    public version: number,
    public groups: SimulationGroup[],
    public lastUpdate: bigint,
  ) {}

  // ── Updates ──────────────────────────────────────────────────────────

  addGroup(group: SimulationGroup): SimulationState {
    return new SimulationState(this.version, [...this.groups, group], this.lastUpdate);
  }

  removeGroup(idx: number): SimulationState {
    return new SimulationState(this.version, this.groups.filter((_, i) => i !== idx), this.lastUpdate);
  }

  withLastUpdate(ts: bigint): SimulationState {
    return new SimulationState(this.version, this.groups, ts);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  static fromTag(root: Tag): SimulationState {
    if (root.type !== TagType.STRUCT) throw new TypeError('SimulationState: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const version    = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    const lastUpdate = s[2]?.type === TagType.LONG ? s[2].getLong() : 0n;
    const groups: SimulationGroup[] = [];
    if (s[1]?.type === TagType.STRUCT) {
      for (const g of s[1].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (g.type === TagType.STRUCT) {
          try { groups.push(SimulationGroup.fromTag(g)); } catch { /* skip malformed */ }
        }
      }
    }
    return new SimulationState(version, groups, lastUpdate);
  }

  toTag(): Tag {
    const groupTags = [...this.groups.map(g => g.toTag()), FINISH_TAG];
    return Tags.struct('SimulationState', [
      Tags.byte(null, this.version),
      new Tag(TagType.STRUCT, null, groupTags),
      Tags.long(null, this.lastUpdate),
    ]);
  }

  /** Encodes to binary for SIMULATION_STATE.sim. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  static fromBuffer(data: Buffer | Uint8Array): SimulationState {
    return SimulationState.fromTag(readFrom(data));
  }

  toString(): string {
    return `SimulationState(v${this.version}, ${this.groups.length} groups, lastUpdate=${this.lastUpdate})`;
  }
}
