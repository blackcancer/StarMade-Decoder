/**
 * @fileoverview Blueprint metadata, headers and nested-entity editing contracts.
 * Verifies both fresh models and raw-preserving legacy input representations.
 */
import fs from 'node:fs';
import { assert } from 'chai';
import { Tag, FINISH_TAG } from '../src/core/Tag.js';
import { TagType } from '../src/core/TagType.js';
import { Tags } from '../src/core/TagBuilder.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { BufferWriter } from '../src/core/BufferWriter.js';
import { Matrix4f } from '../src/types/Matrices.js';
import { ManagerContainer } from '../src/objects/components/ManagerContainer.js';
import { ThrustConfig } from '../src/objects/components/PowerAndThrust.js';
import * as M from '../src/smd3/SmbpmParser.js';
import { writeSmbpm } from '../src/smd3/SmbpmWriter.js';
import * as H from '../src/smd3/SmentParser.js';
import { writeSmbph } from '../src/smd3/SmbphWriter.js';
import { emptySegment, emptySmd3File } from '../src/smd3/Smd3Writer.js';

const v = { x: 1, y: 2, z: 3 };
const zero = { x: 0, y: 0, z: 0 };
const box = { minX: -2, minY: -4, minZ: -6, maxX: 2, maxY: 4, maxZ: 6 };
const makeMeta = () => M.parseSmbpm(Buffer.from('0000000501', 'hex'));
const makeHeader = () => new H.BlueprintHeader({ headerVersion: 5, entityType: 'SHIP', boundingBox: box, blockCountByType: [] });
const piece: M.RailPieceRef = { kind: 0, uid: 'ship', position: v, type: 5, orientation: 0, active: true, hp: 127 };
const request: M.RailChildRequest = { railTagType: 3, rail: piece, docked: { ...piece, uid: 'child', active: false },
  railTransform: new Matrix4f(), dockedTransform: new Matrix4f(), railContact: v,
  movingAtDockTransform: new Matrix4f(), flags: [0, 1] };
const ai: M.AiConfig = { tagName: 'AIConfig1', entries: [{ id: 1, value: 'true' }, { id: 2, value: 'SHIP' }], values: { 1: 'true', 2: 'SHIP' } };

/** Creates an entity model, optionally retaining plain-object children. */
function entity(name: string, children: H.SmentEntity[] = []): H.BlueprintEntity {
  return new H.BlueprintEntity({ name, header: makeHeader(), offset: zero, worldOffset: zero, meta: null, logic: null,
    segments: [{ ...emptySmd3File(), segments: [emptySegment()] }], children });
}

