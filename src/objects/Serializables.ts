/**
 * @fileoverview Serializables
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Serializable objects — business objects for the 7 StarMade SERIALIZABLE types.
 *
 * Each class :
 *  - fromRaw(raw: Uint8Array)   → parses raw RawElement bytes
 *  - toRaw(): Uint8Array        → re-encodes to raw bytes
 *  - toRawElement(): RawElement → ready to insert into a SERIALIZABLE Tag
 *
 * Factory IDs :
 *   0 = ControlElementMapper  (links between controller and controlled blocks)
 *   1 = ElementCountMap        (block counts by type)
 *   2 = NPCFactionNewsEvent    (NPC faction news event)
 *   3 = LongSet                (ensemble de positions/identifiants long)
 *   4 = BlockBuffer            (copied/pasted block buffer)
 *   5 = Long2Vector3fMap       (map long→Vector3f, for example rail positions)
 *   6 = Long2TransformMap      (map long→Transform, for example rail orientations)
 *
 * Source: ControlElementMapper.java, ElementCountMap.java,
 *          NPCFactionNewsEvent*.java, TagSerializable*.java,
 *          BlockBuffer.java, TransformTools.java
 */

import { BufferReader } from '../core/BufferReader.js';
import { BufferWriter } from '../core/BufferWriter.js';
import { RawElement } from '../serializable/Factories.js';
import { posToIndex, indexToPos } from './ElementPosition.js';
import type { BlockPosition } from './ElementPosition.js';

// ── Encoding/decoding helpers ───────────────────────────────────────────────

/**
 * Handles the rawReader operation used by high-level StarMade object modelling.
 *
 * @param raw - Input value for the rawReader operation.
 * @returns The computed StarMade-Decoder value.
 */
function rawReader(raw: Uint8Array): BufferReader {
  return BufferReader.from(Buffer.from(raw));
}

/**
 * Builds Raw for high-level StarMade object modelling.
 *
 * @param fn - Input value for the makeRaw operation.
 * @returns The computed StarMade-Decoder value.
 */
function makeRaw(fn: (w: BufferWriter) => void): Uint8Array {
  const w = new BufferWriter();
  fn(w);
  return new Uint8Array(w.toBuffer());
}

// ── 0 : ControlElementMapper ──────────────────────────────────────────────────

/**
 * Describes the ControlLink data shape used by high-level StarMade object modelling.
 */
export interface ControlLink {
  /** Controller block position (x, y, z en short) */
  from: BlockPosition;
  /** Controlled block type */
  type: number;
  /** Controlled block positions */
  targets: BlockPosition[];
}

/**
 * ControlElementMapper — controller-to-block connection map.
 * Example: cockpit → engines, weapon → targeting computer.
 *
 * Format serializeForDisk :
 *   int header (= -(1024+2) = -1026)
 *   int keySize
 *   keySize × (3×short pos + int valueSize × (short type + int elemSize + elemSize×3×short))
 */
export class ControlElementMapper {
  static readonly FACTORY_ID = 0;
  static readonly DISK_HEADER = -(1024 + 2); // -1026

