#!/usr/bin/env node
/**
 * @fileoverview Tests the actual npm tarball in an isolated production consumer.
 * Requires registry access or a populated npm cache. SDK development dependencies
 * must not be used to satisfy the installed package's runtime imports.
 * @example npm run build && npm run test:package
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-consumer-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run test:package.');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
try {
  const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
  assert.equal(packed.length, 1);
  assert.deepEqual(packed[0].files.filter(f => /\.(?:java|class|jar|war)$/i.test(f.path)), [],
    'Published package must not contain Java sources or binaries');
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.js'));
  assert.ok(packed[0].files.some(f => f.path === 'dist/index.d.ts'));
  const consumer = path.join(temp, 'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'decoder-smoke-consumer', private: true, type: 'module' }));
  npm(['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed[0].filename)], consumer);
  const fixture = new AdmZip();
  fixture.addFile('Consumer/header.smbph', Buffer.alloc(36));
  fs.writeFileSync(path.join(consumer, 'consumer.sment'), fixture.toBuffer());
  for (const file of ['FACTIONS.fac', 'CATALOG.cat', 'TRADING.tag']) {
    fs.copyFileSync(path.join(root, 'samples', file), path.join(consumer, file));
  }
  const script = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Tags, writeTo, readFrom, BlockConfig, BlockDefinition, BlockState, Segment, BlockVolume,
  SkinDocument, WorldSeedDocument, PersistentObjectDocument, SubtitleDocument, SystemNamesDocument, BlueprintModMappings,
  XmlConfigDocument, FactionManager, Catalog, TradingManager, ControlElementMapper, registerAllFactories,
  Inventory, ItemStack, ManagerContainer, parseSment, emptySegment, emptySmd3File, writeSmd3, parseSmd3,
  BlueprintTemplate, parseSmtpl, writeSmtpl, FleetCommandObject, StarSystem, TradePricesObject,
  Smd3Document, readBlueprintDocument, readBlueprintFolderDocument, writeSment, writeBlueprintFolder } from 'starmade-decoder';
registerAllFactories();
const attack = FleetCommandObject.create(42n, 'FLEET_ATTACK');
assert.equal(attack.toBytes().readInt32BE(8), 6);
const oldAttack = FleetCommandObject.create(42n, 'FLEET_ATTACK', [], 'legacy-sdk');
assert.equal(oldAttack.toBytes().readInt32BE(8), 5);
assert.equal(FleetCommandObject.fromBytes(oldAttack.toBytes(), 'legacy-sdk').commandType, 'FLEET_ATTACK');
assert.equal(StarSystem.empty().infosToBytes()[0], 6);
assert.equal(StarSystem.empty().resourcesToBytes().length, 16);
const gameTrade = Buffer.from('0000001a00000019789c636000032d2066646406924c40c697ff400000124e0523', 'hex');
assert.equal(TradePricesObject.fromBytes(gameTrade).getSellOrder(259).price, 500);
const template = new BlueprintTemplate({version:5,minX:0,minY:0,minZ:0,maxX:0,maxY:0,maxZ:0,
  pieces:[{x:0,y:0,z:0,type:2047,hp:127,active:true,orientation:31}],connections:[],texts:new Map()});
const templateBytes = writeSmtpl(template);
assert.equal(templateBytes[0], 5);
assert.equal(templateBytes.subarray(41,44).toString('hex'), 'ffffff');
assert.deepEqual(parseSmtpl(templateBytes).pieces, template.pieces);
assert.equal(readFrom(writeTo(Tags.string('name', '\\u0000\\ud83d\\ude80'))).getString(), '\\u0000\\ud83d\\ude80');
const config = BlockConfig.fromXml('<Config><Block type="5" name="Consumer Hull"><Hitpoints>100</Hitpoints><Mass>2</Mass></Block></Config>');
assert.equal(config.getElementInfoById(5).identity.name, 'Consumer Hull');
assert.equal(config.getElementInfoById(5).block.hp, 100);
const catalogue = BlockConfig.fromBlocks([BlockDefinition.create({id: 9, name: 'Consumer Custom', hp: 250})]);
const reloadedCatalogue = BlockConfig.fromXml(catalogue.toXml(), new Map([['CUSTOM_BLOCK_9', 9]]));
assert.equal(reloadedCatalogue.getById(9).hp, 250);
assert.match(catalogue.toBlockTypesProperties(), /=9/);
const segment = new Segment(); segment.set(1, 2, 3, BlockState.create(9));
const volume = BlockVolume.fromFiles([{...emptySmd3File(), segments: [segment.toData()]}], {config: catalogue});
assert.equal(volume.blockAt({x: 1, y: 2, z: 3}).definition.name, 'Consumer Custom');
assert.equal(segment.toPackedWords()[1 + 32 * 2 + 1024 * 3], BlockState.create(9).toWord());
const first = {x: 1, y: 2, z: 3}, second = {x: -32, y: 4, z: 5};
const manager = ManagerContainer.EMPTY
  .withInventoryAt(first, new Inventory(new Map(), 1).add(9, 4))
  .withInventoryAt(second, Inventory.EMPTY.set(new ItemStack(7, 5, 8)));
const persisted = ManagerContainer.fromTag(readFrom(writeTo(manager.toTag())));
assert.equal(persisted.inventoryEntries.length, 2);
assert.equal(persisted.getInventoryAt(first).countOf(9), 4);
assert.equal(persisted.getInventoryAt(second).countOf(5), 8);
const blueprint = parseSment(fs.readFileSync('consumer.sment'));
assert.equal(blueprint.root.name, 'Consumer');
assert.equal(blueprint.complete, true);
const seg = emptySegment(); seg.blocks[0].type = 5;
assert.equal(parseSmd3(writeSmd3({...emptySmd3File(),segments:[seg]})).segments[0].blockCount, 1);
const original = fs.readFileSync('consumer.sment');
const document = readBlueprintDocument(original);
assert.deepEqual(writeSment(document), original);
document.root.segments.push({...emptySmd3File(),segments:[seg]});
document.setFile('notes.bin', Buffer.from([1, 2, 3]));
const edited = readBlueprintDocument(writeSment(document));
assert.equal(edited.root.header.totalBlockCount, 1);
assert.equal(edited.root.segments[0].segments[0].blocks[0].type, 5);
writeBlueprintFolder(document, 'Consumer-folder');
const folder = readBlueprintFolderDocument('Consumer-folder');
assert.equal(folder.root.header.totalBlockCount, 1);
assert.deepEqual(folder.files.get('Consumer-folder/notes.bin'), Buffer.from([1, 2, 3]));
const regionBytes = writeSmd3({...emptySmd3File(),segments:[seg]});
assert.deepEqual(new Smd3Document(regionBytes).toBuffer(), regionBytes);
const model = folder.model(catalogue), node = model.nodes()[0];
node.blocks.set({x: -257, y: 0, z: 0}, BlockState.create(9));
assert.equal(node.blocks.blockCount, 2);
assert.equal(readBlueprintDocument(folder.toBuffer()).blocks().get({x: -257, y: 0, z: 0}).type, 9);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
const skin = SkinDocument.create({mainDiffuse:png, mainEmission:png, helmetDiffuse:png, helmetEmission:png});
assert.deepEqual(SkinDocument.fromBuffer(skin.toBuffer()).texture('mainDiffuse'), png);
assert.deepEqual(skin.withFile('note.txt',Buffer.from('skin')).withoutFile('note.txt').toBuffer(),skin.toBuffer());
assert.throws(() => SkinDocument.fromBuffer(skin.toBuffer(),{maxEntries:3}));
const seed = new WorldSeedDocument(-9223372036854775808n);
assert.equal(WorldSeedDocument.fromBuffer(seed.toBuffer()).toJSON().seed, '-9223372036854775808');
const objects = new PersistentObjectDocument([{className: 'Consumer', objects: [{id: 3, nested: [true, null]}]}]);
const exported = objects.objectsFor('Consumer'); exported[0].id = 99;
assert.equal(PersistentObjectDocument.fromBuffer(objects.toBuffer()).objectsFor('Consumer')[0].id, 3);
const subtitles = new SubtitleDocument([{startMs: 100, endMs: 200, lines: ['Hello']}]);
assert.equal(SubtitleDocument.fromBuffer(subtitles.shift(25).toBuffer()).at(125)[0].lines[0], 'Hello');
assert.deepEqual(subtitles.at(200), []);
const names = new SystemNamesDocument([{value: 'sol', flags: ['START']}]);
assert.equal(SystemNamesDocument.fromBuffer(names.toBuffer()).withFlag('START')[0].value, 'sol');
const mappings = new BlueprintModMappings([{modName: 'Consumer', blockName: 'Hull', id: -32768}], {compression: 'zlib'});
assert.equal(BlueprintModMappings.fromBuffer(mappings.toBuffer()).idOf('Consumer', 'Hull'), -32768);
const xml = XmlConfigDocument.fromXml('<Config><!--keep--><Item>1</Item><Item>2</Item></Config>');
assert.equal(XmlConfigDocument.fromXml(xml.set('Config.Item[1]', 3).toXml()).get('Config.Item[1]'), 3);
assert.match(xml.set('Config.Item[1]', 3).toXml(), /<!--keep-->/);
for (const [Model, file] of [[FactionManager, 'FACTIONS.fac'], [Catalog, 'CATALOG.cat'], [TradingManager, 'TRADING.tag']]) {
  const raw = fs.readFileSync(file), model = Model.fromBuffer(raw);
  assert.deepEqual(model.toBuffer(), raw, file + ' must retain the original envelope');
  assert.throws(() => Model.fromBuffer(raw, {maxNodes: 1}));
}
const factions = FactionManager.fromBuffer(fs.readFileSync('FACTIONS.fac'));
assert.deepEqual(factions.withLastUpdate(factions.lastUpdate + 1n).withLastUpdate(factions.lastUpdate).toBuffer(), factions.toBuffer());
const mapper = new ControlElementMapper([{from: first, type: 9, targets: [second]}]);
assert.deepEqual(ControlElementMapper.fromTag(readFrom(writeTo(mapper.toTag()))).links, mapper.links);
console.log('Isolated production consumer exercised V2 auxiliary/domain classes and limits, skins, XML snapshots, controllers, position-indexed inventories, Tags, SMD3 and ZIP/folder writers.');
`;
  fs.writeFileSync(path.join(consumer, 'smoke.mjs'), script);
  const env = { ...process.env }; delete env.NODE_PATH;
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, env, stdio: 'inherit', timeout: 30000 });
  fs.writeFileSync(path.join(consumer, 'smoke.ts'), `import { Tags, writeTo, readFrom, type BlockData, type Smd3ParseOptions,
    readBlueprintDocument, writeBlueprintFolder, type BlueprintFileMap, type BlueprintWriteOptions,
    BlockState, Segment, BlockVolume, BlueprintModel, BlockDefinition, Inventory, ItemStack, InventoryLocation,
    BlueprintTemplate, parseSmtpl, writeSmtpl, type TemplatePiece,
    type BlockDefinitionOptions, type InventoryCapacity, type InventoryReadOptions,
    SkinDocument, WorldSeedDocument, PersistentObjectDocument, SubtitleDocument, SystemNamesDocument, BlueprintModMappings,
    XmlConfigDocument, type XmlConfigValue, type FormatLimits, type PersistentObjectLimits, type ModMappingOptions,
    ControlElementMapper, type ControlElementMapperOptions, type NPCRoute } from 'starmade-decoder';
const options: Smd3ParseOptions = { mode: 'strict' };
const templatePiece: TemplatePiece = {x:0,y:0,z:0,type:1,hp:127,active:true,orientation:31,extra:0};
const template = new BlueprintTemplate({version:5,minX:0,minY:0,minZ:0,maxX:0,maxY:0,maxZ:0,
  pieces:[templatePiece],connections:[],texts:new Map()});
parseSmtpl(writeSmtpl(template));
const block: BlockData = {type:1, hp:127, active:true, orientation:0, extra:63};
readFrom(writeTo(Tags.int('value', block.type))); void options;
const exportOptions: BlueprintWriteOptions = { overwrite: true, maxBlocks: 32768 };
function exportBlueprint(bytes: Buffer): BlueprintFileMap {
  const document = readBlueprintDocument(bytes);
  writeBlueprintFolder(document, 'output', exportOptions);
  return document.files;
}
void exportBlueprint;
const definitionOptions: BlockDefinitionOptions = {id: 9, name: 'Typed custom', hp: 250};
const definition = BlockDefinition.create(definitionOptions);
const state: BlockData = BlockState.create(definition.id);
const segment = new Segment(); segment.set(0, 0, 0, state);
// Structural input expected by renderer consumers, with no rendering calculations in the SDK.
const rendererInput: {x: number; y: number; z: number; blocks: readonly {type: number; hp: number; active: boolean; orientation: number}[]} = segment.toData();
const capacity: InventoryCapacity = {maximum: 50, volumeOf: () => 2};
const readOptions: InventoryReadOptions = {maxSlots: 12};
const inventory = Inventory.fromTag(Inventory.EMPTY.set(new ItemStack(0, 9, 3)).toTag(), readOptions);
inventory.assertCapacity(capacity);
new InventoryLocation(3, {x: 0, y: 0, z: 0}, inventory);
void rendererInput; void BlockVolume; void BlueprintModel;
const limits: FormatLimits = {maxBytes: 4096, maxEntries: 100};
const jsonLimits: PersistentObjectLimits = {...limits, maxDepth: 10, maxNodes: 100};
const modOptions: ModMappingOptions = {...limits, compression: 'zlib'};
const controllerOptions: ControlElementMapperOptions = {...limits, maxDepth: 10};
const xmlValue: XmlConfigValue | undefined = XmlConfigDocument.fromXml('<Config/>', limits).get('Config');
new WorldSeedDocument(1n, limits).withSeed(2n);
new PersistentObjectDocument([], jsonLimits).withClass('Example', [{id: 1}]);
new SubtitleDocument([{startMs: 0, endMs: 1, lines: ['text']}], limits).shift(2);
new SystemNamesDocument([], limits).set(0, {value: 'sol', flags: []});
new BlueprintModMappings([], modOptions).withMapping({modName: 'Example', blockName: 'Hull', id: 1});
new ControlElementMapper([], controllerOptions).toTag();
function routeIdentity(route: NPCRoute): NPCRoute {return route;}
const skinTextures = {mainDiffuse:Buffer.alloc(0),mainEmission:Buffer.alloc(0),helmetDiffuse:Buffer.alloc(0),helmetEmission:Buffer.alloc(0)};
function createSkin(): Buffer {return SkinDocument.create(skinTextures,{maxEntries:4}).toBuffer();}
void createSkin; void routeIdentity; void xmlValue;
`);
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true,
    strict: true, types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
  }, files: ['smoke.ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(consumer, 'tsconfig.json')], { stdio: 'inherit', timeout: 30000 });
  console.log(`Package consumer validation passed for ${packed[0].filename}.`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
