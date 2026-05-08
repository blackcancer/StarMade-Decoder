/**
 * @fileoverview Additional Sample Corpus Tests
 *
 * Covers .smtpl files, folder blueprints, and extra .sment samples.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { parseSmtpl } from '../src/smd3/SmtplParser.js';
import { parseBlueprintFolder } from '../src/smd3/BlueprintFolderParser.js';
import { parseSment } from '../src/smd3/SmentParser.js';
import type { SmtplFile } from '../src/smd3/SmtplParser.js';

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');

// ── Helpers ───────────────────────────────────────────────────────────────────

function topTypes(pieces: SmtplFile['pieces'], n = 5): string {
  const m = new Map<number, number>();
  for (const p of pieces) m.set(p.type, (m.get(p.type) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([t, c]) => `type=${t}(${c})`).join(', ');
}

// ── .smtpl ────────────────────────────────────────────────────────────────────

describe('SmtplParser — .smtpl files', function () {
  this.timeout(15_000);

  it('8-Bit NOR Gate RAM Module (version 5)', () => {
    const data = fs.readFileSync(path.join(S, '8-Bit-4-Wide-NOR Gate RAM Module-12x12x16-00.smtpl'));
    const tpl = parseSmtpl(data);
    assert.isNumber(tpl.version);
    assert.isAbove(tpl.totalBlocks, 0);
    console.log('    NOR Gate: version=' + tpl.version +
      ' size=(' + tpl.sizeX + 'x' + tpl.sizeY + 'x' + tpl.sizeZ + ')' +
      ' blocks=' + tpl.totalBlocks +
      ' connections=' + tpl.connections.length +
      ' texts=' + tpl.texts.size);
    console.log('    Top types:', topTypes(tpl.pieces));
  });

  it('83 DMINT prefab interior module pack files', async () => {
    const dir = path.join(S, 'DMINT prefab interior module pack');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.smtpl'));
    console.log('    .smtpl count:', files.length);
    assert.isAbove(files.length, 0);

    let failed = 0;
    let totalBlocks = 0;
    for (const f of files) {
      try {
        const data = fs.readFileSync(path.join(dir, f));
        const tpl = parseSmtpl(data);
        totalBlocks += tpl.totalBlocks;
      } catch (e: any) {
        console.log('    FAIL:', f, '->', e.message.slice(0, 60));
        failed++;
      }
    }
    console.log('    Result: ' + (files.length - failed) + '/' + files.length + ' OK, totalBlocks=' + totalBlocks);
    assert.equal(failed, 0, `${failed} files failed`);
  });

  it('DMINT hall (details)', () => {
    const data = fs.readFileSync(path.join(S, 'DMINT prefab interior module pack', 'dmint Hall - Linear Dark.smtpl'));
    const tpl = parseSmtpl(data);
    assert.isAbove(tpl.totalBlocks, 0);
    console.log('    Hall Linear Dark: version=' + tpl.version +
      ' size=(' + tpl.sizeX + 'x' + tpl.sizeY + 'x' + tpl.sizeZ + ')' +
      ' blocks=' + tpl.totalBlocks);
    console.log('    Top types:', topTypes(tpl.pieces));
    if (tpl.texts.size > 0) {
      console.log('    Textes:', [...tpl.texts.values()].slice(0, 3));
    }
  });
});

// ── Blueprints folder ────────────────────────────────────────────────────────

describe('BlueprintFolderParser — folder blueprints', function () {
  this.timeout(30_000);

  it('BASE_Warehouse_Station (space station)', () => {
    const fp = path.join(S, 'BASE_Warehouse_Station');
    const bp = parseBlueprintFolder(fp);
    assert.exists(bp.root);
    assert.isAbove(bp.totalEntities, 0);
    const r = bp.root;
    console.log('    BASE_Warehouse_Station:');
    console.log('      entityType:', r.header.entityType);
    console.log('      gameVersion:', r.header.gameVersion ?? 'N/A');
    const bb = r.header.boundingBox;
    console.log('      BoundingBox: min(' + bb.minX.toFixed(0) + ',' + bb.minY.toFixed(0) + ',' + bb.minZ.toFixed(0) + ')' +
                             ' max(' + bb.maxX.toFixed(0) + ',' + bb.maxY.toFixed(0) + ',' + bb.maxZ.toFixed(0) + ')');
    console.log('      totalBlockCount:', r.header.totalBlockCount);
    console.log('      totalEntities:', bp.totalEntities, '  totalSegments:', bp.totalSegments);
    console.log('      root children:', r.children.length);

    // Check the main segment
    const seg0 = r.segments[0]?.segments[0];
    if (seg0) {
      console.log('      First seg: version=' + seg0.version + ' blockCount=' + seg0.blockCount);
    }
  });

  it('Gravity magnifier warpgate (folder)', () => {
    // This is actually a folder containing .sment files, not a direct blueprint folder
    // Treat it as a file directory
    const dir = path.join(S, 'Gravity magnifier warpgate');
    const smentFiles = fs.readdirSync(dir).filter(f => f.endsWith('.sment'));
    console.log('    Gravity magnifier warpgate: ' + smentFiles.length + ' .sment found');
    assert.isAbove(smentFiles.length, 0);

    for (const f of smentFiles) {
      const data = fs.readFileSync(path.join(dir, f));
      const sment = parseSment(data);
      const r = sment.root;
      const bb = r.header.boundingBox;
      console.log('    [' + f + ']:');
      console.log('      entityType:', r.header.entityType, ' totalEntities:', sment.totalEntities);
      console.log('      BoundingBox: min(' + bb.minX.toFixed(0) + ',' + bb.minY.toFixed(0) + ',' + bb.minZ.toFixed(0) + ')' +
                               ' max(' + bb.maxX.toFixed(0) + ',' + bb.maxY.toFixed(0) + ',' + bb.maxZ.toFixed(0) + ')');
      console.log('      blocks:', r.header.totalBlockCount, ' segments:', sment.totalSegments);
    }
  });

  it('firestorm class battlecruiser.sment', () => {
    const data = fs.readFileSync(path.join(S, 'firestorm class battlecruiser.sment'));
    const sment = parseSment(data);
    const r = sment.root;
    const bb = r.header.boundingBox;
    console.log('    Firestorm:');
    console.log('      entityType:', r.header.entityType, ' gameVersion:', r.header.gameVersion);
    console.log('      BoundingBox: min(' + bb.minX.toFixed(0) + ',' + bb.minY.toFixed(0) + ',' + bb.minZ.toFixed(0) + ')' +
                             ' max(' + bb.maxX.toFixed(0) + ',' + bb.maxY.toFixed(0) + ',' + bb.maxZ.toFixed(0) + ')');
    console.log('      blocks:', r.header.totalBlockCount, ' entities:', sment.totalEntities, ' segments:', sment.totalSegments);
    assert.isAbove(sment.totalSegments, 0);
  });
});
