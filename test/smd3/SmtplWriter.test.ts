import { strict as assert } from 'node:assert';
import { parseSmtpl, BlueprintTemplate } from '../../src/smd3/SmtplParser.js';
import { writeSmtpl } from '../../src/smd3/SmtplWriter.js';
import { templateInput, templateWire } from './smtpl-fixtures.js';

describe('SmtplWriter — versioned wire contracts', () => {
  for (const version of [1, 2, 3, 4, 5, 6]) {
    it(`writes exactly the independently specified v${version} bytes`, () => {
      assert.deepEqual(writeSmtpl(templateInput(version)), templateWire(version));
      assert.deepEqual(writeSmtpl(parseSmtpl(templateWire(version))), templateWire(version));
    });

    it(`writes empty and boundary-value blocks in v${version}`, () => {
      const input = templateInput(version);
      const piece = input.pieces[0];
      Object.assign(piece, { type: version === 6 ? 8191 : 2047, hp: version <= 3 ? 255 : 127,
        orientation: version <= 3 ? 15 : 31, extra: version === 6 ? 63 : 0, active: false });
      const bytes = writeSmtpl(input);
      const hex = version === 6 ? 'ffefffff' : version >= 4 ? 'fffffb' : 'ffffff';
      assert.equal(bytes.subarray(41, version === 6 ? 45 : 44).toString('hex'), hex);
      assert.deepEqual(parseSmtpl(bytes).pieces, input.pieces.map(p => {
        const copy = { ...p }; if (copy.extra === 0) delete copy.extra; return copy;
      }));
      input.pieces = []; input.connections = []; input.texts.clear();
      input.filters = []; input.production = []; input.productionLimits = []; input.fillUpFilters = [];
      const empty = writeSmtpl(input);
      assert.equal(empty.length, 29 + (version >= 5 ? 6 : version >= 3 ? 4 : version === 2 ? 2 : 1) * 4);
      assert.equal(parseSmtpl(empty).totalBlocks, 0);
    });
  }

  it('preserves legacy HP and extended reserved bits through typed edits', () => {
    for (const version of [3, 6]) {
      const wire = templateWire(version); wire[41] |= version === 3 ? 4 : 0xfc;
      const template = parseSmtpl(wire);
      const edited = template.withPiece({ ...template.pieces[0], type: 0x346 });
      wire[version === 3 ? 43 : 44] = 0x46;
      assert.deepEqual(writeSmtpl(edited), wire);
    }
  });

  for (const version of [0, 7, 1.5, NaN]) {
    it(`rejects unsupported write version ${version}`, () => {
      assert.throws(() => writeSmtpl(templateInput(version)), /version/i);
    });
  }

  for (const version of [1, 4, 5, 6]) {
    it(`rejects unrepresentable block fields in v${version} instead of masking them`, () => {
      const limits = { type: version === 6 ? 8191 : 2047, hp: version <= 3 ? 255 : 127,
        orientation: version <= 3 ? 15 : 31, extra: version === 6 ? 63 : 0 };
      for (const [field, maximum] of Object.entries(limits)) {
        for (const bad of [-1, maximum + 1, 0.5, NaN]) {
          const input = templateInput(version);
          Object.assign(input.pieces[0], { [field]: bad });
          assert.throws(() => writeSmtpl(input), new RegExp(field));
        }
      }
      const input = templateInput(version);
      Object.assign(input.pieces[0], { active: 1 });
      assert.throws(() => writeSmtpl(input), /active/);
    });
  }

  it('rejects sections unavailable in the requested version without mutating the model', () => {
    for (const [version, section] of [[1, 'texts'], [2, 'filters'], [2, 'production'],
      [4, 'productionLimits'], [4, 'fillUpFilters']] as const) {
      const input = new BlueprintTemplate(templateInput(5)); input.version = version;
      const minimal = new BlueprintTemplate(templateInput(version));
      Object.assign(minimal, { [section]: input[section] });
      assert.throws(() => writeSmtpl(minimal), /version/i);
      assert.equal(minimal.version, version);
      assert.deepEqual(minimal[section], input[section]);
    }
  });
});
