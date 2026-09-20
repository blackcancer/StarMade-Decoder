/**
 * @fileoverview Configuration edge cases with portable local fixtures.
 * Covers unknown style descriptors, reactor cycles, optional references and
 * subtitle validation without changing production mappings to obtain coverage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from 'chai';
import { SMToolConfig } from '../../src/config/SMToolConfig.js';
import { BlockConfig, getBlockStyleDescriptor, getResourceInjectionDescriptor } from '../../src/config/BlockConfig.js';
import { parseSbvSubtitles, writeSbvSubtitles, parseSbvTimeCode, formatSbvTimeCode } from '../../src/config/SbvSubtitles.js';

describe('Configuration boundaries — references, cycles and subtitles', () => {
  it('supports current-directory loading and missing world defaults without touching the installation', () => {
    const cwd = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-cwd-'));
    try {
      process.chdir(temp);
      assert.throws(() => SMToolConfig.load(), /created/);
      fs.writeFileSync('SMToolConfig.json', JSON.stringify({ starmadeDir: temp }));
      const cfg = SMToolConfig.load(); assert.equal(cfg.worldDir, 'world0');
      cfg.save(); assert.equal(SMToolConfig.load().starmadeDir, temp);
      assert.throws(() => SMToolConfig.fromData({ starmadeDir: '' }), /required/);
    } finally { process.chdir(cwd); fs.rmSync(temp, { recursive: true, force: true }); }
  });

  it('resolves unknown styles, special orientations and every public reference accessor', () => {
    const cfg = BlockConfig.fromXml('<Config>' + [5, 56, 688, 689].map(id => `<Block type="${id}" name="Block${id}"/>`).join('') + '</Config>');
    assert.equal(getBlockStyleDescriptor(999).id, 999);
    assert.equal(getResourceInjectionDescriptor(999).key, 'UNKNOWN_999');
    const hull = cfg.getById(5)!;
    assert.isBoolean(hull.isNormalBlockStyle); assert.isBoolean(hull.isSolidBlockStyle);
    assert.equal(cfg.getById(689)!.defaultOrientation, 4);
    assert.equal(cfg.getById(688)!.defaultOrientation, 2);
    assert.equal(cfg.getById(56)!.defaultOrientation, 3);
    assert.equal(hull.with({ blockStyle: 6 }).defaultOrientation, 14);
    for (const v of [5, '5', 'missing', '', NaN, Infinity]) {
      const reference = cfg.resolveReference(v);
      assert.isObject(reference); assert.property(reference, 'id');
    }
    assert.equal(cfg.resolveIngredient({ type: '5', count: 3 }).count, 3);
    assert.equal(cfg.getElementInfoById(5)!.identity.id, 5); assert.isUndefined(cfg.getElementInfoById(999));
    assert.equal(cfg.getElementInfoByName('Block5')!.identity.id, 5); assert.isUndefined(cfg.getElementInfoByName('missing'));
    assert.equal(cfg.getElementInfoByTypeName('5')!.identity.id, 5); assert.isUndefined(cfg.getElementInfoByTypeName('missing'));
    const styled = (BlockConfig as any)._nodeToBlock(1, 'X', { '@_name': 'X', LightSourceColor: 'invalid' });
    assert.deepEqual(styled.lightSourceColor, [1, 1, 1, 1]);
  });

  it('terminates cyclic chamber references and exposes all permitted entity types', () => {
    const cfg = BlockConfig.fromXml('<Config><Block type="1" name="A"><ChamberParent>2</ChamberParent><ChamberUpgradesTo>2</ChamberUpgradesTo><ChamberPermission>7</ChamberPermission></Block><Block type="2" name="B"><ChamberParent>1</ChamberParent><ChamberUpgradesTo>1</ChamberUpgradesTo></Block><Block type="3" name="Root"/></Config>');
    const info = cfg.getById(1)!.toElementInfo(cfg);
    assert.isObject(info.chamber);
    assert.include(JSON.stringify(info.chamber), 'ship');
    assert.include(JSON.stringify(info.chamber), 'station');
    assert.include(JSON.stringify(info.chamber), 'planet');
    assert.isObject(cfg.getById(3)!.toElementInfo(cfg));
  });

  it('rejects invalid subtitle timing, missing text and empty documents', () => {
    const valid = '00:00:00.1,00:00:01.25\nHello\n';
    assert.deepEqual(parseSbvSubtitles(Buffer.from(valid)), parseSbvSubtitles(valid));
    assert.equal(parseSbvTimeCode('00:00:00.1'), 100);
    for (const time of ['invalid', '00:60:00.0', '00:00:60.0']) assert.throws(() => parseSbvTimeCode(time));
    for (const ms of [-1, 1.5, Infinity]) assert.throws(() => formatSbvTimeCode(ms));
    for (const text of ['', ' ', '00:00:00.0,00:00:01.0', ',\nx', 'x,x,x\nx']) assert.throws(() => parseSbvSubtitles(text));
    assert.throws(() => writeSbvSubtitles({ cues: [] }));
    assert.throws(() => writeSbvSubtitles({ cues: [{ startMs: 0, endMs: 1, lines: [] }] }));
    assert.throws(() => writeSbvSubtitles({ cues: [{ startMs: 2, endMs: 1, lines: ['x'] }] }));
  });
});
