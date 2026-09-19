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
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-consumer-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run test:package.');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
try {
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
  assert.equal(packed.length, 1);
  assert.deepEqual(packed[0].files.filter(f => /\.(?:java|class|jar|war)$/i.test(f.path)), [],
    'Published package must not contain Java sources or binaries');
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.js'));
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.d.ts'));
  const consumer = path.join(temp, 'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'decoder-smoke-consumer', private: true, type: 'module' }));
  npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed[0].filename)], consumer);
  const fixture = new AdmZip();
  fixture.addFile('Consumer/header.smbph', Buffer.alloc(36));
  fs.writeFileSync(path.join(consumer, 'consumer.sment'), fixture.toBuffer());
  const script = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Tags, writeTo, readFrom, BlockConfig, parseSment, emptySegment, emptySmd3File, writeSmd3, parseSmd3,
  Smd3Document, readBlueprintDocument, readBlueprintFolderDocument, writeSment, writeBlueprintFolder } from 'starmade-decoder';
assert.equal(readFrom(writeTo(Tags.string('name', '\\u0000\\ud83d\\ude80'))).getString(), '\\u0000\\ud83d\\ude80');
const config = BlockConfig.fromXml('<Config><Block type="5" name="Consumer Hull"><Hitpoints>100</Hitpoints><Mass>2</Mass></Block></Config>');
assert.equal(config.getElementInfoById(5).identity.name, 'Consumer Hull');
assert.equal(config.getElementInfoById(5).block.hp, 100);
const blueprint = parseSment(fs.readFileSync('consumer.sment'));
assert.equal(blueprint.root.name, 'Consumer');
assert.equal(blueprint.complete, true);
const seg = emptySegment(); seg.blocks[0].type = 5;
assert.equal(parseSmd3(writeSmd3({...emptySmd3File(),segments:[seg]})).segments[0].blockCount, 1);
const original = fs.readFileSync('consumer.sment');
const document = readBlueprintDocument(original);
assert.deepEqual(writeSment(document), original);
document.root.segments.push({...emptySmd3File(),segments:[seg]});
document.setFile('notes.bin', Buffer.from([1, 2, 3]));
const edited = readBlueprintDocument(writeSment(document));
assert.equal(edited.root.header.totalBlockCount, 1);
assert.equal(edited.root.segments[0].segments[0].blocks[0].type, 5);
writeBlueprintFolder(document, 'Consumer-folder');
const folder = readBlueprintFolderDocument('Consumer-folder');
assert.equal(folder.root.header.totalBlockCount, 1);
assert.deepEqual(folder.files.get('Consumer-folder/notes.bin'), Buffer.from([1, 2, 3]));
const regionBytes = writeSmd3({...emptySmd3File(),segments:[seg]});
assert.deepEqual(new Smd3Document(regionBytes).toBuffer(), regionBytes);
console.log('Isolated production consumer exercised XML, Tags, SMD3 and complete ZIP/folder writers.');
`;
  fs.writeFileSync(path.join(consumer, 'smoke.mjs'), script);
  const env = { ...process.env }; delete env.NODE_PATH;
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, env, stdio: 'inherit', timeout: 30000 });
  fs.writeFileSync(path.join(consumer, 'smoke.ts'), `import { Tags, writeTo, readFrom, type BlockData, type Smd3ParseOptions,
    readBlueprintDocument, writeBlueprintFolder, type BlueprintFileMap, type BlueprintWriteOptions } from 'starmade-decoder';
const options: Smd3ParseOptions = { mode: 'strict' };
const block: BlockData = {type:1, hp:127, active:true, orientation:0, extra:63};
readFrom(writeTo(Tags.int('value', block.type))); void options;
const exportOptions: BlueprintWriteOptions = { overwrite: true, maxBlocks: 32768 };
function exportBlueprint(bytes: Buffer): BlueprintFileMap {
  const document = readBlueprintDocument(bytes);
  writeBlueprintFolder(document, 'output', exportOptions);
  return document.files;
}
void exportBlueprint;
`);
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true,
    strict: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
  }, files: ['smoke.ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { stdio: 'inherit', timeout: 30000 });
  console.log(`Package consumer validation passed for ${packed[0].filename}.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
