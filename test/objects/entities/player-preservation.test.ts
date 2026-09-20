/** @fileoverview Advanced player models retain exact source data while enforcing strict positional edits. */
import { assert } from 'chai';
import fs from 'node:fs';
import { Tag } from '../../../src/core/Tag.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { TagType } from '../../../src/core/TagType.js';
import { readFrom, writeTo, readTagDocument } from '../../../src/core/TagParser.js';
import { registerAllFactories } from '../../../src/serializable/Factories.js';
import { PlayerStateEntity, FactionMembership } from '../../../src/objects/entities/PlayerStateEntity.js';
import { PlayerCharacterEntity } from '../../../src/objects/entities/PlayerCharacterEntity.js';
import { GameEntity } from '../../../src/objects/entities/GameEntity.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { EntityTransform, SectorPosition } from '../../../src/objects/components/Transform.js';
import { SpawnController, SpawnMarker } from '../../../src/objects/components/SpawnData.js';
import * as Slot from '../../../src/objects/EntitySlotObjects.js';
import { envelope, replace } from '../../helpers/simulation.js';

registerAllFactories();
/** Actual saved data remains an independent fixture, not produced by the models being tested. */
function fixture(name: string): Tag { return readFrom(fs.readFileSync(`samples/ENTITY_${name}_InitSysRev.ent`)); }
/** Full wire equality checks names, ordering, types and unknown values. */
function same(a: Tag, b: Tag): void { assert.deepEqual(writeTo(a), writeTo(b)); }
/** Adds source-only data before the terminator. */
function extend(tag: Tag): Tag { return Tags.struct(tag.name, [...tag.getStruct().filter(value => value.type !== TagType.FINISH), Tags.string('future-field', 'retain')]); }
/** Earliest supported tuple: positional credits, legacy spawn vector, real inventory. */
function minimalPlayer(): Tag { return Tags.struct('PlayerState', [Tags.int(null, 12), Tags.vector3f(null, 1, 2, 3), Inventory.EMPTY.toTag()]); }
/** Mandatory transformable fields with the real fixed-length FLOAT matrix. */
function minimalTransformable(): Tag { return Tags.struct('transformable', [Tags.float(null, .1), EntityTransform.IDENTITY.toMatrix4fList()]); }
/** Complete character required tuple with anonymous field names. */
function minimalCharacter(): Tag { return Tags.struct('PlayerCharacter', [Tags.int(null, 1), Tags.float(null, 4), Tags.float(null, .25), minimalTransformable()]); }

