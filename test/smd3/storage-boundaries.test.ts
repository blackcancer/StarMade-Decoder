/**
 * @fileoverview Rejected wire records, ZIP preflight and deterministic filesystem races.
 * Fault injection is restricted to the I/O boundary and always restored; real
 * files are still opened/closed so truncation and identity safeguards are tested.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { BufferReader } from '../../src/core/BufferReader.js';
import { registerAllFactories } from '../../src/serializable/Factories.js';
import { SerializableTagRegister } from '../../src/serializable/SerializableTagRegister.js';
import { BlueprintReadContext } from '../../src/smd3/BlueprintReadContext.js';
import { parseBlueprintFolder } from '../../src/smd3/BlueprintFolderParser.js';
import { parseSmd3, BLOCK_COUNT, HEADER_SIZE, SEGMENT_SECTOR } from '../../src/smd3/Smd3Parser.js';
import { emptySegment, writeSmd3, emptySmd3File, setBlock } from '../../src/smd3/Smd3Writer.js';
import { parseSment, parseSmbph } from '../../src/smd3/SmentParser.js';
import { readIcoSideNormals, normalizeIcoSideNormals } from '../../src/smd3/IcoGeometry.js';
import { encodeLz4Block, decodeLz4Block } from '../../src/smd3/Lz4Block.js';

/** Produces a bounded single-record fixture, independently of the SDK writer. */
function region(kind: number, version = 7, value = 0): Buffer {
  const b = Buffer.alloc(HEADER_SIZE + SEGMENT_SECTOR);
  b[0] = 7; b.writeInt16BE(1, 4); b.writeUInt16BE(30, 6);
  b[HEADER_SIZE] = version; b[HEADER_SIZE + 21] = kind;
  b.writeInt32BE(value, HEADER_SIZE + 22);
  return b;
}
/** Builds a minimal independently encoded blueprint header. */
function header(version = 0, type = 0, count = 0): Buffer {
  const w = new BufferWriter(); w.writeInt32BE(version);
  if (version >= 5) w.writeJavaUTF('test');
  w.writeInt32BE(type); if (version >= 3) w.writeInt32BE(0);
  for (let i = 0; i < 6; i++) w.writeFloat32BE(0);
  w.writeInt32BE(count); return w.toBuffer();
}

