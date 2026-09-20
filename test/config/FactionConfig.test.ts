import { assert } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FactionConfig } from '../../src/config/FactionConfig.js';
import { SMToolConfig } from '../../src/config/SMToolConfig.js';

describe('FactionConfig document integrity', () => {
  it('detaches entries and exposes complete memory exports with immutable edits', () => {
    const xml = '<ActualRoot attr="keep"><N>1</N><Flag>true</Flag><Text>hello</Text><Unknown>007</Unknown></ActualRoot>';
    const model = FactionConfig.fromXml(xml);
    (model.entries() as Map<string, unknown>).set('ActualRoot.N', 99);
    assert.equal(model.getNumber('ActualRoot.N'), 1);
    assert.equal(model.toXml(), xml);
    const edited = model.set('ActualRoot.N', 2);
    assert.equal(FactionConfig.fromXml(edited.toXml()).get('ActualRoot.N'), 2);
    assert.include(edited.toXml(), '<Unknown>007</Unknown>');
    assert.include(edited.toXml(), 'attr="keep"');
    assert.equal(model.getString('ActualRoot.Text'), 'hello');
    assert.equal(model.getString('missing'), ''); assert.equal(model.getString('missing', 'fallback'), 'fallback');
    assert.equal(model.getNumber('missing'), 0); assert.equal(model.getNumber('missing', 4), 4);
    assert.isTrue(model.getBoolean('ActualRoot.Flag')); assert.isFalse(model.getBoolean('missing'));
    assert.isTrue(model.getBoolean('missing', true)); assert.isFalse(model.getBoolean('ActualRoot.N'));
    assert.isTrue(model.set('ActualRoot.Flag', 'TRUE').getBoolean('ActualRoot.Flag'));
    assert.include(model.toString(), 'FactionConfig');
    assert.throws(() => model.set('ActualRoot.N', {} as any));
    assert.throws(() => FactionConfig.fromXml(xml, { maxBytes: 0 }), /budget/);
  });

  it('loads overlays and writes only explicitly requested temporary custom files', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-factionConfig-'));
    try {
      const config = SMToolConfig.fromData({ starmadeDir: temp });
      const empty = () => FactionConfig.load(config);
      assert.equal(empty().entries().size, 0);
      fs.mkdirSync(config.paths.dataConfig, { recursive: true });
      const source = path.join(config.paths.dataConfig, 'FactionConfig.xml');
      const xml = '<Config marker="keep"><N>1</N><Text>hello</Text></Config>';
      fs.writeFileSync(source, xml);
      const vanilla = FactionConfig.load(config);
      assert.isFalse(fs.existsSync(config.paths.custom.factionConfig));
      vanilla.saveCustom(config, vanilla);
      assert.isFalse(fs.existsSync(config.paths.custom.factionConfig));
      const edited = vanilla.set('Config.N', 2);
      edited.saveCustom(config, vanilla);
      edited.saveCustom(config, vanilla);
      const custom = fs.readFileSync(path.join(config.paths.custom.factionConfig, 'FactionConfig.xml'), 'utf8');
      assert.include(custom, 'marker="keep"'); assert.notInclude(custom, '<Text>');
      fs.writeFileSync(path.join(config.paths.custom.factionConfig, 'ignored.txt'), 'not XML');
      assert.equal(FactionConfig.load(config).get('Config.N'), 2);
      assert.equal(fs.readFileSync(source, 'utf8'), xml);
      assert.throws(() => FactionConfig.load(config, { maxBytes: 0 }), /budget/);
      fs.writeFileSync(source, Buffer.from([255]));
      assert.throws(() => FactionConfig.load(config), /UTF-8/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