describe('Advanced player preservation', () => {
  it('updates positional credit, creative and faction fields without changing names, types or extensions elsewhere', () => {
    let root = fixture('PLAYERSTATE'); root = replace(root, 0, Tags.long('custom-credit-name', 12n));
    root = replace(root, 10, Tags.byte('custom-creative-name', 0)); root = replace(root, 6, extend(root.getStruct()[6])); root = extend(root);
    const player = PlayerStateEntity.fromTag(root); same(player.toTag(), root);
    same(player.withCredits(13n).toTag(), replace(root, 0, Tags.long('custom-credit-name', 13n)));
    same(player.withCreativeMode(true).toTag(), replace(root, 10, Tags.byte('custom-creative-name', 1)));
    const faction = root.getStruct()[6], changed = replace(replace(faction, 0, Tags.int(faction.getStruct()[0].name, 99)), 1, Tags.int(faction.getStruct()[1].name, 3));
    same(player.withFaction(99, 3).toTag(), replace(root, 6, changed));
    assert.equal(player.withFaction(99, 3).faction.suspended, 3); assert.equal(player.faction.rank, player.faction.suspended);
    assert.equal(player.getField('factionMembership')!.withValue({ factionId: 4, suspended: 6 }).faction.suspended, 6);
    assert.equal(player.getField('factionMembership')!.withValue(new FactionMembership(4, 5)).faction.suspended, 5);
    assert.equal(player.getField('factionMembership')!.withValue({ factionId: 4 }).faction.suspended, 0);
    assert.throws(() => player.getField('factionMembership')!.withValue(false));
    assert.include(player.toString(), 'PlayerState'); assert.include(player.faction.toString(), 'suspended');
  });

  it('preserves gzip/version/trailing envelopes and exact reverted output for both player classes', () => {
    for (const compressed of [false, true]) for (const name of ['PLAYERSTATE', 'PLAYERCHARACTER']) {
      const Type = name === 'PLAYERSTATE' ? PlayerStateEntity : PlayerCharacterEntity;
      const bytes = envelope(extend(fixture(name)), compressed), input = Buffer.from(bytes), model = Type.fromBuffer(new Uint8Array(input)); input.fill(0);
      assert.deepEqual(model.toBuffer(), bytes); const output = model.toBuffer(); output.fill(0); assert.deepEqual(model.toBuffer(), bytes);
      const edited = model instanceof PlayerStateEntity ? model.withCredits(model.credits + 1n) : model.withId(model.id + 1);
      const document = readTagDocument(edited.toBuffer()); assert.equal(document.compressed, compressed); assert.deepEqual(document.trailingData, Buffer.from([5, 0, 255, 18]));
      if (!compressed) assert.equal(document.version, 23);
      const reverted = edited instanceof PlayerStateEntity ? edited.withCredits((model as PlayerStateEntity).credits) : edited.withId((model as PlayerCharacterEntity).id);
      assert.deepEqual(reverted.toBuffer(), bytes);
    }
  });

  it('detaches all exposed source trees and mutable component projections', () => {
    const root = fixture('PLAYERSTATE'), model = PlayerStateEntity.fromTag(root), before = model.toBuffer(); root.getStruct()[0] = Tags.long(null, 0n);
    model.toTag().getStruct()[0] = Tags.long(null, 0n); assert.throws(() => { (model.spawnData.deathSpawn as any).localX = 999; });
    const inventory = model.inventory, originalCount = model.inventory.items.reduce((sum, item) => sum + item.count, 0);
    if (inventory.items.length) assert.throws(() => { (inventory.items[0] as any).count = 1; });
    assert.equal(model.inventory.items.reduce((sum, item) => sum + item.count, 0), originalCount); assert.deepEqual(model.toBuffer(), before); assert.isFrozen(model);
    const character = PlayerCharacterEntity.fromTag(fixture('PLAYERCHARACTER')), original = character.toBuffer();
    assert.throws(() => { (character.transform as any).originX = 999; }); assert.throws(() => { (character.sectorPosition as any).x = 999; }); character.spawnController.markers.push(new SpawnMarker(0n, 0, 0, 0));
    character.toTag().getStruct()[0] = Tags.int(null, 0); assert.deepEqual(character.toBuffer(), original); assert.isFrozen(character);
    const spawn = new SpawnController([new SpawnMarker(7n, 1, 2, 3)]), changed = character.getTransformableField('spawnController')!.withValue(spawn);
    spawn.markers.length = 0; assert.lengthOf(changed.spawnController.markers, 1);
  });

  it('retains untouched character transforms, homogeneous matrix entries and nested spawn metadata on scalar edits', () => {
    let root = fixture('PLAYERCHARACTER'), transform = root.getStruct()[3], matrix = transform.getStruct()[1];
    const values = matrix.getList(); values[3] = Tags.float(null, 17); values[7] = Tags.float(null, 18); values[11] = Tags.float(null, 19); values[15] = Tags.float(null, 20);
    transform = replace(transform, 1, new Tag(TagType.LIST, 'named-matrix', values, TagType.FLOAT));
    transform = replace(transform, 0, Tags.float('named-mass', 2)); transform = extend(transform);
    root = extend(replace(replace(root, 0, Tags.int('custom-id', 42)), 3, Tags.rename(transform, 'custom-transformable')));
    const model = PlayerCharacterEntity.fromTag(root);
    assert.isFalse(model.isNPC); assert.isTrue(model.withFactionId(-1).isNPC);
    same(model.withId(43).toTag(), replace(root, 0, Tags.int('custom-id', 43)));
    same(model.withSpeed(8).toTag(), replace(root, 1, Tags.float(root.getStruct()[1].name, 8)));
    same(model.withStepHeight(2).toTag(), replace(root, 2, Tags.float(root.getStruct()[2].name, 2)));
    const transformed = model.getTransformableField('transform')!.withValue(model.transform.with({ originX: 123 }));
    const result = transformed.toTag().getStruct()[3].getStruct()[1].getList();
    for (const i of [3, 7, 11, 15]) assert.equal(result[i].getFloat(), values[i].getFloat());
    same(transformed.getTransformableField('transform')!.withValue(model.transform).toTag(), root);
    const {m03,m13,m23,m33,...legacyProjection} = model.transform;
    const fromLegacy = model.getTransformableField('transform')!.withValue({...legacyProjection,originX:123});
    same(fromLegacy.toTag(),transformed.toTag());
    const complete = model.getTransformableField('transform')!.withValue({...model.transform,m03:42});
    assert.equal(complete.transform.m03,42); assert.equal(complete.transform.m33,m33);
    assert.throws(() => model.getTransformableField('transform')!.withValue({...model.transform,m03:NaN}));
    same(model.withOwner('Changed').withOwner(model.owner).toTag(), root);
    same(model.withMass(3).withMass(model.mass).toTag(), root);
    assert.isFalse(model.noAI); assert.equal(model.entityType_, 'PLAYER_CHARACTER');
    assert.isNull(model.getField('absent')); assert.isNull(model.getTransformableField('absent'));
  });

  it('supports genuine legacy omissions but rejects editing absent slots and malformed present values', () => {
    const player = PlayerStateEntity.fromTag(minimalPlayer()); assert.equal(player.credits, 12n); assert.equal(player.spawnData.deathSpawn.localX, 1);
    assert.equal(player.lastLogin, 0n); assert.equal(player.lastLogout, 0n); assert.equal(player.lastEnteredEntity, ''); assert.equal(player.health, 100);
    assert.equal(player.faction.factionId, 0); assert.equal(player.capsuleInventory.size + player.microInventory.size + player.macroInventory.size, 0);
    for (const update of [() => player.withCreativeMode(true), () => player.withFaction(1), () => player.withLastLogin(1n), () => player.withHealth(1)]) assert.throws(update);
    const character = PlayerCharacterEntity.fromTag(minimalCharacter()); assert.equal(character.mass, Math.fround(.1)); assert.equal(character.factionId, 0);
    assert.equal(character.owner, ''); assert.isFalse(character.noAI); assert.isFalse(character.aiConfigurationField!.present);
    assert.deepEqual(character.sectorPosition, new SectorPosition(0, 0, 0)); assert.lengthOf(character.spawnController.markers, 0);
    assert.throws(() => character.withFactionId(1), /absent/); assert.throws(() => character.withOwner('x'), /absent/);
    for (const Type of [PlayerStateEntity, PlayerCharacterEntity]) for (const root of [Tags.struct(null, []), Tags.byte(null, 0)]) assert.throws(() => Type.fromTag(root));
    for (const slot of [0, 1, 2, 3]) assert.throws(() => PlayerCharacterEntity.fromTag(replace(fixture('PLAYERCHARACTER'), slot, Tags.string(null, 'wrong'))));
    for (const slot of [0, 1, 2, 6, 7, 8, 10, 16, 17, 18, 27]) assert.throws(() => PlayerStateEntity.fromTag(replace(fixture('PLAYERSTATE'), slot, Tags.string(null, 'wrong'))));
    assert.throws(() => PlayerStateEntity.fromTag(replace(fixture('PLAYERSTATE'), 11, Tags.byte(null, 0))));
  });

  it('validates actual inventory payloads and preserves their wrapper/metadata on edits', () => {
    const root = fixture('PLAYERSTATE'), model = PlayerStateEntity.fromTag(root);
    const updated = model.withInventory(model.inventory.set(new ItemStack(399, 5, 3)));
    assert.equal(PlayerStateEntity.fromTag(updated.toTag()).inventory.get(399)!.count, 3);
    for (let index = 0; index < root.getStruct().length; index++) if (index !== 2) same(updated.toTag().getStruct()[index], root.getStruct()[index]);
    const invalid = Tags.struct('inv1', [new Tag(TagType.LIST, null, [Tags.int(null, 0)], TagType.INT),
      new Tag(TagType.LIST, null, [], TagType.SHORT), Tags.struct(null, [])]);
    assert.throws(() => PlayerStateEntity.fromTag(replace(root, 2, invalid)), /lengths differ/);
    assert.throws(() => model.withCreativeMode('yes' as any), /boolean/);
    for (const value of [NaN, Infinity, 1e100]) { assert.throws(() => model.withHealth(value)); assert.throws(() => PlayerCharacterEntity.fromTag(fixture('PLAYERCHARACTER')).withSpeed(value)); }
  });

  it('validates faction suspension tuples and preserves both legacy and extended variants', () => {
    const original = Tags.struct('pFac-v0', [Tags.int('id', 7), Tags.int('suspension', 3), Tags.string('extra', 'retained')]);
    const model = FactionMembership.fromTag(original); assert.isFrozen(model); assert.equal(model.rank, 3); same(model.toTag(), original);
    same(model.withFaction(8, 4).toTag(), replace(replace(original, 0, Tags.int('id', 8)), 1, Tags.int('suspension', 4)));
    const legacy = FactionMembership.fromTag(Tags.struct('pFac-v0', [Tags.int(null, 7)])); assert.equal(legacy.suspended, 0);
    assert.equal(legacy.withFaction(8, 0).toTag().getStruct().length, 2); assert.equal(legacy.withFaction(8, 3).suspended, 3);
    assert.throws(() => FactionMembership.fromTag(Tags.struct(null, []))); assert.throws(() => FactionMembership.fromTag(Tags.struct(null, [Tags.int(null, 1), Tags.byte(null, 1)])));
    assert.throws(() => new FactionMembership(1e12, 0));
  });

  it('restores legacy credit widths and noncanonical boolean bytes after explicit edits', () => {
    const root = replace(replace(fixture('PLAYERSTATE'), 0, Tags.int('old-credits', 12)), 10, Tags.byte('creative', 7));
    const original = envelope(root, true), model = PlayerStateEntity.fromBuffer(original);
    assert.deepEqual(model.withCredits(12n).withCreativeMode(true).toBuffer(), original);
    assert.equal(model.withCredits(13n).toTag().getStruct()[0].type, TagType.INT);
    const large = model.withCredits(2147483648n); assert.equal(large.toTag().getStruct()[0].type, TagType.LONG);
    assert.deepEqual(large.withCredits(12n).toBuffer(), original);
    assert.deepEqual(model.withCredits(-2147483649n).withCredits(12n).toBuffer(), original);
    assert.deepEqual(model.withCreativeMode(false).withCreativeMode(true).toBuffer(), original);
    assert.throws(() => model.withCredits(12 as any), /bigint/);
    assert.isNull(model.getField('not-present'));
  });

  it('parses legacy and structured spawn positions and rejects malformed present spawn data', () => {
    const minimal = minimalPlayer().getStruct().filter(value => value.type !== TagType.FINISH);
    const legacy = PlayerStateEntity.fromTag(Tags.struct(null, [...minimal, Tags.vector3i('sector', 4, 5, 6),
      Tags.vector3f('lspawn', 7, 8, 9), Tags.vector3i('lsector', 10, 11, 12)]));
    assert.equal(legacy.spawnData.deathSpawn.sector.y, 5); assert.equal(legacy.logoutLocalZ, 9); assert.equal(legacy.logoutSector!.x, 10);
    assert.isFrozen(legacy.currentSector); assert.equal(PlayerStateEntity.fromTag(minimalPlayer()).savedCoordinates.entries.length, 0);
    const root = fixture('PLAYERSTATE'), originalSpawn = root.getStruct()[1];
    const locations = replace(replace(originalSpawn, 3, Tags.vector3f('pretutpoint', 1, 2, 3)), 4, Tags.vector3i('pretutsector', 4, 5, 6));
    const changed = PlayerStateEntity.fromTag(replace(root, 1, locations));
    assert.equal(changed.spawnData.preSpecialOriginY, 2); assert.equal(changed.spawnData.preSpecialSector!.z, 6);
    for (const spawn of [Tags.struct(null, []), replace(originalSpawn, 0, Tags.int(null, 9)),
      replace(originalSpawn, 1, Tags.struct(null, [])), replace(originalSpawn, 3, Tags.string(null, 'wrong')),
      replace(originalSpawn, 4, Tags.string(null, 'wrong'))]) assert.throws(() => PlayerStateEntity.fromTag(replace(root, 1, spawn)), /spawn/);
    const short = Tags.struct(null, originalSpawn.getStruct().slice(0, 3));
    assert.isNull(PlayerStateEntity.fromTag(replace(root, 1, short)).spawnData.preSpecialSector);
  });

  it('rejects malformed transforms and spawn controllers while retaining true optional omissions', () => {
    const root = fixture('PLAYERCHARACTER'), tr = root.getStruct()[3];
    for (const invalid of [Tags.struct(null, []), replace(tr, 0, Tags.float(null, Infinity)),
      replace(tr, 1, new Tag(TagType.LIST, null, [], TagType.FLOAT)), replace(tr, 3, Tags.byte(null, 0)),
      replace(tr, 6, Tags.struct(null, [])),
      replace(tr, 6, Tags.struct(null, [Tags.struct(null, [Tags.struct(null, [])])]))]) assert.throws(() => GameEntity.parseTransformable(invalid));
    const model = PlayerCharacterEntity.fromTag(root);
    assert.throws(() => model.withMass(Infinity), /finite/);
    same((model as any)._buildTransformableTag(), root.getStruct()[3]);
    const enabled = PlayerCharacterEntity.fromTag(replace(root, 3, replace(tr, 2, Tags.byte('noAI', 1))));
    assert.isTrue(enabled.noAI);
    const typed = PlayerCharacterEntity.fromTag(replace(root, 3, replace(tr, 2, Tags.struct('AI', [Tags.string(null, 'opaque')]))));
    assert.isFalse(typed.noAI);
  });

  it('propagates custom depth, byte, node and shared limits through parsed models and immutable edits', () => {
    for (const Type of [PlayerStateEntity, PlayerCharacterEntity]) {
      const name = Type === PlayerStateEntity ? 'PLAYERSTATE' : 'PLAYERCHARACTER', bytes = writeTo(fixture(name));
      for (const options of [{ maxInputBytes: 1 }, { maxInflatedBytes: 1 }, { maxNodes: 1 }, { maxDepth: 1 }]) assert.throws(() => Type.fromBuffer(bytes, options));
      let deep = Tags.byte(null, 0); for (let i = 0; i < 70; i++) deep = Tags.struct(null, [deep]);
      const root = fixture(name), children = root.getStruct().filter(tag => tag.type !== TagType.FINISH); children.push(deep);
      const original = writeTo(Tags.struct(root.name, children), { maxDepth: 100 }), options = { maxDepth: 100, sharedNodeBudget: { remainingNodes: 100000 } };
      const model = Type.fromBuffer(original, options), left = options.sharedNodeBudget.remainingNodes; options.maxDepth = 1;
      const edited = model instanceof PlayerStateEntity ? model.withCredits(42n) : model.withId(42);
      assert.equal(options.sharedNodeBudget.remainingNodes, left); assert.isAbove(edited.toBuffer().length, 0);
      assert.deepEqual(model.toBuffer(), original);
    }
  });
});
