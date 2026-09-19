#!/usr/bin/env node
/**
 * @fileoverview Tests the actual npm tarball in an isolated production consumer.
 * Requires registry access or a populated npm cache. SDK development dependencies
 * must not be used to satisfy the installed package's runtime imports.
 * @example npm run build && npm run test:package
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-consumer-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run test:package.');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
try {
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
  assert.equal(packed.length, 1);
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.js'));
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.d.ts'));
  const consumer = path.join(temp, 'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'decoder-smoke-consumer', private: true, type: 'module' }));
  npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed[0].filename)], consumer);
  const script = `
import assert from 'node:assert/strict';
import { Tags, writeTo, readFrom, BlockConfig, parseSment, emptySegment, emptySmd3File, writeSmd3, parseSmd3 } from 'starmade-decoder';
assert.equal(readFrom(writeTo(Tags.string('name', '\\u0000\\ud83d\\ude80'))).getString(), '\\u0000\\ud83d\\ude80');
assert.equal(typeof BlockConfig.fromXml, 'function');
assert.equal(typeof parseSment, 'function');
const seg = emptySegment(); seg.blocks[0].type = 5;
assert.equal(parseSmd3(writeSmd3({...emptySmd3File(),segments:[seg]})).segments[0].blockCount, 1);
console.log('Isolated production consumer imported XML/ZIP APIs and exercised Tags and SMD3.');
`;
  fs.writeFileSync(path.join(consumer, 'smoke.mjs'), script);
  const env = { ...process.env }; delete env.NODE_PATH;
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, env, stdio: 'inherit', timeout: 30000 });
  fs.writeFileSync(path.join(consumer, 'smoke.ts'), `import { Tags, writeTo, readFrom, type BlockData, type Smd3ParseOptions } from 'starmade-decoder';
const options: Smd3ParseOptions = { mode: 'strict' };
const block: BlockData = {type:1, hp:127, active:true, orientation:0, extra:63};
readFrom(writeTo(Tags.int('value', block.type))); void options;
`);
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true,
    strict: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
  }, files: ['smoke.ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { stdio: 'inherit', timeout: 30000 });
  console.log(`Package consumer validation passed for ${packed[0].filename}.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
