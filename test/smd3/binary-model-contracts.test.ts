/**
 * @fileoverview Binary model editing, historical sections and diagnostic fallback contracts.
 * Wire fixtures and independent expected values complement the existing sample corpus.
 */
import { assert } from 'chai';
import { BufferWriter } from '../../src/core/BufferWriter.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { TagType } from '../../src/core/TagType.js';
import { readFrom, writeTo } from '../../src/core/TagParser.js';
import { SimulationGroup, SimulationState } from '../../src/objects/Simulation.js';
import { BlueprintLogic, parseSmbpl } from '../../src/smd3/SmbplParser.js';
import { writeSmbpl } from '../../src/smd3/SmbplWriter.js';
import { parseSim } from '../../src/smd3/SimParser.js';
import { writeSim } from '../../src/smd3/SimWriter.js';
import { parseSmbmm } from '../../src/smd3/SmbmmParser.js';
import { writeSmbmm, emptyModMappings } from '../../src/smd3/SmbmmWriter.js';
import { parseSmbph, BlueprintHeader } from '../../src/smd3/SmentParser.js';
import { writeSmbph } from '../../src/smd3/SmbphWriter.js';
import { BlueprintTemplate, normalizeBlueprintTemplate, parseSmtpl, templatePositionKey, templatePositionFromKey } from '../../src/smd3/SmtplParser.js';

const from = { x: 1, y: 2, z: 3 }, a = { x: 4, y: 5, z: 6 }, b = { x: 7, y: 8, z: 9 };
const emptyLogic = () => new BlueprintLogic({ structureVersion: 0, controllers: [], links: [], controllerCount: 0 });
const tplInput = () => ({ version: 6, minX: -1, minY: -2, minZ: -3, maxX: 1, maxY: 2, maxZ: 3, pieces: [], connections: [], texts: new Map() });

describe('Binary model contracts — logic and templates', () => {
  it('constructs, queries and edits links without mutating other controllers', () => {
    const empty = emptyLogic();
    const logic = empty.withStructureVersion(1).addLink(from, 5, [a, b]).addLink(from, 6, a).addLink(a, 5, b);
    assert.equal(empty.groupCount, 0); assert.equal(logic.groupCount, 3);
    assert.equal(logic.connectionCount, 4); assert.equal(logic.controllerCount, 2);
    const fromLinks = empty.withLinks(logic.links);
    assert.deepEqual(fromLinks.controllers, logic.controllers);
    const plain = { structureVersion: 0, controllers: [], links: logic.links, controllerCount: 2 };
    assert.deepEqual(parseSmbpl(new Uint8Array(writeSmbpl(plain))).controllers, logic.controllers);
    assert.isTrue(parseSmbpl(writeSmbpl({ ...plain, links: undefined } as any)).isEmpty);
    assert.strictEqual(logic.removeLink(b), logic);
    assert.strictEqual(logic.removeLink(from, 99), logic);
    assert.strictEqual(logic.moveController(b, from), logic);
    assert.equal(logic.clearController(from).controllerCount, 1);
    assert.equal(logic.removeLink(from, 5).groupCount, 2);
    assert.equal(logic.removeLink(a, 5).controllerCount, 1);
    assert.equal(logic.removeLink(from, 5, a).connectionCount, 3);
    assert.equal(logic.moveController(from, b).controllerAt(b)!.groups.length, 2);
    assert.deepEqual(logic.targetsOf(from, 6), [a]);
    assert.deepEqual(logic.controllersForType(6).map(c => ({ x: c.x, y: c.y, z: c.z })), [from]);
    assert.deepEqual(logic.typesFrom(from), [5, 6]);
    assert.isTrue(logic.isLinked(from, b)); assert.isFalse(logic.isLinked(from, b, 6));
    assert.throws(() => parseSmbpl(Buffer.concat([writeSmbpl(empty), Buffer.from([0])])), /Trailing/);
  });

  for (let mask = 0; mask < 8; mask++) {
    it(`decodes network controller deltas with width mask ${mask}`, () => {
      const w = new BufferWriter();
      w.writeInt32BE(0); w.writeInt32BE(-2); w.writeInt32BE(1);
      for (const v of [1, 2, 3]) w.writeInt16BE(v);
      w.writeInt32BE(1); w.writeInt16BE(5); w.writeInt32BE(1);
      for (let axis = 0; axis < 3; axis++) w.writeInt8((mask >> axis) & 1);
      for (const v of [10, 20, 30]) w.writeInt16BE(v);
      for (let axis = 0; axis < 3; axis++) {
        if ((mask >> axis) & 1) w.writeInt16BE(axis + 1); else w.writeInt8(axis + 1);
      }
      assert.deepEqual(parseSmbpl(w.toBuffer()).links[0].targets, [{ x: 11, y: 22, z: 33 }]);
    });
  }

  it('normalizes sparse templates and edits connections, text, filters and pieces', () => {
    const original = normalizeBlueprintTemplate(tplInput());
    assert.strictEqual(normalizeBlueprintTemplate(original), original);
    assert.deepEqual(original.bounds, { min: { x: -1, y: -2, z: -3 }, max: from, size: { x: 3, y: 5, z: 7 } });
    for (const getter of ['pieceAt', 'getText', 'filterAt', 'fillUpFilterAt', 'productionAt', 'productionLimitAt'] as const) {
      assert.isNull(original[getter](from));
    }
    assert.deepEqual(original.controllersFor(from), []);
    const piece = { ...from, type: 5, hp: 127, orientation: 0, active: false };
    const edited = original.withPiece(piece).withText(from, 'one').addConnection(from, a).addConnection(b, a).addConnection(b, a);
    assert.equal(edited.connectionCount, 2); assert.equal(edited.getText(from), 'one');
    assert.equal(edited.withoutText(from).textCount, 0); assert.equal(edited.removePieceAt(from).pieceCount, 0);
    assert.equal(edited.removeConnection(b).connectionCount, 1);
    assert.deepEqual(edited.controllersFor(a), [from, b]);
    assert.equal(original.pieceCount, 0); assert.equal(original.textCount, 0);
    assert.deepEqual(templatePositionFromKey(templatePositionKey({ x: -32768, y: -1, z: 32767 })), { x: -32768, y: -1, z: 32767 });
  });

  for (const version of [3, 4, 5, 6]) {
    it(`accepts the documented absent optional template tail for v${version}`, () => {
      const w = new BufferWriter(); w.writeInt8(version);
      for (let i = 0; i < 7; i++) w.writeInt32BE(0);
      const absent = parseSmtpl(new Uint8Array(w.toBuffer()));
      assert.equal(absent.totalBlocks, 0); assert.equal(absent.filters.length, 0);
      for (let i = 0; i < 6; i++) w.writeInt32BE(0);
      const empty = parseSmtpl(w.toBuffer());
      assert.deepEqual(empty.pieces, absent.pieces); assert.deepEqual(empty.filters, absent.filters);
    });
  }
});

