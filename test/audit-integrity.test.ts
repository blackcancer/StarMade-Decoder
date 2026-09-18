/**
 * @fileoverview Data-integrity regressions for the September 2026 audit.
 * Fixtures are constructed independently at the wire level wherever practical.
 * These tests must never accept partial data without explicit diagnostics.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { BufferReader, BufferWriter, Tag, TagType, Tags, readFrom, writeTo,
  registerAllFactories, readTagDocument, parseSmd3, writeSmd3, emptySegment, emptySmd3File, setBlock,
  indexToPos, posToIndex, parseSment, parseBlueprintFolder, readIcoSideNormals,
  parseSmbph, parseSmbpm, writeSmbpm, parseSmbpl } from '../src/index.js';
import { decodeBlockWord, HEADER_SIZE, SEGMENT_SECTOR, BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';
import { encodeLz4Block, decodeLz4Block } from '../src/smd3/Lz4Block.js';
import { BlueprintReadContext } from '../src/smd3/BlueprintReadContext.js';
import { isPointInIcoSide } from '../src/smd3/IcoGeometry.js';
import { ControlElementMapper } from '../src/objects/Serializables.js';
import { SerializableTagRegister } from '../src/serializable/SerializableTagRegister.js';
import { RawElement } from '../src/serializable/Factories.js';
import { ManagerContainer } from '../src/objects/components/ManagerContainer.js';

/** Minimal independently constructed v0 blueprint header, not an SDK round trip. */
function header(): Buffer { return Buffer.alloc(36); }
/** Makes one exact region table entry, with padding outside the record. */
function region(record: Buffer, size = record.length): Buffer {
  const b = Buffer.alloc(HEADER_SIZE + SEGMENT_SECTOR);
  b[0] = 7; b.writeInt16BE(1, 4); b.writeUInt16BE(size, 6);
  record.copy(b, HEADER_SIZE); return b;
}
/** Makes the common segment header independently of Smd3Writer. */
function record(kind: number, payload = Buffer.alloc(0), version = 7): Buffer {
  const b = Buffer.alloc(22 + payload.length);
  b[0] = version; b.writeBigInt64BE(123n, 1); b[21] = kind;
  payload.copy(b, 22); return b;
}
/** Makes named empty entities in a real ZIP archive. */
function archive(names: string[], additional: Record<string, Buffer> = {}): Buffer {
  const z = new AdmZip();
  for (const name of names) z.addFile(`${name}/header.smbph`, header());
  for (const [name, bytes] of Object.entries(additional)) z.addFile(name, bytes);
  return z.toBuffer();
}
/** Builds a deterministic incompressible buffer without non-reproducible random data. */
function noise(length: number): Buffer {
  let seed = 0x12345678;
  return Buffer.from(Array.from({ length }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed & 255;
  }));
}

registerAllFactories();

const normals = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] as const;

