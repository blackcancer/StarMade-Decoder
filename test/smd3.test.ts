/**
 * @fileoverview Smd3 Parser Tests
 *
 * Covers .smd3 parsing, segment indexing, blockk reads, and type statistics.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { parseSmd3, indexToPos, getBlock, CHUNK_DIM, BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const SMD3 = path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3');

describe('Smd3Parser — .smd3 file', function () {
  this.timeout(10_000);

  let file: ReturnType<typeof parseSmd3>;

  before(() => {
    const data = fs.readFileSync(SMD3);
    file = parseSmd3(data);
  });

  it('parses without errors', () => {
    assert.exists(file);
  });

  it('headerVersion is readable', () => {
    assert.isNumber(file.headerVersion);
    console.log('    headerVersion:', file.headerVersion);
  });

  it('at least one non-empty segment', () => {
    assert.isAbove(file.usedSlots, 0);
    assert.isAbove(file.segments.length, 0);
    console.log('    usedSlots:', file.usedSlots, '  parsed segments:', file.segments.length);
  });

  it('segment contains valid blocks', () => {
    const seg = file.segments[0];
    assert.isNumber(seg.x);
    assert.isNumber(seg.y);
    assert.isNumber(seg.z);
    assert.isAbove(seg.blockCount, 0);
    assert.strictEqual(seg.blocks.length, BLOCK_COUNT);

    console.log('    Segment[0] pos:(' + seg.x + ',' + seg.y + ',' + seg.z + ')');
    console.log('    version:', seg.version, '  blockCount:', seg.blockCount);
    console.log('    lastChanged:', seg.lastChanged.toString());

    // Display the first five non-empty blockks
    console.log('    First non-empty blocks:');
    let shown = 0;
    for (let i = 0; i < BLOCK_COUNT && shown < 5; i++) {
      const b = seg.blocks[i];
      if (b.type !== 0) {
        const p = indexToPos(i);
        console.log('      (' + p.x + ',' + p.y + ',' + p.z + ') type=' + b.type + ' hp=' + b.hp + ' active=' + (b.active ? 'Y' : 'N') + ' ori=' + b.orientation);
        shown++;
      }
    }
  });

  it('pos↔index mapping is consistent', () => {
    for (const [x, y, z] of [[0,0,0],[1,2,3],[31,31,31],[15,8,4]] as [number,number,number][]) {
      const idx = x + y * CHUNK_DIM + z * CHUNK_DIM * CHUNK_DIM;
      const pos = indexToPos(idx);
      assert.equal(pos.x, x, 'x mismatch');
      assert.equal(pos.y, y, 'y mismatch');
      assert.equal(pos.z, z, 'z mismatch');
    }
  });

  it('block type statistics', () => {
    const seg = file.segments[0];
    const typeCounts: Map<number, number> = new Map();
    for (const b of seg.blocks) {
      if (b.type !== 0) {
        typeCounts.set(b.type, (typeCounts.get(b.type) ?? 0) + 1);
      }
    }
    const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log('    Block types (top 5):');
    sorted.slice(0, 5).forEach(([type, count]) =>
      console.log('      type=' + type + '  count=' + count)
    );
    assert.isAbove(typeCounts.size, 0);
  });
});
