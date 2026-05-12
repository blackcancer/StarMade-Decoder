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
   * DataInputStream.readUTF() — uint16 byte-length + standard UTF-8 bytes.
   * Used by StarMade save-file Tag serialization.
   */
  readJavaUTF(): string {
    const len = this.readUInt16BE();
    this._check(len);
    const str = this.buf.toString('utf8', this._offset, this._offset + len);
    this._offset += len;
    return str;
  }

  /**
   * DataInputStream.readUTF() — Java Modified UTF-8 variant used by the
   * StarMade network protocol (DataOutput.writeUTF on the wire).
   *
   * Differences from standard UTF-8:
   *   • NUL (U+0000) is encoded as 2 bytes: C0 80 (never as a single 0x00).
   *   • Supplementary characters (U+10000+) are encoded as two independent
   *     3-byte sequences using their surrogate halves, not as 4-byte UTF-8.
   *   • Otherwise identical to standard CESU-8 / modified UTF-8.
   *
   * Wire shape: uint16 encoded-byte-count, then that many bytes.
   */
  readJavaModifiedUTF(): string {
    const len = this.readUInt16BE();
    this._check(len);
    const end = this._offset + len;
    const codes: number[] = [];
    let i = this._offset;
    while (i < end) {
      const b = this.buf[i++];
      if ((b & 0x80) === 0) {
        // 1-byte: U+0001..U+007F
        codes.push(b);
      } else if ((b & 0xe0) === 0xc0) {
        // 2-byte: NUL (C0 80) or U+0080..U+07FF
        if (i >= end) throw new Error('Truncated Java Modified UTF-8 2-byte sequence');
        const b2 = this.buf[i++];
        codes.push(((b & 0x1f) << 6) | (b2 & 0x3f));
      } else if ((b & 0xf0) === 0xe0) {
        // 3-byte: U+0800..U+FFFF (incl. surrogates for supplementary chars)
        if (i + 1 >= end) throw new Error('Truncated Java Modified UTF-8 3-byte sequence');
        const b2 = this.buf[i++];
        const b3 = this.buf[i++];
        codes.push(((b & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
      } else {
        throw new Error(`Invalid Java Modified UTF-8 byte 0x${b.toString(16).padStart(2, '0')} at position ${i - 1}`);
      }
    }
    this._offset = end;
    // String.fromCharCode handles surrogate pairs correctly as JS strings
    // are also UTF-16 internally.
    return codes.length <= 0x3000
      ? String.fromCharCode(...codes)
      : codes.reduce((s, c) => s + String.fromCharCode(c), '');
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