describe('Blueprint contracts — header and entity models', () => {
  it('computes and immutably edits every score component, including v0', () => {
    const score = new H.BlueprintIndexScore();
    assert.equal(score.totalIndex, 0); assert.isTrue(score.hasMiningIndex);
    assert.isFalse(score.withVersion(0).hasMiningIndex);
    const values = { offensiveIndex: 1, defensiveIndex: 2, powerIndex: 3, mobilityIndex: 4,
      dangerIndex: 5, survivabilityIndex: 6, supportIndex: 7, miningIndex: 8 };
    const full = score.withValues(values);
    assert.equal(full.totalIndex, 36); assert.equal(full.strongestField, 'miningIndex');
    for (const [key, value] of Object.entries(values)) {
      assert.equal(full.getValue(key as H.BlueprintScoreField), value);
      assert.equal(full.withValue(key as H.BlueprintScoreField, 20).getValue(key as H.BlueprintScoreField), 20);
    }
    assert.equal(new H.BlueprintIndexScore({ legacyOffensiveIndex: 9 }).legacyOffensiveIndex, 9);
    assert.equal(score.totalIndex, 0);
    for (const version of [0, 1]) {
      const header = makeHeader().withScore({ ...values, version, legacyOffensiveIndex: 99 });
      const parsed = H.parseSmbph(writeSmbph(header));
      assert.equal(parsed.score!.version, version);
      assert.equal(parsed.score!.miningIndex, version === 0 ? 0 : 8);
    }
  });

  it('edits header identity, bounds, counts and classifications without stale totals', () => {
    const original = makeHeader();
    assert.isTrue(original.isEmpty); assert.equal(original.blockShare(5), 0);
    assert.equal(original.entityTypeOrdinal, 0); assert.deepEqual(original.boundsCenter, zero);
    assert.deepEqual(original.boundsSize, { x: 4, y: 8, z: 12 }); assert.equal(original.boundsVolume, 384);
    assert.equal(original.withHeaderVersion(3).headerVersion, 3);
    assert.equal(original.withGameVersion('test').gameVersion, 'test');
    assert.isUndefined(original.withGameVersion(undefined).gameVersion);
    assert.deepEqual(original.withBoundingBox({ ...box, maxX: 4 }).boundsCenter, { x: 1, y: 0, z: 0 });
    for (const [type, classification] of [['SHOP', 21], ['SPACE_STATION', 9], ['MANAGED_ASTEROID', 19], ['ASTEROID', 18], ['PLANET', 20], ['SHIP', 0], ['unknown', 0]] as const) {
      assert.equal(original.withEntityType(type).classificationOrdinal, classification);
      assert.equal(H.defaultBlueprintClassification(type), classification);
    }
    assert.equal(original.withEntityType('SHIP', 4).classificationOrdinal, 4);
    assert.equal(original.withClassification(undefined).classificationOrdinal, 0);
    assert.equal(H.blueprintClassificationName(999), 'UNKNOWN(999)');
    assert.equal(H.blueprintClassificationName(undefined), 'UNKNOWN(-1)');
    const counted = original.withBlockCount(5, 3).withBlockCount(6, 1);
    assert.equal(counted.blockCountOf(99), 0); assert.isTrue(counted.hasBlockType(5)); assert.isFalse(counted.hasBlockType(99));
    assert.equal(counted.blockShare(5), 0.75);
    assert.equal(counted.withoutBlockType(5).totalBlockCount, 1);
    assert.equal(counted.topBlockTypes()[0].type, 5); assert.lengthOf(counted.topBlockTypes(1), 1);
    assert.isTrue(original.isEmpty); assert.equal(counted.blockTypeCount, 2);
    assert.isFalse(counted.withScore(null).hasScore);
  });

  it('handles model and plain-object entities and immutable entity edits', () => {
    const child = entity('root/child');
    const plain = { ...entity('plain') };
    const root = entity('root', [child, plain]);
    assert.strictEqual(root.child('child'), child); assert.strictEqual(root.child('root/child'), child);
    assert.isNull(root.child('missing')); assert.isNull(root.findEntity('missing'));
    assert.strictEqual(root.findEntity('child'), child);
    assert.equal(root.directBlockCount, 0); assert.equal(root.declaredBlockCount, 0);
    assert.equal(root.segmentFileCount, 1); assert.equal(root.attachmentCount, 2);
    assert.equal(root.withMeta(makeMeta()).meta!.metaVersion, 5); assert.isNull(root.withLogic(null).logic);
    assert.equal(root.withHeader({ ...makeHeader(), entityType: 'PLANET' }).entityType, 'PLANET');
    assert.equal(root.withChildren([]).attachmentCount, 0); assert.equal(root.attachmentCount, 2);
    const archive = new H.BlueprintArchive({ ...root, header: { ...makeHeader() } } as any);
    assert.lengthOf(archive.entities, 3); assert.equal(archive.totalBlockCount, 0);
    assert.isTrue(archive.complete); assert.isNull(archive.findEntity('missing'));
    archive.root = { ...root, children: [{ ...child, children: [plain] }] } as any;
    assert.lengthOf(archive.entities, 3); assert.equal(archive.findEntity('plain')!.name, 'plain');
    assert.isNull(archive.findEntity('unknown'));
    assert.strictEqual(entity('').findEntity('')!.name, '');
  });
});

