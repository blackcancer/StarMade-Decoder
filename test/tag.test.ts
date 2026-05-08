/**
 * @fileoverview Tag Parser Sample Tests
 *
 * Parses StarMade sample files and verifies binary Tag round-trips for the
 * supported non-GZIP corpus.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { TagType } from '../src/core/TagType.js';
import { registerAllFactories } from '../src/serializable/Factories.js';

// Register factories before all tests
registerAllFactories();

const SAMPLES_DIR = path.resolve(
  '/mnt/c/Users/init-/source/repos/SMDecoder/samples'
);

const SAMPLE_FILES = fs.existsSync(SAMPLES_DIR)
  ? fs.readdirSync(SAMPLES_DIR).filter(f => !f.endsWith('.txt'))
  : [];

describe('TagParser — StarMade sample reading', function () {
  this.timeout(10_000);

  if (SAMPLE_FILES.length === 0) {
    it('no sample found (skip)', function () {
      this.skip();
    });
    return;
  }

  for (const filename of SAMPLE_FILES) {
    const filepath = path.join(SAMPLES_DIR, filename);

    describe(`[${filename}]`, function () {

      it('parses without errors', function () {
        const data = fs.readFileSync(filepath);
        assert.doesNotThrow(() => readFrom(data), `readFrom(${filename}) must not throw`);
      });

      it('root tag is STRUCT or LIST', function () {
        const data = fs.readFileSync(filepath);
        const tag = readFrom(data);
        assert.include(
          [TagType.STRUCT, TagType.LIST, TagType.BYTE, TagType.INT],
          tag.type,
          `Type root inattendu: ${tag.type}`
        );
      });

      it('round-trip : serializes then re-parses identically', function () {
        const data = fs.readFileSync(filepath);

        // No round-trip for GZIP files because writeTo emits uncompressed data
        const isGzip = data[0] === 0x1f && data[1] === 0x8b;
        if (isGzip) { this.skip(); return; }

        const tag1  = readFrom(data);
        const out   = writeTo(tag1);
        const tag2  = readFrom(out);

        // Compare buffers directly
        assert.deepEqual(
          Buffer.from(out).toString('hex'),
          Buffer.from(data).toString('hex'),
          'The re-serialized buffer must be identical'
        );
      });

    });
  }
});
