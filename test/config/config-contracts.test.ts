/**
 * @fileoverview Installation-independent configuration persistence contracts.
 * Temporary fixtures exercise defaults, overrides, comments and all value kinds
 * without relying on the developer's StarMade installation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from 'chai';
import { ServerConfig, SERVER_CONFIG_SCHEMA } from '../../src/config/ServerConfig.js';
import { SMToolConfig } from '../../src/config/SMToolConfig.js';
import { BlockConfig } from '../../src/config/BlockConfig.js';
import { BlockRegistry } from '../../src/config/BlockRegistry.js';
import { parseSystemNames, writeSystemNames } from '../../src/config/SystemNames.js';

describe('Configuration contracts — portable fixtures', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-config-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); BlockRegistry.reset(); });

  it('round-trips every schema value and preserves its declared primitive type', () => {
    const text = Object.entries(SERVER_CONFIG_SCHEMA).map(([key, meta]) => `${key} = ${meta.default}`).join('\n');
    const cfg = ServerConfig.fromString(text);
    assert.equal(cfg.keys().length, Object.keys(SERVER_CONFIG_SCHEMA).length);
    for (const [key, meta] of Object.entries(SERVER_CONFIG_SCHEMA)) {
      assert.isTrue(cfg.isKnown(key));
      assert.strictEqual(cfg.get(key), meta.default, key);
      assert.strictEqual(ServerConfig.fromString('').get(key), meta.default, `default ${key}`);
      const value = meta.type === 'string' ? 'changed' : meta.type === 'boolean' ? !meta.default : 7;
      const next = cfg.set(key, value);
      assert.strictEqual(ServerConfig.fromString(next.toString()).get(key), value, `edit ${key}`);
      assert.strictEqual(cfg.get(key), meta.default, `immutable ${key}`);
    }
    assert.equal(cfg.entries().size, cfg.keys().length);
    assert.isFalse(cfg.isKnown('UNKNOWN_FIELD'));
    assert.equal(cfg.get('UNKNOWN_FIELD'), '');
    assert.throws(() => cfg.set('UNKNOWN_FIELD', 1), TypeError);
    assert.throws(() => cfg.setMany({ WORLD: 'alpha', UNKNOWN_FIELD: 1 }), TypeError);
  });

  it('loads the template, prefers the live file, and preserves comments on edits', () => {
    const config = SMToolConfig.fromData({ starmadeDir: root });
    fs.mkdirSync(config.paths.defaultSettings, { recursive: true });
    const text = '# Header\n\nnot an assignment\nWORLD = alpha // keep\nMAX_CLIENTS = 8\nCUSTOM = TRUE\nENABLE_SIMULATION = false\nPHYSICS_LINEAR_DAMPING = 0.25\n';
    fs.writeFileSync(path.join(config.paths.defaultSettings, 'server.cfg'), text);
    const original = ServerConfig.load(config);
    assert.equal(original.toString(), text);
    assert.isTrue(original.getBoolean('CUSTOM'));
    assert.isFalse(original.getBoolean('ENABLE_SIMULATION'));
    assert.isTrue(original.getBoolean('BLUEPRINTS_USE_COMPONENTS'));
    assert.equal(original.getFloat('PHYSICS_LINEAR_DAMPING'), 0.25);
    assert.equal(original.getNumber('MAX_CLIENTS'), 8);
    assert.equal(original.getString('MAX_CLIENTS'), '8');
    const next = original.setMany({ WORLD: 'beta', MAX_CLIENTS: 12, DEBUG_FSM_STATE: true });
    assert.include(next.toString(), 'WORLD = beta // keep');
    assert.include(next.toString(), 'MAX_CLIENTS = 12');
    assert.include(next.toString(), 'DEBUG_FSM_STATE = true');
    next.save(config);
    assert.equal(ServerConfig.load(config).get('WORLD'), 'beta');
    assert.equal(original.get('WORLD'), 'alpha');
  });

  it('preserves syllables, flags, empty files and both newline styles', () => {
    const expected = { syllables: [{ value: 'sol', flags: ['+c', '-v'] }, { value: 'ara', flags: [] }] };
    for (const input of ['# comment\n\nsol +c -v\r\n ara \n', Buffer.from('sol +c -v\nara')]) {
      assert.deepEqual(parseSystemNames(input), expected);
    }
    assert.equal(writeSystemNames(expected).toString(), 'sol +c -v\nara\n');
    assert.equal(writeSystemNames(expected, '\r\n').toString(), 'sol +c -v\r\nara\r\n');
    assert.deepEqual(parseSystemNames(new Uint8Array(writeSystemNames(expected))), expected);
    assert.equal(writeSystemNames({ syllables: [] }).length, 0);
  });

  it('exposes numeric block lookups before and after registry initialization', () => {
    BlockRegistry.reset();
    assert.isFalse(BlockRegistry.isInitialized);
    for (const getter of [BlockRegistry.get, BlockRegistry.getHp, BlockRegistry.getMass, BlockRegistry.getPrice]) {
      assert.isNull(getter(5));
    }
    assert.equal(BlockRegistry.getName(5), 'block#5');
    const cfg = BlockConfig.fromXml('<Config><Block type="5" name="Hull"><Hitpoints>100</Hitpoints><Mass>2</Mass><Price>7</Price></Block></Config>');
    BlockRegistry.init(cfg);
    assert.isTrue(BlockRegistry.isInitialized);
    assert.equal(BlockRegistry.getName(5), 'Hull');
    assert.equal(BlockRegistry.getHp(5), 100);
    assert.equal(BlockRegistry.getMass(5), 2);
    assert.equal(BlockRegistry.getPrice(5), 7);
    assert.strictEqual(BlockRegistry.get(5), cfg.getById(5));
    for (const getter of [BlockRegistry.get, BlockRegistry.getHp, BlockRegistry.getMass, BlockRegistry.getPrice]) {
      assert.isNull(getter(9999));
    }
    assert.equal(BlockRegistry.getName(9999), 'block#9999');
  });
});