describe('Storage boundaries — invalid wire representations', () => {
  it('rejects unknown segment policies, unsupported versions and impossible lengths', () => {
    assert.throws(() => parseSmd3(region(2), { mode: 'invalid' as any }), /mode/);
    assert.equal(parseSmd3(new Uint8Array(region(2))).segments.length, 1);
    assert.throws(() => parseSmd3(region(2).subarray(0, HEADER_SIZE + 25)), /Truncated/);
    for (const kind of [3, 4]) assert.throws(() => parseSmd3(region(kind, 5)), /migration/);
    assert.throws(() => parseSmd3(region(1, 7, 999)), /LZ4 record header/);
    assert.throws(() => parseSmd3(region(1, 6, 0)), /compressed segment length/);
    assert.throws(() => parseSmd3(region(1, 6, 4)), /compressed SMD3/);
    for (const block of [null, { type: 1, hp: 1, orientation: 0, active: 1 }]) {
      const seg = emptySegment(); seg.blocks[0] = block as any;
      assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [seg] }), /boolean/);
    }
    const broken = { ...emptySegment(), blocks: [] };
    assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [broken] }), /blocks/);
    assert.throws(() => setBlock(broken, 0, 0, 0, { type: 1, hp: 1, orientation: 0, active: false }), /array/);
  });

  it('rejects incomplete LZ4 sequences and cross-decodes extended literals', () => {
    for (const [hex, expected, message] of [
      ['20ff', 2, /literal/], ['10ff00', 2, /truncated LZ4 match/],
      ['10000100', 3, /match exceeds/], ['f0ff', 10, /length exceeds/],
    ] as const) assert.throws(() => decodeLz4Block(Buffer.from(hex, 'hex'), expected), message);
    const prefix = Buffer.from(Array.from({ length: 40 }, (_, i) => i));
    const data = Buffer.concat([prefix, prefix, Buffer.alloc(20, 123)]);
    assert.deepEqual(decodeLz4Block(encodeLz4Block(data), data.length), data);
  });

  it('validates geometry count and finite normals, including typed-array input', () => {
    const b = Buffer.alloc(36); b.writeFloatBE(1, 0); b.writeFloatBE(1, 16); b.writeFloatBE(1, 32);
    assert.lengthOf(readIcoSideNormals(new Uint8Array(b)), 3);
    assert.throws(() => normalizeIcoSideNormals([] as any), /three/);
    assert.throws(() => normalizeIcoSideNormals([{ x: NaN, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]), /finite/);
  });

  it('rejects unsupported header versions, negative counts, extra bytes and ambiguous roots', () => {
    assert.equal(parseSmbph(new Uint8Array(header(0, 99))).entityType, 'UNKNOWN(99)');
    assert.throws(() => parseSmbph(header(99)), /Unsupported/);
    const negative = Buffer.concat([header(0, 0, 1), Buffer.from('0001ffffffff', 'hex')]);
    assert.throws(() => parseSmbph(negative), /Negative/);
    assert.throws(() => parseSmbph(Buffer.concat([header(), Buffer.from([1])])), /Unrecognized/);
    assert.throws(() => parseSmbph(Buffer.concat([header(1), Buffer.from([1, 0, 99])])), /score version/);
    const empty = new AdmZip();
    assert.throws(() => parseSment(empty.toBuffer()), /root folder/);
    for (const n of ['A', 'B']) empty.addFile(`${n}/header.smbph`, header());
    assert.throws(() => parseSment(new Uint8Array(empty.toBuffer())), /Multiple/);
  });

  it('limits opaque legacy controller snapshots and consumes narrow delta coordinates', () => {
    registerAllFactories();
    const w = new BufferWriter(); w.writeInt32BE(1_000_001);
    assert.throws(() => SerializableTagRegister.register[0].create(BufferReader.from(w.toBuffer())), /Too many/);
    const wire = new BufferWriter(); wire.writeInt32BE(-2); wire.writeInt32BE(1);
    for (let i = 0; i < 3; i++) wire.writeInt16BE(0);
    wire.writeInt32BE(1); wire.writeInt16BE(5); wire.writeInt32BE(1);
    for (let i = 0; i < 3; i++) wire.writeInt8(0);
    for (let i = 0; i < 3; i++) wire.writeInt16BE(0);
    for (let i = 0; i < 3; i++) wire.writeInt8(1);
    const r = BufferReader.from(wire.toBuffer()); SerializableTagRegister.register[0].create(r);
    assert.isTrue(r.isEOF());
  });
});

