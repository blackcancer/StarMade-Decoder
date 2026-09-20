import { assert } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerConfig, SERVER_CONFIG_SCHEMA } from '../../src/config/ServerConfig.js';
import { SMToolConfig } from '../../src/config/SMToolConfig.js';

describe('ServerConfig document integrity', () => {
  it('detaches entries and treats inherited names as unknown data', () => {
    const source = '# comment\n__proto__ = untouched\nconstructor = name\nMAX_CLIENTS = 1\n';
    const model = ServerConfig.fromString(source);
    (model.entries() as Map<string, unknown>).set('MAX_CLIENTS', 99);
    assert.equal(model.get('MAX_CLIENTS'), 1);
    assert.equal(model.get('constructor'), 'name');
    assert.equal(ServerConfig.fromString('').get('constructor'), '');
    assert.isFalse(model.isKnown('__proto__'));
    assert.isFalse(model.isKnown('constructor'));
    assert.throws(() => model.set('__proto__', 'bad'), TypeError);
    assert.throws(() => model.set(['WORLD'] as any, 'bad'), TypeError);
    assert.throws(() => { (SERVER_CONFIG_SCHEMA.WORLD as any).default = 'changed'; }, TypeError);
    assert.equal(model.toString(), source);
  });

  it('updates every duplicate without treating commented records as active and retains CRLF comments', () => {
    const source = '// MAX_CLIENTS = 100\r\nMAX_CLIENTS = 1 // first\r\nMAX_CLIENTS = 2 // second\r\n';
    const model = ServerConfig.fromString(source);
    assert.equal(model.getNumber('MAX_CLIENTS'), 2);
    const changed = model.set('MAX_CLIENTS', 7);
    assert.equal(ServerConfig.fromString(changed.toString()).getNumber('MAX_CLIENTS'), 7);
    assert.include(changed.toString(), 'MAX_CLIENTS = 7 // first\r\n');
    assert.include(changed.toString(), 'MAX_CLIENTS = 7 // second\r\n');
    assert.include(changed.toString(), '// MAX_CLIENTS = 100\r\n');
    assert.equal(model.toString(), source);
  });

  it('rejects wrong primitive types, inexact integers and values that would inject records', () => {
    const model = ServerConfig.fromString('');
    for (const value of ['true', 1, null, {}]) assert.throws(() => model.set('ENABLE_SIMULATION', value as any), TypeError);
    for (const value of [1, null, {}, ' leading', 'trailing ', 'a\nb', 'a\rb', 'https://host', '\ud800']) assert.throws(() => model.set('WORLD', value as any), TypeError);
    for (const value of ['1', NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => model.set('MAX_CLIENTS', value as any), TypeError);
    for (const value of ['1', NaN, Infinity]) assert.throws(() => model.set('PHYSICS_LINEAR_DAMPING', value as any), TypeError);
    assert.equal(model.set('MAX_CLIENTS', -7).get('MAX_CLIENTS'), -7);
    assert.equal(model.set('PHYSICS_LINEAR_DAMPING', 0.25).get('PHYSICS_LINEAR_DAMPING'), 0.25);
    assert.equal(model.set('WORLD', 'a=b').get('WORLD'), 'a=b');
    assert.equal(model.toString(), '');
  });

  it('rejects malformed typed records instead of silently truncating or returning NaN', () => {
    for (const source of ['MAX_CLIENTS = 4junk', 'MAX_CLIENTS = 1.5', 'PHYSICS_LINEAR_DAMPING = 1e999',
      'PHYSICS_LINEAR_DAMPING = nope', 'ENABLE_SIMULATION = nope', '= value']) assert.throws(() => ServerConfig.fromString(source));
    assert.throws(() => ServerConfig.fromString(1 as any), TypeError);
    assert.throws(() => ServerConfig.fromString('# \ud800'), /Unicode/);
    const model = ServerConfig.fromString('MAX_CLIENTS = +12\nPHYSICS_LINEAR_DAMPING = -.5e1\nENABLE_SIMULATION = FALSE');
    assert.equal(model.get('MAX_CLIENTS'), 12);
    assert.equal(model.get('PHYSICS_LINEAR_DAMPING'), -5);
    assert.isFalse(model.getBoolean('ENABLE_SIMULATION'));
  });

  it('retains configurable byte and entry ceilings across immutable edits', () => {
    assert.throws(() => ServerConfig.fromString('é', { maxBytes: 1 }), /budget/);
    assert.throws(() => ServerConfig.fromString('WORLD=x', { maxEntries: 0 }), /budget/);
    assert.throws(() => ServerConfig.fromString('', { maxBytes: -1 }));
    const bytes = ServerConfig.fromString('', { maxBytes: 0 });
    assert.equal(bytes.toString(), '');
    assert.throws(() => bytes.set('WORLD', ''), /budget/);
    const entries = ServerConfig.fromString('WORLD=x', { maxEntries: 1 });
    assert.throws(() => entries.set('MAX_CLIENTS', 1), /budget/);
    assert.equal(entries.get('WORLD'), 'x');
  });

  it('loads and saves only explicit temporary paths, checking size before reading', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-server-model-'));
    try {
      const config = SMToolConfig.fromData({ starmadeDir: temp });
      assert.throws(() => ServerConfig.load(config), /not found/);
      fs.mkdirSync(config.paths.defaultSettings, { recursive: true });
      const template = path.join(config.paths.defaultSettings, 'server.cfg');
      fs.writeFileSync(template, 'WORLD = original');
      assert.throws(() => ServerConfig.load(config, { maxBytes: 0 }), /budget/);
      const original = ServerConfig.load(config);
      assert.isFalse(fs.existsSync(config.paths.serverCfg));
      original.set('WORLD', 'edited').save(config);
      assert.equal(ServerConfig.load(config).get('WORLD'), 'edited');
      assert.equal(fs.readFileSync(template, 'utf8'), 'WORLD = original');
      fs.writeFileSync(config.paths.serverCfg, Buffer.from([255]));
      assert.throws(() => ServerConfig.load(config), /UTF-8/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
