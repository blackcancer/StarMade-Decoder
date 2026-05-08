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
const GROWTH_FACTOR    = 1.5;

export class BufferWriter {
  private buf: Buffer;
  private _pos: number = 0;

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.buf = Buffer.allocUnsafe(initialCapacity);
  }

  get position(): number { return this._pos; }

  // ── Primitives ────────────────────────────────────────────────────────────

  writeInt8(v: number): void {
    this._ensure(1);
    this.buf.writeInt8(v, this._pos++);
  }

  writeUInt8(v: number): void {
    this._ensure(1);
    this.buf.writeUInt8(v, this._pos++);
  }

  writeInt16BE(v: number): void {
    this._ensure(2);
    this.buf.writeInt16BE(v, this._pos);
    this._pos += 2;
  }

  writeUInt16BE(v: number): void {
    this._ensure(2);
    this.buf.writeUInt16BE(v, this._pos);
    this._pos += 2;
  }

  writeInt32BE(v: number): void {
    this._ensure(4);
    this.buf.writeInt32BE(v, this._pos);
    this._pos += 4;
  }

  writeUInt32BE(v: number): void {
    this._ensure(4);
    this.buf.writeUInt32BE(v, this._pos);
    this._pos += 4;
  }

  writeInt64BE(v: bigint): void {
    this._ensure(8);
    this.buf.writeBigInt64BE(v, this._pos);
    this._pos += 8;
  }

  writeFloat32BE(v: number): void {
    this._ensure(4);
    this.buf.writeFloatBE(v, this._pos);
    this._pos += 4;
  }

  writeFloat64BE(v: number): void {
    this._ensure(8);
    this.buf.writeDoubleBE(v, this._pos);
    this._pos += 8;
  }

  writeBytes(data: Uint8Array | Buffer): void {
    this._ensure(data.length);
    Buffer.from(data).copy(this.buf, this._pos);
    this._pos += data.length;
  }

  /**
   * DataOutputStream.writeUTF() — uint16 byte length + UTF-8 bytes.
   */
  writeJavaUTF(s: string): void {
    const encoded = Buffer.from(s, 'utf8');
    if (encoded.length > 65535) {
      throw new RangeError(`String too long for writeJavaUTF: ${encoded.length} bytes`);
    }
    this.writeUInt16BE(encoded.length);
    this.writeBytes(encoded);
  }

  /** Returns the written buffer as a trimmed copy. */
  toBuffer(): Buffer {
    return this.buf.slice(0, this._pos);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

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
