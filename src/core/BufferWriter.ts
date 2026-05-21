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
  constructor(initialCapacity = INITIAL_CAPACITY) {
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
    this._ensure(1);
    this.buf.writeInt8(v, this._pos++);
  }

  /**
   * Writes UInt8 to the StarMade binary representation.
   *
   * @param v - Input value for the writeUInt8 operation.
   */
  writeUInt8(v: number): void {
    this._ensure(1);
    this.buf.writeUInt8(v, this._pos++);
  }

  /**
   * Writes Int16BE to the StarMade binary representation.
   *
   * @param v - Input value for the writeInt16BE operation.
   */
  writeInt16BE(v: number): void {
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
    Buffer.from(data).copy(this.buf, this._pos);
    this._pos += data.length;
  }

  /**
   * DataOutputStream.writeUTF() — uint16 byte-length + standard UTF-8 bytes.
   * Used by StarMade save-file Tag serialization.
   */
  writeJavaUTF(s: string): void {
    const encoded = Buffer.from(s, 'utf8');
    if (encoded.length > 65535) {
      throw new RangeError(`String too long for writeJavaUTF: ${encoded.length} bytes`);
    }
    this.writeUInt16BE(encoded.length);
    this.writeBytes(encoded);
  }

  /**
   * DataOutputStream.writeUTF() — Java Modified UTF-8 variant used by the
   * StarMade network protocol.
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
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x0001 && c <= 0x007f) {
        // 1-byte ASCII
        bytes.push(c);
      } else if (c === 0x0000 || (c >= 0x0080 && c <= 0x07ff)) {
        // 2-byte: NUL and U+0080..U+07FF
        bytes.push(0xc0 | ((c >> 6) & 0x1f), 0x80 | (c & 0x3f));
      } else {
        // 3-byte: U+0800..U+FFFF, including surrogates
        bytes.push(
          0xe0 | ((c >> 12) & 0x0f),
          0x80 | ((c >> 6)  & 0x3f),
          0x80 | (c         & 0x3f),
        );
      }
    }
    if (bytes.length > 0xffff) {
      throw new RangeError(`String too long for writeJavaModifiedUTF: ${bytes.length} encoded bytes`);
    }
    this.writeUInt16BE(bytes.length);
    this.writeBytes(Buffer.from(bytes));
  }

  /** Returns the written buffer as a trimmed copy. */
  toBuffer(): Buffer {
    return this.buf.slice(0, this._pos);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Handles the ensure operation used by core binary tag parsing and serialization.
   *
   * @param n - Input value for the _ensure operation.
   */
  private _ensure(n: number): void {
    const needed = this._pos + n;
    if (needed <= this.buf.length) return;
    let newCap = this.buf.length;
    while (newCap < needed) newCap = Math.ceil(newCap * GROWTH_FACTOR);
    const newBuf = Buffer.allocUnsafe(newCap);
    this.buf.copy(newBuf, 0, 0, this._pos);
    this.buf = newBuf;
  }
}
