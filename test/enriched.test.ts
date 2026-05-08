/**
 * @fileoverview Phase 4 BlockConfig Enrichment Tests
 *
 * Covers BlockConfig-enriched views, edge cases, security constraints, and
 * performance guardrails before additional functional development continues.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { SMToolConfig } from '../src/config/SMToolConfig.js';
import { BlockConfig } from '../src/config/BlockConfig.js';
import { BlockRegistry } from '../src/config/BlockRegistry.js';
import { ElementCountMap } from '../src/objects/Serializables.js';
import { Ship } from '../src/objects/entities/Ships.js';
import { ManagerContainer } from '../src/objects/components/ManagerContainer.js';
import { Tags } from '../src/core/TagBuilder.js';
import {
  enrichBlockCounts,
  getBlockCountStats,
  enrichSmd3,
  enrichSegment,
  RichSegmentController,
} from '../src/objects/enriched/index.js';
import { parseSmd3, BLOCK_COUNT } from '../src/smd3/Smd3Parser.js';

registerAllFactories();

const STARMADE_DIR = '/mnt/d/Jeux/Steam/steamapps/common/StarMade/StarMade';
const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');

function initBlockRegistry(): void {
  const cfg = SMToolConfig.fromData({ starmadeDir: STARMADE_DIR, worldDir: 'world0' });
  BlockRegistry.init(BlockConfig.load(cfg));
}

function minimalBlockConfigXml(name = 'Test Block'): string {
  return `<Config><Element><General><Basic><Block type="TEST_BLOCK" name="${name}" icon="1">
    <Hitpoints>10</Hitpoints><Mass>2</Mass><Volume>3</Volume><Price>4</Price>
    <Description>safe</Description><ArmorValue>0</ArmorValue><Placable>true</Placable>
    <InShop>true</InShop><Orientation>false</Orientation><CanActivate>false</CanActivate>
    <Deprecated>false</Deprecated><BlockStyle>0</BlockStyle>
  </Block></Basic></General></Element></Config>`;
}

describe('Phase 4 — BlockConfig-enriched views', function () {
  this.timeout(30_000);

  before(() => {
    initBlockRegistry();
  });

  after(() => {
    BlockRegistry.reset();
  });

  it('BlockRegistry resolves a known vanilla block', () => {
    const def = BlockRegistry.get(1);
    assert.isDefined(def);
    assert.equal(BlockRegistry.getName(1), def!.name);
    assert.equal(BlockRegistry.getHp(1), def!.hp);
  });

  it('BlockRegistry falls back to block#id when uninitialized or unknown', () => {
    BlockRegistry.reset();
    assert.isFalse(BlockRegistry.isInitialized);
    assert.isNull(BlockRegistry.get(123456));
    assert.equal(BlockRegistry.getName(123456), 'block#123456');

    initBlockRegistry();
    assert.equal(BlockRegistry.getName(123456), 'block#123456');
  });

  it('enrichBlockCounts computes names and statistics', () => {
    const ecm = new ElementCountMap([
      { type: 1, count: 2 },
      { type: 598, count: 3 },
    ]);

    const enriched = enrichBlockCounts(ecm);
    const stats = getBlockCountStats(ecm);

    assert.lengthOf(enriched, 2);
    assert.equal(stats.totalBlocks, 5);
    assert.isAbove(stats.totalMass, 0);
    assert.isAbove(stats.totalHp, 0);
    assert.isNotNull(enriched[0].blockDef);
    assert.isString(enriched[0].blockName);
  });

  it('enrichBlockCounts ignores zero/negative counts and keeps unknown types safe', () => {
    const ecm = new ElementCountMap([
      { type: 1, count: 0 },
      { type: 2, count: -4 },
      { type: 999999, count: 7 },
    ]);

    const enriched = enrichBlockCounts(ecm);
    const stats = getBlockCountStats(ecm);

    assert.lengthOf(enriched, 1);
    assert.equal(enriched[0].blockName, 'block#999999');
    assert.isNull(enriched[0].blockDef);
    assert.equal(stats.totalBlocks, 7);
    assert.equal(stats.totalMass, 0);
    assert.equal(stats.totalPrice, 0);
    assert.equal(stats.totalHp, 0);
  });

  it('RichSegmentController enriches control links and exposes relevantECM', () => {
    const ship = Ship.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Traders Homerl110.ent')));
    const rich = new RichSegmentController(ship);

    assert.isAbove(rich.controlLinks.length, 0);
    assert.equal(rich.controlLinks.length, ship.controlElementMap.links.length);
    assert.isNotNull(rich.controlLinks[0].blockDef);
    assert.equal(rich.controlLinks[0].blockName, rich.controlLinks[0].blockDef!.name);

    const relevant = ship.managerContainer?.relevantElementCountMap;
    assert.isNotNull(relevant);
    assert.isAbove(relevant!.counts.length, 100);

    const stats = rich.blockStats;
    assert.isNotNull(stats);
    assert.equal(stats!.totalBlocks, 0);
  });

  it('ManagerContainer.relevantElementCountMap tolerates malformed relevantECM data', () => {
    const ship = Ship.fromBuffer(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Traders Homerl110.ent')));
    const mc = ship.managerContainer!;
    const rawChildren = [...mc._rawChildren];
    rawChildren[7] = Tags.struct(null, [
      Tags.int(null, 42),
      Tags.struct(null, [Tags.string(null, 'bad'), Tags.int(null, 12)]),
      Tags.struct(null, [Tags.short(null, 5), Tags.string(null, 'bad')]),
    ]);

    const malformed = new ManagerContainer(
      mc.inventories, mc.initialShields, mc.powerState, mc.texts,
      mc.slotAssignment, mc.pullPermission, rawChildren,
    );

    assert.deepEqual(malformed.relevantElementCountMap?.counts, []);
  });

  it('enrichSmd3 resolves block definitions from a segment', () => {
    const smd3 = parseSmd3(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3')));
    const enriched = enrichSmd3(smd3);

    assert.isAbove(enriched.length, 0);
    assert.isAbove(enriched[0].blocks.length, 0);
    assert.isNotNull(enriched[0].blocks[0].blockDef);
    assert.equal(enriched[0].blocks[0].blockName, enriched[0].blocks[0].blockDef!.name);
  });

  it('enrichSegment handles empty segments without errors or false positives', () => {
    const emptySegment = {
      x: 0, y: 0, z: 0,
      lastChanged: 0n,
      version: 7,
      blocks: Array.from({ length: BLOCK_COUNT }, () => ({ type: 0, hp: 0, orientation: 0, active: false })),
      blockCount: 0,
    };

    assert.deepEqual(enrichSegment(emptySegment), []);
  });

  it('security: BlockConfig.fromXml does not expand external XML entities', () => {
    const xml = `<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <Config><Block type="TEST_BLOCK" name="Danger" icon="1">
        <Description>&xxe;</Description>
      </Block></Config>`;

    try {
      const bc = BlockConfig.fromXml(xml, new Map([['TEST_BLOCK', 1]]));
      const desc = bc.getById(1)?.description ?? '';
      assert.notInclude(desc, 'root:', 'external entities must not read /etc/passwd');
      assert.notInclude(desc, 'daemon:', 'external entities must not read /etc/passwd');
    } catch (err) {
      assert.instanceOf(err, Error, 'rejecting XML with DOCTYPE is acceptable');
    }
  });

  it('security: saveCustom writes only under customBlockConfig', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smd-phase4-'));
    try {
      const cfg = SMToolConfig.fromData({ starmadeDir: tmp, worldDir: 'world0' });
      const vanilla = BlockConfig.fromXml(minimalBlockConfigXml(), new Map([['TEST_BLOCK', 1]]));
      const changed = vanilla.set(vanilla.getById(1)!.with({ hp: 99 }));

      changed.saveCustom(cfg, vanilla);

      const customPath = path.join(tmp, 'customBlockConfig', 'BlockConfigImport.xml');
      const dataPath = path.join(tmp, 'data', 'config', 'BlockConfig.xml');
      assert.isTrue(fs.existsSync(customPath));
      assert.isFalse(fs.existsSync(dataPath), 'must not write into data/config');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('perf: BlockRegistry lookups remain fast', () => {
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      BlockRegistry.getName((i % 1_500) + 1);
    }
    const elapsed = performance.now() - start;

    assert.isBelow(elapsed, 2_000, `100k lookups are too slow: ${elapsed.toFixed(1)}ms`);
  });

  it('perf: enrichSmd3 remains bounded on a real segment', () => {
    const smd3 = parseSmd3(fs.readFileSync(path.join(S, 'ENTITY_SHIP_Isanth Type-Zero B-_1753655196983.0.0.0.smd3')));

    const start = performance.now();
    const enriched = enrichSmd3(smd3);
    const elapsed = performance.now() - start;

    assert.isAbove(enriched[0].blocks.length, 0);
    assert.isBelow(elapsed, 2_000, `enrichSmd3 is too slow: ${elapsed.toFixed(1)}ms`);
  });
});
