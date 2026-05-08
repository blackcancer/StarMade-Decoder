/**
 * @fileoverview Buffer Reader
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * BufferReader — big-endian binary reader for StarMade files.
 *
 * Port of Java DataInputStream (big-endian by Java convention).
 * Supports readJavaUTF(), which matches DataInputStream.readUTF() :
 *   2 unsigned bytes = length + UTF-8 bytes.
 */

export class BufferReader {
  private readonly buf: Buffer;
  private _offset: number;

  private constructor(buf: Buffer) {
    this.buf = buf;
    this._offset = 0;
  }

  static from(data: Buffer | Uint8Array): BufferReader {
    return new BufferReader(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  /** Returns a copy of the bytes between two offsets */
  snapshot(start: number, end: number): Uint8Array {
    return new Uint8Array(this.buf.slice(start, end));
  }

  /** Exposes the internal buffer as read-only data */
  get rawBuffer(): Buffer { return this.buf; }

  get offset(): number { return this._offset; }

  isEOF(): boolean { return this._offset >= this.buf.length; }

  remaining(): number { return this.buf.length - this._offset; }

  // ── Primitives ────────────────────────────────────────────────────────────

  readInt8(): number {
    this._check(1);
    return this.buf.readInt8(this._offset++);
  }

  readUInt8(): number {
    this._check(1);
    return this.buf.readUInt8(this._offset++);
  }

  readInt16BE(): number {
    this._check(2);
    const v = this.buf.readInt16BE(this._offset);
    this._offset += 2;
    return v;
  }

  readUInt16BE(): number {
    this._check(2);
    const v = this.buf.readUInt16BE(this._offset);
    this._offset += 2;
    return v;
  }

  readInt32BE(): number {
    this._check(4);
    const v = this.buf.readInt32BE(this._offset);
    this._offset += 4;
    return v;
  }

  readUInt32BE(): number {
    this._check(4);
    const v = this.buf.readUInt32BE(this._offset);
    this._offset += 4;
    return v;
  }

  readInt64BE(): bigint {
    this._check(8);
    const v = this.buf.readBigInt64BE(this._offset);
    this._offset += 8;
    return v;
  }

  readFloat32BE(): number {
    this._check(4);
    const v = this.buf.readFloatBE(this._offset);
    this._offset += 4;
    return v;
  }

  readFloat64BE(): number {
    this._check(8);
    const v = this.buf.readDoubleBE(this._offset);
    this._offset += 8;
    return v;
  }

  readBytes(n: number): Uint8Array {
    this._check(n);
    const slice = this.buf.slice(this._offset, this._offset + n);
    this._offset += n;
    return new Uint8Array(slice);
  }

  /**
   * DataInputStream.readUTF() — uint16 length + UTF-8 bytes.
   */
  readJavaUTF(): string {
    const len = this.readUInt16BE();
    this._check(len);
    const str = this.buf.toString('utf8', this._offset, this._offset + len);
    this._offset += len;
    return str;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _check(n: number): void {
    if (this._offset + n > this.buf.length) {
      throw new Error(
        `BufferReader underflow: need ${n} bytes at offset ${this._offset}, ` +
        `but only ${this.buf.length - this._offset} remaining`
      );
    }
  }
}