describe('Storage boundaries — ZIP preflight and aggregate budgets', () => {
  it('rejects every unsupported ZIP end-record representation and central-directory inconsistency', () => {
    const ctx = new BlueprintReadContext();
    assert.throws(() => new BlueprintReadContext({ mode: 'bad' as any }), /mode/);
    assert.throws(() => ctx.preflightArchive(Buffer.alloc(22)), /end-of-directory/);
    const z = new AdmZip(); z.addFile('Root/header.smbph', header()); const good = z.toBuffer();
    const end = good.length - 22;
    for (const [offset, width, value] of [[10, 2, 65535], [12, 4, 0xffffffff], [16, 4, 0xffffffff], [4, 2, 1], [6, 2, 1], [8, 2, 0]]) {
      const bad = Buffer.from(good); bad.writeUIntLE(value, end + offset, width);
      assert.throws(() => ctx.preflightArchive(bad), /ZIP64|multi-disk/);
    }
    let bad = Buffer.from(good); bad.writeUInt32LE(good.length, end + 16);
    assert.throws(() => ctx.preflightArchive(bad), /bounds/);
    const start = good.readUInt32LE(end + 16);
    bad = Buffer.from(good); bad.writeUInt32LE(0, start);
    assert.throws(() => ctx.preflightArchive(bad), /directory entry/);
    bad = Buffer.from(good); bad.writeUInt16LE(65535, start + 28);
    assert.throws(() => ctx.preflightArchive(bad), /Truncated/);
    bad = Buffer.from(good); bad.writeUInt16LE(0, end + 10); bad.writeUInt16LE(0, end + 8);
    assert.throws(() => ctx.preflightArchive(bad), /count mismatch/);
    const limited = new BlueprintReadContext({ maxEntries: 0 });
    assert.throws(() => limited.chargeFile(), /file count/);
    assert.throws(() => limited.validateEntries(z.getEntries()), /entry count/);
  });

  it('checks stored entry lengths independently of deflate and copies validated data', () => {
    const ctx = new BlueprintReadContext();
    const entry = { header: { size: 0, compressedSize: 0, flags: 0, method: 0, crc: 0 }, getCompressedData: () => Buffer.alloc(0) };
    assert.equal(ctx.readZipEntry(entry as any).length, 0);
    assert.throws(() => ctx.readZipEntry({ ...entry, header: { ...entry.header, compressedSize: 1 } } as any), /Truncated/);
    assert.throws(() => ctx.readZipEntry({ ...entry, header: { ...entry.header, size: 1 } } as any), /stored ZIP/);
  });

  it('propagates recovery diagnostics and counts rejected slots against aggregate budgets', () => {
    const ctx = new BlueprintReadContext({ mode: 'recover' });
    assert.isFalse(ctx.readSegments(region(99), 'file.smd3').complete);
    assert.include(ctx.diagnostics[0].path!, 'file.smd3:segment');
    const b = Buffer.concat([region(99), Buffer.alloc(SEGMENT_SECTOR)]);
    b.writeInt16BE(2, 8); b.writeUInt16BE(30, 10); b[HEADER_SIZE + SEGMENT_SECTOR] = 7; b[HEADER_SIZE + SEGMENT_SECTOR + 21] = 99;
    assert.throws(() => new BlueprintReadContext({ mode: 'recover', maxBlocks: BLOCK_COUNT }).readSegments(b, 'file'), /budget/);
  });
});

describe('Storage boundaries — filesystem race safeguards', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-io-')); fs.writeFileSync(path.join(root, 'header.smbph'), header()); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('rejects a symlinked DATA directory and non-file header', () => {
    fs.symlinkSync(root, path.join(root, 'DATA'), 'dir');
    assert.throws(() => parseBlueprintFolder(root), /symlinks/);
    fs.unlinkSync(path.join(root, 'DATA'));
    fs.unlinkSync(path.join(root, 'header.smbph')); fs.mkdirSync(path.join(root, 'header.smbph'));
    assert.throws(() => parseBlueprintFolder(root), /regular/);
  });

  for (const fault of ['identity', 'truncated', 'size', 'mtime', 'extra'] as const) {
    it(`rejects a ${fault} change while reading a real blueprint file`, () => {
      const read = fs.readSync, stat = fs.fstatSync; let calls = 0;
      try {
        fs.fstatSync = ((fd: number) => {
          const actual = stat(fd); calls++;
          if (fault === 'identity') return Object.assign(actual, { ino: actual.ino + 1 });
          if (calls === 2 && fault === 'size') return Object.assign(actual, { size: actual.size + 1 });
          if (calls === 2 && fault === 'mtime') return Object.assign(actual, { mtimeMs: actual.mtimeMs + 1 });
          return actual;
        }) as any;
        fs.readSync = ((...args: any[]) => {
          if (fault === 'truncated') return 0;
          if (fault === 'extra' && args[3] === 1) return 1;
          return (read as any)(...args);
        }) as any;
        assert.throws(() => parseBlueprintFolder(root), /changed|truncated/);
      } finally { fs.readSync = read; fs.fstatSync = stat; }
    });
  }
});
