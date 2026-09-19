#!/usr/bin/env node
/**
 * @fileoverview Independent JDK qualification of public blueprint document exports.
 * BlueprintOracle.java pins the local StarMade-Open reference and limits the claim:
 * wire-format interoperability for these vectors, never an actual in-game import.
 * Requires built dist and a full JDK; no npm package or game runtime is downloaded.
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
  BlueprintLogic, emptySegment, emptySmd3File, writeSment,
} from '../dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-blueprint-'));
const time = 123456789n;
const sdkVersion = 'sdk\0🚀';
const air = () => ({ type: 0, hp: 0, active: false, orientation: 0 });
const index = (x, y, z) => x + y * 32 + z * 1024;
const java = (...args) => execFileSync('java', args, { stdio: 'inherit', timeout: 30000 });
try {
  java('-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', temp,
    path.join(root, 'test/fixtures/BlueprintOracle.java'));
  java('-cp', temp, 'BlueprintOracle', 'generate', temp);
  const original = fs.readFileSync(path.join(temp, 'java.sment'));
  assert.ok(original.readUInt16LE(6) & 8, 'JDK fixture must contain data descriptors');
  const document = BlueprintDocument.fromSment(original);
  assert.deepEqual(document.toBuffer(), original, 'Java ZIP no-op must be byte-exact');
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
  assert.deepEqual(document.toBuffer(), original, 'edit/revert must restore exact Java ZIP');

  // Build this archive exclusively from caller-created models, without parsing Java bytes.
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
  java('-cp', temp, 'BlueprintOracle', 'verify', temp);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
