/** @fileoverview Independent Python ZIP/PNG qualification of public SMSKIN reads and writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SkinDocument } from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-skin-'));
const oracle = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/skin_oracle.py'), mode, temp], {stdio: 'inherit', timeout: 30000});
try {
  oracle('generate');
  const source = fs.readFileSync(path.join(temp, 'reference.smskin'));
  const document = SkinDocument.fromBuffer(source);
  fs.writeFileSync(path.join(temp, 'noop.smskin'), document.toBuffer());
  const edited = document.withTexture('mainDiffuse', fs.readFileSync(path.join(temp, 'replacement.png')));
  fs.writeFileSync(path.join(temp, 'edited.smskin'), edited.toBuffer());
  assert.deepEqual(edited.withTexture('mainDiffuse', document.texture('mainDiffuse')).toBuffer(), source);
  const textures = Object.fromEntries(['mainDiffuse', 'mainEmission', 'helmetDiffuse', 'helmetEmission'].map(role => [role, document.texture(role)]));
  const created = SkinDocument.fromBuffer(SkinDocument.create(textures).toBuffer());
  for (const [role, data] of Object.entries(textures)) assert.deepEqual(created.texture(role), data);
  oracle('verify');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
