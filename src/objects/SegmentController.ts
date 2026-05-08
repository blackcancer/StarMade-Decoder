/**
 * @fileoverview Segment Controller
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SegmentControllerObject — business object for Ship, SpaceStation, Shop
 * (ENTITY_SHIP_*.ent, ENTITY_SPACESTATION_*.ent, ENTITY_SHOP_*.ent)
 *
 * Source: SegmentController.fromTagStructure() Java
 * Provides business-object access to SERIALIZABLE values (ControlElementMapper, etc.)
 */

import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { readFrom, writeTo } from '../core/TagParser.js';
import { RawElement } from '../serializable/Factories.js';
import { ControlElementMapper, ElementCountMap, Long2Vector3fMap, Long2TransformMap, decodeSerializable } from './Serializables.js';
import type { Vector3i } from '../types/Vectors.js';
import type { Matrix4f } from '../types/Matrices.js';

export class SegmentControllerObject {
  constructor(
    public uniqueId: string,
    public realName: string,
    public minPos: Vector3i | null,
    public maxPos: Vector3i | null,
    public factionCode: number,
    public owner: string,
    public sectorPosition: Vector3i | null,
    public transform: Matrix4f | null,
    public creatorId: number,
    public spawner: string,
    public lastModifier: string,
    public seed: bigint,
    public nonEmptySegments: number,
    private _rootTag: Tag,
  ) {}

  // ── Business-object SERIALIZABLE accessors ──────────────────────────────

  private _findSerializables(): Tag[] {
    const results: Tag[] = [];
    const walk = (tag: Tag) => {
      if (tag.type === TagType.SERIALIZABLE) results.push(tag);
      if (tag.type === TagType.STRUCT || tag.type === TagType.LIST) {
        (tag.value as Tag[]).forEach(walk);
      }
    };
    walk(this._rootTag);
    return results;
  }

  /** Returns the ControlElementMapper (block connections) when present. */
  get controlElementMapper(): ControlElementMapper | null {
    const ser = this._findSerializables().find(t => (t.value as RawElement).factoryId === 0);
    return ser ? ControlElementMapper.fromRaw((ser.value as RawElement).raw) : null;
  }

  /** Returns the ElementCountMap (block counts) when present. */
  get elementCountMap(): ElementCountMap | null {
    const ser = this._findSerializables().find(t => (t.value as RawElement).factoryId === 1);
    return ser ? ElementCountMap.fromRaw((ser.value as RawElement).raw) : null;
  }

  /** Returns all Long2Vector3fMap values (rail positions). */
  get long2Vector3fMaps(): Long2Vector3fMap[] {
    return this._findSerializables()
      .filter(t => (t.value as RawElement).factoryId === 5)
      .map(t => Long2Vector3fMap.fromRaw((t.value as RawElement).raw));
  }

  /** Returns all Long2TransformMap values (rail orientations). */
  get long2TransformMaps(): Long2TransformMap[] {
    return this._findSerializables()
      .filter(t => (t.value as RawElement).factoryId === 6)
      .map(t => Long2TransformMap.fromRaw((t.value as RawElement).raw));
  }

  // ── Updates ──────────────────────────────────────────────────────────

  withName(name: string): SegmentControllerObject {
    return SegmentControllerObject.fromTag(Tags.setField(this._rootTag, 'uniqueId', Tags.string('uniqueId', name)));
  }

  withRealName(name: string): SegmentControllerObject {
    return SegmentControllerObject.fromTag(Tags.setField(this._rootTag, 'realName', Tags.string('realName', name)));
  }

