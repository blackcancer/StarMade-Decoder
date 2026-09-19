/**
 * @fileoverview BlockConfig read/edit/write and XML-node normalization contracts.
 * Synthetic installations cover vanilla/custom precedence without redistributing
 * game assets. Node-shape tests exercise parser-boundary normalizers directly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert } from 'chai';
import { BlockConfig, BlockDefinition } from '../src/config/BlockConfig.js';
import { BlockBehaviorConfig } from '../src/config/BlockBehaviorConfig.js';
import { FactionConfig } from '../src/config/FactionConfig.js';
import { SMToolConfig } from '../src/config/SMToolConfig.js';

const xml = '<Config><Block type="HULL" name="Hull" icon="3" textureId="1,2"><Hitpoints>100</Hitpoints><Mass>2</Mass></Block></Config>';
const normalized = (b: BlockDefinition) => ({ ...b, xmlTypeName: String(b.id) });

describe('Block configuration contracts — persistence and metadata', () => {
  let root: string;
  let config: SMToolConfig;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-blocks-'));
    config = SMToolConfig.fromData({ starmadeDir: root });
    fs.mkdirSync(config.paths.dataConfig, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('loads mappings and custom overrides with deterministic precedence', () => {
    fs.writeFileSync(path.join(config.paths.dataConfig, 'BlockConfig.xml'), xml);
    assert.equal(BlockConfig.load(config).size, 0);
    fs.writeFileSync(path.join(config.paths.dataConfig, 'BlockTypes.properties'), '# types\nHULL = 5\ninvalid\n = 8\nBAD = x\n');
    const vanilla = BlockConfig.load(config);
    assert.equal(vanilla.size, 1); assert.equal(vanilla.getByName('HULL')!.id, 5);
    assert.equal(vanilla.getByTypeName('HULL')!.hp, 100);
    assert.deepEqual([...vanilla], vanilla.all);
    assert.include(vanilla.toString(), '1 blocks');
    const changed = vanilla.set(vanilla.getById(5)!.with({ hp: 200 }));
    changed.saveCustom(config, vanilla);
    assert.equal(BlockConfig.load(config).getById(5)!.hp, 200);
    assert.equal(vanilla.getById(5)!.hp, 100);
    vanilla.saveCustom(config, vanilla);
    assert.equal(BlockConfig.load(config).getById(5)!.hp, 100);
    assert.equal(vanilla.delete(5).size, 0);
    assert.equal(vanilla.getById(5)!.toElementInfo(vanilla).identity.id, 5);
  });

  it('round-trips every edited top-level field and non-empty metadata section', () => {
    const vanilla = BlockConfig.fromXml(xml, new Map([['HULL', 5]]));
    const block = vanilla.getById(5)!;
    const metadata = { ...block.metadata,
      fullName: 'Extended Hull', oldHitpoints: 80, lowHpSetting: 1,
      structureHpContribution: 2, explosionAbsorption: 3, blockResourceType: 4,
      basicResourceFactory: 5, producedInFactory: 6, factoryBakeTime: 7,
      inRecipe: true, physical: true, cubeCubeCollision: true, useDetailedCollisionForAstronautMode: true,
      collisionDefault: { type: 'BOX', slab: 2, styleId: 3 },
      detailedCollisionForAstronautMode: { type: 'MESH', slab: 1, styleId: 4 },
      door: true, beacon: true, enterable: true, sensorInput: true, systemBlock: true,
      sourceReference: 5, inventoryGroup: 'cargo', controlledBy: ['HULL'], controlling: ['5', 'missing'],
      consistence: [{ type: 'HULL', count: 3 }], cubatomConsistence: [{ type: '5', count: 1 }, { type: 'missing', count: 2 }],
      recipeBuyResources: ['HULL'], wildcardIds: [2, 3], mainCombinationController: true,
      supportCombinationController: true, effectCombinationController: true,
      effectArmor: { heat: 1, kinetic: 2, em: 3 }, generalChamber: true,
      chamberParent: 5, chamberChildren: [1, 2], chamberPrerequisites: [3], chamberMutuallyExclusive: [4],
      chamberUpgradesTo: 5, chamberAppliesTo: 6, chamberCapacity: 7, chamberPermission: 8,
      chamberConfigGroups: ['a', 'b'], reactorHp: 9, reactorGeneralIconIndex: 10, lodActivationAnimationStyle: 11,
    };
    const overrides = { name: 'Changed', hp: 1, mass: 2, volume: 3, price: 4, description: 'A < B & C', armor: 5,
      isPlacable: false, inShop: false, hasOrientation: true, canActivate: true, isDeprecated: true,
      blockStyle: 6, textureIds: [1, 2, 3], transparent: true, animated: true, individualSides: 3,
      sideTexturesPointToOrientation: true, hasActivationTexture: true, lightSource: true,
      lightSourceColor: [0.1, 0.2, 0.3, 0.4] as const, lodShape: 'mesh', lodShapeActive: 'mesh-active',
      lodShapeStyle: 1, drawOnlyInBuildMode: true, extendedTexture: true, resourceInjection: 17,
      chamberRoot: 5, reactorChamberSpecific: true, lodCollisionPhysical: false, slab: 2,
      drawLogicConnection: true, logicBlock: true, logicSignaledByRail: true, logicBlockButton: true, metadata };
    assert.deepEqual(block.with({}), block);
    const edited = block.with(overrides);
    for (const [key, value] of Object.entries(overrides)) assert.deepEqual((edited as any)[key], value, key);
    assert.equal(block.hp, 100);
    const all = vanilla.set(edited);
    all.saveAll(config);
    const persisted = BlockConfig.fromXml(fs.readFileSync(path.join(config.paths.custom.blockConfig, 'BlockConfigImport.xml'), 'utf8'));
    assert.deepEqual(normalized(persisted.getById(5)!), normalized(edited));
    all.saveAll(config); // Existing destination directory is supported.
    assert.lengthOf(all.elementInfo, 1);
    assert.isObject(edited.render); assert.isObject(edited.collision); assert.isObject(edited.factory);
    assert.include(edited.toString(), 'Changed');
    assert.isTrue(edited.isReactorChamberAny); assert.isTrue(edited.isReactorChamberGeneral);
    assert.isTrue(edited.isReactorChamberSpecific);
    all.set(BlockConfig.fromXml('<Config><Block type="9" name="New"/></Config>').getById(9)!).saveCustom(config, vanilla);
    assert.equal(BlockConfig.fromXml(fs.readFileSync(path.join(config.paths.custom.blockConfig, 'BlockConfigImport.xml'), 'utf8')).size, 2);
  });

  it('normalizes absent, empty and malformed parser-node metadata safely', () => {
    const parse = (node: any): BlockDefinition => (BlockConfig as any)._nodeToBlock(5, 'HULL', { '@_name': 'Hull', ...node });
    const a = parse({
      ControlledBy: { Element: [null, undefined, '', ['HULL', '5']] },
      Controlling: {}, Consistence: { Item: [null, undefined, '', 'HULL', { '#text': '5', '@_count': 'bad' }, { '@_count': '3' }] },
      CubatomConsistence: {}, RecipeBuyResource: 'invalid',
      ChamberChildren: null, ChamberPrerequisites: '{}', ChamberMutuallyExclusive: '{1, bad, 3}',
      CollisionDefault: {}, DetailedCollisionForAstronautMode: { '@_slab': 'bad', StyleId: 'bad' },
      EffectArmor: { Heat: 'bad', Kinetic: 'bad', EM: 'bad' },
      LightSourceColor: '0.5', Texture: null, SlabIds: '1, bad, 3', Mass: 'bad',
    });
    assert.deepEqual(a.metadata.controlledBy, ['HULL', '5']);
    assert.deepEqual(a.metadata.controlling, []);
    assert.deepEqual(a.metadata.consistence, [{ type: 'HULL', count: 1 }, { type: '5', count: 1 }]);
    assert.deepEqual(a.metadata.cubatomConsistence, []);
    assert.deepEqual(a.metadata.chamberMutuallyExclusive, [1, 3]);
    assert.deepEqual(a.metadata.collisionDefault, { type: '', slab: 0, styleId: 0 });
    assert.deepEqual(a.metadata.effectArmor, { heat: 0, kinetic: 0, em: 0 });
    assert.deepEqual(a.lightSourceColor, [0.5, 1, 1, 1]); assert.equal(a.mass, 0);
    assert.deepEqual(a.slabIds, [1, 3]);
    const b = parse({ EffectArmor: {}, LightSourceColor: ' ', SlabIds: ' ', Mass: '3.5', Physical: 'TRUE' });
    assert.deepEqual(b.lightSourceColor, [1, 1, 1, 1]); assert.equal(b.mass, 3.5); assert.isTrue(b.metadata.physical);
    assert.deepEqual(b.metadata.effectArmor, { heat: 0, kinetic: 0, em: 0 });
    assert.deepEqual(parse({ Consistence: { Item: { '#text': 'HULL' } } }).metadata.consistence, [{ type: 'HULL', count: 1 }]);
    assert.equal(parse({ '@_name': undefined }).name, '');
    assert.equal(BlockConfig.fromXml('<Config><Other/><Block type="unknown" name="x"/></Config>').size, 0);
    const output = new Map();
    (BlockConfig as any)._walkNode(null, new Map(), output);
    assert.equal(output.size, 0);
    const info = a.toElementInfo();
    assert.isObject(info);
  });

  for (const Ctor of [FactionConfig, BlockBehaviorConfig]) {
    it(`${Ctor.name} loads overrides and round-trips strings, booleans and numeric defaults`, () => {
      const isFaction = Ctor === FactionConfig;
      const file = isFaction ? 'FactionConfig.xml' : 'blockBehaviorConfig.xml';
      const dir = isFaction ? config.paths.custom.factionConfig : config.paths.custom.blockBehaviorConfig;
      fs.writeFileSync(path.join(config.paths.dataConfig, file), '<Config marker="skip"><Value>1</Value><Flag>true</Flag><Text>hello</Text></Config>');
      const vanilla = Ctor.load(config);
      assert.equal(vanilla.getNumber('Config.Value'), 1);
      assert.equal(vanilla.getNumber('absent'), 0); assert.equal(vanilla.getNumber('absent', 9), 9);
      assert.equal(vanilla.getString('absent'), ''); assert.equal(vanilla.getString('absent', 'fallback'), 'fallback');
      assert.equal(vanilla.getString('Config.Text'), 'hello');
      assert.isTrue(vanilla.getBoolean('Config.Flag')); assert.isFalse(vanilla.getBoolean('absent'));
      assert.isTrue(vanilla.getBoolean('absent', true)); assert.isFalse(vanilla.getBoolean('Config.Value'));
      assert.isTrue(vanilla.set('Config.Flag', 'TRUE').getBoolean('Config.Flag'));
      assert.isFalse(vanilla.set('Config.Flag', false).getBoolean('Config.Flag'));
      const edited = vanilla.set('Config.Value', 2).set('Config.Text', 'changed');
      (edited as any).saveCustom(config, vanilla);
      fs.writeFileSync(path.join(dir, 'ignored.txt'), 'not XML');
      assert.equal(Ctor.load(config).getNumber('Config.Value'), 2);
      assert.equal(vanilla.getNumber('Config.Value'), 1);
      (edited as any).saveCustom(config, vanilla);
      assert.isAbove(edited.entries().size, 0); assert.include(edited.toString(), Ctor.name);
      for (const raw of [null, '', { Null: null, Repeated: [1, 2] }]) {
        assert.equal((Ctor as any)._flatten(raw).size, 0);
      }
    });
  }
});
