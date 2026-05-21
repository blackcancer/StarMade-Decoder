/**
 * @fileoverview Auxiliary StarMade format tests
 *
 * Covers small non-blueprint files that exist in /srv/StarMade and are useful
 * for complete read/write tooling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assert } from 'chai';
import { parseWorldSeed, writeWorldSeed } from '../src/db/WorldSeed.js';
import { parsePersistentObjects, writePersistentObjects } from '../src/db/PersistentObjects.js';

const STARMADE_DIR = '/srv/StarMade';

describe('WorldSeed — .seed', function () {
  it('parses and writes the world seed file', () => {
    const seedPath = path.join(STARMADE_DIR, 'server-database/world0/.seed');
    const parsed = parseWorldSeed(fs.readFileSync(seedPath));
    assert.isTrue(typeof parsed.seed === 'bigint');
    assert.deepEqual(parseWorldSeed(writeWorldSeed(parsed)), parsed);
  });

  it('rejects invalid seed sizes', () => {
    assert.throws(() => parseWorldSeed(Buffer.alloc(7)), /expected 8 bytes/);
  });
});

describe('PersistentObjects — .smdat', function () {
  it('parses and writes the live empty StarLoader persistent file', () => {
    const file = path.join(STARMADE_DIR, 'moddata/StarLoader/persistent/world0.smdat');
    const parsed = parsePersistentObjects(fs.readFileSync(file));
    assert.deepEqual(parsed.entries, []);
    assert.equal(writePersistentObjects(parsed).length, 0);
  });

  it('round-trips synthetic persistent object blocks', () => {
    const parsed = parsePersistentObjects([
      'example.ModObject',
      '{"id":1,"name":"alpha"}',
      '{"id":2,"active":true}',
      '_end_',
    ].join('\n'));

    assert.lengthOf(parsed.entries, 1);
    assert.equal(parsed.entries[0].className, 'example.ModObject');
    assert.deepEqual(parsed.entries[0].objects[1], { id: 2, active: true });
    assert.deepEqual(parsePersistentObjects(writePersistentObjects(parsed)), parsed);
  });
});
