/** @fileoverview Complete blueprint editing, independent byte fixtures and real inventory round trips. */
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo, readTagDocument } from '../../src/core/TagParser.js';
import { ManagerContainer } from '../../src/objects/components/ManagerContainer.js';
import { ThrustConfig } from '../../src/objects/components/PowerAndThrust.js';
import { getSmbpmInternals, getRailChildInternals } from '../../src/smd3/SmbpmParser.js';
import { assert } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { BlueprintDocument, readBlueprintDocument, readBlueprintFolderDocument, writeSment, writeBlueprintFolder } from '../../src/smd3/BlueprintDocument.js';
import { BlueprintArchive, BlueprintEntity, BlueprintHeader, parseSmbph } from '../../src/smd3/SmentParser.js';
import { parseSmbpm } from '../../src/smd3/SmbpmParser.js';
import { parseSmbpl } from '../../src/smd3/SmbplParser.js';
import { writeSmbpm } from '../../src/smd3/SmbpmWriter.js';
import { writeSmbph } from '../../src/smd3/SmbphWriter.js';
import { emptySegment, emptySmd3File, writeSmd3 } from '../../src/smd3/Smd3Writer.js';
import { parseSmd3, BLOCK_COUNT } from '../../src/smd3/Smd3Parser.js';
import { readBlueprintFiles } from '../../src/smd3/BlueprintFiles.js';

/** Original noncanonical but valid v0 header with no blocks. */
function header(): Buffer { return Buffer.alloc(36); }
/** An independent ZIP envelope with arbitrary ancillary bytes and an empty directory. */
function fixture(extra: [string, Buffer | null][] = []): Buffer {
  const zip = new AdmZip();
  for (const [name, bytes] of new Map<string, Buffer | null>([
    ['Ship/header.smbph', header()], ['Ship/meta.smbpm', Buffer.from('0000000001', 'hex')],
    ['Ship/logic.smbpl', Buffer.from('00000000ffffffff00000000', 'hex')], ['Ship/empty.bin', Buffer.alloc(0)], ['Ship/modmappings.smbmm', Buffer.from('Mod~Block~8191\n')],
    ['Ship/notes.bin', Buffer.from([0, 255, 7])], ['Ship/empty/', null], ...extra,
  ])) zip.addFile(name, bytes ?? Buffer.alloc(0), 'retained entry comment');
  zip.addZipComment('retained archive comment');
  return zip.toBuffer();
}
/** Builds a fresh editable model using public factories. */
function entity(name = 'Ship'): BlueprintEntity {
  return new BlueprintEntity({ name, header: parseSmbph(header()), meta: null, logic: null,
    offset: { x: 0, y: 0, z: 0 }, worldOffset: { x: 0, y: 0, z: 0 }, segments: [], children: [] });
}
/** A sparse region containing one occupied block at local 17,18,19. */
function region(x = 0): Buffer {
  const segment = emptySegment(x); segment.blocks[17 + 18 * 32 + 19 * 1024].type = 5;
  return writeSmd3({ ...emptySmd3File(), segments: [segment] });
}
/** Valid docking metadata references a child by its full blueprint path. */
function docking(name = 'Ship/ATTACHED_0') {
  return parseSmbpm(Buffer.from('0000000001', 'hex')).withDockingEntries([
    { name, posX: 17, posY: 18, posZ: 19, sizeX: 0, sizeY: 0, sizeZ: 0, style: 0, orientation: 0, offset: { x: 1, y: 2, z: 3 } },
  ]);
}
/** Asserts a structured decoder error, not merely an incidental exception. */
function fails(operation: () => unknown, code: string): void {
  assert.propertyVal(assert.throws(operation), 'code', code);
}

