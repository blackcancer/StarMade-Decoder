import { assert } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlockBehaviorConfig } from '../../src/config/BlockBehaviorConfig.js';
import { SMToolConfig } from '../../src/config/SMToolConfig.js';

describe('BlockBehaviorConfig document integrity', () => {
  it('detaches entries and exposes complete memory exports with immutable edits', () => {
    const xml = '<ActualRoot attr="keep"><N>1</N><Flag>true</Flag><Text>hello</Text><Unknown>007</Unknown></ActualRoot>';
    const model = BlockBehaviorConfig.fromXml(xml);
    (model.entries() as Map<string, unknown>).set('ActualRoot.N', 99);
    assert.equal(model.getNumber('ActualRoot.N'), 1);
    assert.equal(model.toXml(), xml);
    const edited = model.set('ActualRoot.N', 2);
    assert.equal(BlockBehaviorConfig.fromXml(edited.toXml()).get('ActualRoot.N'), 2);
    assert.include(edited.toXml(), '<Unknown>007</Unknown>');
    assert.include(edited.toXml(), 'attr="keep"');
    assert.equal(model.getString('ActualRoot.Text'), 'hello');
    assert.equal(model.getString('missing'), ''); assert.equal(model.getString('missing', 'fallback'), 'fallback');
    assert.equal(model.getNumber('missing'), 0); assert.equal(model.getNumber('missing', 4), 4);
    assert.isTrue(model.getBoolean('ActualRoot.Flag')); assert.isFalse(model.getBoolean('missing'));
    assert.isTrue(model.getBoolean('missing', true)); assert.isFalse(model.getBoolean('ActualRoot.N'));
    assert.isTrue(model.set('ActualRoot.Flag', 'TRUE').getBoolean('ActualRoot.Flag'));
    assert.include(model.toString(), 'BlockBehaviorConfig');
    assert.throws(() => model.set('ActualRoot.N', {} as any));
    assert.throws(() => BlockBehaviorConfig.fromXml(xml, { maxBytes: 0 }), /budget/);
  });

  it('loads overlays and writes only explicitly requested temporary custom files', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-blockBehaviorConfig-'));
    try {
      const config = SMToolConfig.fromData({ starmadeDir: temp });
      const empty = () => BlockBehaviorConfig.load(config);
      assert.throws(empty, /not found/);
      fs.mkdirSync(config.paths.dataConfig, { recursive: true });
      const source = path.join(config.paths.dataConfig, 'blockBehaviorConfig.xml');
      const xml = '<Config marker="keep"><N>1</N><Text>hello</Text></Config>';
      fs.writeFileSync(source, xml);
      const vanilla = BlockBehaviorConfig.load(config);
      assert.isFalse(fs.existsSync(config.paths.custom.blockBehaviorConfig));
      vanilla.saveCustom(config, vanilla);
      assert.isFalse(fs.existsSync(config.paths.custom.blockBehaviorConfig));
      const edited = vanilla.set('Config.N', 2);
      edited.saveCustom(config, vanilla);
      edited.saveCustom(config, vanilla);
      const custom = fs.readFileSync(path.join(config.paths.custom.blockBehaviorConfig, 'customBlockBehaviorConfig.xml'), 'utf8');
      assert.include(custom, 'marker="keep"'); assert.notInclude(custom, '<Text>');
      fs.writeFileSync(path.join(config.paths.custom.blockBehaviorConfig, 'ignored.txt'), 'not XML');
      assert.equal(BlockBehaviorConfig.load(config).get('Config.N'), 2);
      assert.equal(fs.readFileSync(source, 'utf8'), xml);
      assert.throws(() => BlockBehaviorConfig.load(config, { maxBytes: 0 }), /budget/);
      fs.writeFileSync(source, Buffer.from([255]));
      assert.throws(() => BlockBehaviorConfig.load(config), /UTF-8/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