describe('Blueprint contracts — metadata editing and preservation', () => {
  it('updates each metadata section and round-trips its meaningful fields', () => {
    const base = makeMeta();
    assert.isFalse(base.hasManager); assert.isFalse(base.hasRails); assert.equal(base.attachmentCount, 0);
    assert.isNull(base.childTransformFor('missing')); assert.isNull(base.childOffsetFor('missing'));
    const docking = { name: 'root/child', posX: 17, posY: 18, posZ: 19, sizeX: 2, sizeY: 3, sizeZ: 4,
      style: 1, orientation: 2, offset: v };
    const rail = { name: 'root/rail', request, offset: M.getRailChildOffsetFromRequest(request) };
    let meta = base.withDockingEntries([docking]).withRailChildren([rail, { name: 'empty', request: null, offset: null }])
      .withRailUID('uid').withRailBounds(v, { x: 4, y: 5, z: 6 })
      .withWirelessMarkers([{ marking: 'marker', markerLocation: 2n, fromLocation: 3n }])
      .withRailDockerPieces([{ posX: 1, posY: 2, posZ: 3, type: 5, orientation: 2, active: true, hp: 90 }])
      .withCargoPoints([{ posIndex: 4n, capacity: 2.5 }]).withLockBoxPoints([{ posIndex: 5n, capacity: 3.5 }])
      .withAiConfig(ai);
    assert.isTrue(meta.hasRails); assert.equal(meta.attachmentCount, 2);
    assert.deepEqual(meta.childOffsetFor('child'), v);
    assert.isNull(meta.childOffsetFor('////'));
    const parsed = M.parseSmbpm(new Uint8Array(writeSmbpm(meta)));
    for (const property of ['dockingEntries', 'wirelessMarkers', 'railDockerPieces', 'cargoPoints', 'lockBoxPoints', 'aiConfig']) {
      assert.deepEqual((parsed as any)[property], (meta as any)[property], property);
    }
    assert.isNull(parsed.railChildren[1].request);
    assert.equal(meta.withMetaVersion(1).metaVersion, 1);
    assert.equal(M.parseSmbpm(writeSmbpm(base.withMetaVersion(1))).metaVersion, 1);
    assert.isUndefined(meta.withRailUID(undefined).railUID);
    assert.isNull(meta.withRailBounds(null, null).railRootMin);
    assert.equal(meta.withAiValue(1, 'false').withAiValue(3, 'new').aiConfig!.values[3], 'new');
    assert.equal(base.withAiValue(1, 'fresh').aiConfig!.entries[0].value, 'fresh');
    assert.isNull(meta.withAiConfig(null).aiConfig);
    assert.strictEqual(meta.withRailChildRequest(-1, request), meta);
    assert.strictEqual(meta.withRailChildRequest('absent', request), meta);
    assert.strictEqual(meta.withRailChildRequest(2, request), meta);
    assert.equal(meta.withRailChildRequest('rail', { ...request, flags: [1] }).railChildren[0].request!.flags[0], 1);
    assert.isNull(meta.withRailChildRequest(0, null).railChildren[0].request);
    const unchanged = M.parseSmbpm(fs.readFileSync('samples/BASE_Warehouse_Station/meta.smbpm'));
    assert.isTrue(unchanged.hasManager);
    assert.isTrue(unchanged.withMetaVersion(5).hasManager);
    const manager = ManagerContainer.fromTag(Tags.struct(null, []));
    assert.isTrue(base.withManager(manager).hasManager);
    assert.isFalse(unchanged.withManager(null).hasManager);
    assert.isTrue(M.parseSmbpm(writeSmbpm(base.withManager(manager))).hasManager);
    const thrust = ThrustConfig.fromTag(Tags.struct(null, []));
    assert.isNotNull(M.parseSmbpm(writeSmbpm(base.withThrustConfig(thrust))).thrustConfig);
    assert.isNull(base.withThrustConfig(null).thrustConfig);
  });

  it('preserves explicit presence flags and legacy raw/tag representations', () => {
    for (const flag of [0, 1]) {
      const b = flag ? Buffer.from('0000000508010000000001', 'hex') : Buffer.from('00000005080001', 'hex');
      const first = M.parseSmbpm(b), second = M.parseSmbpm(writeSmbpm(first));
      assert.equal(M.getSmbpmInternals(second).lockBoxPresent, flag === 1);
    }
    const tag = Tags.struct(null, []), raw = writeTo(tag);
    for (const fields of [{ managerTag: tag }, { managerRaw: raw }, { managerRaw: raw, manager: ManagerContainer.fromTag(tag) },
      { thrustTag: tag }, { thrustRaw: raw }, { thrustRaw: raw, thrustConfig: ThrustConfig.fromTag(tag) }]) {
      const model = { ...makeMeta(), ...fields };
      const encoded = writeSmbpm(model);
      assert.isAbove(encoded.length, raw.length);
      assert.isObject(M.parseSmbpm(encoded));
    }
    for (const value of ['', 1]) {
      assert.isNull(M.getSmbpmInternals(value as any).managerRaw);
      assert.isNull(M.getRailChildInternals(value as any).tagRaw);
    }
    const model = { ...makeMeta(), wirelessMarkers: undefined } as any;
    assert.lengthOf(M.parseSmbpm(writeSmbpm(model)).wirelessMarkers, 0);
    const legacy = { ...makeMeta(), aiConfig: null, aiTag: M.aiConfigToTag(ai) } as any;
    assert.deepEqual(M.parseSmbpm(writeSmbpm(legacy)).aiConfig, ai);
  });

  it('preserves unknown AI children, replaces known values and drops removed entries', () => {
    assert.isNull(M.parseAiConfigTag(null)); assert.isNull(M.parseAiConfigTag(Tags.byte(null, 1)));
    const fallback = Tags.struct('fallback', [Tags.int('unknown', 2), Tags.struct('bad', []),
      Tags.struct('pair', [Tags.byte('id', 1), Tags.string('value', 'old'), Tags.int('extra', 7)]),
      Tags.struct(null, [Tags.byte(null, 9), Tags.string(null, 'removed')])]);
    const updated = M.aiConfigToTag({ ...ai, tagName: null }, fallback);
    assert.equal(updated.name, 'fallback'); assert.equal(updated.findByName('unknown')!.getInt(), 2);
    assert.equal(updated.findByName('pair')!.findByName('extra')!.getInt(), 7);
    assert.deepEqual(M.parseAiConfigTag(updated)!.entries, ai.entries);
    assert.equal(M.aiConfigToTag({ ...ai, tagName: null }).name, null);
    for (const fallbackTag of [Tags.byte(null, 0), M.aiConfigToTag({ ...ai, entries: [] }), M.aiConfigToTag(ai)]) {
      const edited = { ...makeMeta(), aiConfig: { ...ai, entries: [{ id: 1, value: 'changed' }] }, aiTag: fallbackTag };
      assert.equal(M.parseSmbpm(writeSmbpm(edited)).aiConfig!.values[1], 'changed');
    }
  });

  it('round-trips rail requests and edits them while retaining fallback names', () => {
    const tag = M.railChildRequestToTag(request);
    assert.deepEqual(M.parseRailChildRequestFromTag(tag), request);
    assert.deepEqual(M.getRailChildOffsetFromTag(tag), M.getRailChildOffsetFromRequest(request));
    assert.isNull(M.getRailChildOffsetFromTag(null));
    const fallback = Tags.rename(tag, 'rail');
    const edited = { ...request, rail: { ...piece, uid: 'changed' }, flags: [1, 0, 1] };
    const updated = M.railChildRequestToTag(edited, fallback);
    assert.equal(updated.name, 'rail'); assert.deepEqual(M.parseRailChildRequestFromTag(updated), edited);
    const sparse = { ...request, rail: null, docked: null, railTransform: null, dockedTransform: null,
      railContact: null, movingAtDockTransform: null, flags: [] };
    const preserved = M.railChildRequestToTag(sparse, fallback);
    assert.deepEqual(M.parseRailChildRequestFromTag(preserved), request);
    assert.isNull(M.parseRailChildRequestFromTag(M.railChildRequestToTag(sparse))!.rail);
    for (const bad of [null, Tags.byte(null, 0), Tags.struct(null, []), Tags.struct(null, [Tags.byte(null, 1)]),
      Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [])])]) assert.isNull(M.parseRailChildRequestFromTag(bad));
    const payload = Array.from({ length: 6 }, () => Tags.nothing(null));
    payload[0] = Tags.struct(null, []);
    const partial = Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [Tags.struct(null, payload)])]);
    assert.isNull(M.parseRailChildRequestFromTag(partial)!.rail);
    const validPartialPiece = [Tags.nothing(null), Tags.nothing(null), Tags.vector3i(null, 1, 2, 3), Tags.nothing(null), Tags.byte(null, 0)];
    payload[0] = Tags.struct(null, validPartialPiece);
    const partial2 = Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [Tags.struct(null, payload)])]);
    assert.equal(M.parseRailChildRequestFromTag(partial2)!.rail!.uid, '');
    for (const child of [{ name: 'child', request: null, offset: null, tag },
      { name: 'child', request: edited, offset: null, tag },
      { name: 'child', request: request, offset: null, tag: Tags.byte(null, 0) },
      { name: 'child', request: sparse, offset: null, tag: M.railChildRequestToTag(sparse) }]) {
      const model = { ...makeMeta(), railChildren: [child] };
      assert.lengthOf(M.parseSmbpm(writeSmbpm(model)).railChildren, 1);
    }
  });

  it('rejects malformed embedded Tags in every metadata envelope section', () => {
    for (const type of [2, 5, 9]) for (const bad of [Buffer.from('0000ff', 'hex'), Buffer.from('00', 'hex')]) {
      const w = new BufferWriter(); w.writeInt32BE(5); w.writeInt8(type);
      if (type === 5) w.writeInt32BE(bad.length);
      w.writeBytes(bad);
      assert.throws(() => M.parseSmbpm(w.toBuffer()), /Tag/);
    }
  });
});
