/**
 * @fileoverview Installs the packed SDK in a clean production-only consumer.
 * Requires npm registry access. Never installs development dependencies into
 * the consumer, and tests imports through package exports rather than src/.
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'starmade-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const result = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], {
    cwd: root, encoding: 'utf8', timeout: 120000,
  }));
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ name: 'decoder-consumer-smoke', private: true, type: 'module' }));
  execFileSync(npm, ['install', join(temp, result[0].filename), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: temp, stdio: 'pipe', timeout: 120000,
  });
  writeFileSync(join(temp, 'smoke.mjs'), `
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { Tags, readFrom, writeTo, emptySegment, emptySmd3File, writeSmd3, parseSmd3, setBlock, BlockConfig } from 'starmade-decoder';
assert.equal(readFrom(writeTo(Tags.string('name', '\\ud83d\\ude80\\0'))).getString(), '\\ud83d\\ude80\\0');
const segment = emptySegment();
setBlock(segment, 0, 0, 0, { type: 5, hp: 10, active: false, orientation: 2 });
assert.equal(parseSmd3(writeSmd3({ ...emptySmd3File(), segments: [segment] })).segments[0].blockCount, 1);
assert.equal(typeof BlockConfig.load, 'function');
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('mocha'));
console.log('Production-only packed consumer passed.');
`);
  const message = execFileSync(process.execPath, ['smoke.mjs'], { cwd: temp, encoding: 'utf8', timeout: 30000 });
  assert.match(message, /consumer passed/);
  process.stdout.write(message);
} finally { rmSync(temp, { recursive: true, force: true }); }
