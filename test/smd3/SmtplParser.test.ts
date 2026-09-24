import { strict as assert } from 'node:assert';
import { BlueprintTemplate, parseSmtpl } from '../../src/smd3/SmtplParser.js';
import { templateInput, templateWire } from './smtpl-fixtures.js';

describe('SmtplParser — versioned wire contracts', () => {
  it('returns an independent model while public construction still snapshots caller arrays', () => {
    const source = templateWire(5), original = Buffer.from(source);
    const parsed = parseSmtpl(source), second = parseSmtpl(source);
    assert.ok(parsed instanceof BlueprintTemplate);
    parsed.pieces[0].type = 999;
    parsed.connections[0].targets.push(19n);
    parsed.texts.set(5n, 'changed');
    assert.deepEqual(source, original);
    assert.equal(second.pieces[0].type, templateInput(5).pieces[0].type);
    assert.equal(second.connections[0].targets.length, 2);
    assert.equal(second.texts.get(5n), 'A\0é');
    const input = templateInput(5), model = new BlueprintTemplate(input);
    input.pieces[0].type = 777;
    assert.equal(model.pieces[0].type, templateInput(5).pieces[0].type);
  });
  for (const version of [1, 2, 3, 4, 5, 6]) {
    it(`decodes independent v${version} bytes, including every available section`, () => {
      const parsed = parseSmtpl(templateWire(version));
      const expected = templateInput(version);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
        assert.deepEqual(parsed[key], expected[key], key);
      }
      assert.deepEqual(parsed.bounds, { min: { x: -1, y: 2, z: -3 }, max: { x: 4, y: 5, z: 6 }, size: { x: 6, y: 4, z: 10 } });
    });
  }

  it('keeps all eight legacy HP bits without applying game orientation migration', () => {
    const wire = templateWire(3); wire[41] |= 4;
    assert.equal(parseSmtpl(wire).pieces[0].hp, 213);
  });

  it('retains extended v6 reserved bits', () => {
    const wire = templateWire(6); wire[41] |= 0xfc;
    assert.equal(parseSmtpl(wire).pieces[0].extra, 63);
  });

  for (const version of [0, 7, 127, 255]) {
    it(`rejects unknown version byte ${version}`, () => {
      const wire = templateWire(5); wire[0] = version;
      assert.throws(() => parseSmtpl(wire), /version/i);
    });
  }

  for (const version of [1, 2, 3, 4, 5, 6]) {
    it(`rejects negative, impossible and truncated collections in v${version}`, () => {
      const shift = version === 6 ? 1 : 0;
      const offsets = [25, 44 + shift, 56 + shift];
      if (version >= 2) offsets.push(76 + shift);
      if (version >= 3) offsets.push(95 + shift, 107 + shift, 117 + shift);
      if (version >= 5) offsets.push(131 + shift, 147 + shift, 159 + shift);
      for (const offset of offsets) {
        for (const count of [-1, 0x7fffffff]) {
          const wire = templateWire(version); wire.writeInt32BE(count, offset);
          assert.throws(() => parseSmtpl(wire), /count/, `version ${version}, count at ${offset}`);
        }
        assert.throws(() => parseSmtpl(templateWire(version).subarray(0, offset + 3)),
          /underflow|count/, `truncated count at ${offset}`);
      }
      assert.throws(() => parseSmtpl(templateWire(version).subarray(0, -1)), /underflow|count/);
    });
  }
});