  withFactionCode(code: number): SegmentControllerObject {
    let tag = this._rootTag;
    // factionCode is in the child struct "transformable" at index [4]
    const transformable = this._findTransformable();
    if (transformable) {
      const s = transformable.getStruct().filter(t => t.type !== TagType.FINISH);
      const newChildren = [...s];
      if (newChildren[4]?.type === TagType.INT) newChildren[4] = Tags.int(newChildren[4].name, code);
      const newTransformable = new Tag(TagType.STRUCT, transformable.name,
        [...newChildren, ...(newChildren.at(-1)?.type === TagType.FINISH ? [] : [])]);
      tag = Tags.setField(tag, 'transformable', newTransformable);
    }
    return SegmentControllerObject.fromTag(tag);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  toTag(): Tag { return this._rootTag; }
  toBuffer(): Buffer { return writeTo(this._rootTag); }

  private _findTransformable(): Tag | null {
    const s = this._rootTag.type === TagType.STRUCT
      ? this._rootTag.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];
    return s[6]?.type === TagType.STRUCT ? s[6] : (s.find(t => t.name === 'transformable' && t.type === TagType.STRUCT) ?? null);
  }

  static fromTag(root: Tag): SegmentControllerObject {
    // Wrapper handling (Shop, SpaceStation)
    let sc = root;
    if (root.type === TagType.STRUCT) {
      const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
      if (!s.some(t => t.name === 'uniqueId') && s.some(t => t.type === TagType.STRUCT)) {
        for (const sub of s) {
          if (sub.type === TagType.STRUCT && sub.getStruct().some(t => t.name === 'uniqueId')) {
            sc = sub; break;
          }
        }
      }
    }

    const s = sc.type === TagType.STRUCT
      ? sc.getStruct().filter(t => t.type !== TagType.FINISH)
      : [];

    const uniqueId     = s.find(t => t.name === 'uniqueId')?.getString() ?? '';
    const realName     = s.find(t => t.name === 'realName')?.getString() ?? s[5]?.getString() ?? '';
    const minPos       = s.find(t => t.name === 'minPos')?.getVector3i() ?? (s[1]?.type === TagType.VECTOR3i ? s[1].getVector3i() : null);
    const maxPos       = s.find(t => t.name === 'maxPos')?.getVector3i() ?? (s[2]?.type === TagType.VECTOR3i ? s[2].getVector3i() : null);
    const creatorId    = s[8]?.type === TagType.INT    ? s[8].getInt()    : 0;
    const spawner      = s[9]?.type === TagType.STRING ? s[9].getString() : '';
    const lastModifier = s[10]?.type === TagType.STRING ? s[10].getString() : '';
    const seed         = s[11]?.type === TagType.LONG   ? s[11].getLong()   : 0n;
    const nonEmptySegs = s[20]?.type === TagType.INT    ? s[20].getInt()    : 0;

    let factionCode = 0, owner = '', sectorPosition: Vector3i | null = null, transform: Matrix4f | null = null;
    const tr = s[6]?.type === TagType.STRUCT ? s[6] : s.find(t => t.name === 'transformable' && t.type === TagType.STRUCT);
    if (tr) {
      const ts = tr.getStruct().filter(t => t.type !== TagType.FINISH);
      if (ts[1]?.type === TagType.MATRIX4f) transform      = ts[1].getMatrix4f();
      if (ts[3]?.type === TagType.VECTOR3i) sectorPosition = ts[3].getVector3i();
      if (ts[4]?.type === TagType.INT)      factionCode    = ts[4].getInt();
      if (ts[5]?.type === TagType.STRING)   owner          = ts[5].getString();
    }

    return new SegmentControllerObject(uniqueId, realName, minPos, maxPos,
      factionCode, owner, sectorPosition, transform, creatorId, spawner,
      lastModifier, seed, nonEmptySegs, root);
  }

  static fromBuffer(data: Buffer | Uint8Array): SegmentControllerObject {
    return SegmentControllerObject.fromTag(readFrom(data));
  }

  toString(): string {
    return `SegmentControllerObject(id="${this.uniqueId}", name="${this.realName}", sector=${JSON.stringify(this.sectorPosition)}, faction=${this.factionCode})`;
  }
}
