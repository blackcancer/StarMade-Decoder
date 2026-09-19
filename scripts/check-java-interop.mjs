#!/usr/bin/env node
/**
 * @fileoverview Runs independent JDK write/read checks against the compiled SDK.
 * Requires a full JDK java launcher on PATH (compiler module included). Fails rather than silently skipping a missing JDK.
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-java-'));
const values = ['', 'ASCII', '\u0000', '\u00e9\u4e2d', '\ud83d\ude80', '\ud800', 'x'.repeat(65535), '\u0000'.repeat(32767)];
try {
  execFileSync('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', temp, path.join(root, 'test/fixtures/WireOracle.java')], { stdio: 'inherit', timeout: 30000 });
  const run = mode => execFileSync('java', ['-cp', temp, 'WireOracle', mode, temp], { stdio: 'inherit', timeout: 30000 });
  run('generate');
  for (let i = 0; i < values.length; i++) {
    const java = fs.readFileSync(path.join(temp, `java-utf-${i}`));
    assert.equal(BufferReader.from(java).readJavaUTF(), values[i]);
    const writer = new BufferWriter(); writer.writeJavaUTF(values[i]);
    assert.deepEqual(writer.toBuffer(), java);
    fs.writeFileSync(path.join(temp, `js-utf-${i}`), writer.toBuffer());
  }
  for (const name of ['java-tag', 'java-tag-gzip']) {
    const tag = readFrom(fs.readFileSync(path.join(temp, name)), { allowTrailingBytes: false });
    assert.equal(tag.name, 'name\u0000\ud800'); assert.equal(tag.getString(), 'value\ud83d\ude80\u0000');
  }
  fs.writeFileSync(path.join(temp, 'js-tag'), writeTo(Tags.string('name\u0000\ud800', 'value\ud83d\ude80\u0000')));
  const words = fs.readFileSync(path.join(temp, 'java-block-words'));
  for (let i = 0; i < 32768; i++) {
    const raw = words.readUInt32LE(i * 4), block = decodeBlockWord(raw);
    assert.deepEqual(block, { type: i & 8191, hp: i & 127, active: Boolean(i & 1), orientation: i & 31, ...((i & 63) ? { extra: i & 63 } : {}) });
    assert.equal(encodeBlockWord(block), raw);
  }
  run('verify'); run('malformed');
  console.log('JDK interoperability passed: 8 UTF boundary cases, plain/GZIP Tags and all 32,768 block words.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
