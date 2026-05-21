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
import { deflateSync } from 'zlib';
import { assert } from 'chai';
import {
  parseSmd3,
  indexToPos,
  getBlock,
  CHUNK_DIM,
  BLOCK_COUNT,
  HEADER_SIZE,
  SEGMENT_SECTOR,
  DATA_AVAILABLE,
} from '../src/smd3/Smd3Parser.js';

const S = path.resolve('samples');
const SMD3 = path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3');

function makeVersion6Smd3WithBlock(block: { type: number; hp: number; active: boolean; orientation: number }): Buffer {
  const out = Buffer.alloc(HEADER_SIZE + SEGMENT_SECTOR);
  out.writeUInt8(6, 0);
  out.writeInt16BE(1, 4);
  out.writeUInt16BE(SEGMENT_SECTOR, 6);

  let off = HEADER_SIZE;
  out.writeUInt8(6, off); off += 1;
  out.writeBigInt64BE(123n, off); off += 8;
  out.writeInt32BE(0, off); off += 4;
  out.writeInt32BE(0, off); off += 4;
  out.writeInt32BE(0, off); off += 4;
  out.writeUInt8(DATA_AVAILABLE, off); off += 1;

  const raw = Buffer.alloc(BLOCK_COUNT * 3);
  const encoded =
    (block.type & 0x7ff) |
    ((block.hp & 0x7f) << 11) |
    ((block.active ? 1 : 0) << 18) |
    ((block.orientation & 0x1f) << 19);
  raw[0] = encoded & 0xff;
  raw[1] = (encoded >> 8) & 0xff;
  raw[2] = (encoded >> 16) & 0xff;

  const compressed = deflateSync(raw);
  out.writeInt32BE(compressed.length, off); off += 4;
  compressed.copy(out, off);
  return out;
}

describe('Smd3Parser — version 6 block encoding', () => {
  it('decodes three-byte blocks with the Java SegmentDataIntArray layout', () => {
    const parsed = parseSmd3(makeVersion6Smd3WithBlock({
      type: 823,
      hp: 64,
      active: true,
      orientation: 17,
    }));

    assert.equal(parsed.headerVersion, 6);
    assert.equal(parsed.segments.length, 1);
    assert.equal(parsed.segments[0].blockCount, 1);
    assert.deepEqual(getBlock(parsed.segments[0], 0, 0, 0), {
      type: 823,
      hp: 64,
      active: true,
      orientation: 17,
    });
  });
});

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