  /**
   * Creates a ControlElementMapper instance.
   *
   * @param links - Input value for the constructor operation.
   */
  constructor(public links: ControlLink[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): ControlElementMapper {
    const r = rawReader(raw);
    const links: ControlLink[] = [];
    if (r.isEOF()) return new ControlElementMapper(links);

    const header = r.readInt32BE();
    if (header >= 0) return new ControlElementMapper(links); // unsupported network format
    const isDisk = -header > 1024;
    const keySize = r.readInt32BE();

    for (let i = 0; i < keySize; i++) {
      const fx = r.readInt16BE(), fy = r.readInt16BE(), fz = r.readInt16BE();
      const from: BlockPosition = { x: fx, y: fy, z: fz };
      const valueSize = r.readInt32BE();
      for (let v = 0; v < valueSize; v++) {
        const type = r.readInt16BE();
        const elemSize = r.readInt32BE();
        const targets: BlockPosition[] = [];
        if (isDisk) {
          for (let e = 0; e < elemSize; e++) {
            targets.push({ x: r.readInt16BE(), y: r.readInt16BE(), z: r.readInt16BE() });
          }
        } else {
          const bigX = r.readInt8() !== 0, bigY = r.readInt8() !== 0, bigZ = r.readInt8() !== 0;
          const mx = r.readInt16BE(), my = r.readInt16BE(), mz = r.readInt16BE();
          for (let e = 0; e < elemSize; e++) {
            targets.push({
              x: (bigX ? r.readInt16BE() : r.readInt8()) + mx,
              y: (bigY ? r.readInt16BE() : r.readInt8()) + my,
              z: (bigZ ? r.readInt16BE() : r.readInt8()) + mz,
            });
          }
        }
        links.push({ from, type, targets });
      }
    }
    return new ControlElementMapper(links);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    // Group by controller position
    const byFrom = new Map<string, ControlLink[]>();
    for (const link of this.links) {
      const key = `${link.from.x},${link.from.y},${link.from.z}`;
      if (!byFrom.has(key)) byFrom.set(key, []);
      byFrom.get(key)!.push(link);
    }

    return makeRaw(w => {
      w.writeInt32BE(ControlElementMapper.DISK_HEADER);
      w.writeInt32BE(byFrom.size);
      for (const links of byFrom.values()) {
        w.writeInt16BE(links[0].from.x);
        w.writeInt16BE(links[0].from.y);
        w.writeInt16BE(links[0].from.z);
        w.writeInt32BE(links.length);
        for (const link of links) {
          w.writeInt16BE(link.type);
          w.writeInt32BE(link.targets.length);
          for (const t of link.targets) {
            w.writeInt16BE(t.x); w.writeInt16BE(t.y); w.writeInt16BE(t.z);
          }
        }
      }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement {
    return new RawElement(ControlElementMapper.FACTORY_ID, this.toRaw());
  }

  /** Adds a controller → block connection. */
  addLink(from: BlockPosition, type: number, target: BlockPosition): ControlElementMapper {
    return new ControlElementMapper([...this.links, { from, type, targets: [target] }]);
  }

  /** Removes all connections from a given controller. */
  removeFrom(from: BlockPosition): ControlElementMapper {
    return new ControlElementMapper(
      this.links.filter(l => l.from.x !== from.x || l.from.y !== from.y || l.from.z !== from.z)
    );
  }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `ControlElementMapper(${this.links.length} links)`; }
}

// ── 1 : ElementCountMap ───────────────────────────────────────────────────────

/**
 * Describes the BlockCount data shape used by high-level StarMade object modelling.
 */
export interface BlockCount { type: number; count: number; }

/**
 * ElementCountMap — block count by type (for statistics and price).
 *
 * Format: int existingTypeCount + (short type + int count)×
 */
export class ElementCountMap {
  static readonly FACTORY_ID = 1;

  /**
   * Creates a ElementCountMap instance.
   *
   * @param counts - Input value for the constructor operation.
   */
  constructor(public counts: BlockCount[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): ElementCountMap {
    const r = rawReader(raw);
    const counts: BlockCount[] = [];
    if (r.isEOF()) return new ElementCountMap(counts);
    const size = r.readInt32BE();
    for (let i = 0; i < size && !r.isEOF(); i++) {
      counts.push({ type: r.readInt16BE(), count: r.readInt32BE() });
    }
    return new ElementCountMap(counts);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    const nonZero = this.counts.filter(c => c.count > 0);
    return makeRaw(w => {
      w.writeInt32BE(nonZero.length);
      for (const c of nonZero) { w.writeInt16BE(c.type); w.writeInt32BE(c.count); }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(ElementCountMap.FACTORY_ID, this.toRaw()); }

  /**
   * Converts this value to talBlocks.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get totalBlocks(): number { return this.counts.reduce((s, c) => s + c.count, 0); }

  /**
   * Returns Count.
   *
   * @param type - Input value for the getCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  getCount(type: number): number { return this.counts.find(c => c.type === type)?.count ?? 0; }

  /**
   * Stores Count.
   *
   * @param type - Input value for the setCount operation.
   * @param count - Input value for the setCount operation.
   * @returns The computed StarMade-Decoder value.
   */
  setCount(type: number, count: number): ElementCountMap {
    const existing = this.counts.filter(c => c.type !== type);
    return new ElementCountMap(count > 0 ? [...existing, { type, count }] : existing);
  }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `ElementCountMap(${this.counts.length} types, ${this.totalBlocks} total)`; }
}

// ── 2 : NPCFactionNewsEvent ───────────────────────────────────────────────────

/**
 * Defines the NPCEventType type used by high-level StarMade object modelling.
 */
export type NPCEventType = 'GROWN' | 'WAR' | 'PEACE' | 'ALLIES' | 'TRADING' | 'LOST_STATION' | 'LOST_TERRITORY';
/**
 * Defines NPC_EVENT_TYPES for high-level StarMade object modelling.
 */
const NPC_EVENT_TYPES: NPCEventType[] = ['GROWN', 'WAR', 'PEACE', 'ALLIES', 'TRADING', 'LOST_STATION', 'LOST_TERRITORY'];

/**
 * NPCFactionNewsEvent — NPC faction news.
 *
 * Format: byte eventType + int64 time + int32 factionId + extra data by type :
 *   GROWN(0), LOST_TERRITORY(6) → +Vector3i system (3×int32)
 *   ALLIES(3), LOST_STATION(5) → +UTF otherEnt
 *   WAR(1), PEACE(2), TRADING(4) → no extra data
 */
export class NPCFactionNewsEvent {
  static readonly FACTORY_ID = 2;

  /**
   * Creates a NPCFactionNewsEvent instance.
   *
   * @param eventType - Input value for the constructor operation.
   * @param time - Input value for the constructor operation.
   * @param factionId - Input value for the constructor operation.
   * @param system - Input value for the constructor operation.
   * @param otherEnt - Input value for the constructor operation.
   */
  constructor(
    public eventType: NPCEventType,
    public time: bigint,
    public factionId: number,
    /** For GROWN and LOST_TERRITORY */
    public system?: BlockPosition,
    /** For ALLIES and LOST_STATION */
    public otherEnt?: string,
  ) {}

  /**
   * Handles the eventTypeName operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get eventTypeName(): NPCEventType { return this.eventType; }

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): NPCFactionNewsEvent {
    const r = rawReader(raw);
    const typeIdx = r.readUInt8();
    const time = r.readInt64BE();
    const factionId = r.readInt32BE();
    const eventType = NPC_EVENT_TYPES[typeIdx] ?? 'TRADING';

    let system: BlockPosition | undefined;
    let otherEnt: string | undefined;

    switch (typeIdx) {
      case 0: case 6: // GROWN, LOST_TERRITORY → Vector3i
        system = { x: r.readInt32BE(), y: r.readInt32BE(), z: r.readInt32BE() };
        break;
      case 3: case 5: // ALLIES, LOST_STATION → UTF
        otherEnt = r.readJavaUTF();
        break;
    }

    return new NPCFactionNewsEvent(eventType, time, factionId, system, otherEnt);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    const typeIdx = NPC_EVENT_TYPES.indexOf(this.eventType);
    return makeRaw(w => {
      w.writeUInt8(typeIdx >= 0 ? typeIdx : 4);
      w.writeInt64BE(this.time);
      w.writeInt32BE(this.factionId);
      if ((this.eventType === 'GROWN' || this.eventType === 'LOST_TERRITORY') && this.system) {
        w.writeInt32BE(this.system.x); w.writeInt32BE(this.system.y); w.writeInt32BE(this.system.z);
      } else if ((this.eventType === 'ALLIES' || this.eventType === 'LOST_STATION') && this.otherEnt) {
        w.writeJavaUTF(this.otherEnt);
      }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(NPCFactionNewsEvent.FACTORY_ID, this.toRaw()); }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() {
    return `NPCFactionNewsEvent(${this.eventType}, faction=${this.factionId}, time=${this.time})`;
  }
}

// ── 3 : LongSet ───────────────────────────────────────────────────────────────

/**
 * LongSet — set of positions/identifiers encoded as 48-bit longs.
 *
 * Format: int size + int64×size
 */
export class LongSet {
  static readonly FACTORY_ID = 3;

  /**
   * Creates a LongSet instance.
   *
   * @param values - Input value for the constructor operation.
   */
  constructor(public values: bigint[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): LongSet {
    const r = rawReader(raw);
    if (r.isEOF()) return new LongSet([]);
    const size = r.readInt32BE();
    const values: bigint[] = [];
    for (let i = 0; i < size && !r.isEOF(); i++) values.push(r.readInt64BE());
    return new LongSet(values);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    return makeRaw(w => {
      w.writeInt32BE(this.values.length);
      for (const v of this.values) w.writeInt64BE(v);
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(LongSet.FACTORY_ID, this.toRaw()); }

  /** Positions decoded from long indexes. */
  get positions(): BlockPosition[] { return this.values.map(indexToPos); }

  /**
   * Reports whether has is true for the current value.
   *
   * @param index - Input value for the has operation.
   * @returns The computed StarMade-Decoder value.
   */
  has(index: bigint): boolean { return this.values.includes(index); }
  /**
   * Handles the add operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the add operation.
   * @returns The computed StarMade-Decoder value.
   */
  add(index: bigint): LongSet { return new LongSet([...this.values, index]); }
  /**
   * Handles the addPos operation used by high-level StarMade object modelling.
   *
   * @param x - Input value for the addPos operation.
   * @param y - Input value for the addPos operation.
   * @param z - Input value for the addPos operation.
   * @returns The computed StarMade-Decoder value.
   */
  addPos(x: number, y: number, z: number): LongSet { return this.add(posToIndex(x, y, z)); }
  /**
   * Handles the remove operation used by high-level StarMade object modelling.
   *
   * @param index - Input value for the remove operation.
   * @returns The computed StarMade-Decoder value.
   */
  remove(index: bigint): LongSet { return new LongSet(this.values.filter(v => v !== index)); }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `LongSet(${this.values.length} entries)`; }
}

// ── 4 : BlockBuffer ───────────────────────────────────────────────────────────

/**
 * Describes the BufferedBlock data shape used by high-level StarMade object modelling.
 */
export interface BufferedBlock {
  x: number; y: number; z: number;
  data: number;
  hasMeta: boolean;
  controllerPos?: bigint;
  connectedFrom?: bigint[];
}

/**
 * BlockBuffer — block buffer (copy/paste in-game).
 *
 * Format:
 *   int size + int controllerSize + int conSize
 *   size × (3×short pos + int data + boolean meta
 *            + [si meta] long ctrlPos + int mSize + mSize×long connected)
 */
export class BlockBuffer {
  static readonly FACTORY_ID = 4;

  /**
   * Creates a BlockBuffer instance.
   *
   * @param blocks - Input value for the constructor operation.
   */
  constructor(public blocks: BufferedBlock[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): BlockBuffer {
    const r = rawReader(raw);
    if (r.isEOF()) return new BlockBuffer([]);
    const size = r.readInt32BE();
    r.readInt32BE(); // controllerSize (recomputed)
    r.readInt32BE(); // conSize (recomputed)
    const blocks: BufferedBlock[] = [];

    for (let i = 0; i < size; i++) {
      const x = r.readInt16BE(), y = r.readInt16BE(), z = r.readInt16BE();
      const data = r.readInt32BE();
      const hasMeta = r.readInt8() !== 0;
      const block: BufferedBlock = { x, y, z, data, hasMeta };
      if (hasMeta) {
        block.controllerPos = r.readInt64BE();
        const mSize = r.readInt32BE();
        block.connectedFrom = [];
        for (let j = 0; j < mSize; j++) block.connectedFrom.push(r.readInt64BE());
      }
      blocks.push(block);
    }
    return new BlockBuffer(blocks);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    const metaBlocks = this.blocks.filter(b => b.hasMeta);
    const conSize = metaBlocks.reduce((s, b) => s + (b.connectedFrom?.length ?? 0) + 1, 0);
    return makeRaw(w => {
      w.writeInt32BE(this.blocks.length);
      w.writeInt32BE(metaBlocks.length);
      w.writeInt32BE(conSize);
      for (const b of this.blocks) {
        w.writeInt16BE(b.x); w.writeInt16BE(b.y); w.writeInt16BE(b.z);
        w.writeInt32BE(b.data);
        w.writeInt8(b.hasMeta ? 1 : 0);
        if (b.hasMeta) {
          w.writeInt64BE(b.controllerPos ?? 0n);
          const connected = b.connectedFrom ?? [];
          w.writeInt32BE(connected.length);
          for (const c of connected) w.writeInt64BE(c);
        }
      }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(BlockBuffer.FACTORY_ID, this.toRaw()); }
  /**
   * Handles the blockCount operation used by high-level StarMade object modelling.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get blockCount(): number { return this.blocks.length; }
  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `BlockBuffer(${this.blocks.length} blocks)`; }
}

// ── 5 : Long2Vector3fMap ──────────────────────────────────────────────────────

/**
 * Describes the Vec3fEntry data shape used by high-level StarMade object modelling.
 */
export interface Vec3fEntry { key: bigint; x: number; y: number; z: number; }

/**
 * Long2Vector3fMap — map long→Vector3f (rail positions, etc.)
 *
 * Format: int size + (int64 key + 3×float32)×size
 */
export class Long2Vector3fMap {
  static readonly FACTORY_ID = 5;

  /**
   * Creates a Long2Vector3fMap instance.
   *
   * @param entries - Input value for the constructor operation.
   */
  constructor(public entries: Vec3fEntry[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): Long2Vector3fMap {
    const r = rawReader(raw);
    if (r.isEOF()) return new Long2Vector3fMap([]);
    const size = r.readInt32BE();
    const entries: Vec3fEntry[] = [];
    for (let i = 0; i < size && !r.isEOF(); i++) {
      entries.push({ key: r.readInt64BE(), x: r.readFloat32BE(), y: r.readFloat32BE(), z: r.readFloat32BE() });
    }
    return new Long2Vector3fMap(entries);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    return makeRaw(w => {
      w.writeInt32BE(this.entries.length);
      for (const e of this.entries) {
        w.writeInt64BE(e.key); w.writeFloat32BE(e.x); w.writeFloat32BE(e.y); w.writeFloat32BE(e.z);
      }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(Long2Vector3fMap.FACTORY_ID, this.toRaw()); }

  /**
   * Returns the requested value.
   *
   * @param key - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(key: bigint): Vec3fEntry | undefined { return this.entries.find(e => e.key === key); }
  /**
   * Stores the requested value.
   *
   * @param key - Input value for the set operation.
   * @param x - Input value for the set operation.
   * @param y - Input value for the set operation.
   * @param z - Input value for the set operation.
   * @returns The computed StarMade-Decoder value.
   */
  set(key: bigint, x: number, y: number, z: number): Long2Vector3fMap {
    const filtered = this.entries.filter(e => e.key !== key);
    return new Long2Vector3fMap([...filtered, { key, x, y, z }]);
  }
  /**
   * Handles the delete operation used by high-level StarMade object modelling.
   *
   * @param key - Input value for the delete operation.
   * @returns The computed StarMade-Decoder value.
   */
  delete(key: bigint): Long2Vector3fMap { return new Long2Vector3fMap(this.entries.filter(e => e.key !== key)); }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `Long2Vector3fMap(${this.entries.length} entries)`; }
}

// ── 6 : Long2TransformMap ─────────────────────────────────────────────────────

/**
 * Describes the Transform data shape used by high-level StarMade object modelling.
 */
export interface Transform {
  /** Origine (position) */
  originX: number; originY: number; originZ: number;
  /** Matrice de rotation 3x3 (row-major : m00..m22) */
  m00: number; m01: number; m02: number;
  m10: number; m11: number; m12: number;
  m20: number; m21: number; m22: number;
}

/**
 * Describes the TransformEntry data shape used by high-level StarMade object modelling.
 */
export interface TransformEntry { key: bigint; transform: Transform; }

/**
 * Long2TransformMap — map long→Transform (rail orientationss, etc.)
 *
 * Format: int size + (int64 key + TransformTools.serializeFully)×size
 * TransformTools.serializeFully : 3×float origin + 9×float Matrix3f
 */
export class Long2TransformMap {
  static readonly FACTORY_ID = 6;

  /**
   * Creates a Long2TransformMap instance.
   *
   * @param entries - Input value for the constructor operation.
   */
  constructor(public entries: TransformEntry[]) {}

  /**
   * Creates a value from Raw.
   *
   * @param raw - Input value for the fromRaw operation.
   * @returns The computed StarMade-Decoder value.
   */
  static fromRaw(raw: Uint8Array): Long2TransformMap {
    const r = rawReader(raw);
    if (r.isEOF()) return new Long2TransformMap([]);
    const size = r.readInt32BE();
    const entries: TransformEntry[] = [];
    for (let i = 0; i < size && !r.isEOF(); i++) {
      const key = r.readInt64BE();
      const originX = r.readFloat32BE(), originY = r.readFloat32BE(), originZ = r.readFloat32BE();
      const m00 = r.readFloat32BE(), m01 = r.readFloat32BE(), m02 = r.readFloat32BE();
      const m10 = r.readFloat32BE(), m11 = r.readFloat32BE(), m12 = r.readFloat32BE();
      const m20 = r.readFloat32BE(), m21 = r.readFloat32BE(), m22 = r.readFloat32BE();
      entries.push({ key, transform: { originX, originY, originZ, m00, m01, m02, m10, m11, m12, m20, m21, m22 } });
    }
    return new Long2TransformMap(entries);
  }

  /**
   * Converts this value to Raw.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRaw(): Uint8Array {
    return makeRaw(w => {
      w.writeInt32BE(this.entries.length);
      for (const e of this.entries) {
        const t = e.transform;
        w.writeInt64BE(e.key);
        w.writeFloat32BE(t.originX); w.writeFloat32BE(t.originY); w.writeFloat32BE(t.originZ);
        w.writeFloat32BE(t.m00); w.writeFloat32BE(t.m01); w.writeFloat32BE(t.m02);
        w.writeFloat32BE(t.m10); w.writeFloat32BE(t.m11); w.writeFloat32BE(t.m12);
        w.writeFloat32BE(t.m20); w.writeFloat32BE(t.m21); w.writeFloat32BE(t.m22);
      }
    });
  }

  /**
   * Converts this value to RawElement.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toRawElement(): RawElement { return new RawElement(Long2TransformMap.FACTORY_ID, this.toRaw()); }

  /**
   * Returns the requested value.
   *
   * @param key - Input value for the get operation.
   * @returns The computed StarMade-Decoder value.
   */
  get(key: bigint): TransformEntry | undefined { return this.entries.find(e => e.key === key); }
  /**
   * Stores the requested value.
   *
   * @param key - Input value for the set operation.
   * @param transform - Input value for the set operation.
   * @returns The computed StarMade-Decoder value.
   */
  set(key: bigint, transform: Transform): Long2TransformMap {
    const filtered = this.entries.filter(e => e.key !== key);
    return new Long2TransformMap([...filtered, { key, transform }]);
  }
  /**
   * Handles the delete operation used by high-level StarMade object modelling.
   *
   * @param key - Input value for the delete operation.
   * @returns The computed StarMade-Decoder value.
   */
  delete(key: bigint): Long2TransformMap { return new Long2TransformMap(this.entries.filter(e => e.key !== key)); }

  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `Long2TransformMap(${this.entries.length} entries)`; }
}

// ── Helper: decode a RawElement into the matching class ───────────────────────

/**
 * Decodes a RawElement into the matching business object.
 */
export function decodeSerializable(elem: RawElement): ControlElementMapper | ElementCountMap | NPCFactionNewsEvent | LongSet | BlockBuffer | Long2Vector3fMap | Long2TransformMap | RawElement {
  switch (elem.factoryId) {
    case 0: return ControlElementMapper.fromRaw(elem.raw);
    case 1: return ElementCountMap.fromRaw(elem.raw);
    case 2: return NPCFactionNewsEvent.fromRaw(elem.raw);
    case 3: return LongSet.fromRaw(elem.raw);
    case 4: return BlockBuffer.fromRaw(elem.raw);
    case 5: return Long2Vector3fMap.fromRaw(elem.raw);
    case 6: return Long2TransformMap.fromRaw(elem.raw);
    default: return elem;
  }
}
