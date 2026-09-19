/**
 * @fileoverview Protects the PR1 legacy-segment guard when integrating the audited parsers.
 * Unsupported resources must never produce an apparently complete blueprint.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { DecodeError, emptySmd3File, parseBlueprintFolder, parseSment, writeSmd3 } from '../src/index.js';

describe('Legacy segment resources', () => {
  for (const extension of ['smd0', 'smd1', 'smd2']) {
    for (const entity of ['Root', 'Root/ATTACHED_0']) {
      for (const format of ['archive', 'folder']) {
        it(`rejects or reports ${extension} in ${entity} (${format}) while retaining modern segments`, () => {
          const legacyPath = `${entity}/DATA/old.${extension}`;
          const files: Record<string, Buffer> = {
            'Root/header.smbph': Buffer.alloc(36),
            [`${entity}/header.smbph`]: Buffer.alloc(36),
            [legacyPath]: Buffer.from('unsupported segment payload'),
            [`${entity}/DATA/current.smd3`]: writeSmd3(emptySmd3File()),
            [`${entity}/DATA/notes.txt`]: Buffer.from('unrelated resource'),
          };
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-legacy-resources-'));
          try {
            const zip = new AdmZip();
            for (const [name, bytes] of Object.entries(files)) {
              zip.addFile(name, bytes);
              const filename = path.join(directory, name);
              fs.mkdirSync(path.dirname(filename), { recursive: true });
              fs.writeFileSync(filename, bytes);
            }
            const input = zip.toBuffer();
            const parse = (mode: 'strict' | 'recover') => format === 'archive'
              ? parseSment(input, { mode })
              : parseBlueprintFolder(path.join(directory, 'Root'), { mode });
            const expectedPath = format === 'archive' ? legacyPath : path.join(directory, legacyPath);
            const failure = assert.throws(() => parse('strict'), DecodeError, /legacy segment/);
            assert.equal((failure as DecodeError).code, 'E_UNSUPPORTED');
            assert.equal((failure as DecodeError).path, expectedPath);
            const recovered = parse('recover');
            assert.isFalse(recovered.complete);
            assert.lengthOf(recovered.diagnostics, 1);
            assert.equal(recovered.diagnostics[0].code, 'E_UNSUPPORTED');
            assert.equal(recovered.diagnostics[0].path, expectedPath);
            const decodedEntity = entity === 'Root' ? recovered.root : recovered.root.children[0];
            assert.lengthOf(decodedEntity.segments, 1);
          } finally { fs.rmSync(directory, { recursive: true, force: true }); }
        });
      }
    }
  }

  it('charges unsupported folder resources to the entry budget even in recovery mode', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-legacy-budget-'));
    try {
      fs.writeFileSync(path.join(directory, 'header.smbph'), Buffer.alloc(36));
      fs.mkdirSync(path.join(directory, 'DATA'));
      fs.writeFileSync(path.join(directory, 'DATA', 'old.smd2'), Buffer.alloc(0));
      const failure = assert.throws(() => parseBlueprintFolder(directory, { mode: 'recover', maxEntries: 1 }), DecodeError);
      assert.equal((failure as DecodeError).code, 'E_LIMIT');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
