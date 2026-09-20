#!/usr/bin/env node
/**
 * @fileoverview Independent Python qualification of public blueprint document exports.
 * Source-entry vectors are pinned to external JDK binary captures. ZIP local
 * records and zipfile independently verify CRCs, descriptors and all contents.
 * Requires built dist and python3; this is neither a JDK run nor an in-game import.
 * @example npm run build && node scripts/check-blueprint-interop.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BlueprintDocument, BlueprintArchive, BlueprintEntity, BlueprintHeader, BlueprintMeta,
  BlueprintLogic, BlueprintModMappings, emptySegment, emptySmd3File, writeSment, parseSmbmm, writeSmbmm,
} from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-blueprint-'));
const time = 123456789n;
const sdkVersion = 'sdk\0🚀';
const air = () => ({ type: 0, hp: 0, active: false, orientation: 0 });
const index = (x, y, z) => x + y * 32 + z * 1024;
const oracle = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/blueprint_oracle.py'), mode, temp], { stdio: 'inherit', timeout: 30000 });
const mappingOracle = mode => execFileSync('python3', ['-B', path.join(root, 'test/fixtures/blueprint_mappings_oracle.py'), mode, temp], { stdio: 'inherit', timeout: 30000 });
try {
  // Independent Python vectors are separate from the pinned JDK archive inventory.
  mappingOracle('generate');
  const expectedMappings = [
    { modName: 'Étoiles🚀', blockName: 'Cœur: α', id: -32768 },
    { modName: '工具包', blockName: '反应堆', id: 32767 },
    { modName: 'naïve mod', blockName: 'bloc e\u0301', id: -1 },
    { modName: 'vanilla-ish', blockName: 'zéro', id: 0 },
    { modName: 'signes', blockName: 'positif', id: 12 },
  ];
  const replacedMapping = { ...expectedMappings[0], id: -12345 };
  const addedMapping = { modName: 'Nouvelle🛰️', blockName: '氧气 Δ', id: 32767 };
  for (const kind of ['text', 'zlib']) {
    const input = fs.readFileSync(path.join(temp, `mappings-${kind}.smbmm`));
    const model = BlueprintModMappings.fromBuffer(input);
    assert.equal(model.compression, kind === 'zlib' ? 'zlib' : 'none');
    assert.deepEqual(model.mappings, expectedMappings);
    assert.equal(model.idOf('Étoiles🚀', 'Cœur: α'), -32768);
    assert.deepEqual(model.get(32767), expectedMappings[1]);
    fs.writeFileSync(path.join(temp, `mappings-${kind}-model-noop.smbmm`), model.toBuffer());
    const edited = model.withMapping(replacedMapping).withoutId(32767).withMapping(addedMapping);
    fs.writeFileSync(path.join(temp, `mappings-${kind}-model-edited.smbmm`), edited.toBuffer());
    assert.deepEqual(model.toBuffer(), input, 'Mapping edits must leave the source unchanged');

    const file = parseSmbmm(input);
    assert.equal(file.format, kind === 'zlib' ? 'zlibText' : 'text');
    assert.equal(file.isEmpty, false);
    assert.deepEqual(file.namespacedMappings, expectedMappings);
    fs.writeFileSync(path.join(temp, `mappings-${kind}-codec-noop.smbmm`), writeSmbmm(file));
    file.namespacedMappings = [replacedMapping, ...expectedMappings.slice(2), addedMapping];
    fs.writeFileSync(path.join(temp, `mappings-${kind}-codec-edited.smbmm`), writeSmbmm(file));
  }
  mappingOracle('verify');
  oracle('generate');
  const original = fs.readFileSync(path.join(temp, 'reference.sment'));
  assert.ok(original.readUInt16LE(6) & 8, 'Independent fixture must contain data descriptors');
  const document = BlueprintDocument.fromSment(original);
  assert.deepEqual(document.toBuffer(), original, 'Independent ZIP no-op must be byte-exact');
  fs.writeFileSync(path.join(temp, 'noop.sment'), writeSment(document));

  const segment = document.root.segments[0].segments[0];
  const filled = { type: 37, hp: 93, active: true, orientation: 17, extra: 42 };
  assert.deepEqual(segment.blocks[0], filled);
  const originalBlocks = segment.blocks;
  segment.blocks = Array.from({ length: 32768 }, air);
  segment.blocks[0] = filled;
  segment.blocks[index(31, 30, 29)] = { type: 11, hp: 127, active: false, orientation: 31, extra: 63 };
  segment.blocks[index(17, 18, 19)] = { type: 37, hp: 1, active: false, orientation: 0, extra: 1 };
  segment.lastChanged = time + 1n;
  document.root.header.classification = 7;
  document.root.header.gameVersion = sdkVersion;
  document.removeFile('delete.me').setFile('added.bin', Buffer.from([9, 0, 254]));
  fs.writeFileSync(path.join(temp, 'edited.sment'), document.toBuffer());

  // Mutation tracking must recognize a semantic revert, including the original SINGLE.
  segment.blocks = originalBlocks; segment.lastChanged = time;
  document.root.header.classification = 2; document.root.header.gameVersion = 'java\0🚀';
  document.removeFile('added.bin').setFile('delete.me', Buffer.from([11, 12]));
  assert.deepEqual(document.toBuffer(), original, 'edit/revert must restore exact input ZIP');

  // Build this archive exclusively from caller-created models, without parsing reference bytes.
  const negative = emptySegment(-32, 32, -64), positive = emptySegment(32, 0, 0), empty = emptySegment(0, -32, 0);
  for (const item of [negative, positive, empty]) item.lastChanged = time + 2n;
  negative.blocks[index(31, 0, 16)] = { type: 511, hp: 73, active: true, orientation: 5, extra: 12 };
  positive.blocks[index(0, 31, 31)] = { type: 8191, hp: 127, active: true, orientation: 31, extra: 63 };
  const entity = new BlueprintEntity({
    name: 'SDKShip',
    header: new BlueprintHeader({ headerVersion: 5, gameVersion: sdkVersion, entityType: 'SHIP', classification: 7,
      boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }, blockCountByType: [], score: null }),
    meta: new BlueprintMeta({ metaVersion: 5, manager: null, dockingEntries: [], railUID: 'sdk-rail',
      railRootMin: null, railRootMax: null, wirelessMarkers: [], railChildren: [], childTransforms: [],
      aiConfig: null, railDockerPieces: [], cargoPoints: [], lockBoxPoints: [], thrustConfig: null }),
    logic: new BlueprintLogic({ structureVersion: 0, links: [], controllerCount: 0,
      controllers: [{ x: -17, y: 16, z: -64, groups: [{ type: 8191, targets: [{ x: 16, y: 15, z: 15 }] }] }] }),
    offset: { x: 0, y: 0, z: 0 }, worldOffset: { x: 0, y: 0, z: 0 }, children: [],
    segments: [{ ...emptySmd3File(), segments: [negative, positive, empty] }],
  });
  const archive = new BlueprintArchive(entity);
  const created = writeSment(archive);
  assert.deepEqual(BlueprintDocument.fromArchive(archive).toBuffer(), created,
    'document factory and direct writer must agree for a new archive');
  fs.writeFileSync(path.join(temp, 'created.sment'), created);
  oracle('verify');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
