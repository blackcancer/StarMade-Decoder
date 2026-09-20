/** @fileoverview Typed faction summaries share strict archive validation and configurable read limits. */
import fs from 'node:fs';
import { strict as assert } from 'node:assert';
import { readFrom, writeTo } from '../../src/core/TagParser.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { registerAllFactories } from '../../src/serializable/Factories.js';
import { parseFactions } from '../../src/entity/Factions.js';

describe('parseFactions — strict detached projection', () => {
  it('extracts actual identifiers and NPC categories without fabricating credits or borrowing source data', () => {
    registerAllFactories();
    const root = readFrom(fs.readFileSync('samples/FACTIONS.fac')), before = writeTo(root);
    const parsed = parseFactions(root);
    assert.equal(parsed.totalCount, parsed.factions.length); assert.ok(parsed.totalCount > 0);
    assert.ok(parsed.factions.some(faction => faction.factionType === 0));
    assert.ok(parsed.factions.some(faction => faction.factionType === 1));
    assert.ok(parsed.factions.every(faction => faction.credits === undefined));
    parsed.factions[0].name = 'Only a projection'; parsed.factions.pop();
    assert.deepEqual(writeTo(root), before);
  });
  it('passes selected limits through to the model and rejects unknown layouts explicitly', () => {
    const root = Tags.struct('factions-v0', Array.from({ length: 5 }, () => Tags.struct(null, [])));
    assert.deepEqual(parseFactions(root), { version: 0, factions: [], totalCount: 0 });
    assert.throws(() => parseFactions(root, { maxNodes: 2 }), { code: 'E_LIMIT' });
    assert.throws(() => parseFactions(Tags.struct('future-format', [])), { code: 'E_UNSUPPORTED' });
  });
});
