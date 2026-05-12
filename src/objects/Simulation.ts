/**
 * @fileoverview Simulation
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * NPCFactions — business object for NPCFACTIONS_0_0_0.tag
 *
 * Structure (NPCFactionManager.toTagStructure) :
 *   STRUCT [
 *     BYTE  version
 *     FINISH
 *   ]
 *
 * SimulationGroup structure (SimulationGroup.toTagStructure):
 *   STRUCT [
 *     BYTE    version
 *     INT     type
 *     STRUCT  members — STRING list
 *     LONG    startTime
 *     VECTOR3i startSector
 *     INT     programId
 *     FINISH
 *   ]
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { FINISH_TAG } from '../core/Tag.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import type { Vector3i } from '../types/Vectors.js';

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
    const version   = s[0]?.type === TagType.BYTE    ? s[0].getByte()     : 0;
    const type      = s[1]?.type === TagType.INT     ? s[1].getInt()      : 0;
    const members: string[] = [];
    if (s[2]?.type === TagType.STRUCT) {
      for (const m of s[2].getStruct().filter(t => t.type !== TagType.FINISH)) {
        if (m.type === TagType.STRING) members.push(m.getString());
      }
    }
    const startTime  = s[3]?.type === TagType.LONG     ? s[3].getLong()     : 0n;
    const startSector = s[4]?.type === TagType.VECTOR3i ? s[4].getVector3i() : null;
    const programId  = s[5]?.type === TagType.INT      ? s[5].getInt()      : 0;

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

export class NPCFactionManager {
  constructor(
    public version: number,
    private _rootTag: Tag,
  ) {}

  static fromTag(root: Tag): NPCFactionManager {
    if (root.type !== TagType.STRUCT) throw new TypeError('NPCFactionManager: expected STRUCT');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const version = s[0]?.type === TagType.BYTE ? s[0].getByte() : 0;
    return new NPCFactionManager(version, root);
  }

  toTag(): Tag { return this._rootTag; }

  /** Encodes to binary for NPCFACTIONS_*.tag. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  static fromBuffer(data: Buffer | Uint8Array): NPCFactionManager {
    return NPCFactionManager.fromTag(readFrom(data));
  }

  toString(): string { return `NPCFactionManager(v${this.version})`; }
}

/**
 * SimulationState — business object for SIMULATION_STATE.sim
 *
 * Structure (SimulationManager.toTagStructure) :
 *   STRUCT "SimulationState" [
 *     BYTE    version
 *     STRUCT  groups — SimulationGroup list
 *     LONG    lastUpdate
 *     FINISH
 *   ]
 */
export class SimulationState {
  constructor(
    public version: number,
    public groups: SimulationGroup[],
    public lastUpdate: bigint,
    private _rootTag: Tag,
  ) {}

  // ── Updates ──────────────────────────────────────────────────────────

  addGroup(group: SimulationGroup): SimulationState {
    return SimulationState.fromTag(this._rebuild([...this.groups, group]));
  }

  removeGroup(idx: number): SimulationState {
    return SimulationState.fromTag(this._rebuild(this.groups.filter((_, i) => i !== idx)));
  }

  private _rebuild(groups: SimulationGroup[]): Tag {
    const groupTags = [...groups.map(g => g.toTag()), FINISH_TAG];
    return Tags.struct('SimulationState', [
      Tags.byte(null, this.version),
      new Tag(TagType.STRUCT, null, groupTags),
      Tags.long(null, this.lastUpdate),
    ]);
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
          try { groups.push(SimulationGroup.fromTag(g)); } catch { /* skip */ }
        }
      }
    }

    return new SimulationState(version, groups, lastUpdate, root);
  }

  toTag(): Tag { return this._rebuild(this.groups); }

  /** Encodes to binary for SIMULATION_STATE.sim. */
  toBuffer(): Buffer { return writeTo(this.toTag()); }

  static fromBuffer(data: Buffer | Uint8Array): SimulationState {
    return SimulationState.fromTag(readFrom(data));
  }

  toString(): string {
    return `SimulationState(v${this.version}, ${this.groups.length} groups, lastUpdate=${this.lastUpdate})`;
  }
}
