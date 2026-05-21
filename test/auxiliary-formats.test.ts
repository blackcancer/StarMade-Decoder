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
import {
  formatSbvTimeCode,
  parseSbvSubtitles,
  parseSbvTimeCode,
  writeSbvSubtitles,
} from '../src/config/SbvSubtitles.js';

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

describe('SbvSubtitles — .sbv', function () {
  it('parses and writes a synthetic subtitle file', () => {
    const parsed = parseSbvSubtitles([
      '00:00:01.600,00:00:07.800',
      'First line',
      'Second line',
      '',
      '00:00:08.100,00:00:14.080',
      'Another cue',
      '',
    ].join('\n'));

    assert.deepEqual(parsed.cues[0], {
      startMs: 1600,
      endMs: 7800,
      lines: ['First line', 'Second line'],
    });
    assert.equal(writeSbvSubtitles(parsed), [
      '00:00:01.600,00:00:07.800',
      'First line',
      'Second line',
      '',
      '00:00:08.100,00:00:14.080',
      'Another cue',
      '',
    ].join('\n'));
  });

  it('parses every live StarMade .sbv language file', () => {
    const languageDir = path.join(STARMADE_DIR, 'language');
    const files = fs.readdirSync(languageDir, { recursive: true })
      .filter((name): name is string => typeof name === 'string' && name.endsWith('.sbv'));

    assert.isAbove(files.length, 0);
    for (const file of files) {
      const parsed = parseSbvSubtitles(fs.readFileSync(path.join(languageDir, file)));
      assert.isAbove(parsed.cues.length, 0, file);
      assert.doesNotThrow(() => parseSbvSubtitles(writeSbvSubtitles(parsed)), file);
    }
  });

  it('validates time codes and malformed cues', () => {
    assert.equal(parseSbvTimeCode('01:02:03.004'), 3723004);
    assert.equal(formatSbvTimeCode(3723004), '01:02:03.004');
    assert.throws(() => parseSbvTimeCode('00:99:00.000'), /Invalid SBV time code/);
    assert.throws(() => parseSbvSubtitles('00:00:02.000,00:00:01.000\nBad\n'), /ends before/);
  });
});
