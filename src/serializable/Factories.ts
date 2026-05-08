/**
 * @fileoverview Factories
 *
 * Implements StarMade SERIALIZABLE tag factories and registration helpers for typed binary payloads.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * SERIALIZABLE factories — port of the StarMade Java factories.
 *
 * Automatic registration of all known factories.
 *
 * Implemented factories :
 *   1 = ELEMENT_COUNT_MAP       int size + (short type + int count)×
 *   2 = NPC_FACTION_NEWS_EVENT  byte eventType + long time + int factionId + extra
 *   3 = LONG_SET                int size + long×
 *   5 = LONG_2_VECTOR3f_MAP     int size + (long + 3×float32)×
 *   6 = LONG_2_TRANSFORM_MAP    int size + (long + Matrix3f + Vector3f)×
 *
 * Opaque factories (raw byte storage) :
 *   0 = CONTROL_ELEMENT_MAPPER  (complex compressed format)
 *   4 = BLOCK_BUFFER            (undocumented format)
 *
 * Java source: org.schema.schine.resource.tag.*Factory
 */

import type { BufferReader } from '../core/BufferReader.js';
import type { BufferWriter } from '../core/BufferWriter.js';
import type { SerializableTagFactory } from './SerializableTagFactory.js';
import type { SerializableTagElement } from './SerializableTagElement.js';
import { SerializableTagRegister } from './SerializableTagRegister.js';

// ── RawElement: stores raw bytes ───────────────────────────────────────

export class RawElement implements SerializableTagElement {
  constructor(public readonly factoryId: number, public readonly raw: Uint8Array) {}
  getFactoryId() { return this.factoryId; }
  writeToTag(w: BufferWriter) { w.writeBytes(this.raw); }
  toString() { return `RawElement(id=${this.factoryId}, ${this.raw.length}B)`; }
}

// ── SnapshotFactory: wraps a structured factory and preserves raw bytes ────

class SnapshotFactory implements SerializableTagFactory {
  constructor(
    private readonly factoryId: number,
    private readonly inner: { parse(reader: BufferReader): void }
  ) {}

  create(reader: BufferReader): RawElement {
    const start = reader.offset;
    this.inner.parse(reader);
    const raw = reader.snapshot(start, reader.offset);
    return new RawElement(this.factoryId, raw);
  }
}

// ── Factory 1 : ElementCountMap ───────────────────────────────────────────────
// int existingTypeCount + (short type + int count)×size

class ElementCountMapParser {
  parse(r: BufferReader) {
    const size = r.readInt32BE();
    for (let i = 0; i < size; i++) {
      r.readInt16BE(); // type
      r.readInt32BE(); // count
    }
  }
}

// ── Factory 2 : NPCFactionNewsEvent ──────────────────────────────────────────
// The Java factory reads: byte eventType + NPCFactionNewsEvent.deserialize(long time + int factionId) + extra data by type
// Subtypes (NPCFactionNewsEventType):
//   GROWN(0), WAR(1), ALLY(2?), TRADING, LOST_STATION, LOST_TERRITORY, NEUTRAL, OTHER_ENT, ROUTE, SYSTEM
// Base = long time + int factionId
// OtherEnt += long entityUid + String entityName
// Route += Vector3i from + Vector3i to  (3×int each)
// System += Vector3i system
// The remaining event types do not carry additional data

class NPCFactionNewsEventParser {
  parse(r: BufferReader) {
    const eventType = r.readUInt8();
    // base : long time + int factionId
    r.readInt64BE();  // time
    r.readInt32BE();  // factionId
    // NPCFactionNewsEventType hierarchy:
    //   GROWN(0)         → EventSystem → +Vector3i (3×int32)
    //   WAR(1)           → base only
    //   PEACE(2)         → base only
    //   ALLIES(3)        → OtherEnt  → +readUTF (String)
    //   TRADING(4)       → base only
    //   LOST_STATION(5)  → OtherEnt  → +readUTF (String)
    //   LOST_TERRITORY(6)→ EventSystem→ +Vector3i (3×int32)
    switch (eventType) {
      case 0: // GROWN → EventSystem
      case 6: // LOST_TERRITORY → EventSystem
        r.readInt32BE(); r.readInt32BE(); r.readInt32BE(); // Vector3i
        break;
      case 3: // ALLIES → OtherEnt
      case 5: // LOST_STATION → OtherEnt
        r.readJavaUTF(); // String otherEnt (readUTF)
        break;
      default:
        // WAR=1, PEACE=2, TRADING=4 — no extra data
        break;
    }
  }
}

// ── Factory 3 : LongSet ───────────────────────────────────────────────────────
// int size + long×size

class LongSetParser {
  parse(r: BufferReader) {
    const size = r.readInt32BE();
    for (let i = 0; i < size; i++) r.readInt64BE();
  }
}