describe('BlueprintDocument', () => {
  it('preserves ZIP bytes, empty files, empty directories and unknown mappings, with detached ownership', () => {
    const original = fixture(); const input = Buffer.from(original);
    const options = { maxEntries: 20 };
    const doc = readBlueprintDocument(new Uint8Array(input), options);
    input.fill(0); options.maxEntries = 0;
    assert.deepEqual(writeSment(doc), original);
    assert.equal(doc.files.get('Ship/modmappings.smbmm')!.toString(), 'Mod~Block~8191\n');
    assert.strictEqual(doc.files.get('Ship/empty/'), null);
    assert.deepEqual(doc.files.get('Ship/logic.smbpl'), Buffer.from('00000000ffffffff00000000', 'hex'));
    assert.deepEqual(doc.files.get('Ship/empty.bin'), Buffer.alloc(0));
    doc.files.get('Ship/notes.bin')!.fill(0);
    const output = doc.toBuffer(); output.fill(0);
    assert.deepEqual(doc.toBuffer(), original);
    doc.root.header.classification = 7;
    const edited = readBlueprintDocument(doc.toBuffer());
    assert.equal(edited.root.header.classification, 7);
    assert.equal(edited.root.header.headerVersion, 5); // Edited resources use the canonical current format
    doc.root.header.classification = undefined;
    assert.deepEqual(doc.toBuffer(), original);
  });

  it('changes and reverts nested header, logic and ancillary resources independently', () => {
    const original = fixture(); const doc = BlueprintDocument.fromSment(original);
    doc.root.header.boundingBox.minX = -42;
    doc.root.logic!.structureVersion = 3;
    const data = Buffer.from('new'); doc.setFile('custom/new', data); data.fill(0);
    doc.removeFile('notes.bin');
    const out = readBlueprintDocument(doc.toBuffer());
    assert.equal(out.root.header.boundingBox.minX, -42);
    assert.equal(out.root.logic!.structureVersion, 3);
    assert.equal(out.files.get('Ship/custom/new')!.toString(), 'new');
    assert.isFalse(out.files.has('Ship/notes.bin'));
    assert.deepEqual(out.files.get('Ship/meta.smbpm'), Buffer.from('0000000001', 'hex'));
    doc.removeFile('custom/new').setFile('notes.bin', Buffer.from([0, 255, 7]));
    doc.root.header.boundingBox.minX = 0; doc.root.logic!.structureVersion = 0;
    assert.deepEqual(doc.toBuffer(), original);
    doc.root.logic = null; doc.root.meta = null;
    assert.isFalse(doc.files.has('Ship/logic.smbpl')); assert.isFalse(doc.files.has('Ship/meta.smbpm'));
  });

  it('updates exact Java bounds and type counts after nested block edits and retains DATA names', () => {
    const original = fixture([['Ship/DATA/ENTITY_weird_uid.0.0.0.smd3', region()]]);
    const doc = readBlueprintDocument(original), file = doc.root.segments[0];
    const block = file.segments[0].blocks[17 + 18 * 32 + 19 * 1024];
    block.type = 8;
    const output = doc.files;
    assert.isTrue(output.has('Ship/DATA/ENTITY_weird_uid.0.0.0.smd3'));
    const h = parseSmbph(output.get('Ship/header.smbph')!);
    assert.deepEqual(h.boundingBox, { minX: 0, minY: 1, minZ: 2, maxX: 3, maxY: 4, maxZ: 5 });
    assert.deepEqual(h.blockCountByType, [{ type: 8, count: 1 }]);
    assert.equal(h.totalBlockCount, 1); assert.isNull(h.score);
    assert.deepEqual(output.get('Ship/notes.bin'), Buffer.from([0, 255, 7]));
    block.type = 5; assert.deepEqual(doc.toBuffer(), original);
    // A detached equivalent region also retains its original name and exact bytes.
    doc.root.segments = [structuredClone(file)]; assert.deepEqual(doc.toBuffer(), original);
    doc.root.segments = []; const empty = readBlueprintDocument(doc.toBuffer());
    assert.equal(empty.root.header.totalBlockCount, 0);
    assert.deepEqual(empty.root.header.boundingBox, { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
    assert.isFalse(empty.files.has('Ship/DATA/ENTITY_weird_uid.0.0.0.smd3'));
  });

  it('adds distinct negative/positive regions, derives repeated counts and exports a canonical archive', () => {
    const root = entity(); root.segments = [parseSmd3(region(-512)), parseSmd3(region(512))];
    root.segments[0].segments[0].blocks[0].type = 5;
    root.logic = parseSmbpl(Buffer.from('00000000ffffffff00000000', 'hex')); root.meta = docking();
    root.children.push(entity('ATTACHED_0'));
    const archive = new BlueprintArchive(root);
    const doc = BlueprintDocument.fromArchive(archive);
    assert.deepEqual([...doc.files.keys()].filter(p => p.includes('/DATA/')), ['Ship/DATA/Ship.-1.0.0.smd3', 'Ship/DATA/Ship.1.0.0.smd3']);
    assert.equal(doc.root.header.totalBlockCount, 3);
    assert.equal(doc.archive.totalEntities, 2);
    assert.deepEqual(doc.root.children[0].offset, { x: 1, y: 2, z: 3 });
    assert.deepEqual(readBlueprintDocument(writeSment(archive)).root.header, doc.root.header);
    const blank = entity(); blank.segments = [emptySmd3File()];
    assert.isTrue(BlueprintDocument.fromArchive(new BlueprintArchive(blank)).files.has('Ship/DATA/Ship.0.0.0.smd3'));
  });

  it('renames roots and children, removes attachment references and preserves child ancillary bytes', () => {
    const original = fixture([['Ship/meta.smbpm', writeSmbpm(docking())], ['Ship/ATTACHED_0/header.smbph', header()],
      ['Ship/ATTACHED_0/custom.bin', Buffer.from('child')]]);
    const doc = readBlueprintDocument(original);
    assert.deepEqual(doc.toBuffer(), original);
    doc.root.name = 'Renamed'; doc.root.children[0].name = 'ATTACHED_3';
    let copy = readBlueprintDocument(doc.toBuffer());
    assert.equal(copy.root.meta!.dockingEntries[0].name, 'Renamed/ATTACHED_3');
    assert.equal(copy.files.get('Renamed/ATTACHED_3/custom.bin')!.toString(), 'child');
    doc.root.children = []; copy = readBlueprintDocument(doc.toBuffer());
    assert.isEmpty(copy.root.meta!.dockingEntries);
    assert.isFalse([...copy.files.keys()].some(p => p.includes('ATTACHED')));
  });

  it('supports equivalent replacement entities and adds explicitly linked attachments', () => {
    const doc = readBlueprintDocument(fixture());
    const child = entity('ATTACHED_0'); doc.root.children.push(child); doc.root.meta = docking();
    doc.setFile('ATTACHED_0/modmappings.smbmm', Buffer.from('Mod~Child~7\n'));
    assert.equal(doc.files.get('Ship/ATTACHED_0/modmappings.smbmm')!.toString(), 'Mod~Child~7\n');
    assert.equal(readBlueprintDocument(doc.toBuffer()).archive.totalEntities, 2);
    const original = doc.toBuffer(); const second = readBlueprintDocument(original);
    second.root.children[0] = new BlueprintEntity(second.root.children[0]);
    assert.deepEqual(second.toBuffer(), original);
  });

  it('snapshots folders and publishes both documents and new models without touching the source', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-document-'));
    try {
      const doc = readBlueprintDocument(fixture()); const first = path.join(temp, 'Ship');
      writeBlueprintFolder(doc, first);
      const folder = readBlueprintFolderDocument(first);
      const inventory = readBlueprintFiles(first);
      assert.deepEqual(folder.files, inventory);
      fs.writeFileSync(path.join(first, 'notes.bin'), 'outside mutation');
      assert.deepEqual(folder.files, inventory);
      assert.deepEqual(readBlueprintDocument(folder.toBuffer()).files, inventory);
      const second = path.join(temp, 'model'); writeBlueprintFolder(new BlueprintArchive(entity()), second);
      assert.equal(readBlueprintFolderDocument(second).root.name, 'model');
      fails(() => doc.writeFolder(first), 'E_IO');
      doc.writeFolder(first, { overwrite: true });
      assert.deepEqual(readBlueprintFiles(first), inventory);
      doc.root.children.push(entity('ATTACHED_0')); doc.root.meta = docking();
      const renamed = path.join(temp, 'Renamed'); doc.writeFolder(renamed);
      const copy = readBlueprintFolderDocument(renamed);
      assert.equal(copy.root.meta!.dockingEntries[0].name, 'Renamed/ATTACHED_0');
      assert.equal(doc.root.name, 'Ship'); assert.equal(doc.root.meta.dockingEntries[0].name, 'Ship/ATTACHED_0');
      const created = path.join(temp, 'Created'); writeBlueprintFolder(doc.archive, created);
      assert.equal(readBlueprintFolderDocument(created).root.meta!.dockingEntries[0].name, 'Created/ATTACHED_0');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });

  it('rejects incomplete documents, missing roots, legacy regions and missing child headers', () => {
    fails(() => readBlueprintDocument(fixture(), { mode: 'recover' }), 'E_INCOMPLETE');
    const zip = new AdmZip(); zip.addFile('header.smbph', header());
    fails(() => readBlueprintDocument(zip.toBuffer()), 'E_FORMAT');
    fails(() => readBlueprintDocument(fixture([['Other/header.smbph', header()]])), 'E_FORMAT');
    fails(() => readBlueprintDocument(fixture([['outside', Buffer.alloc(0)]])), 'E_FORMAT');
    fails(() => readBlueprintDocument(fixture([['Ship/DATA/old.smd2', Buffer.alloc(0)]])), 'E_UNSUPPORTED');
    fails(() => readBlueprintDocument(fixture([['Ship/ATTACHED_0/note', Buffer.alloc(0)]])), 'E_FORMAT');
    fails(() => readBlueprintDocument(fixture([['Ship/ATTACHED_0/header.smbph', header()]]), { maxDepth: 0 }), 'E_LIMIT');
    fails(() => readBlueprintDocument(fixture([['Ship/ATTACHED_0/header.smbph', header()]]), { maxEntities: 1 }), 'E_LIMIT');
  });

  it('enforces aggregate input and output limits and rejects incomplete or duplicate geometry', () => {
    const doc = readBlueprintDocument(fixture([['Ship/DATA/file.0.0.0.smd3', region()]]));
    fails(() => doc.toFiles({ maxBlocks: BLOCK_COUNT - 1 }), 'E_LIMIT');
    fails(() => doc.toFiles({ maxTotalBytes: 1 }), 'E_LIMIT');
    fails(() => doc.toFiles({ maxEntries: 1 }), 'E_LIMIT');
    fails(() => doc.toBuffer({ maxInputBytes: 1 }), 'E_LIMIT');
    doc.root.segments[0].complete = false;
    fails(() => doc.toBuffer(), 'E_INCOMPLETE');
    doc.root.segments[0].complete = true; doc.root.segments[0].diagnostics = [{ code: 'E_FORMAT', message: 'omitted' }];
    fails(() => doc.toBuffer(), 'E_INCOMPLETE'); doc.root.segments[0].diagnostics = [];
    doc.root.segments.push(structuredClone(doc.root.segments[0])); fails(() => doc.toBuffer(), 'E_FORMAT');
    doc.root.segments = [emptySmd3File(), emptySmd3File()]; fails(() => doc.toBuffer(), 'E_FORMAT');
    const recovered = new BlueprintArchive(entity(), [{ code: 'E_FORMAT', message: 'omitted' }]);
    fails(() => writeSment(recovered), 'E_INCOMPLETE');
  });

  it('rejects unsafe names, tree cycles, missing metadata targets and raw model overrides', () => {
    const doc = readBlueprintDocument(fixture());
    for (const p of ['', '../escape', 'foo//bar', 'C:file', 'header.smbph', 'ATTACHED_0/meta.smbpm', 'DATA/file.smd3']) fails(() => doc.setFile(p, Buffer.alloc(0)), 'E_FORMAT');
    doc.setFile('ATTACHED_99/note', Buffer.alloc(0)); fails(() => doc.toBuffer(), 'E_FORMAT');
    doc.removeFile('ATTACHED_99/note'); assert.isFalse(doc.files.has('Ship/ATTACHED_99/note'));
    const fresh = readBlueprintDocument(fixture());
    fresh.root.name = '..'; fails(() => fresh.toBuffer(), 'E_FORMAT'); fresh.root.name = 'Ship';
    fresh.root.children = [entity('invalid')]; fails(() => fresh.toBuffer(), 'E_FORMAT');
    const child = entity('ATTACHED_0'); child.children.push(child); fresh.root.children = [child]; fails(() => fresh.toBuffer(), 'E_FORMAT');
    fresh.root.children = [entity('ATTACHED_0'), entity('ATTACHED_0')]; fails(() => fresh.toBuffer(), 'E_FORMAT');
    fresh.root.children = []; fresh.root.meta = docking(); fails(() => fresh.toBuffer(), 'E_FORMAT');
    fresh.root.children = [entity('ATTACHED_1')]; fresh.root.meta = null; fails(() => fresh.toBuffer(), 'E_FORMAT');
    fresh.root.meta = parseSmbpm(Buffer.from('0000000001', 'hex')); fails(() => fresh.toBuffer(), 'E_FORMAT');
    fresh.root.children = []; fresh.root.header.entityType = 'future-unknown'; fails(() => fresh.toBuffer(), 'E_UNSUPPORTED');
  });

  it('persists component edits while retaining terminal Tag envelopes and opaque extension bytes', () => {
    const suffix = Buffer.from([8, 0, 9, 0]); // StarMade-Open writes extensions after the manager Tag.
    const manager = ManagerContainer.fromTag(Tags.struct(null, [Tags.struct(null, []), Tags.nothing(null), Tags.double(null, 0), Tags.double(null, 123)]));
    const managerBytes = Buffer.concat([writeTo(manager.toTag()), suffix]);
    managerBytes.writeInt16BE(71, 0); // Non-default uncompressed Tag envelope version.
    const original = fixture([['Ship/meta.smbpm', Buffer.concat([Buffer.from('0000000502', 'hex'), managerBytes])]]);
    const doc = readBlueprintDocument(original);
    assert.deepEqual(doc.toBuffer(), original);
    const initial = doc.root.meta!.manager as ManagerContainer;
    doc.root.meta!.manager = initial.withInitialShields(456);
    let copy = readBlueprintDocument(doc.toBuffer());
    assert.equal((copy.root.meta!.manager as ManagerContainer).initialShields, 456);
    const raw = Buffer.from(getSmbpmInternals(copy.root.meta!).managerRaw!);
    assert.equal(raw.readInt16BE(0), 71);
    assert.deepEqual(readTagDocument(raw).trailingData, suffix);
    doc.root.meta!.manager = initial; assert.deepEqual(doc.toBuffer(), original);
    doc.root.meta!.manager = null; fails(() => doc.toBuffer(), 'E_UNSUPPORTED');
    const noTail = readBlueprintDocument(fixture([['Ship/meta.smbpm', writeSmbpm(docking().withDockingEntries([]).withManager(manager))]]));
    noTail.root.meta!.manager = null;
    assert.isNull(readBlueprintDocument(noTail.toBuffer()).root.meta!.manager);
    const thrustMeta = docking().withDockingEntries([]).withThrustConfig(ThrustConfig.DEFAULT);
    const thrust = readBlueprintDocument(fixture([['Ship/meta.smbpm', writeSmbpm(thrustMeta)]]));
    const originalThrust = thrust.root.meta!.thrustConfig!;
    thrust.root.meta!.thrustConfig = originalThrust.withThrustSharing(true);
    assert.isTrue(readBlueprintDocument(thrust.toBuffer()).root.meta!.thrustConfig!.thrustSharing);
    thrust.root.meta!.thrustConfig = null;
    assert.isNull(readBlueprintDocument(thrust.toBuffer()).root.meta!.thrustConfig);
    thrust.root.meta = thrustMeta.withManager(manager);
    fails(() => thrust.toBuffer(), 'E_UNSUPPORTED');
  });

  it('edits nested AI values and removes the AI section explicitly', () => {
    const meta = parseSmbpm(Buffer.from('0000000506010000000007010000000008010000000001', 'hex')).withAiValue(1, 'true');
    const original = fixture([['Ship/meta.smbpm', writeSmbpm(meta)]]);
    const doc = readBlueprintDocument(original);
    fails(() => doc.toFiles({ maxTagNodes: 0 }), 'E_LIMIT');
    doc.root.meta!.aiConfig!.entries[0].value = 'false';
    const parsed = readBlueprintDocument(doc.toBuffer()).root.meta!;
    assert.equal(parsed.aiConfig!.entries[0].value, 'false');
    const flags = getSmbpmInternals(parsed);
    assert.isTrue(flags.cargoPresent); assert.isTrue(flags.lockBoxPresent); assert.isTrue(flags.railDockerPresent);
    doc.root.meta!.aiConfig!.entries[0].value = 'true'; assert.deepEqual(doc.toBuffer(), original);
    doc.root.meta!.aiConfig = null;
    assert.isNull(readBlueprintDocument(doc.toBuffer()).root.meta!.aiConfig);
  });

  it('renames rail attachments without losing their opaque Tags, then removes their references', () => {
    const opaque = writeTo(Tags.struct('futureRail', [Tags.string('unknown', 'untouched')]));
    const writer = new BufferWriter(); writer.writeInt32BE(5); writer.writeInt8(4);
    for (let i = 0; i < 6; i++) writer.writeFloat32BE(0);
    writer.writeJavaUTF('uid'); writer.writeInt32BE(0); writer.writeInt32BE(1);
    writer.writeJavaUTF('Ship/ATTACHED_0'); writer.writeInt32BE(opaque.length); writer.writeBytes(opaque); writer.writeInt8(1);
    const original = fixture([['Ship/meta.smbpm', writer.toBuffer()], ['Ship/ATTACHED_0/header.smbph', header()]]);
    const doc = readBlueprintDocument(original); assert.deepEqual(doc.toBuffer(), original);
    doc.root.name = 'Renamed'; doc.root.children[0].name = 'ATTACHED_1';
    const output = readBlueprintDocument(doc.toBuffer());
    const child = output.root.meta!.railChildren[0];
    assert.equal(child.name, 'Renamed/ATTACHED_1');
    assert.deepEqual(Buffer.from(getRailChildInternals(child).tagRaw!), opaque);
    doc.root.children = [];
    assert.isEmpty(readBlueprintDocument(doc.toBuffer()).root.meta!.railChildren);
  });

  it('preserves full real archives and every warehouse folder resource', function () {
    this.timeout(120000);
    for (const filename of ['Sobek Dreadnought 2025-jun-02.sment', 'firestorm class battlecruiser.sment']) {
      const original = fs.readFileSync(path.join('samples', filename));
      const doc = readBlueprintDocument(original);
      assert.deepEqual(doc.toBuffer(), original, filename);
      const before = doc.files; doc.root.header.boundingBox.minX -= 1;
      const after = readBlueprintDocument(doc.toBuffer()).files;
      for (const [name, bytes] of before) if (name !== `${doc.root.name}/header.smbph`) assert.deepEqual(after.get(name), bytes, name);
    }
    const folder = 'samples/BASE_Warehouse_Station';
    const doc = readBlueprintFolderDocument(folder);
    assert.deepEqual(doc.files, readBlueprintFiles(folder));
  });
});
