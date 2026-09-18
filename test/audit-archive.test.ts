/**
 * @fileoverview Blueprint ancestry, recovery and global resource-limit regressions.
 * @author InitSysRev
 */
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parseSment, parseSmbph } from '../src/smd3/SmentParser.js';
import { parseBlueprintFolder } from '../src/smd3/BlueprintFolderParser.js';
import { parseSmbpl } from '../src/smd3/SmbplParser.js';
import { parseSmbpm } from '../src/smd3/SmbpmParser.js';
import { writeSmd3, emptySmd3File, emptySegment } from '../src/smd3/Smd3Writer.js';

/** Independent version-1 blueprint header: ship, zero bounds, zero counts, no score. */
const header = Buffer.alloc(37);
header.writeInt32BE(1);
/** @param entries ZIP file names and bytes. @returns In-memory blueprint archive. */
function archive(entries: Record<string, Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, bytes] of Object.entries(entries)) zip.addFile(name, bytes);
  return zip.toBuffer();
}

describe('Audit: blueprint archives', () => {
  it('does not invent descendants under a sibling with the same path length', () => {
    const parsed = parseSment(archive({ 'Root/header.smbph': header,
      'Root/ATTACHED_0/header.smbph': header, 'Root/ATTACHED_1/header.smbph': header,
      'Root/ATTACHED_1/ATTACHED_9/header.smbph': header }));
    assert.equal(parsed.totalEntities, 4);
    assert.equal(parsed.root.child('ATTACHED_0')!.children.length, 0);
    assert.equal(parsed.root.child('ATTACHED_1')!.children[0].name, 'ATTACHED_9');
    assert.equal(parsed.complete, true);
  });
  it('reads depth greater than five and explicitly rejects an exhausted depth budget', () => {
    const entries: Record<string, Buffer> = {};
    let name = 'Root';
    for (let i = 0; i < 8; i++, name += '/ATTACHED_0') entries[`${name}/header.smbph`] = header;
    const bytes = archive(entries);
    assert.equal(parseSment(bytes).totalEntities, 8);
    assert.throws(() => parseSment(bytes, { maxDepth: 5 }), /depth budget/);
    assert.throws(() => parseSment(bytes, { mode: 'recover', maxDepth: 5 }), /depth budget/);
  });
  it('rejects ambiguous roots', () => {
    assert.throws(() => parseSment(archive({ 'A/header.smbph': header, 'B/header.smbph': header })), /unique root/);
  });
  it('reports corrupted files only in explicit recovery mode', () => {
    const bytes = archive({ 'Root/header.smbph': header, 'Root/DATA/a.smd3': Buffer.alloc(4) });
    assert.throws(() => parseSment(bytes), /Truncated SMD3/);
    const parsed = parseSment(bytes, { mode: 'recover' });
    assert.equal(parsed.complete, false);
    assert.equal(parsed.diagnostics.length, 1);
    assert.equal(parsed.diagnostics[0].path, 'Root/DATA/a.smd3');
  });
  it('does not hide a missing attachment header', () => {
    const bytes = archive({ 'Root/header.smbph': header, 'Root/ATTACHED_1/DATA/a.smd3': writeSmd3(emptySmd3File()) });
    assert.throws(() => parseSment(bytes), /Missing entity header/);
    assert.equal(parseSment(bytes, { mode: 'recover' }).complete, false);
  });
  it('enforces file, total byte, entry and decoded segment budgets', () => {
    const bytes = archive({ 'Root/header.smbph': header });
    for (const options of [{ maxArchiveBytes: 0 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }, { maxEntries: 0 }]) {
      assert.throws(() => parseSment(bytes, options), /budget/);
    }
    const segment = writeSmd3({ ...emptySmd3File(), segments: [emptySegment()] });
    const two = archive({ 'Root/header.smbph': header, 'Root/DATA/a.smd3': segment, 'Root/DATA/b.smd3': segment });
    assert.throws(() => parseSment(two, { maxSegments: 1 }), /budget/);
  });
  it('rejects truncated headers and malformed metadata/control maps', () => {
    assert.throws(() => parseSmbph(header.subarray(0, 34)));
    assert.throws(() => parseSmbph(header.subarray(0, 36)));
    assert.throws(() => parseSmbpl(Buffer.alloc(4)), /control map/);
    assert.throws(() => parseSmbpm(Buffer.from([0, 0, 0, 5, 99])), /metadata type/);
    assert.throws(() => parseSmbpm(Buffer.from([0, 0, 0, 5, 2, 0, 0, 8])), /underflow/);
  });
  it('applies the same strict/recovery contract to folders', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starmade-audit-'));
    try {
      fs.writeFileSync(path.join(directory, 'header.smbph'), header);
      fs.mkdirSync(path.join(directory, 'DATA'));
      fs.writeFileSync(path.join(directory, 'DATA', 'bad.smd3'), Buffer.alloc(4));
      assert.throws(() => parseBlueprintFolder(directory), /Truncated SMD3/);
      const recovered = parseBlueprintFolder(directory, { mode: 'recover' });
      assert.equal(recovered.complete, false);
      assert.equal(recovered.diagnostics.length, 1);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