// ── Factory 0 : ControlElementMapper ─────────────────────────────────────────
// Format serializeForDisk :
//   int header (= -(1024 + SERIALIZATION_VERSION) = -1026 for v2)
//   int keySize
//   for each key :
//     3×short(x,y,z) — writeIndexAsShortPos
//     int valueSize
//     for each value :
//       short type
//       int elemSize
//       elemSize × 3×short — writeIndexAsShortPos

class ControlElementMapperParser {
  parse(r: BufferReader) {
    const header = r.readInt32BE(); // negative
    if (header >= 0) {
      // Legacy/network format cannot be parsed safely without surrounding context
      throw new Error(`ControlElementMapper: unexpected positive header ${header}`);
    }
    const version = -header;
    const isDisk = version > 1024;
    const keySize = r.readInt32BE();
    for (let i = 0; i < keySize; i++) {
      r.readInt16BE(); r.readInt16BE(); r.readInt16BE(); // 3×short key position
      const valueSize = r.readInt32BE();
      for (let v = 0; v < valueSize; v++) {
        r.readInt16BE(); // short type
        const elemSize = r.readInt32BE();
        if (isDisk) {
          // serializeForDisk: 3×short per element (writeIndexAsShortPos)
          for (let e = 0; e < elemSize; e++) {
            r.readInt16BE(); r.readInt16BE(); r.readInt16BE();
          }
        } else {
          // Network format: boolean×3 + short×3 (median) + compressed coordinates
          const bigX = r.readInt8() !== 0;
          const bigY = r.readInt8() !== 0;
          const bigZ = r.readInt8() !== 0;
          r.readInt16BE(); r.readInt16BE(); r.readInt16BE(); // median
          for (let e = 0; e < elemSize; e++) {
            if (bigX) r.readInt16BE(); else r.readInt8();
            if (bigY) r.readInt16BE(); else r.readInt8();
            if (bigZ) r.readInt16BE(); else r.readInt8();
          }
        }
      }
    }
  }
}

// ── Factory 4 : BlockBuffer ──────────────────────────────────────────────────
// int size + int controllerSize + int conSize
// Then for each element:
//   3×short position + int data + boolean meta
//   si meta : long controller + int mSize + mSize×long connectedFromThis

class BlockBufferParser {
  parse(r: BufferReader) {
    const size = r.readInt32BE();
    const controllerSize = r.readInt32BE();
    const conSize = r.readInt32BE();
    let c = 0, conC = 0;
    for (let i = 0; i < size; i++) {
      r.readInt16BE(); r.readInt16BE(); r.readInt16BE(); // 3×short position
      r.readInt32BE(); // int data
      const meta = r.readInt8() !== 0; // boolean
      if (meta) {
        r.readInt64BE(); // long controller
        const mSize = r.readInt32BE();
        for (let j = 0; j < mSize; j++) {
          r.readInt64BE(); // long connectedFromThis
        }
        c++; conC += mSize + 1;
      }
    }
  }
}

// ── Factory 5 : Long2Vector3fMap ──────────────────────────────────────────────
// int size + (long key + 3×float32)×size

class Long2Vector3fMapParser {
  parse(r: BufferReader) {
    const size = r.readInt32BE();
    for (let i = 0; i < size; i++) {
      r.readInt64BE();      // key
      r.readFloat32BE(); r.readFloat32BE(); r.readFloat32BE(); // x, y, z
    }
  }
}

// ── Factory 6 : Long2TransformMap ─────────────────────────────────────────────
// TransformTools.serializeFully = Matrix3f (9 floats) + Vector3f (3 floats) = 48 bytes
// int size + (long key + 12×float32)×size

class Long2TransformMapParser {
  parse(r: BufferReader) {
    const size = r.readInt32BE();
    for (let i = 0; i < size; i++) {
      r.readInt64BE(); // key
      // Matrix3f : 9 floats
      for (let m = 0; m < 9; m++) r.readFloat32BE();
      // Vector3f origin : 3 floats
      for (let o = 0; o < 3; o++) r.readFloat32BE();
    }
  }
}

// ── Enregistrement ────────────────────────────────────────────────────────────

/**
 * Registers all factories in the global registry.
 * Must be called **before** invoking `readFrom()` on files
 * containing SERIALIZABLE values.
 */
export function registerAllFactories(): void {
  SerializableTagRegister.set(0, new SnapshotFactory(0, new ControlElementMapperParser()));
  SerializableTagRegister.set(1, new SnapshotFactory(1, new ElementCountMapParser()));
  SerializableTagRegister.set(2, new SnapshotFactory(2, new NPCFactionNewsEventParser()));
  SerializableTagRegister.set(3, new SnapshotFactory(3, new LongSetParser()));
  SerializableTagRegister.set(4, new SnapshotFactory(4, new BlockBufferParser()));
  SerializableTagRegister.set(5, new SnapshotFactory(5, new Long2Vector3fMapParser()));
  SerializableTagRegister.set(6, new SnapshotFactory(6, new Long2TransformMapParser()));
}