describe('Binary model contracts — simulation and auxiliary files', () => {
  it('selects simulation, structured-group and opaque-root writer paths', () => {
    const rootTag = Tags.int('diagnostic', 42);
    const base = { version: 0, groups: [], rootTag };
    assert.equal(readFrom(writeSim(base)).getInt(), 42);
    assert.equal(parseSim(writeSim({ ...base, lastUpdate: 7n })).lastUpdate, 7n);
    const group = new SimulationGroup(0, 2, ['ship'], 3n, { x: 1, y: 2, z: 3 } as any, 4);
    const result = parseSim(writeSim({ ...base, groups: [{ ...group, raw: group.toTag() }] }));
    assert.deepEqual(result.groups[0].members, ['ship']); assert.equal(result.lastUpdate, 0n);
    assert.equal(parseSim(writeSim({ ...base, simulation: new SimulationState(2, [group], 8n) })).version, 2);
    assert.equal(parseSim(new Uint8Array(writeTo(rootTag))).groups.length, 0);
    assert.equal(parseSim(writeTo(Tags.struct(null, []))).groups.length, 0);
  });

  it('retains diagnostic group data if high-level simulation decoding fails', () => {
    const originalState = SimulationState.fromTag, originalGroup = SimulationGroup.fromTag;
    const good = new SimulationGroup(1, 2, ['ship'], 3n, { x: 1, y: 2, z: 3 } as any, 4).toTag();
    const root = Tags.struct(null, [Tags.byte(null, 5), Tags.struct(null, [good, Tags.string(null, 'opaque')]), Tags.long(null, 8n)]);
    try {
      // The format-level reader deliberately has a fallback for a failing domain decoder.
      SimulationState.fromTag = () => { throw new Error('Injected domain decoder failure'); };
      const recovered = parseSim(writeTo(root));
      assert.isNull(recovered.simulation); assert.equal(recovered.version, 5); assert.equal(recovered.lastUpdate, 8n);
      assert.equal(recovered.groups[0].programId, 4); assert.equal(recovered.groups[1].raw.getString(), 'opaque');
      SimulationGroup.fromTag = () => { throw new Error('Injected group decoder failure'); };
      assert.equal(parseSim(writeTo(root)).groups[0].raw.type, TagType.STRUCT);
      assert.equal(parseSim(writeTo(Tags.struct(null, []))).groups.length, 0);
    } finally { SimulationState.fromTag = originalState; SimulationGroup.fromTag = originalGroup; }
  });

  it('uses a high-level reconstructed raw group if the domain decoder synthesizes one', () => {
    const original = SimulationState.fromTag;
    const group = new SimulationGroup(0, 1, [], 0n, null, 0);
    try {
      SimulationState.fromTag = () => new SimulationState(0, [group], 0n);
      assert.deepEqual(parseSim(writeTo(Tags.struct(null, []))).groups[0].raw, group.toTag());
    } finally { SimulationState.fromTag = original; }
  });

  it('keeps opaque mappings unless explicitly requested as typed pairs', () => {
    assert.equal(emptyModMappings().length, 0);
    assert.isTrue(parseSmbmm(new Uint8Array()).isEmpty);
    const mappings = [{ from: 1, to: 2 }], raw = Buffer.from([1, 2, 3]);
    assert.deepEqual(writeSmbmm({ mappings, raw, isEmpty: false, format: 'opaque' } as any), raw);
    assert.equal(writeSmbmm({ mappings, raw, isEmpty: true, format: 'opaque' } as any).length, 8);
    assert.equal(writeSmbmm({ mappings, raw: Buffer.alloc(0), isEmpty: false, format: 'opaque' } as any).length, 8);
    assert.equal(parseSmbph(writeSmbph(new BlueprintHeader({ entityType: 'UNKNOWN', headerVersion: 0, blockCountByType: [], boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } }))).entityType, 'SHIP');
  });
});
