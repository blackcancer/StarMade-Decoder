/** @fileoverview Byte-preserving SMD3 edits over independently encoded region layouts. */
import { assert } from 'chai';
import { Smd3Document } from '../../src/smd3/Smd3Document.js';
import { BLOCK_COUNT, HEADER_SIZE, SEGMENT_SECTOR, parseSmd3, decodeBlockWord } from '../../src/smd3/Smd3Parser.js';
import { emptySegment, emptySmd3File, writeSmd3 } from '../../src/smd3/Smd3Writer.js';
import type { Smd3File } from '../../src/smd3/Smd3Parser.js';

/** Independent table index for fixtures in the region containing the origin. */
function cell(x = 0, y = 0, z = 0): number {
  return (((x >> 5) + 8) & 15) + ((((y >> 5) + 8) & 15) << 4) + ((((z >> 5) + 8) & 15) << 8);
}
/** Synthetic geometry context used only by the second fixture record. */
const sideNormals = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] as const;
/** Noncanonical layout: v6 SINGLE at sector3, v7 geometry at sector1, holes and trailing bytes. */
function source(): Buffer {
  const data = Buffer.alloc(HEADER_SIZE + 4 * SEGMENT_SECTOR + 11, 0x9d);
  data.fill(0, 0, HEADER_SIZE); data[0] = 6; data[1] = 0xa1; data[2] = 0xb2; data[3] = 0xc3;
  for (const [x, offset, version, kind, word] of [[0, 3, 6, 3, 5 | (93 << 11) | (1 << 18) | (17 << 19)],
    [32, 1, 7, 5, (37 | (91 << 13) | (1 << 20) | (17 << 21) | (42 << 26)) >>> 0]]) {
    data.writeInt16BE(offset, 4 + cell(x) * 4); data.writeUInt16BE(26, 6 + cell(x) * 4);
    const start = HEADER_SIZE + (offset - 1) * SEGMENT_SECTOR;
    data[start] = version; data.writeBigInt64BE(123456789n + BigInt(x), start + 1);
    data.writeInt32BE(x, start + 9); data.writeInt32BE(0, start + 13); data.writeInt32BE(0, start + 17);
    data[start + 21] = kind; data.writeUInt32BE(word, start + 22);
  }
  data.writeInt16BE(4, 4 + cell(64) * 4); // Allocated but empty cell.
  return data;
}
/** New complete model for document replacement tests. */
function model(...segments: ReturnType<typeof emptySegment>[]): Smd3File {
  return { ...emptySmd3File(), segments };
}

