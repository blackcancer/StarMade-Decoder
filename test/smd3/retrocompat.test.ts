/**
 * @fileoverview Public Blueprint Retrocompatibility Tests
 *
 * Verifies dated StarMadeDock blueprint samples so older public file layouts are
 * covered alongside the more recent local sample corpus.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { DecodeError } from '../../src/core/DecodeError.js';
import { parseSment } from '../../src/smd3/SmentParser.js';
import { parseSmtpl } from '../../src/smd3/SmtplParser.js';

const ROOT = path.resolve('samples/retrocompat/starmadedock');
const MANIFEST = path.join(ROOT, 'manifest.json');

interface RetroSample {
  id: string;
  name: string;
  source: string;
  download: string;
  published: string;
  updated?: string;
  category: string;
  filename: string;
  bytes: number;
}

function loadManifest(): RetroSample[] {
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { samples: RetroSample[] };
  return raw.samples;
}

describe('Retrocompat — StarMadeDock samples', function () {
  this.timeout(30_000);

  it('keeps the manifest consistent and sample files present', () => {
    const samples = loadManifest();
    assert.isAtLeast(samples.length, 1);

    for (const sample of samples) {
      assert.match(sample.source, /^https:\/\/starmadedock\.net\/content\//);
      assert.match(sample.download, /^https:\/\/starmadedock\.net\/content\//);
      assert.match(sample.published, /^\d{4}-\d{2}-\d{2}$/);
      assert.notInclude(sample.filename, '..');

      const file = path.join(ROOT, sample.filename);
      assert.isTrue(fs.existsSync(file), `${sample.filename} is missing`);
      assert.equal(fs.statSync(file).size, sample.bytes);
    }
  });

  for (const sample of loadManifest()) {
    it(`parses retro blueprint ${sample.id} (${sample.published})`, () => {
      const file = path.join(ROOT, sample.filename);
      const data = fs.readFileSync(file);

      if (sample.filename.endsWith('.sment')) {
        const entries = new AdmZip(data).getEntries().map(e => e.entryName);
        const smd2Count = entries.filter(e => e.endsWith('.smd2')).length;
        const smd3Count = entries.filter(e => e.endsWith('.smd3')).length;
        const legacyEntries = entries.filter(e => ['.smd0', '.smd1', '.smd2'].some(extension => e.endsWith(extension)));
        const blueprint = parseSment(data, legacyEntries.length > 0 ? { mode: 'recover' } : {});
        if (legacyEntries.length > 0) {
          const failure = assert.throws(() => parseSment(data), DecodeError, /legacy segment/);
          assert.equal((failure as DecodeError).code, 'E_UNSUPPORTED');
          assert.isFalse(blueprint.complete);
          assert.deepEqual(blueprint.diagnostics.map(d => d.path).sort(), [...legacyEntries].sort());
          assert.isTrue(blueprint.diagnostics.every(d => d.code === 'E_UNSUPPORTED'));
        } else {
          assert.isTrue(blueprint.complete);
          assert.isEmpty(blueprint.diagnostics);
        }

        assert.isAbove(blueprint.totalEntities, 0);
        assert.isString(blueprint.root.header.entityType);
        assert.isAtLeast(blueprint.root.header.totalBlockCount, 0);
        assert.isArray(blueprint.root.header.blockCountByType);

        if (smd3Count > 0) {
          assert.isAbove(blueprint.totalSegments, 0);
        } else {
          // Very old StarMadeDock blueprints: .sment archives with .smd2 segments.
          // Explicit recovery extracts headers/children and reports every skipped resource;
          // block-by-block .smd2 decoding belongs to a dedicated legacy layer.
          assert.isAbove(smd2Count, 0);
          assert.equal(blueprint.totalSegments, 0);
          assert.isAbove(blueprint.root.header.totalBlockCount, 0);
        }
      } else if (sample.filename.endsWith('.smtpl')) {
        const template = parseSmtpl(data);
        assert.isAbove(template.blocks.length, 0);
      } else {
        assert.fail(`unsupported extension in retrocompat harness: ${sample.filename}`);
      }
    });
  }
});
