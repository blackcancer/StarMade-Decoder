import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { SERVER_CONFIG_SCHEMA, SERVER_CONFIG_SCHEMA_SOURCE, ServerConfig } from '../../src/config/ServerConfig.js';

const reference = JSON.parse(fs.readFileSync(new URL('../fixtures/server-config-reference.json', import.meta.url), 'utf8'));

describe('ServerConfig — pinned current game contract', () => {
  it('exposes exactly the 210 active settings and their complete reference metadata', () => {
    assert.equal(SERVER_CONFIG_SCHEMA_SOURCE, reference.source);
    assert.equal(Object.keys(SERVER_CONFIG_SCHEMA).length, 210);
    assert.deepEqual(SERVER_CONFIG_SCHEMA, reference.entries);
    for (const [key, entry] of Object.entries(SERVER_CONFIG_SCHEMA)) {
      assert.ok(entry.description.trim(), `${key} needs an effect description`);
      assert.ok(Object.isFrozen(entry), `${key} must be immutable`);
      if (entry.choices) assert.ok(Object.isFrozen(entry.choices), `${key} choices must be immutable`);
      if (entry.min !== undefined) {
        assert.ok(entry.max !== undefined && entry.min <= entry.default && entry.default <= entry.max,
          `${key} default must fit its game range`);
      }
    }
    assert.ok(Object.isFrozen(SERVER_CONFIG_SCHEMA));
    assert.equal(SERVER_CONFIG_SCHEMA.SECTOR_SIZE.default, 5000);
    assert.deepEqual([SERVER_CONFIG_SCHEMA.SECTOR_SIZE.min, SERVER_CONFIG_SCHEMA.SECTOR_SIZE.max], [2000, 1000000]);
    assert.equal(SERVER_CONFIG_SCHEMA.BLUEPRINT_UPLOAD_SPEED.kind, 'long');
    assert.deepEqual(SERVER_CONFIG_SCHEMA.DEFAULT_GAME_MODE.choices, ['SURVIVAL', 'CREATIVE']);
  });

  it('recognizes every new setting and retains obsolete keys as unknown source data', () => {
    const obsolete = ['ALLOW_CUSTOM_IMAGES', 'BLUEPRINTS_USE_COMPONENTS',
      'GALAXY_DENSITY_TRANSITION_INNER_BOUND', 'GALAXY_DENSITY_TRANSITION_OUTER_BOUND',
      'GALAXY_DENSITY_RATE_INNER', 'GALAXY_DENSITY_RATE_OUTER', 'PLANET_CORE_RADIUS',
      'GAS_PLANET_SIZE_MEAN_VALUE', 'GAS_PLANET_SIZE_DEVIATION_VALUE', 'TEST_PLANET_TYPE'];
    const config = ServerConfig.fromString('ALLOW_CUSTOM_IMAGES = false // old key\nSECTOR_SIZE = 5000');
    for (const key of Object.keys(reference.entries)) assert.equal(config.isKnown(key), true, key);
    for (const key of obsolete) {
      assert.equal(config.isKnown(key), false, key);
      assert.throws(() => config.set(key, true), /Unknown/);
    }
    assert.equal(config.get('ALLOW_CUSTOM_IMAGES'), 'false');
    assert.equal(config.toString(), 'ALLOW_CUSTOM_IMAGES = false // old key\nSECTOR_SIZE = 5000');
  });

  it('enforces every numeric game range on edits, including its boundaries', () => {
    const config = ServerConfig.fromString('');
    for (const [key, entry] of Object.entries(SERVER_CONFIG_SCHEMA)) {
      if (entry.min === undefined || entry.max === undefined) continue;
      const below = entry.min - Math.max(1, Math.abs(entry.min));
      const above = entry.max + Math.max(1, Math.abs(entry.max));
      assert.equal(config.set(key, entry.min).get(key), entry.min, `${key} minimum`);
      assert.equal(config.set(key, entry.max).get(key), entry.max, `${key} maximum`);
      assert.throws(() => config.set(key, below), /at least/, `${key} below minimum`);
      assert.throws(() => config.set(key, above), /at most/, `${key} above maximum`);
    }
  });

  it('enforces game-mode choices while accepting their case-insensitive spelling', () => {
    const config = ServerConfig.fromString('DEFAULT_GAME_MODE = creative');
    assert.equal(config.get('DEFAULT_GAME_MODE'), 'creative');
    assert.equal(config.set('DEFAULT_GAME_MODE', 'SURVIVAL').get('DEFAULT_GAME_MODE'), 'SURVIVAL');
    assert.throws(() => config.set('DEFAULT_GAME_MODE', 'SPECTATOR'), /SURVIVAL, CREATIVE/);
    assert.throws(() => ServerConfig.fromString('DEFAULT_GAME_MODE = INVALID'), /SURVIVAL, CREATIVE/);
  });

  it('retains a preexisting out-of-range number verbatim but rejects a new out-of-range edit', () => {
    const old = ServerConfig.fromString('SECTOR_SIZE = 1000 // existing\n');
    assert.equal(old.getNumber('SECTOR_SIZE'), 1000);
    assert.equal(old.toString(), 'SECTOR_SIZE = 1000 // existing\n');
    assert.throws(() => old.set('SECTOR_SIZE', 1000), /at least 2000/);
    assert.equal(old.set('SECTOR_SIZE', 5000).getNumber('SECTOR_SIZE'), 5000);
  });
});
