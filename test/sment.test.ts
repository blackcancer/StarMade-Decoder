/**
 * @fileoverview Sment Blueprint Parser Tests
 *
 * Covers .sment blueprint parsing, root entity discovery, segment loading,
 * attached child traversal, and aggregate blueprint statistics.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { parseSment } from '../src/smd3/SmentParser.js';
import { BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';
import type { SmentEntity } from '../src/smd3/SmentParser.js';

const SMENT = path.resolve(
  '/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples',
  'Sobek Dreadnought 2025-jun-02.sment'
);

describe('SmentParser — Sobek Dreadnought 2025-jun-02.sment', function () {
  this.timeout(30_000);

  let sment: ReturnType<typeof parseSment>;

  before(() => {
    const data = fs.readFileSync(SMENT);
    sment = parseSment(data);
  });

  it('parses without errors', () => {
    assert.exists(sment);
    assert.exists(sment.root);
  });

  it('root entity identified', () => {
    const r = sment.root;
    assert.include(r.name.toLowerCase(), 'sobek');
    console.log('    Root name:', r.name);
    console.log('    entityType:', r.header.entityType);
    console.log('    gameVersion:', r.header.gameVersion);
    console.log('    headerVersion:', r.header.headerVersion);
    const bb = r.header.boundingBox;
    console.log('    BoundingBox: min(' + bb.minX.toFixed(1) + ',' + bb.minY.toFixed(1) + ',' + bb.minZ.toFixed(1) + ')' +
                            ' max(' + bb.maxX.toFixed(1) + ',' + bb.maxY.toFixed(1) + ',' + bb.maxZ.toFixed(1) + ')');
    console.log('    totalBlockCount:', r.header.totalBlockCount);
  });

  it('entity and segment count', () => {
    assert.isAbove(sment.totalEntities, 1);
    assert.isAbove(sment.totalSegments, 1);
    console.log('    totalEntities:', sment.totalEntities);
    console.log('    totalSegments:', sment.totalSegments);
    console.log('    root segments:', sment.root.segments.length);
    console.log('    root children (ATTACHED):', sment.root.children.length);
  });

  it('main segments are parsed and non-empty', () => {
    const segs = sment.root.segments;
    assert.isAbove(segs.length, 0);
    for (const smd3 of segs) {
      assert.isAbove(smd3.segments.length, 0);
      console.log('    smd3 file: usedSlots=' + smd3.usedSlots + ' segments=' + smd3.segments.length);
    }
  });

  it('main segment blocks are valid', () => {
    const seg = sment.root.segments[0]?.segments[0];
    if (!seg) { console.log('    (no segment to inspect)'); return; }
    assert.strictEqual(seg.blocks.length, BLOCK_COUNT);
    assert.isAbove(seg.blockCount, 0);
    console.log('    First segment: pos(' + seg.x + ',' + seg.y + ',' + seg.z + ')' +
                ' version=' + seg.version + ' blockCount=' + seg.blockCount);

    // Top 5 types
    const counts = new Map<number, number>();
    for (const b of seg.blocks) {
      if (b.type !== 0) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log('    Top block types:', top.map(([t, c]) => `type=${t}(${c})`).join(', '));
  });

  it('ATTACHED children are parsed', () => {
    const children = sment.root.children;
    assert.isAbove(children.length, 0);

    // Display a few children
    children.slice(0, 3).forEach(c => {
      const seg0 = c.segments[0]?.segments[0];
      console.log('    ATTACHED: ' + c.name +
        ' type=' + c.header.entityType +
        ' blocks=' + c.header.totalBlockCount +
        (seg0 ? ' (smd3 blockCount=' + seg0.blockCount + ')' : ' (no smd3)') +
        ' children=' + c.children.length);
    });

    // Recursively check a few grandchildren
    const withChildren = children.filter(c => c.children.length > 0);
    if (withChildren.length > 0) {
      const wc = withChildren[0];
      console.log('    ATTACHED with children: ' + wc.name + ' -> ' + wc.children.length + ' children');
    }
  });

  it('global blueprint summary', () => {
    // Count all blocks across all segments
    let totalBlocks = 0;
    const countBlocks = (entity: SmentEntity) => {
      for (const smd3 of entity.segments) {
        for (const seg of smd3.segments) {
          totalBlocks += seg.blockCount;
        }
      }
      entity.children.forEach(countBlocks);
    };
    countBlocks(sment.root);

    console.log('    === Blueprint summary ===');
    console.log('    Total entities:', sment.totalEntities);
    console.log('    Total smd3 files:', sment.totalSegments);
    console.log('    Total blocks (in smd3):', totalBlocks);
    console.log('    Declared blocks (header):', sment.root.header.totalBlockCount);
    assert.isAbove(totalBlocks, 0);
  });
});
