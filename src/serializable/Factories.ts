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

import { DecodeError } from '../core/DecodeError.js';
import type { BufferReader } from '../core/BufferReader.js';
import type { BufferWriter } from '../core/BufferWriter.js';
import type { SerializableTagFactory } from './SerializableTagFactory.js';
import type { SerializableTagElement } from './SerializableTagElement.js';
import { SerializableTagRegister } from './SerializableTagRegister.js';

// ── RawElement: stores raw bytes ───────────────────────────────────────

/**
 * Represents the RawElement model used by StarMade SERIALIZABLE payload handling.
 */
export class RawElement implements SerializableTagElement {
  /**
   * Creates a RawElement instance.
   *
   * @param factoryId - Input value for the constructor operation.
   * @param raw - Input value for the constructor operation.
   */
  constructor(public readonly factoryId: number, public readonly raw: Uint8Array) {}
  /**
   * Returns FactoryId.
   */
  getFactoryId() { return this.factoryId; }
  /**
   * Writes ToTag to the StarMade binary representation.
   *
   * @param w - Input value for the writeToTag operation.
   */
  writeToTag(w: BufferWriter) { w.writeBytes(this.raw); }
  /**
   * Builds the diagnostic string representation for this value.
   */
  toString() { return `RawElement(id=${this.factoryId}, ${this.raw.length}B)`; }
}

// ── SnapshotFactory: wraps a structured factory and preserves raw bytes ────

/**
 * Represents the SnapshotFactory model used by StarMade SERIALIZABLE payload handling.
 */
class SnapshotFactory implements SerializableTagFactory {
  /**
   * Creates a SnapshotFactory instance.
   *
   * @param factoryId - Input value for the constructor operation.
   * @param inner - Input value for the constructor operation.
   */
  constructor(
    private readonly factoryId: number,
    private readonly inner: { parse(reader: BufferReader): void }
  ) {}

  /**
   * Builds a value for StarMade SERIALIZABLE payload handling.
   *
   * @param reader - Input value for the create operation.
   * @returns The computed StarMade-Decoder value.
   */
  create(reader: BufferReader): RawElement {
    const start = reader.offset;
    this.inner.parse(reader);
    const raw = reader.snapshot(start, reader.offset);
    return new RawElement(this.factoryId, raw);
  }
}

// ── Factory 1 : ElementCountMap ───────────────────────────────────────────────
// int existingTypeCount + (short type + int count)×size

/**
 * Represents the ElementCountMapParser model used by StarMade SERIALIZABLE payload handling.
 */
class ElementCountMapParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const size = r.readCount(6);
    for (let i = 0; i < size; i++) {
      r.readInt16BE(); // type
      r.readInt32BE(); // count
    }
  }
}

// ── Factory 2 : NPCFactionNewsEvent ──────────────────────────────────────────
// Ordinals 0/6 carry a Vector3i; 1/2/3/5 carry modified UTF; 4 carries two Vector3i.
// Unknown ordinals cannot be skipped because this payload has no enclosing byte length.

/**
 * Represents the NPCFactionNewsEventParser model used by StarMade SERIALIZABLE payload handling.
 */
class NPCFactionNewsEventParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const eventType = r.readUInt8();
    // base : long time + int factionId
    r.readInt64BE();  // time
    r.readInt32BE();  // factionId
    switch (eventType) {
      case 0: // GROWN → EventSystem
      case 6: // LOST_TERRITORY → EventSystem
        r.readInt32BE(); r.readInt32BE(); r.readInt32BE(); // Vector3i
        break;
      case 1: // WAR → OtherEnt
      case 2: // PEACE → OtherEnt
      case 3: // ALLIES → OtherEnt
      case 5: // LOST_STATION → OtherEnt
        r.readJavaUTF(); // String otherEnt (readUTF)
        break;
      case 4: // TRADING → Route
        for (let i = 0; i < 6; i++) r.readInt32BE();
        break;
      default:
        throw new DecodeError('E_UNSUPPORTED', 'Unknown NPC event ordinal');
    }
  }
}

// ── Factory 3 : LongSet ───────────────────────────────────────────────────────
// int size + long×size

/**
 * Represents the LongSetParser model used by StarMade SERIALIZABLE payload handling.
 */
class LongSetParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const size = r.readCount(8);
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

/**
 * Represents the ControlElementMapperParser model used by StarMade SERIALIZABLE payload handling.
 */
class ControlElementMapperParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const header = r.readInt32BE();
    // Java's unversioned format stores the controller count in the first int.
    // This snapshot reader preserves raw coordinates; domain readers migrate them.
    const isDisk = header >= 0 || -header > 1024;
    const keySize = header >= 0 ? header : r.readCount(10);
    if (keySize > 1_000_000) throw new DecodeError('E_LIMIT', 'Too many legacy controllers');
    if (keySize * 10 > r.remaining()) {
      throw new DecodeError('E_TRUNCATED', 'Truncated legacy controller records', { offset: r.offset });
    }
    if (header >= 0) r.validateCollectionCount(keySize, 10);
    for (let i = 0; i < keySize; i++) {
      r.readInt16BE(); r.readInt16BE(); r.readInt16BE(); // 3×short key position
      const valueSize = r.readCount(6);
      for (let v = 0; v < valueSize; v++) {
        r.readInt16BE(); // short type
        const elemSize = r.readCount(isDisk ? 6 : 3);
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
//   if meta: long controller + int mSize + mSize×long connectedFromThis

/**
 * Represents the BlockBufferParser model used by StarMade SERIALIZABLE payload handling.
 */
class BlockBufferParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const size = r.readCount(11);
    const controllerSize = r.readCount();
    const conSize = r.readCount();
    let c = 0, conC = 0;
    for (let i = 0; i < size; i++) {
      r.readInt16BE(); r.readInt16BE(); r.readInt16BE(); // 3×short position
      r.readInt32BE(); // int data
      const meta = r.readInt8() !== 0; // boolean
      if (meta) {
        r.readInt64BE(); // long controller
        const mSize = r.readCount(8);
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

/**
 * Represents the Long2Vector3fMapParser model used by StarMade SERIALIZABLE payload handling.
 */
class Long2Vector3fMapParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const size = r.readCount(20);
    for (let i = 0; i < size; i++) {
      r.readInt64BE();      // key
      r.readFloat32BE(); r.readFloat32BE(); r.readFloat32BE(); // x, y, z
    }
  }
}

// ── Factory 6 : Long2TransformMap ─────────────────────────────────────────────
// TransformTools.serializeFully = Matrix3f (9 floats) + Vector3f (3 floats) = 48 bytes
// int size + (long key + 12×float32)×size

/**
 * Represents the Long2TransformMapParser model used by StarMade SERIALIZABLE payload handling.
 */
class Long2TransformMapParser {
  /**
   * Parses input data for StarMade SERIALIZABLE payload handling.
   *
   * @param r - Input value for the parse operation.
   */
  parse(r: BufferReader) {
    const size = r.readCount(56);
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
