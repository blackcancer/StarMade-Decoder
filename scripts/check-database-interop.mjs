/** @fileoverview Bidirectional JDK ObjectStream qualification of the actual database codec. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeFleetRemotes, encodeFleetRemotes, FleetRemotesObject } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-database-'));
try {
  execFileSync('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', temp,
    path.join(root, 'test/fixtures/DatabaseOracle.java')], { stdio: 'inherit', timeout: 30000 });
  const run = mode => execFileSync('java', ['-cp', temp, 'DatabaseOracle', mode, temp], { stdio: 'inherit', timeout: 30000 });
  run('generate');
  const keys = ['', 'dot.name', 'slash/name', 'value', 'nul\u0000', 'rocket\ud83d\ude80', 'lone\ud800', 'x'.repeat(65535)];
  for (const [id, expected] of [new Map(), new Map(keys.map((key, i) => [key, i % 2 === 0]))].entries()) {
    const java = fs.readFileSync(path.join(temp, `java-map-${id}`));
    const decoded = decodeFleetRemotes(java);
    assert.deepEqual(decoded.remotes, expected);
    assert.equal(decoded.format, 'java'); assert.equal(decoded.complete, true); assert.deepEqual(decoded.diagnostics, []);
    const output = encodeFleetRemotes(expected, 'java');
    assert.deepEqual(decodeFleetRemotes(FleetRemotesObject.fromBytes(java).toBytes()).remotes, expected);
    fs.writeFileSync(path.join(temp, `sdk-map-${id}`), output);
  }
  run('verify');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
