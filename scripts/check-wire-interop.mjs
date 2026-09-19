#!/usr/bin/env node
/**
 * @fileoverview Runs independent Python wire checks against the compiled SDK and pinned JDK vectors.
 * Requires python3; no Java source, compiler or game runtime is bundled or executed.
 * @example npm run build && npm run test:interop
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BufferReader, BufferWriter, Tags, readFrom, writeTo } from '../dist/index.js';
import { decodeBlockWord } from '../dist/smd3/Smd3Parser.js';
import { encodeBlockWord } from '../dist/smd3/Smd3Writer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-wire-'));
const values = ['', 'ASCII', '\u0000', '\u00e9\u4e2d', '\ud83d\ude80', '\ud800', 'x'.repeat(65535), '\u0000'.repeat(32767)];
try {
  const run = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/wire_oracle.py'), mode, temp], { stdio: 'inherit', timeout: 30000 });
  run('generate');
  for (let i = 0; i < values.length; i++) {
    const reference = fs.readFileSync(path.join(temp, `reference-utf-${i}`));
    assert.equal(BufferReader.from(reference).readJavaUTF(), values[i]);
    const writer = new BufferWriter(); writer.writeJavaUTF(values[i]);
    assert.deepEqual(writer.toBuffer(), reference);
    fs.writeFileSync(path.join(temp, `js-utf-${i}`), writer.toBuffer());
  }
  for (const name of ['reference-tag', 'reference-tag-gzip']) {
    const tag = readFrom(fs.readFileSync(path.join(temp, name)), { allowTrailingBytes: false });
    assert.equal(tag.name, 'name\u0000\ud800'); assert.equal(tag.getString(), 'value\ud83d\ude80\u0000');
  }
  fs.writeFileSync(path.join(temp, 'js-tag'), writeTo(Tags.string('name\u0000\ud800', 'value\ud83d\ude80\u0000')));
  const words = fs.readFileSync(path.join(temp, 'reference-block-words'));
  const sdkWords = Buffer.alloc(words.length);
  for (let i = 0; i < 32768; i++) {
    const raw = words.readUInt32LE(i * 4), block = decodeBlockWord(raw);
    assert.deepEqual(block, { type: i & 8191, hp: i & 127, active: Boolean(i & 1), orientation: i & 31, ...((i & 63) ? { extra: i & 63 } : {}) });
    assert.equal(encodeBlockWord(block), raw);
    sdkWords.writeUInt32LE(encodeBlockWord(block), i * 4);
  }
  fs.writeFileSync(path.join(temp, 'sdk-block-words'), sdkWords);
  for (const hex of ['0002c241', '0003e28241', '0003e24180', '0001c2', '0002e280', '0004f09f9880']) {
    assert.throws(() => BufferReader.from(Buffer.from(hex, 'hex')).readJavaUTF());
  }
  run('verify'); run('malformed');
  console.log('Independent Python wire qualification passed against fixed JDK vectors: 8 UTF boundary cases, plain/GZIP Tags and all 32,768 block words.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
