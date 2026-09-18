/**
 * @fileoverview
 * Bounded big-endian reader for StarMade save files and network payloads.
 * Java UTF strings use DataInput.readUTF's Modified UTF-8 representation.
 * Reads are transactional: a failed read does not advance the cursor.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
export class BufferReader {
  private _offset = 0;

  /** @param buf Backing bytes; callers must not mutate them while reading. */
  private constructor(private readonly buf: Buffer) {}

  /**
   * Creates a reader. Buffers are borrowed; other byte arrays are copied.
   * @param data Input bytes.
   * @returns A reader positioned at byte zero.
   */
  static from(data: Buffer | Uint8Array): BufferReader {
    return new BufferReader(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  /**
   * Copies an absolute byte range without changing the cursor.
   * @param start Inclusive byte offset.
   * @param end Exclusive byte offset.
   * @returns Independent snapshot bytes.
   * @throws {RangeError} If the range is invalid.
   */
  snapshot(start: number, end: number): Uint8Array {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || end > this.buf.length) {
      throw new RangeError(`Invalid snapshot range: ${start}..${end}`);
    }
    return new Uint8Array(this.buf.subarray(start, end));
  }

  /** Borrowed backing buffer. Do not mutate it while this reader is in use. */
  get rawBuffer(): Buffer { return this.buf; }
  /** Current byte offset. */
  get offset(): number { return this._offset; }
  /** @returns Whether every byte has been consumed. */
  isEOF(): boolean { return this._offset === this.buf.length; }
  /** @returns Unconsumed byte count. */
  remaining(): number { return this.buf.length - this._offset; }

  /** @returns A signed byte. @throws {RangeError} On underflow. */
  readInt8(): number { this._check(1); return this.buf.readInt8(this._offset++); }
  /** @returns An unsigned byte. @throws {RangeError} On underflow. */
  readUInt8(): number { this._check(1); return this.buf.readUInt8(this._offset++); }
  /** @returns A signed big-endian 16-bit integer. @throws {RangeError} On underflow. */
  readInt16BE(): number {
    this._check(2); const value = this.buf.readInt16BE(this._offset); this._offset += 2; return value;
  }
  /** @returns An unsigned big-endian 16-bit integer. @throws {RangeError} On underflow. */
  readUInt16BE(): number {
    this._check(2); const value = this.buf.readUInt16BE(this._offset); this._offset += 2; return value;
  }
  /** @returns A signed big-endian 32-bit integer. @throws {RangeError} On underflow. */
  readInt32BE(): number {
    this._check(4); const value = this.buf.readInt32BE(this._offset); this._offset += 4; return value;
  }
  /** @returns An unsigned big-endian 32-bit integer. @throws {RangeError} On underflow. */
  readUInt32BE(): number {
    this._check(4); const value = this.buf.readUInt32BE(this._offset); this._offset += 4; return value;
  }
  /** @returns A signed big-endian 64-bit integer without precision loss. @throws {RangeError} On underflow. */
  readInt64BE(): bigint {
    this._check(8); const value = this.buf.readBigInt64BE(this._offset); this._offset += 8; return value;
  }
  /** @returns An IEEE-754 single-precision value. @throws {RangeError} On underflow. */
  readFloat32BE(): number {
    this._check(4); const value = this.buf.readFloatBE(this._offset); this._offset += 4; return value;
  }
  /** @returns An IEEE-754 double-precision value. @throws {RangeError} On underflow. */
  readFloat64BE(): number {
    this._check(8); const value = this.buf.readDoubleBE(this._offset); this._offset += 8; return value;
  }

  /**
   * @param n Nonnegative integral byte count.
   * @returns An independent copy of the next bytes.
   * @throws {RangeError} For an invalid count or underflow.
   */
  readBytes(n: number): Uint8Array {
    this._check(n);
    const bytes = new Uint8Array(this.buf.subarray(this._offset, this._offset + n));
    this._offset += n;
    return bytes;
  }

  /**
   * Reads Java Modified UTF-8, including NUL and UTF-16 surrogate code units.
   * @returns The decoded Java string.
   * @throws {Error} For an invalid sequence or incomplete input.
   * @remarks This is the save-file codec too, not standard UTF-8.
   */
  readJavaUTF(): string { return this.readJavaModifiedUTF(); }

  /**
   * Reads an unsigned 16-bit byte count followed by Java Modified UTF-8.
   * @returns The decoded UTF-16 string, preserving lone surrogates.
   * @throws {Error} On underflow, invalid lead bytes or invalid continuations.
   * @remarks Matches DataInputStream.readUTF acceptance, including Java's
   * acceptance of a literal zero byte and noncanonical two/three-byte forms.
   */
  readJavaModifiedUTF(): string {
    this._check(2);
    const length = this.buf.readUInt16BE(this._offset);
    this._check(2 + length);
    let i = this._offset + 2;
    const end = i + length;
    const codes: number[] = [];
    while (i < end) {
      const lead = this.buf[i++];
      if (lead < 0x80) {
        codes.push(lead);
      } else if ((lead & 0xe0) === 0xc0) {
        if (i >= end) throw new Error('Truncated Java Modified UTF-8 2-byte sequence');
        const b2 = this.buf[i++];
        if ((b2 & 0xc0) !== 0x80) throw new Error(`Invalid Java Modified UTF-8 continuation at ${i - 1}`);
        codes.push(((lead & 0x1f) << 6) | (b2 & 0x3f));
      } else if ((lead & 0xf0) === 0xe0) {
        if (i + 1 >= end) throw new Error('Truncated Java Modified UTF-8 3-byte sequence');
        const b2 = this.buf[i++];
        const b3 = this.buf[i++];
        if ((b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
          throw new Error(`Invalid Java Modified UTF-8 continuation near ${i - 2}`);
        }
        codes.push(((lead & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
      } else {
        throw new Error(`Invalid Java Modified UTF-8 byte 0x${lead.toString(16)} at ${i - 1}`);
      }
    }
    const parts: string[] = [];
    for (let start = 0; start < codes.length; start += 0x2000) {
      parts.push(String.fromCharCode(...codes.slice(start, start + 0x2000)));
    }
    this._offset = end;
    return parts.join('');
  }

  /**
   * Reads a non-negative int32 collection count with allocation and byte bounds.
   * @param minimumItemBytes - Smallest serialized item size, or zero for variable-size items.
   * @param maximum - Maximum permitted item count; defaults to one million.
   * @returns The validated count.
   * @throws {RangeError} If the count exceeds either bound or is negative.
   */
  readCount(minimumItemBytes = 0, maximum = 1_000_000): number {
    if (!Number.isSafeInteger(minimumItemBytes) || minimumItemBytes < 0 ||
        !Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError('Invalid collection bounds');
    this._check(4);
    const count = this.buf.readInt32BE(this._offset);
    if (count < 0 || count > maximum || count * minimumItemBytes > this.remaining() - 4) {
      throw new RangeError(`Invalid collection count ${count} at offset ${this.offset}`);
    }
    this._offset += 4;
    return count;
  }

  /**
   * @param n Requested byte count.
   * @throws {RangeError} For invalid lengths or insufficient remaining bytes.
   */
  private _check(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid byte count: ${n}`);
    if (n > this.remaining()) {
      throw new RangeError(`BufferReader underflow: need ${n} bytes at offset ${this._offset}, but only ${this.remaining()} remaining`);
    }
  }
}
