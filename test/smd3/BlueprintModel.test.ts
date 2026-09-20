/** @fileoverview Hierarchical grids edit the actual lossless document while preserving entity identity. */
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { BlueprintModel } from '../../src/smd3/BlueprintModel.js';
import { BlockState } from '../../src/smd3/BlockState.js';
import { BlockConfig, BlockDefinition } from '../../src/config/BlockConfig.js';
import { BlueprintDocument } from '../../src/smd3/BlueprintDocument.js';
import { BlueprintArchive, BlueprintEntity, parseSmbph } from '../../src/smd3/SmentParser.js';
import { parseSmbpm } from '../../src/smd3/SmbpmParser.js';
import { emptySegment, emptySmd3File, writeSmd3 } from '../../src/smd3/Smd3Writer.js';
import { ManagerContainer } from '../../src/objects/components/ManagerContainer.js';
import { Inventory, ItemStack } from '../../src/objects/components/Inventory.js';

/** Builds a minimal entity without depending on game assets. */
function entity(name: string): BlueprintEntity {
  return new BlueprintEntity({ name, header: parseSmbph(Buffer.alloc(36)), meta: null, logic: null,
    offset: { x: 0, y: 0, z: 0 }, worldOffset: { x: 0, y: 0, z: 0 }, segments: [], children: [] });
}