describe('Smd3Document', () => {
  it('preserves original versions, codecs, sectors, padding, holes and tail exactly', () => {
    const bytes = source(); const original = Buffer.from(bytes);
    const document = new Smd3Document(new Uint8Array(bytes), { sideNormals });
    bytes.fill(0);
    assert.deepEqual(document.toBuffer(), original);
    const output = document.toBuffer(); output.fill(0);
    assert.deepEqual(document.toBuffer(), original);
    document.file.segments.reverse();
    document.file.usedSlots = 999;
    document.file.segments[0].blockCount = -42;
    document.file.segments[1].blocks[0].extra = 0;
    assert.deepEqual(document.toBuffer(), original);
  });

  it('detects nested mutations and reverts without rewriting untouched optimized records', () => {
    const original = source(); const document = new Smd3Document(original, { sideNormals });
    const segment = document.file.segments[0];
    const old = segment.blocks[5].hp; segment.blocks[5].hp = 1;
    const output = document.toBuffer();
    assert.notDeepEqual(output, original);
    const editedStart = HEADER_SIZE + 2 * SEGMENT_SECTOR;
    const editedSize = output.readUInt16BE(6 + cell() * 4);
    assert.equal(output[editedStart], 7);
    assert.deepEqual(output.subarray(0, 4), original.subarray(0, 4));
    const expected = Buffer.from(original);
    output.copy(expected, 6 + cell() * 4, 6 + cell() * 4, 8 + cell() * 4);
    output.copy(expected, editedStart, editedStart, editedStart + editedSize);
    assert.deepEqual(output, expected);
    const parsed = parseSmd3(output, { sideNormals });
    assert.equal(parsed.segments[0].blocks[5].hp, 1);
    assert.equal(parsed.segments[0].lastChanged, segment.lastChanged);
    assert.deepEqual(parsed.segments[1], document.file.segments[1]);
    segment.blocks[5].hp = old;
    assert.deepEqual(document.toBuffer(), original);
  });

  it('detects scalar edits and accepts a detached equivalent replacement model', () => {
    const original = source(); const document = new Smd3Document(original, { sideNormals });
    const replacement = structuredClone(document.file);
    assert.deepEqual(document.toBuffer(replacement), original);
    replacement.segments[0].lastChanged++;
    const output = document.toBuffer(replacement);
    assert.equal(parseSmd3(output, { sideNormals }).segments[0].lastChanged, replacement.segments[0].lastChanged);
    assert.deepEqual(document.toBuffer(), original);
    replacement.segments[0].lastChanged--;
    replacement.segments[0].version = 7;
    assert.equal(document.toBuffer(replacement)[HEADER_SIZE + 2 * SEGMENT_SECTOR], 7);
  });

  it('retains original allocation and bytes when removing a segment', () => {
    const original = source(); const document = new Smd3Document(original, { sideNormals });
    document.file.segments.shift();
    const expected = Buffer.from(original); expected.writeUInt16BE(0, 6 + cell() * 4);
    assert.deepEqual(document.toBuffer(), expected);
    assert.equal(parseSmd3(document.toBuffer(), { sideNormals }).segments.length, 1);
  });

  it('reuses a destination cell allocation and appends additions beyond the preserved tail', () => {
    const original = source(); const options = { sideNormals, maxInputBytes: 2_000_000 };
    const document = new Smd3Document(original, options);
    options.maxInputBytes = 0;
    const reused = emptySegment(64), appended = emptySegment(96);
    reused.blocks[1].type = 8; appended.blocks[2].type = 9;
    document.file.segments.push(reused, appended);
    const output = document.toBuffer();
    assert.equal(output.readInt16BE(4 + cell(64) * 4), 4);
    assert.equal(output.readInt16BE(4 + cell(96) * 4), 6);
    assert.equal(output.length, HEADER_SIZE + 6 * SEGMENT_SECTOR);
    assert.deepEqual(output.subarray(HEADER_SIZE + 4 * SEGMENT_SECTOR, original.length), original.subarray(HEADER_SIZE + 4 * SEGMENT_SECTOR));
    assert.deepEqual(output.subarray(HEADER_SIZE + SEGMENT_SECTOR, HEADER_SIZE + 2 * SEGMENT_SECTOR), original.subarray(HEADER_SIZE + SEGMENT_SECTOR, HEADER_SIZE + 2 * SEGMENT_SECTOR));
    const parsed = parseSmd3(output, { sideNormals });
    assert.equal(parsed.segments.find(s => s.x === 64)!.blocks[1].type, 8);
    assert.equal(parsed.segments.find(s => s.x === 96)!.blocks[2].type, 9);
  });

  it('moves segments without recycling or overwriting their former sector', () => {
    const original = source(); const document = new Smd3Document(original, { sideNormals });
    document.file.segments[0].x = 96;
    const output = document.toBuffer();
    assert.equal(output.readInt16BE(4 + cell() * 4), 3);
    assert.equal(output.readUInt16BE(6 + cell() * 4), 0);
    assert.equal(output.readInt16BE(4 + cell(96) * 4), 6);
    assert.deepEqual(output.subarray(HEADER_SIZE + 2 * SEGMENT_SECTOR, HEADER_SIZE + 3 * SEGMENT_SECTOR), original.subarray(HEADER_SIZE + 2 * SEGMENT_SECTOR, HEADER_SIZE + 3 * SEGMENT_SECTOR));
    assert.deepEqual(parseSmd3(output, { sideNormals }).segments.map(s => s.x), [32, 96]);
  });

  it('preserves partial final sectors and permits explicit header-byte edits', () => {
    const original = writeSmd3(model(emptySegment())).subarray(0, HEADER_SIZE + 22);
    const document = new Smd3Document(original);
    document.file.headerVersion = 9;
    const expected = Buffer.from(original); expected[0] = 9;
    assert.deepEqual(document.toBuffer(), expected);
    document.file.segments[0].blocks[0].type = 1;
    const output = document.toBuffer();
    assert.isAbove(output.length, original.length);
    assert.equal(output.length, HEADER_SIZE + output.readUInt16BE(6 + cell() * 4));
    assert.equal(parseSmd3(output).segments[0].blocks[0].type, 1);
  });

  it('allows untouched pre-v6 records but rejects their implicit migration on edit', () => {
    const bytes = writeSmd3(model(emptySegment())); bytes[HEADER_SIZE] = 3;
    const document = new Smd3Document(bytes);
    assert.deepEqual(document.toBuffer(), bytes);
    document.file.segments[0].blocks[0].type = 1;
    assert.throws(() => document.toBuffer(), /migration/);
  });

  it('supports an empty source and its first region, including negative coordinates', () => {
    const bytes = writeSmd3(emptySmd3File());
    const document = new Smd3Document(bytes);
    assert.deepEqual(document.toBuffer(), bytes);
    const file = model(emptySegment(-512));
    assert.equal(parseSmd3(document.toBuffer(file)).segments[0].x, -512);
    file.segments.push(emptySegment(-480));
    assert.equal(parseSmd3(document.toBuffer(file)).segments.length, 2);
  });

  it('rejects partial recovery at construction and at serialization', () => {
    const corrupt = writeSmd3(model(emptySegment())); corrupt[HEADER_SIZE + 21] = 99;
    assert.throws(() => new Smd3Document(corrupt, { mode: 'recover' }), /incomplete/);
    const document = new Smd3Document(writeSmd3(emptySmd3File()));
    assert.throws(() => document.toBuffer({ ...model(), complete: false }), /incomplete/);
    assert.throws(() => document.toBuffer({ ...model(), diagnostics: [{ code: 'E_FORMAT', message: 'omitted' }] }), /incomplete/);
    assert.doesNotThrow(() => document.toBuffer({ headerVersion: 7, usedSlots: 0, segments: [] }));
  });

  it('rejects ambiguous sector allocation and misplaced source records', () => {
    let bytes = source(); bytes.writeInt16BE(-1, 4 + cell(64) * 4);
    assert.throws(() => new Smd3Document(bytes, { sideNormals }), /allocation/);
    bytes = source(); bytes.writeInt16BE(3, 4 + cell(64) * 4);
    assert.throws(() => new Smd3Document(bytes, { sideNormals }), /allocation/);
    bytes = source(); bytes.writeInt32BE(96, HEADER_SIZE + 2 * SEGMENT_SECTOR + 9);
    assert.throws(() => new Smd3Document(bytes, { sideNormals }), /table cell/);
    bytes = source(); bytes.writeInt32BE(544, HEADER_SIZE + 9);
    assert.throws(() => new Smd3Document(bytes, { sideNormals }), /different regions/);
  });

  it('applies immutable input, output, block and table-count budgets', () => {
    const original = writeSmd3(model(emptySegment()));
    assert.throws(() => new Smd3Document(original, { maxInputBytes: original.length - 1 }), /input byte budget/);
    assert.throws(() => new Smd3Document(original, { maxBlocks: 0 }), /block budget/);
    assert.throws(() => new Smd3Document(original, { maxInputBytes: -1 }));
    const document = new Smd3Document(original, { maxInputBytes: original.length, maxBlocks: 2 * BLOCK_COUNT });
    assert.throws(() => document.toBuffer(model(emptySegment(), emptySegment(32))), /output byte budget/);
    assert.throws(() => document.toBuffer(model(emptySegment(), emptySegment(32), emptySegment(64))), /block budget/);
    assert.throws(() => document.toBuffer({ ...model(), segments: Array(4097) }), /segment count/);
    assert.throws(() => document.toBuffer({ ...model(), headerVersion: 256 }), /headerVersion/);
  });

  it('rejects duplicate target cells, foreign regions and invalid aligned coordinates', () => {
    const document = new Smd3Document(writeSmd3(model(emptySegment())));
    assert.throws(() => document.toBuffer(model(emptySegment(), emptySegment())), /Duplicate/);
    assert.throws(() => document.toBuffer(model(emptySegment(512))), /different/);
    for (const x of [NaN, 1, -2147483680, 2147483648]) {
      assert.throws(() => document.toBuffer(model(emptySegment(x))), /coordinates/);
    }
  });

  it('rejects invalid timestamps, versions, arrays and block fields before writing', () => {
    const document = new Smd3Document(writeSmd3(emptySmd3File()));
    for (const lastChanged of [1, -0x8000000000000001n, 0x8000000000000000n]) {
      const segment = emptySegment(); segment.lastChanged = lastChanged as bigint;
      assert.throws(() => document.toBuffer(model(segment)), /timestamp/);
    }
    const segment = emptySegment(); segment.version = NaN;
    assert.throws(() => document.toBuffer(model(segment)), /version/);
    segment.version = 7; segment.blocks = null as any;
    assert.throws(() => document.toBuffer(model(segment)), /blocks/);
    segment.blocks = [];
    assert.throws(() => document.toBuffer(model(segment)), /blocks/);
    segment.blocks = emptySegment().blocks; segment.blocks[0].type = -1;
    assert.throws(() => document.toBuffer(model(segment)), /block.type/);
  });

  it('rejects offset exhaustion and oversized records without changing source/model', () => {
    const bytes = writeSmd3(emptySmd3File()); bytes.writeInt16BE(32767, 4 + cell(64) * 4);
    const document = new Smd3Document(bytes);
    assert.deepEqual(document.toBuffer(), bytes);
    assert.throws(() => document.toBuffer(model(emptySegment())), /offset capacity/);
    assert.throws(() => document.toBuffer(model(emptySegment(64))), /output byte budget/);
    const normal = new Smd3Document(writeSmd3(model(emptySegment())));
    let seed = 123456789;
    const noisy = emptySegment();
    noisy.blocks = Array.from({ length: BLOCK_COUNT }, () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return decodeBlockWord(seed >>> 0);
    });
    assert.throws(() => normal.toBuffer(model(noisy)), /sector capacity/);
    assert.deepEqual(normal.toBuffer(), writeSmd3(normal.file));
  });
});
