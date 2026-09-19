/** @fileoverview Independent ObjectStream qualification with actual fixed JDK binary captures and a Python decoder. */
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
  const run = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/database_oracle.py'), mode, temp], { stdio: 'inherit', timeout: 30000 });
  run('generate');
  const keys = ['', 'dot.name', 'slash/name', 'value', 'nul\u0000', 'rocket\ud83d\ude80', 'lone\ud800', 'x'.repeat(65535)];
  for (const [id, expected] of [new Map(), new Map(keys.map((key, i) => [key, i % 2 === 0]))].entries()) {
    const reference = fs.readFileSync(path.join(temp, `reference-map-${id}`));
    const decoded = decodeFleetRemotes(reference);
    assert.deepEqual(decoded.remotes, expected);
    assert.equal(decoded.format, 'java'); assert.equal(decoded.complete, true); assert.deepEqual(decoded.diagnostics, []);
    const output = encodeFleetRemotes(expected, 'java');
    assert.deepEqual(decodeFleetRemotes(FleetRemotesObject.fromBytes(reference).toBytes()).remotes, expected);
    fs.writeFileSync(path.join(temp, `sdk-map-${id}`), output);
  }
  run('verify');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