describe('BlueprintModel', () => {
  it('distinguishes repeated attachment names by full path and exposes sparse JSON', () => {
    const root = entity('Ship'), left = entity('ATTACHED_0'), right = entity('ATTACHED_1');
    left.children.push(entity('ATTACHED_0')); right.children.push(entity('ATTACHED_0')); root.children.push(left, right);
    root.segments.push({ ...emptySmd3File(), segments: [emptySegment()] }); root.segments[0].segments[0].blocks[0].type = 5;
    const config = BlockConfig.fromBlocks([BlockDefinition.create({ id: 5, name: 'Hull' })]);
    const scene = new BlueprintModel(new BlueprintArchive(root), { config });
    assert.deepEqual(scene.nodes().map(node => node.path), ['Ship', 'Ship/ATTACHED_0', 'Ship/ATTACHED_0/ATTACHED_0', 'Ship/ATTACHED_1', 'Ship/ATTACHED_1/ATTACHED_0']);
    assert.strictEqual(scene.find('Ship/ATTACHED_1/ATTACHED_0')!.entity, right.children[0]);
    assert.isUndefined(scene.find('ATTACHED_0')); assert.equal(scene.blockCount, 1);
    assert.equal(scene.nodes()[0].blocks.blockAt({ x: 0, y: 0, z: 0 }).definition!.name, 'Hull');
    const json = JSON.parse(JSON.stringify(scene)); assert.lengthOf(json, 5); assert.isNull(json[0].parentPath);
    assert.equal(json[0].blocks[0].state.type, 5); assert.deepEqual(json[0].offset, { x: 0, y: 0, z: 0 });
    json[0].offset.x = 100; assert.equal(root.offset.x, 0);
    left.children = []; assert.lengthOf(scene.nodes(), 4);
  });

  it('rejects incomplete data, ambiguous hierarchy and aggregate resource excesses', () => {
    const root = entity('Ship'), archive = new BlueprintArchive(root), scene = new BlueprintModel(archive);
    archive.diagnostics.push({ code: 'E_FORMAT', message: 'omitted' }); assert.throws(() => scene.nodes()); archive.diagnostics.length = 0;
    assert.throws(() => new BlueprintModel(archive, { maxEntities: 0 }).nodes());
    assert.throws(() => new BlueprintModel(archive, { maxDepth: 257 }));
    root.children.push(root); assert.throws(() => scene.nodes()); root.children = [];
    root.children.push(entity('same'), entity('same')); assert.throws(() => scene.nodes()); root.children = [];
    for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', '\0']) { root.name = name; assert.throws(() => scene.nodes()); } root.name = 'Ship';
    root.children.push(entity('ATTACHED_0')); assert.throws(() => new BlueprintModel(archive, { maxDepth: 0 }).nodes());
    assert.throws(() => new BlueprintModel(archive, { maxEntities: 1 }).nodes());
    root.segments.push({ ...emptySmd3File(), segments: [emptySegment()] });
    root.children[0].segments.push({ ...emptySmd3File(), segments: [emptySegment()] });
    assert.throws(() => new BlueprintModel(archive, { maxSegments: 1 }).nodes());
    assert.equal(new BlueprintModel(archive, { maxSegments: 2 }).nodes().length, 2);
  });

  it('integrates live edits and edit/revert with original ZIP bytes and unknown resources', () => {
    const root = entity('Ship'); root.children.push(entity('ATTACHED_0'));
    root.meta = parseSmbpm(Buffer.from('0000000001', 'hex')).withDockingEntries([
      { name: 'Ship/ATTACHED_0', posX: 16, posY: 16, posZ: 16, sizeX: 0, sizeY: 0, sizeZ: 0,
        style: 0, orientation: 0, offset: { x: 0, y: 0, z: 0 } },
    ]);
    root.segments.push({ ...emptySmd3File(), segments: [emptySegment()] }); root.segments[0].segments[0].blocks[0].type = 5;
    const base = BlueprintDocument.fromArchive(new BlueprintArchive(root)); base.setFile('custom.bin', Buffer.from([3, 7, 11]));
    const bytes = base.toBuffer(), document = BlueprintDocument.fromSment(bytes, { maxBlocks: 4 * 32768, maxEntities: 4, maxDepth: 4 });
    const scene = document.model(), nodes = scene.nodes(); assert.equal(scene.blockCount, 1);
    const before = nodes[0].blocks.get({ x: 0, y: 0, z: 0 });
    nodes[0].blocks.set({ x: 0, y: 0, z: 0 }, before.with({ orientation: 31, extra: 63, hp: 64 }));
    const reloaded = BlueprintDocument.fromSment(document.toBuffer());
    assert.equal(reloaded.blocks().get({ x: 0, y: 0, z: 0 }).extra, 63);
    assert.deepEqual(reloaded.files.get('Ship/custom.bin'), Buffer.from([3, 7, 11]));
    nodes[0].blocks.set({ x: 0, y: 0, z: 0 }, before); assert.deepEqual(document.toBuffer(), bytes);
    nodes[1].blocks.set({ x: -257, y: 0, z: 0 }, BlockState.create(7));
    assert.equal(BlueprintDocument.fromSment(document.toBuffer()).model().blockCount, 2);
    assert.throws(() => document.blocks(entity('unrelated')));
    document.root.children.push(entity('ATTACHED_2'));
    document.blocks(document.root.children[1]).set({ x: 0, y: 0, z: 0 }, BlockState.create(8));
    assert.equal(document.model().blockCount, 3);
    const detachedRoot = new BlueprintEntity({ ...document.root }); document.archive.root = detachedRoot;
    assert.equal(document.blocks(detachedRoot).blockCount, 1);
  });

  it('uses empty region filenames to avoid wrong-region allocation or fallback collisions', () => {
    const zip = new AdmZip(); zip.addFile('Ship/header.smbph', Buffer.alloc(36));
    zip.addFile('Ship/DATA/original.1.0.0.smd3', writeSmd3(emptySmd3File()));
    zip.addFile('Ship/DATA/anonymous.smd3', writeSmd3(emptySmd3File()));
    const document = BlueprintDocument.fromSment(zip.toBuffer()), blocks = document.blocks();
    assert.deepEqual(document.toBuffer(), zip.toBuffer());
    blocks.set({ x: 0, y: 0, z: 0 }, BlockState.create(5));
    blocks.set({ x: 256, y: 0, z: 0 }, BlockState.create(8));
    assert.lengthOf(document.root.segments, 2);
    assert.isTrue(document.files.has('Ship/DATA/anonymous.smd3'));
    assert.isTrue(document.files.has('Ship/DATA/original.1.0.0.smd3'));
    assert.equal(BlueprintDocument.fromSment(document.toBuffer()).blocks().blockCount, 2);
    const other = new AdmZip(); other.addFile('Ship/header.smbph', Buffer.alloc(36));
    other.addFile('Ship/DATA/original.1.0.0.smd3', writeSmd3(emptySmd3File()));
    const mixed = BlueprintDocument.fromSment(other.toBuffer());
    mixed.blocks().set({ x: 0, y: 0, z: 0 }, BlockState.create(5));
    assert.isTrue(mixed.files.has('Ship/DATA/Ship.0.0.0.smd3'));
    assert.isTrue(mixed.files.has('Ship/DATA/original.1.0.0.smd3'));
    assert.equal(BlueprintDocument.fromSment(mixed.toBuffer()).blocks().blockCount, 1);
  });

  it('persists one position-indexed inventory through blueprint metadata without changing other files', () => {
    const root = entity('Ship'), first = { x: 1, y: 2, z: 3 }, second = { x: -32, y: 4, z: 5 };
    root.meta = parseSmbpm(Buffer.from('0000000001', 'hex')).withManager(ManagerContainer.EMPTY
      .withInventoryAt(first, Inventory.EMPTY.set(new ItemStack(0, 5, 12)), 3)
      .withInventoryAt(second, Inventory.EMPTY.set(new ItemStack(7, 8, 24)), 3));
    const source = BlueprintDocument.fromArchive(new BlueprintArchive(root));
    source.setFile('extra.bin', Buffer.from([0, 255, 19]));
    const bytes = source.toBuffer(), document = BlueprintDocument.fromSment(bytes), before = document.files;
    const manager = document.root.meta!.manager as ManagerContainer;
    assert.lengthOf(manager.inventoryEntries, 2);
    const previous = manager.getInventoryAt(first)!;
    document.root.meta = document.root.meta!.withManager(manager.withInventoryAt(first, previous.add(5, 8)));
    const edited = BlueprintDocument.fromSment(document.toBuffer());
    const reloaded = edited.root.meta!.manager as ManagerContainer;
    assert.equal(reloaded.getInventoryAt(first)!.countOf(5), 20);
    assert.equal(reloaded.getInventoryAt(second)!.get(7)!.count, 24);
    for (const [name, value] of before) {
      if (!name.endsWith('/meta.smbpm')) assert.deepEqual(edited.files.get(name), value, name);
    }
    document.root.meta = document.root.meta!.withManager(manager);
    assert.deepEqual(document.toBuffer(), bytes);
  });
});