describe('Audit integrity — binary primitives and Tags', () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects readBytes(${invalid}) without moving the cursor`, () => {
      const r = BufferReader.from(Buffer.alloc(8)); r.readInt32BE();
      assert.throws(() => r.readBytes(invalid)); assert.equal(r.offset, 4);
    });
  }
  it('rejects invalid snapshot bounds without changing state', () => {
    const r = BufferReader.from(Buffer.alloc(8));
    assert.throws(() => r.snapshot(-1, 3)); assert.throws(() => r.snapshot(4, 2));
    assert.throws(() => r.snapshot(0, 9)); assert.equal(r.offset, 0);
  });
  it('rejects negative, impossible and over-budget collection counts', () => {
    for (const [value, width, limit] of [[-1, 0, 99], [100, 4, 1000], [2, 0, 1]]) {
      const b = Buffer.alloc(4); b.writeInt32BE(value);
      assert.throws(() => BufferReader.from(b).readCount(width, limit));
    }
  });
  it('grows a zero-capacity writer, and returns detached snapshots', () => {
    const w = new BufferWriter(0); w.writeUInt8(42);
    const a = w.toBuffer(); a[0] = 0; assert.equal(w.toBuffer()[0], 42);
  });
  it('checks capacity and string limits before writing', () => {
    assert.throws(() => new BufferWriter(-1));
    const w = new BufferWriter(0, 1); w.writeUInt8(1);
    assert.throws(() => w.writeUInt8(2)); assert.equal(w.position, 1);
    const utf = new BufferWriter();
    assert.throws(() => utf.writeJavaUTF('\u0000'.repeat(32768))); assert.equal(utf.position, 0);
  });
  it('rejects fractional and non-finite integers without silent coercion', () => {
    const w = new BufferWriter();
    for (const value of [NaN, Infinity, 1.5]) {
      assert.throws(() => w.writeInt32BE(value));
      assert.throws(() => w.writeUInt8(value));
    }
    assert.equal(w.position, 0);
  });
  it('does not advance a writer after a failing one-byte primitive', () => {
    const w = new BufferWriter(); assert.throws(() => w.writeInt8(128));
    assert.throws(() => w.writeUInt8(-1)); assert.equal(w.position, 0);
  });
  for (const malformed of ['0002c241', '0003e28241', '0003e24180', '0001c2', '0002e280', '0004f09f9880']) {
    it(`rejects malformed modified UTF ${malformed} transactionally`, () => {
      const r = BufferReader.from(Buffer.from(malformed, 'hex'));
      assert.throws(() => r.readJavaUTF()); assert.equal(r.offset, 0);
    });
  }
  for (const value of ['\u0000', '\uD83D\uDE80', '\uD800', 'é\u0000中', 'x'.repeat(65535)]) {
    it(`preserves Java strings through complete Tag parsing (${value.length} UTF-16 units)`, () => {
      const tag = Tags.string('name\u0000\uD800', value);
      const bytes = writeTo(tag); const parsed = readFrom(bytes);
      assert.equal(parsed.name, tag.name); assert.equal(parsed.getString(), value);
      if (value === '\u0000') assert.include(bytes.toString('hex'), '0002c080');
    });
  }
  it('reads an independently constructed Java NUL STRING Tag', () => {
    const wire = Buffer.from('0000080001730002c080', 'hex');
    assert.equal(readFrom(wire).getString(), '\u0000');
    assert.deepEqual(writeTo(Tags.string('s', '\u0000')), wire);
  });
  it('preserves the complete uncompressed envelope, version and tail', () => {
    const b = Buffer.concat([writeTo(Tags.int('n', 1)), Buffer.from('cafe', 'hex')]); b.writeInt16BE(42);
    const d = readTagDocument(b); assert.deepEqual(d.toBuffer(), b);
    const edited = d.toBuffer(Tags.int('n', 2));
    assert.equal(edited.readInt16BE(), 42); assert.equal(readFrom(edited).getInt(), 2);
    assert.equal(edited.subarray(-2).toString('hex'), 'cafe');
    const tail = d.trailingData; tail.fill(0); assert.equal(d.trailingData.toString('hex'), 'cafe');
    assert.throws(() => readFrom(b, { allowTrailingBytes: false }), /Trailing/);
  });
  it('preserves unchanged GZIP bytes and its uncompressed tail on edit', () => {
    const payload = Buffer.concat([writeTo(Tags.int(null, 1)).subarray(2), Buffer.from([0xff])]);
    const input = gzipSync(payload); const d = readTagDocument(input);
    assert.deepEqual(d.toBuffer(), input);
    const edited = readTagDocument(d.toBuffer(Tags.int(null, 2)));
    assert.isTrue(edited.compressed); assert.equal(edited.root.getInt(), 2);
    assert.deepEqual(edited.trailingData, Buffer.from([0xff]));
  });
  it('enforces input, inflated, depth, node and list budgets', () => {
    const tag = Tags.struct(null, [Tags.struct(null, [Tags.int(null, 1)])]);
    const bytes = writeTo(tag);
    assert.throws(() => readFrom(bytes, { maxInputBytes: 0 }));
    assert.throws(() => readFrom(bytes, { maxInflatedBytes: 0 }));
    assert.throws(() => readFrom(bytes, { maxDepth: 1 }));
    assert.throws(() => readFrom(bytes, { maxNodes: 1 }));
    assert.throws(() => readFrom(gzipSync(bytes.subarray(2)), { maxInflatedBytes: 1 }));
    const list = new Tag(TagType.LIST, null, [Tags.int(null, 1)], TagType.INT);
    assert.throws(() => readFrom(writeTo(list), { maxListLength: 0 }));
    assert.throws(() => writeTo(tag, { maxDepth: 1 }));
  });
  it('rejects negative and invalid zero-payload list counts before allocating', () => {
    assert.throws(() => readFrom(Buffer.from('0000f411ffffffff', 'hex')));
    assert.throws(() => readFrom(Buffer.from('0000f4ff00000000', 'hex')));
    assert.throws(() => readFrom(Buffer.from('0000f4117fffffff', 'hex')));
    assert.throws(() => readFrom(Buffer.from('0000f9ffffffff', 'hex')));
  });
  it('rejects heterogeneous lists, missing terminators and cycles before writing', () => {
    assert.throws(() => writeTo(new Tag(TagType.LIST, null, [Tags.int(null, 1)], TagType.SHORT)));
    assert.throws(() => writeTo(new Tag(TagType.STRUCT, null, [])));
    const t = Tags.struct(null, []); t.getStruct().unshift(t);
    assert.throws(() => writeTo(t), /cycl/i);
  });
});

describe('Audit integrity — SMD3 data and LZ4', () => {
  it('does not share mutable air blocks, even across two empty segments', () => {
    const a = emptySegment(), b = emptySegment(); a.blocks[0].type = 5;
    assert.equal(a.blocks[1].type, 0); assert.equal(b.blocks[0].type, 0);
    assert.equal(a.blocks.filter(x => x.type !== 0).length, 1);
  });
  it('saves edited content even if blockCount remains stale', () => {
    const seg = emptySegment(); seg.blocks[3] = { type: 8191, hp: 127, orientation: 31, active: true, extra: 63 };
    const parsed = parseSmd3(writeSmd3({ ...emptySmd3File(), segments: [seg] }));
    assert.equal(parsed.segments[0].blockCount, 1);
    assert.deepEqual(parsed.segments[0].blocks, seg.blocks);
    assert.equal(seg.blockCount, 0); // Writer does not mutate caller input.
  });
  it('preserves reserved fields even when all block type identifiers are zero', () => {
    const seg = emptySegment(); seg.blocks[0].extra = 63;
    const parsed = parseSmd3(writeSmd3({ ...emptySmd3File(), segments: [seg] }));
    assert.equal(parsed.segments[0].blockCount, 0); assert.equal(parsed.segments[0].blocks[0].extra, 63);
  });
  it('edits one block by value and refreshes derived count', () => {
    const seg = emptySegment(), block = { type: 5, hp: 70, orientation: 12, active: true };
    setBlock(seg, 1, 2, 3, block); block.type = 9;
    assert.equal(seg.blocks[posToIndex(1, 2, 3)].type, 5); assert.equal(seg.blockCount, 1);
    assert.deepEqual(indexToPos(posToIndex(31, 31, 31)), { x: 31, y: 31, z: 31 });
    assert.throws(() => posToIndex(-1, 0, 0)); assert.throws(() => indexToPos(BLOCK_COUNT));
    assert.throws(() => setBlock(seg, 0, 0, 0, { ...block, type: 8192 }));
  });
  it('rejects oversized compressed records before producing a file', () => {
    const raw = noise(BLOCK_COUNT * 4), seg = emptySegment();
    seg.blocks = Array.from({ length: BLOCK_COUNT }, (_, i) => decodeBlockWord(raw.readUInt32LE(i * 4)));
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [seg] }), /sector capacity/);
  });
  it('rejects colliding cells, mixed regions, misaligned coordinates and pre-v6 writes', () => {
    const a = emptySegment();
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [a, a] }), /Duplicate/);
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [a, { ...a, x: 512 }] }), /different/);
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [{ ...a, x: 1 }] }), /aligned/);
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [{ ...a, version: 4 }] }), /migration/);
    assert.throws(() => writeSmd3(emptySmd3File(), 6));
  });
  it('validates the record boundary rather than borrowing bytes from sector padding', () => {
    const payload = Buffer.alloc(4); payload.writeUInt32BE(5);
    assert.throws(() => parseSmd3(region(record(3, payload), 22)), /declared size/);
  });
  it('reports recovery omissions and refuses to rewrite them', () => {
    const b = region(record(99));
    assert.throws(() => parseSmd3(b), /Unknown/);
    const partial = parseSmd3(b, { mode: 'recover' });
    assert.isFalse(partial.complete); assert.lengthOf(partial.diagnostics!, 1);
    assert.equal(partial.diagnostics![0].offset, HEADER_SIZE);
    assert.throws(() => writeSmd3(partial), /incomplete/);
  });
  it('never suppresses exhausted budgets in recovery mode', () => {
    assert.throws(() => parseSmd3(region(record(2)), { mode: 'recover', maxBlocks: 0 }), /budget/);
    assert.throws(() => parseSmd3(region(record(2)), { maxInputBytes: 1 }), /budget/);
  });
  it('accepts the Java empty-slot convention with retained allocation offsets', () => {
    const b = Buffer.alloc(HEADER_SIZE); b.writeInt16BE(15, 4);
    assert.isTrue(parseSmd3(b).complete); assert.lengthOf(parseSmd3(b).segments, 0);
  });
  it('rejects negative storage offsets, duplicate storage and unknown versions', () => {
    const b = region(record(2)); b.writeInt16BE(-1, 4);
    assert.throws(() => parseSmd3(b)); b.writeInt16BE(1, 4); b.writeInt16BE(1, 8); b.writeUInt16BE(22, 10);
    assert.throws(() => parseSmd3(b), /Duplicate/);
    assert.throws(() => parseSmd3(region(record(2, Buffer.alloc(0), 99))), /version/);
  });
  it('rejects truncated old compressed arrays instead of inventing air', () => {
    const compressed = deflateSync(Buffer.alloc(3)), p = Buffer.alloc(4 + compressed.length);
    p.writeInt32BE(compressed.length); compressed.copy(p, 4);
    assert.throws(() => parseSmd3(region(record(1, p, 6))), /inflated/);
  });
  it('decodes SINGLE as independent values with the version-correct bit layout', () => {
    const p = Buffer.alloc(4); p.writeUInt32BE(5 | (90 << 11) | (1 << 18) | (17 << 19));
    const seg = parseSmd3(region(record(3, p, 6))).segments[0];
    assert.deepEqual(seg.blocks[0], { type: 5, hp: 90, active: true, orientation: 17 });
    seg.blocks[0].type = 6; assert.equal(seg.blocks[1].type, 5);
  });
  it('requires geometric context for SINGLE_SIDE_EDGE and preserves its empty half-spaces', () => {
    const p = Buffer.alloc(4); p.writeUInt32BE(5);
    assert.throws(() => parseSmd3(region(record(5, p))), /sideNormals/);
    const seg = parseSmd3(region(record(5, p)), { sideNormals: normals }).segments[0];
    assert.equal(seg.blockCount, 15 ** 3);
    assert.equal(seg.blocks[posToIndex(16, 17, 17)].type, 0); // Boundary is outside.
    assert.equal(seg.blocks[posToIndex(17, 17, 17)].type, 5);
  });
  it('loads finite geometry normals and rejects incomplete or degenerate inputs', () => {
    const b = Buffer.alloc(36); b.writeFloatBE(1, 0); b.writeFloatBE(1, 16); b.writeFloatBE(1, 32);
    assert.deepEqual(readIcoSideNormals(b), normals);
    assert.isTrue(isPointInIcoSide(1, 1, 1, normals));
    assert.throws(() => readIcoSideNormals(b.subarray(0, 35)));
    assert.throws(() => readIcoSideNormals(Buffer.alloc(36)));
  });
  for (const shift of [3, 4, 5]) {
    it(`decodes independently constructed BITMAP words, shift=${shift}`, () => {
      const p = Buffer.alloc(8 + 8 + (BLOCK_COUNT >> shift) * 4);
      p.writeInt32BE(shift); p.writeInt32BE(2, 4); p.writeUInt32BE(0, 8); p.writeUInt32BE(5, 12);
      p.writeUInt32BE(1, 16);
      const seg = parseSmd3(region(record(4, p))).segments[0];
      assert.equal(seg.blocks[0].type, 5); assert.equal(seg.blockCount, 1);
    });
  }
  it('rejects malformed BITMAP shifts, counts and missing palette entries', () => {
    const p = Buffer.alloc(8 + 4 + (BLOCK_COUNT >> 3) * 4);
    p.writeInt32BE(3); p.writeInt32BE(1, 4); p.writeUInt32BE(1, 12);
    assert.throws(() => parseSmd3(region(record(4, p))), /palette index/);
    p.writeInt32BE(2); assert.throws(() => parseSmd3(region(record(4, p))), /shift/);
  });
  it('requires explicit opt-in to migrate the former SDK zlib/BE v7 output', () => {
    const raw = Buffer.alloc(BLOCK_COUNT * 4); raw.writeUInt32BE((5 | (63 << 26)) >>> 0);
    const comp = deflateSync(raw), p = Buffer.alloc(4 + comp.length);
    p.writeInt32BE(comp.length); comp.copy(p, 4);
    const input = region(record(1, p));
    assert.throws(() => parseSmd3(input));
    const migrated = parseSmd3(input, { legacyV7ZlibBigEndian: true });
    assert.equal(migrated.segments[0].blocks[0].extra, 63);
    assert.deepEqual(parseSmd3(writeSmd3(migrated)).segments[0].blocks, migrated.segments[0].blocks);
  });
  for (const size of [0, 1, 12, 13, 255, 1024, 131072]) {
    it(`round-trips LZ4 literal and repeated sequences of ${size} bytes`, () => {
      for (const b of [Buffer.alloc(size), noise(size)]) assert.deepEqual(decodeLz4Block(encodeLz4Block(b), size), b);
    });
  }
  for (const [hex, size] of [['', 1], ['f0', 20], ['000000', 5], ['10000100', 8], ['1000', 5], ['1f000100ff', 300]] as const) {
    it(`rejects malformed LZ4 ${hex || '(empty)'}`, () => assert.throws(() => decodeLz4Block(Buffer.from(hex, 'hex'), size)));
  }
});

describe('Audit integrity — blueprint archives, folders and metadata', () => {
  it('does not invent a sibling descendant with an equal-length entity path', () => {
    const a = parseSment(archive(['Root', 'Root/ATTACHED_0', 'Root/ATTACHED_1', 'Root/ATTACHED_1/ATTACHED_9']));
    assert.equal(a.totalEntities, 4); assert.isTrue(a.complete);
    const first = a.root.children.find(c => c.name === 'ATTACHED_0')!;
    const second = a.root.children.find(c => c.name === 'ATTACHED_1')!;
    assert.lengthOf(first.children, 0); assert.equal(second.children[0].name, 'ATTACHED_9');
  });
  it('supports valid nesting beyond five levels, subject to an explicit depth budget', () => {
    const names = ['Root']; for (let i = 0; i < 8; i++) names.push(names.at(-1)! + '/ATTACHED_0');
    const b = archive(names); assert.equal(parseSment(b).totalEntities, 9);
    assert.throws(() => parseSment(b, { maxDepth: 5, mode: 'recover' }), /budget/);
  });
  it('rejects missing headers strictly and marks recovery archives incomplete', () => {
    const b = archive(['Root'], { 'Root/ATTACHED_0/logic.smbpl': Buffer.alloc(8) });
    assert.throws(() => parseSment(b), /Missing/);
    const recovered = parseSment(b, { mode: 'recover' });
    assert.isFalse(recovered.complete); assert.lengthOf(recovered.diagnostics, 1);
    assert.include(recovered.diagnostics[0].path!, 'ATTACHED_0/header.smbph');
  });
  it('reports invalid segment files instead of returning an apparently complete archive', () => {
    const b = archive(['Root'], { 'Root/DATA/Root.0.0.0.smd3': Buffer.alloc(5) });
    assert.throws(() => parseSment(b), /Truncated/);
    const a = parseSment(b, { mode: 'recover' }); assert.isFalse(a.complete);
    assert.include(a.diagnostics[0].path!, 'smd3');
  });
  it('enforces archive input, entity, entry and aggregate byte budgets', () => {
    const b = archive(['Root']);
    for (const options of [{ maxInputBytes: 1 }, { maxEntries: 0 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }, { maxEntities: 0 }]) {
      assert.throws(() => parseSment(b, options), /budget/);
    }
  });
  it('rejects duplicate and unsafe paths at the ZIP inventory boundary', () => {
    const z = new AdmZip(archive(['Root'])), entry = z.getEntries()[0], context = new BlueprintReadContext();
    assert.throws(() => context.validateEntries([entry, entry]), /Duplicate/);
    for (const name of ['../escape', '/absolute', 'Root/../escape', 'C:/escape', 'Root\\escape', 'Root//header']) {
      assert.throws(() => context.validateEntries([{ ...entry, entryName: name }]), /Unsafe/);
    }
  });
  it('rejects ZIP CRC tampering and inflation beyond declared entry size', () => {
    for (const field of ['crc', 'size'] as const) {
      const z = new AdmZip(archive(['Root'])); const entry = z.getEntries()[0];
      if (field === 'crc') entry.header.crc ^= 1; else entry.header.size = 1;
      assert.throws(() => new BlueprintReadContext().readZipEntry(entry), /CRC32|oversized/);
    }
  });
  it('rejects unsupported ZIP compression and encryption before extraction', () => {
    const z = new AdmZip(archive(['Root'])), entry = z.getEntries()[0];
    entry.header.method = 99;
    assert.throws(() => new BlueprintReadContext().readZipEntry(entry), /method/);
    entry.header.flags |= 1;
    assert.throws(() => new BlueprintReadContext().readZipEntry(entry), /Encrypted/);
  });
  it('decodes legacy controller coordinates with the Java +8 origin migration', () => {
    const w = new BufferWriter(); w.writeInt32BE(0); w.writeInt32BE(1);
    w.writeInt16BE(1); w.writeInt16BE(2); w.writeInt16BE(3); w.writeInt32BE(1);
    w.writeInt16BE(5); w.writeInt32BE(1);
    w.writeInt16BE(-1); w.writeInt16BE(0); w.writeInt16BE(32767);
    const logic = parseSmbpl(w.toBuffer());
    assert.deepEqual(logic.controllers[0], { x: 9, y: 10, z: 11,
      groups: [{ type: 5, targets: [{ x: 7, y: 8, z: -32761 }] }] });
    const raw = w.toBuffer().subarray(4);
    const snapshot = SerializableTagRegister.register[0].create(BufferReader.from(raw)) as RawElement;
    assert.deepEqual(Buffer.from(snapshot.raw), raw);
    const mapper = ControlElementMapper.fromRaw(raw);
    assert.deepEqual(mapper.links.map(({ from, ...link }) => ({ fromX: from.x, fromY: from.y, fromZ: from.z, ...link })), logic.links);
    assert.deepEqual(ControlElementMapper.fromRaw(mapper.toRaw()).links, mapper.links);

  });
  it('migrates network-v1 mapper coordinates consistently across all APIs', () => {
    const w = new BufferWriter(); w.writeInt32BE(-1); w.writeInt32BE(1);
    for (const value of [32767, 0, -10]) w.writeInt16BE(value);
    w.writeInt32BE(1); w.writeInt16BE(5); w.writeInt32BE(1);
    for (const big of [0, 0, 1]) w.writeUInt8(big);
    for (const median of [32767, -2, 20]) w.writeInt16BE(median);
    w.writeInt8(1); w.writeInt8(-3); w.writeInt16BE(-20);
    const raw = w.toBuffer();
    const expected = [{ from: { x: -32761, y: 8, z: -2 }, type: 5,
      targets: [{ x: -32760, y: 3, z: 8 }] }];
    const mapper = ControlElementMapper.fromRaw(raw);
    assert.deepEqual(mapper.links, expected);
    const snapshot = SerializableTagRegister.register[0].create(BufferReader.from(raw)) as RawElement;
    assert.deepEqual(Buffer.from(snapshot.raw), raw);
    assert.deepEqual(parseSmbpl(Buffer.concat([Buffer.alloc(4), raw])).links, expected.map(({ from, ...link }) => ({ fromX: from.x, fromY: from.y, fromZ: from.z, ...link })));
    assert.throws(() => ControlElementMapper.fromRaw(Buffer.from('00000001', 'hex')), /Truncated/);
    assert.throws(() => ControlElementMapper.fromRaw(Buffer.from('ffffffffffffffff', 'hex')));
    assert.throws(() => ControlElementMapper.fromRaw(Buffer.concat([raw, Buffer.from([0])])), /Trailing/);
  });
  it('rejects truncated blueprint headers and metadata section payloads', () => {
    assert.throws(() => parseSmbph(header().subarray(0, 35)));
    assert.throws(() => parseSmbpm(Buffer.from([0, 0, 0, 5, 2, 0])));
    assert.throws(() => parseSmbpm(Buffer.from([0, 0, 0, 5, 99])));
  });
  it('uses a manager-container model and retains real metadata bytes', () => {
    const bytes = fs.readFileSync('samples/BASE_Warehouse_Station/meta.smbpm');
    const meta = parseSmbpm(bytes); assert.instanceOf(meta.manager, ManagerContainer);
    assert.deepEqual(writeSmbpm(meta), bytes);
  });
  it('bounds folder reads and rejects symlinked child entities', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-audit-'));
    try {
      fs.writeFileSync(path.join(dir, 'header.smbph'), header());
      assert.isTrue(parseBlueprintFolder(dir).complete);
      assert.throws(() => parseBlueprintFolder(dir, { maxEntryBytes: 1 }), /budget/);
      if (process.platform === 'win32') return; // Requires developer mode/admin on Windows.
      fs.symlinkSync(dir, path.join(dir, 'ATTACHED_0'));
      assert.throws(() => parseBlueprintFolder(dir), /symlink/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
