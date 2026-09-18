/**
 * @fileoverview Compares SDK string encoders/decoders against a real JDK oracle.
 * Requires a JDK 17+ on PATH and a completed npm run build.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferReader, BufferWriter } from '../dist/index.js';

const vectors = ['', '\0', 'A\0B', 'é', '中', '\ud83d\ude80', '\ud800', '\udfff', 'a'.repeat(65535)];
const malformed = ['0002c241', '0003e04180', '0003e08041', '0001f0', '0001c2'];
const directory = mkdtempSync(join(tmpdir(), 'starmade-java-'));
try {
  execFileSync('javac', ['-d', directory, fileURLToPath(new URL('../test/reference/JavaUtfReference.java', import.meta.url))], { timeout: 30000 });
  const encoded = vectors.map(text => {
    const writer = new BufferWriter(); writer.writeJavaUTF(text); return writer.toBuffer().toString('hex');
  });
  const utf16 = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('');
  const lines = [...vectors.map(text => `E ${utf16(text)}`), ...encoded.map(hex => `D ${hex}`), ...malformed.map(hex => `D ${hex}`)];
  const output = execFileSync('java', ['-cp', directory, 'JavaUtfReference'], {
    input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 ** 2,
  }).replace(/\r/g, '').split('\n');
  vectors.forEach((text, i) => {
    assert.equal(output[i], encoded[i], `SDK encoding must match JDK vector ${i}`);
    assert.equal(BufferReader.from(Buffer.from(output[i], 'hex')).readJavaUTF(), text);
    assert.equal(output[vectors.length + i], utf16(text), `JDK must read SDK vector ${i}`);
  });
  malformed.forEach((hex, i) => {
    assert.match(output[2 * vectors.length + i], /^ERROR:/);
    assert.throws(() => BufferReader.from(Buffer.from(hex, 'hex')).readJavaUTF());
  });
  console.log(`Java interoperability passed: ${vectors.length} vectors in both directions and ${malformed.length} malformed sequences.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
