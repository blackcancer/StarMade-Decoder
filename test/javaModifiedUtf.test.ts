/**
 * @fileoverview Java Modified UTF-8 round-trip tests
 *
 * Covers BufferReader.readJavaModifiedUTF() and
 * BufferWriter.writeJavaModifiedUTF() against the Java DataOutput.writeUTF()
 * wire format used by the StarMade network protocol.
 *
 * @author InitSysRev
 */

import { assert } from 'chai';
import { BufferReader } from '../src/core/BufferReader.js';
import { BufferWriter } from '../src/core/BufferWriter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function encode(s: string): Buffer {
  const w = new BufferWriter();
  w.writeJavaModifiedUTF(s);
  return w.toBuffer();
}

function decode(buf: Buffer): string {
  return BufferReader.from(buf).readJavaModifiedUTF();
}

function roundTrip(s: string): string {
  return decode(encode(s));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BufferWriter / BufferReader — Java Modified UTF-8', function () {

  it('empty string round-trips', function () {
    assert.strictEqual(roundTrip(''), '');
  });

  it('pure ASCII round-trips', function () {
    const s = '/STATUS 127.0.0.1 hello world';
    assert.strictEqual(roundTrip(s), s);
  });

  it('NUL character encodes as C0 80 (not 0x00)', function () {
    const buf = encode('\u0000');
    // uint16 length = 2 (two encoded bytes for NUL)
    assert.strictEqual(buf.readUInt16BE(0), 2);
    assert.strictEqual(buf[2], 0xc0);
    assert.strictEqual(buf[3], 0x80);
  });

  it('NUL round-trips', function () {
    assert.strictEqual(roundTrip('\u0000'), '\u0000');
  });

  it('latin accent é (U+00E9) round-trips', function () {
    assert.strictEqual(roundTrip('é'), 'é');
  });

  it('multi-accent string round-trips', function () {
    const s = 'RUN\u0000_SCRIPT éàü';
    assert.strictEqual(roundTrip(s), s);
  });

  it('CJK character (U+4E2D) round-trips', function () {
    assert.strictEqual(roundTrip('中'), '中');
  });

  it('supplementary character 🚀 (U+1F680) round-trips via surrogate pairs', function () {
    // U+1F680 = surrogate pair U+D83D U+DE80 in JS
    const rocket = '\uD83D\uDE80';
    assert.strictEqual(roundTrip(rocket), rocket);
    // Each surrogate is encoded as a 3-byte sequence → 6 bytes total
    const buf = encode(rocket);
    assert.strictEqual(buf.readUInt16BE(0), 6);
  });

  it('pure ASCII produces identical encoding to writeJavaUTF', function () {
    const s = 'hello StarMade';
    const w1 = new BufferWriter();
    w1.writeJavaUTF(s);
    const w2 = new BufferWriter();
    w2.writeJavaModifiedUTF(s);
    assert.deepEqual(w1.toBuffer(), w2.toBuffer());
  });

  it('pure ASCII: readJavaModifiedUTF ≡ readJavaUTF', function () {
    const s = 'hello StarMade';
    const buf = encode(s);
    const r = BufferReader.from(buf);
    // Both decoders should give the same result on ASCII
    assert.strictEqual(BufferReader.from(buf).readJavaUTF(), s);
    assert.strictEqual(r.readJavaModifiedUTF(), s);
  });

  it('multiple values in sequence round-trip correctly', function () {
    const w = new BufferWriter();
    w.writeJavaModifiedUTF('password123');
    w.writeJavaModifiedUTF('/STATUS');
    w.writeJavaModifiedUTF('café\u0000null');
    const buf = w.toBuffer();
    const r = BufferReader.from(buf);
    assert.strictEqual(r.readJavaModifiedUTF(), 'password123');
    assert.strictEqual(r.readJavaModifiedUTF(), '/STATUS');
    assert.strictEqual(r.readJavaModifiedUTF(), 'café\u0000null');
    assert.isTrue(r.isEOF());
  });

  it('throws on truncated 2-byte sequence', function () {
    // uint16=1, then one 0xC2 byte (start of 2-byte seq) but no continuation
    const buf = Buffer.from([0x00, 0x01, 0xc2]);
    assert.throws(() => BufferReader.from(buf).readJavaModifiedUTF(), /Truncated/);
  });

  it('throws on truncated 3-byte sequence', function () {
    // uint16=2, then 0xE2 0x80 (start of 3-byte seq, missing final byte)
    const buf = Buffer.from([0x00, 0x02, 0xe2, 0x80]);
    assert.throws(() => BufferReader.from(buf).readJavaModifiedUTF(), /Truncated/);
  });

  it('throws on invalid leading byte (4-byte UTF-8 not valid in Modified UTF-8)', function () {
    // 0xF0 is a valid UTF-8 4-byte lead but invalid in Java Modified UTF-8
    const buf = Buffer.from([0x00, 0x01, 0xf0]);
    assert.throws(() => BufferReader.from(buf).readJavaModifiedUTF(), /Invalid/);
  });

  it('throws RangeError on string exceeding 65535 encoded bytes', function () {
    const huge = 'é'.repeat(33000); // é = 2 bytes each → 66000 bytes > 65535
    const w = new BufferWriter();
    assert.throws(() => w.writeJavaModifiedUTF(huge), RangeError);
  });
});
