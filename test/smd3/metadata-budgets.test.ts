/** Aggregate budgets must include every GZIP Tag embedded in blueprint metadata. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { BufferWriter, Tags, writeTo, parseSment, parseBlueprintFolder, parseSmbpm, ManagerContainer, ThrustConfig, registerAllFactories } from '../../src/index.js';
import type { BlueprintParseOptions } from '../../src/smd3/BlueprintReadContext.js';

registerAllFactories();
const payload = Tags.string('payload', 'x'.repeat(4096));
const plainTag = writeTo(Tags.struct(null, [payload]));
const managerTag = ManagerContainer.EMPTY.toTag(), thrustTag = ThrustConfig.DEFAULT.toTag();
const managerPlainTag = writeTo(Tags.struct(managerTag.name, [...managerTag.getStruct().slice(0, -1), payload]));
const thrustPlainTag = writeTo(Tags.struct(thrustTag.name, [...thrustTag.getStruct().slice(0, -1), payload]));
/** Typed sections carry their real schema; the opaque suffix supplies the inflation load. */
function sectionPlainTag(kind: number): Buffer { return kind === 2 ? managerPlainTag : kind === 9 ? thrustPlainTag : plainTag; }
const inflatedBytes = plainTag.length - 2;

/** Constructs each independently specified metadata section around exact Tag bytes. */
function metadata(kind: number, tag = gzipSync(sectionPlainTag(kind).subarray(2))): Buffer {
  const writer = new BufferWriter();
  writer.writeInt32BE(5); writer.writeInt8(kind);
  if (kind === 4) {
    writer.writeBytes(Buffer.alloc(24)); writer.writeJavaUTF('');
    writer.writeInt32BE(0); writer.writeInt32BE(1); writer.writeJavaUTF('ATTACHED_0');
  }
  if (kind === 4 || kind === 5) writer.writeInt32BE(tag.length);
  writer.writeBytes(tag);
  if (kind === 4 || kind === 5) writer.writeInt8(1);
  return writer.toBuffer();
}

/** Exercises the same bounded fixture as either a ZIP or an unpacked folder. */
function parseFiles(format: 'archive' | 'folder', files: Record<string, Buffer>, options: BlueprintParseOptions) {
  if (format === 'archive') {
    const zip = new AdmZip();
    for (const [name, bytes] of Object.entries(files)) zip.addFile(name, bytes);
    return parseSment(zip.toBuffer(), options);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-metadata-budget-'));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const filename = path.join(directory, name);
      fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
    }
    return parseBlueprintFolder(path.join(directory, 'Root'), options);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

describe('Audit metadata — aggregate nested inflation budgets', () => {
  for (const format of ['archive', 'folder'] as const) {
    it(`shares node limits across plain and compressed metadata entities (${format})`, () => {
      const files = {
        'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': metadata(5, plainTag),
        'Root/ATTACHED_0/header.smbph': Buffer.alloc(36), 'Root/ATTACHED_0/meta.smbpm': metadata(5),
      };
      assert.isTrue(parseFiles(format, files, { maxTagNodes: 6 }).complete);
      for (const mode of ['strict', 'recover'] as const) {
        const error = assert.throws(() => parseFiles(format, files, { maxTagNodes: 5, mode })) as any;
        assert.equal(error.code, 'E_LIMIT');
        assert.match(error.path, /ATTACHED_0\/meta\.smbpm$/);
      }
      assert.throws(() => parseFiles(format, files, { maxTagNodes: -1 }));
    });
  }
  for (const kind of [2, 4, 5, 9]) {
    for (const format of ['archive', 'folder'] as const) {
      it(`bounds embedded GZIP section ${kind} before inflation (${format})`, () => {
        const files = { 'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': metadata(kind) };
        const entryBytes = Object.values(files).reduce((total, bytes) => total + bytes.length, 0);
        const sectionInflatedBytes = sectionPlainTag(kind).length - 2;
        for (const mode of ['strict', 'recover'] as const) {
          const error = assert.throws(() => parseFiles(format, files, {
            mode, maxTotalBytes: entryBytes + sectionInflatedBytes - 1,
          })) as any;
          assert.equal(error.code, 'E_LIMIT');
          assert.match(error.path, /Root\/meta\.smbpm$/);
          assert.isTrue(parseFiles(format, files, { mode, maxTotalBytes: entryBytes + sectionInflatedBytes }).complete);
        }
      });
    }
  }

  for (const format of ['archive', 'folder'] as const) {
    it(`shares inflation charges between sections of one metadata file (${format})`, () => {
      const section = metadata(5);
      const combined = Buffer.concat([section.subarray(0, section.length - 1), section.subarray(4)]);
      const files = { 'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': combined };
      const maxTotalBytes = 36 + combined.length + inflatedBytes * 2;
      assert.isTrue(parseFiles(format, files, { maxTotalBytes }).complete);
      const error = assert.throws(() => parseFiles(format, files, { maxTotalBytes: maxTotalBytes - 1, mode: 'recover' })) as any;
      assert.equal(error.code, 'E_LIMIT');
    });

    it(`shares inflation charges across attached entities (${format})`, () => {
      const files = {
        'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': metadata(5),
        'Root/ATTACHED_0/header.smbph': Buffer.alloc(36), 'Root/ATTACHED_0/meta.smbpm': metadata(5),
      };
      const entryBytes = Object.values(files).reduce((total, bytes) => total + bytes.length, 0);
      const maxTotalBytes = entryBytes + inflatedBytes * 2;
      assert.equal(parseFiles(format, files, { maxTotalBytes }).totalEntities, 2);
      for (const mode of ['strict', 'recover'] as const) {
        const error = assert.throws(() => parseFiles(format, files, { mode, maxTotalBytes: maxTotalBytes - 1 })) as any;
        assert.equal(error.code, 'E_LIMIT');
        assert.match(error.path, /Root\/ATTACHED_0\/meta\.smbpm$/);
      }
    });

    it(`does not charge already-read plain Tag bytes twice (${format})`, () => {
      const files = { 'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': metadata(2, managerPlainTag) };
      const maxTotalBytes = Object.values(files).reduce((total, bytes) => total + bytes.length, 0);
      assert.isTrue(parseFiles(format, files, { maxTotalBytes }).complete);
    });

    it(`also applies the per-entry inflation bound (${format})`, () => {
      const files = { 'Root/header.smbph': Buffer.alloc(36), 'Root/meta.smbpm': metadata(2) };
      const error = assert.throws(() => parseFiles(format, files, { maxEntryBytes: 256, mode: 'recover' })) as any;
      assert.equal(error.code, 'E_LIMIT');
    });
  }

  it('accepts bounded Tag options for direct metadata reads', () => {
    for (const kind of [2, 4, 5, 9]) {
      assert.throws(() => parseSmbpm(metadata(kind), { maxInflatedBytes: 256 }));
    }
  });
});
