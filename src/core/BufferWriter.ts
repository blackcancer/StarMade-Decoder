/**
 * @fileoverview Buffer Writer
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * BufferWriter — big-endian binary writer for StarMade files.
 *
 * Port of Java DataOutputStream. Growable: resizes automatically.
 * writeJavaUTF() matches DataOutputStream.writeUTF().
 */

const INITIAL_CAPACITY = 4096;
/**
 * Defines GROWTH_FACTOR for core binary tag parsing and serialization.
 */
const GROWTH_FACTOR    = 1.5;

/**
 * Represents the BufferWriter model used by core binary tag parsing and serialization.
 */
export class BufferWriter {
  private buf: Buffer;
  private _pos: number = 0;

  /**
   * Creates a BufferWriter instance.
   *
   * @param initialCapacity - Input value for the constructor operation.
   */
  constructor(initialCapacity = INITIAL_CAPACITY, private readonly maxCapacity = 256 * 1024 * 1024) {
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 0 ||
        !Number.isSafeInteger(maxCapacity) || maxCapacity < 1 || initialCapacity > maxCapacity) {
      throw new RangeError('Invalid BufferWriter capacity');
    }
    this.buf = Buffer.allocUnsafe(initialCapacity);
  }

  /**
   * Handles the position operation used by core binary tag parsing and serialization.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get position(): number { return this._pos; }

  // ── Primitives ────────────────────────────────────────────────────────────

  /**
   * Writes Int8 to the StarMade binary representation.
   *
   * @param v - Input value for the writeInt8 operation.
   */
  writeInt8(v: number): void {
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new RangeError('writeInt8 requires an integer in [-128, 127]');
    this._ensure(1);
    this.buf.writeInt8(v, this._pos);
    this._pos++;
  }

  /**
   * Writes UInt8 to the StarMade binary representation.
   *
   * @param v - Input value for the writeUInt8 operation.
   */
  writeUInt8(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError('writeUInt8 requires an integer in [0, 255]');
    this._ensure(1);
    this.buf.writeUInt8(v, this._pos);
    this._pos++;
  }

  /**
   * Writes Int16BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeInt16BE operation.
   */
  writeInt16BE(v: number): void {
    if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new RangeError('writeInt16BE requires an integer in [-32768, 32767]');
    this._ensure(2);
    this.buf.writeInt16BE(v, this._pos);
    this._pos += 2;
  }

  /**
   * Writes UInt16BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeUInt16BE operation.
   */
  writeUInt16BE(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 65535) throw new RangeError('writeUInt16BE requires an integer in [0, 65535]');
    this._ensure(2);
    this.buf.writeUInt16BE(v, this._pos);
    this._pos += 2;
  }

  /**
   * Writes Int32BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeInt32BE operation.
   */
  writeInt32BE(v: number): void {
    if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new RangeError('writeInt32BE requires an integer in [-2147483648, 2147483647]');
    this._ensure(4);
    this.buf.writeInt32BE(v, this._pos);
    this._pos += 4;
  }

  /**
   * Writes UInt32BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeUInt32BE operation.
   */
  writeUInt32BE(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 4294967295) throw new RangeError('writeUInt32BE requires an integer in [0, 4294967295]');
    this._ensure(4);
    this.buf.writeUInt32BE(v, this._pos);
    this._pos += 4;
  }

  /**
   * Writes Int64BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeInt64BE operation.
   */
  writeInt64BE(v: bigint): void {
    this._ensure(8);
    this.buf.writeBigInt64BE(v, this._pos);
    this._pos += 8;
  }

  /**
   * Writes Float32BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeFloat32BE operation.
   */
  writeFloat32BE(v: number): void {
    this._ensure(4);
    this.buf.writeFloatBE(v, this._pos);
    this._pos += 4;
  }

  /**
   * Writes Float64BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeFloat64BE operation.
   */
  writeFloat64BE(v: number): void {
    this._ensure(8);
    this.buf.writeDoubleBE(v, this._pos);
    this._pos += 8;
  }

  /**
   * Writes Bytes to the StarMade binary representation.
   *
   * @param data - Input value for the writeBytes operation.
   */
  writeBytes(data: Uint8Array | Buffer): void {
    this._ensure(data.length);
    this.buf.set(data, this._pos);
    this._pos += data.length;
  }

  /**
   * Writes Java Modified UTF-8 for save files and network messages.
   * @param s - UTF-16 string to encode, including unpaired surrogates.
   * @throws {RangeError} If the encoded string exceeds 65,535 bytes.
   */
  writeJavaUTF(s: string): void {
    this.writeJavaModifiedUTF(s);
  }

  /**
   * DataOutputStream.writeUTF() — Java Modified UTF-8 variant used by the
   * StarMade save files and network protocol.
   *
   * Differences from standard UTF-8:
   *   • NUL (U+0000) → 2 bytes: C0 80.
   *   • U+0001..U+007F → 1 byte (standard ASCII).
   *   • U+0080..U+07FF → 2 bytes (standard).
   *   • U+0800..U+FFFF → 3 bytes (standard, includes surrogates).
   *   • Supplementary chars (U+10000+): each surrogate half encoded
   *     independently as a 3-byte sequence — identical to Java behaviour.
   *
   * Wire shape: uint16 encoded-byte-count, then that many bytes.
   */
  writeJavaModifiedUTF(s: string): void {
    if (typeof s !== 'string') throw new TypeError('Expected a string');
    let length = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      length += c >= 1 && c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3;
      if (length > 0xffff) throw new RangeError(`String too long for Java Modified UTF-8: ${length} bytes`);
    }
    this._ensure(length + 2);
    this.writeUInt16BE(length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 1 && c <= 0x7f) {
        this.buf[this._pos++] = c;
      } else if (c <= 0x7ff) {
        this.buf[this._pos++] = 0xc0 | (c >> 6);
        this.buf[this._pos++] = 0x80 | (c & 0x3f);
      } else {
        this.buf[this._pos++] = 0xe0 | (c >> 12);
        this.buf[this._pos++] = 0x80 | ((c >> 6) & 0x3f);
        this.buf[this._pos++] = 0x80 | (c & 0x3f);
      }
    }
  }

  /** Returns the written buffer as a trimmed copy. */
  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this._pos));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Handles the ensure operation used by core binary tag parsing and serialization.
   *
   * @param n - Input value for the _ensure operation.
   */
  private _ensure(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid byte length: ${n}`);
    const needed = this._pos + n;
    if (needed > this.maxCapacity) throw new RangeError(`BufferWriter limit exceeded: ${needed} bytes`);
    if (needed <= this.buf.length) return;
    let newCap = Math.max(1, this.buf.length);
    while (newCap < needed) newCap = Math.min(this.maxCapacity, Math.ceil(newCap * GROWTH_FACTOR));
    const newBuf = Buffer.allocUnsafe(newCap);
    this.buf.copy(newBuf, 0, 0, this._pos);
    this.buf = newBuf;
  }
}
