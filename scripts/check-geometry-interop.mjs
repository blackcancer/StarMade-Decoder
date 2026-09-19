#!/usr/bin/env node
/**
 * @fileoverview Checks every field of independently produced SINGLE_SIDE_EDGE regions.
 * Python binary32/int32 vectors must match the complete fixed JDK binary corpus.
 * Requires python3; no Java or game runtime is executed.
 * @example npm run build && node scripts/check-geometry-interop.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSmd3, BLOCK_COUNT } from '../dist/smd3/Smd3Parser.js';
import { readIcoSideNormals } from '../dist/smd3/IcoGeometry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-geometry-'));
const filled = { type: 37, hp: 93, active: true, orientation: 17, extra: 42 };
const air = { type: 0, hp: 0, active: false, orientation: 0 };
try {
  execFileSync('python3', ['-B', path.join(root, 'test/fixtures/geometry_oracle.py'), temp], { stdio: 'inherit', timeout: 60000 });
  const reference = fs.readFileSync(path.join(temp, 'geometry.bin'));
  const cases = reference.readInt32BE(0);
  assert.ok(cases > 0);
  assert.equal(reference.length, 4 + cases * (36 + 12 + BLOCK_COUNT));
  let offset = 4;
  let filledPositions = 0;
  for (let id = 0; id < cases; id++) {
    const sideNormals = readIcoSideNormals(reference.subarray(offset, offset + 36)); offset += 36;
    const position = [0, 4, 8].map(delta => reference.readInt32BE(offset + delta)); offset += 12;
    const mask = reference.subarray(offset, offset + BLOCK_COUNT); offset += BLOCK_COUNT;
    const input = fs.readFileSync(path.join(temp, `region-${id}.smd3`));
    const region = parseSmd3(input, { sideNormals });
    assert.equal(region.complete, true);
    assert.deepEqual(region.diagnostics, []);
    assert.equal(region.segments.length, 1);
    const segment = region.segments[0];
    assert.deepEqual([segment.x, segment.y, segment.z], position);
    assert.equal(segment.lastChanged, 123456789n);
    assert.equal(segment.version, 7);
    assert.equal(segment.blocks.length, BLOCK_COUNT);
    let count = 0;
    for (let index = 0; index < BLOCK_COUNT; index++) {
      assert.ok(mask[index] === 0 || mask[index] === 1);
      assert.deepEqual(segment.blocks[index], mask[index] ? filled : air,
        `Pinned geometry mismatch: case=${id}, index=${index}`);
      count += mask[index];
    }
    assert.equal(segment.blockCount, count);
    filledPositions += count;
  }
  assert.ok(filledPositions > 0 && filledPositions < cases * BLOCK_COUNT);
  console.log(`Geometry interoperability passed: ${cases} independent regions matching fixed JDK vectors, ${cases * BLOCK_COUNT} complete block-field comparisons (${filledPositions} filled positions).`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
