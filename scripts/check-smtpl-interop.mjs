/** @fileoverview Independent Python qualification of SMTPL block layouts and public exports. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BlueprintTemplate, parseSmtpl, writeSmtpl } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-smtpl-'));
const oracle = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/smtpl_oracle.py'), mode, temp],
  { stdio: 'inherit', timeout: 30000 });
try {
  oracle('generate');
  for (const version of [4, 5, 6]) {
    const wire = fs.readFileSync(path.join(temp, `v${version}.smtpl`));
    const pieces = JSON.parse(fs.readFileSync(path.join(temp, `v${version}.json`), 'utf8'));
    const parsed = parseSmtpl(wire);
    assert.deepEqual(parsed.pieces, pieces);
    const created = new BlueprintTemplate({ version, minX: -32, minY: 2, minZ: -3, maxX: 100, maxY: 2, maxZ: -3,
      pieces, connections: [], texts: new Map() });
    const edited = parsed.withPieces(parsed.pieces.map(p => ({ ...p, active: !p.active })));
    for (const [name, model] of Object.entries({ noop: parsed, created, edited })) {
      fs.writeFileSync(path.join(temp, `v${version}-${name}.smtpl`), writeSmtpl(model));
    }
  }
  const samples = path.join(root, 'samples');
  const records = fs.readdirSync(samples, { recursive: true }).filter(name => name.endsWith('.smtpl')).map(name => {
    const location = path.join(samples, name), input = fs.readFileSync(location), model = parseSmtpl(input);
    assert.deepEqual(writeSmtpl(model), input, `Byte-exact real sample: ${name}`);
    return { path: location, pieces: model.pieces };
  });
  fs.writeFileSync(path.join(temp, 'samples.json'), JSON.stringify(records));
  oracle('verify');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
