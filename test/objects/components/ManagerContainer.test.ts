/** Real manager slot separation, lossless immutable edits and caller resource limits. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Tag } from '../../../src/core/Tag.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { TagType } from '../../../src/core/TagType.js';
import { readFrom, writeTo } from '../../../src/core/TagParser.js';
import { DecodeError } from '../../../src/core/DecodeError.js';
import { ManagerContainer, PullPermission } from '../../../src/objects/components/ManagerContainer.js';
import { PowerState } from '../../../src/objects/components/PowerAndThrust.js';
import { Inventory, ItemStack } from '../../../src/objects/components/Inventory.js';
import { TextBlocks } from '../../../src/objects/components/TextBlocks.js';
import { SlotAssignment } from '../../../src/objects/components/SlotAssignment.js';
import { EntSlotObject, WarpGateInfo, ManagerModulesState, AiConfigurationState, RaceGateInfo,
  UnloadedDummiesState, ModuleExplosionsState, ModDataState } from '../../../src/objects/EntitySlotObjects.js';
import { parseSmbpm } from '../../../src/smd3/SmbpmParser.js';
import { writeSmbpm } from '../../../src/smd3/SmbpmWriter.js';
import { registerAllFactories } from '../../../src/serializable/Factories.js';

registerAllFactories();
const code = (fn: () => unknown, expected: string): void => assert.throws(fn, (error: unknown) => error instanceof DecodeError && error.code === expected);
/** PowerImplementation stores a version, reactor index, collections and cooldowns; it is not PowerAddOn. */
const reactor = (): Tag => Tags.struct('reactor', [Tags.byte('version', 1), Tags.long('selected', -1n), Tags.struct('reactors', []),
  Tags.struct('priority', []), Tags.byte('enabled', 1), Tags.float('switch', 0.25), Tags.float('reboot', 0.5), Tags.long('future', 9007199254740993n)]);
/** ShieldLocalAddOn is a version and a local-shield collection. */
const shields = (): Tag => Tags.struct('shield-local', [Tags.byte('version', 0), Tags.struct('locals', []), Tags.string('future', 'retain')]);
/** Known fields use real schemas; placeholders remain visible rather than becoming fake typed records. */
function managerTag(overrides: Record<number, Tag> = {}): Tag {
  const children = Array.from({ length: 19 }, () => Tags.nothing(null));
  children[0] = Tags.struct('inventories', []); children[1] = Tags.int('shipMan0', 0);
  children[2] = Tags.struct('power-old', [Tags.double('power', 100), Tags.double('battery', 20), Tags.string('future-power', 'keep')]);
  children[3] = Tags.double('sh', 40); children[6] = Tags.rename(TextBlocks.EMPTY.toTag(), 'text');
  children[7] = Tags.struct('counts', [Tags.struct('pair', [Tags.short('type', -5), Tags.int('count', -1), Tags.string('future', 'keep')])]);
  children[11] = Tags.rename(SlotAssignment.EMPTY.toTag(), 'slots'); children[15] = reactor(); children[16] = Tags.byte('pull', 7);
  children[18] = Tags.byteArray('future-manager', Buffer.from([5, 6, 7]));
  for (const [index, tag] of Object.entries(overrides)) children[Number(index)] = tag;
  return Tags.struct('container-original', children);
}
const same = (a: Tag, b: Tag): void => assert.deepEqual(writeTo(a, { maxDepth: 100 }), writeTo(b, { maxDepth: 100 }));

describe('ManagerContainer source schemas', () => {
  it('reads the warehouse metadata and preserves its complete actual reactor-bearing manager', () => {
    const raw = fs.readFileSync('samples/BASE_Warehouse_Station/meta.smbpm'), metadata = parseSmbpm(raw);
    assert.ok(metadata.manager instanceof ManagerContainer);
    const manager = metadata.manager;
    assert.equal(manager.powerReactor.toTag().type, TagType.STRUCT);
    same(ManagerContainer.fromTag(manager.toTag()).toTag(), manager.toTag());
    assert.deepEqual(writeSmbpm(metadata), raw);
    const changed = manager.withPower(new PowerState(999, 5));
    assert.equal(changed.toTag().getStruct()[2].getStruct()[0].getDouble(), 999);
    same(changed.toTag().getStruct()[15], manager.toTag().getStruct()[15]);
  });

  it('edits PowerAddOn only at slot2 and exposes the independent reactor tree at slot15', () => {
    const input = managerTag(), model = ManagerContainer.fromTag(input), before = writeTo(input);
    assert.equal(model.powerState.initialPower, 100); assert.equal(model.powerState.initialBatteryPower, 20);
    assert.equal(model.powerReactor.toTag().getStruct()[1].getLong(), -1n);
    assert.equal(model.pullPermission, 7); same(model.toTag(), input);
    const edited = model.withPower(model.powerState.withPower(300));
    const out = edited.toTag().getStruct(); assert.equal(out[2].getStruct()[0].getDouble(), 300); assert.equal(out[2].name, 'power-old');
    assert.equal(out[2].getStruct()[2].getString(), 'keep'); same(out[15], input.getStruct()[15]); assert.equal(model.powerState.initialPower, 100);
    assert.equal(edited.getField('powerAddOn')!.withValue(new PowerState(400, 9)).powerState.initialPower, 400);
    const next = reactor(); next.getStruct()[1] = Tags.long('selected', 99n);
    const changedReactor = model.withPowerReactor(new EntSlotObject('PowerInterface', next));
    assert.equal(changedReactor.powerReactor.toTag().getStruct()[1].getLong(), 99n); same(changedReactor.toTag().getStruct()[2], input.getStruct()[2]);
    assert.equal(model.getField('powerReactor')!.withValue(new EntSlotObject('PowerInterface', next)).powerReactor.toTag().getStruct()[1].getLong(), 99n);
    const snapshot = model.powerReactor.toTag(); snapshot.getStruct()[1] = Tags.long(null, 777n);
    input.getStruct()[2] = Tags.byte(null, 0); assert.deepEqual(writeTo(model.toTag()), before); assert.ok(Object.isFrozen(model));
    assert.throws(() => model.withPowerReactor(new PowerState(1, 2) as any));
    code(() => model.withPowerReactor(new EntSlotObject('wrong', Tags.double(null, 1))), 'E_FORMAT');
    assert.equal(model.withPowerReactor(new EntSlotObject('absent', Tags.nothing(null))).powerReactor.present, false);
  });

  it('keeps modern shields opaque and rejects silent scalar replacement', () => {
    const input = managerTag({ 3: shields() }), model = ManagerContainer.fromTag(input);
    same(model.toTag(), input); assert.equal(model.initialShields, 0); same(model.shieldAddOn.toTag(), input.getStruct()[3]);
    code(() => model.withInitialShields(5), 'E_UNSUPPORTED'); code(() => model.getField('shieldAddOn')!.withValue(0), 'E_UNSUPPORTED');
    const update = Tags.struct(null, [Tags.byte(null, 1), Tags.struct(null, [])]);
    const edited = model.withShieldAddOn(new EntSlotObject('shield', update));
    assert.equal(edited.shieldAddOn.toTag().getStruct()[0].getByte(), 1); assert.equal(edited.shieldAddOn.tagName, 'shield-local');
    same(model.getField('shieldAddOn')!.withValue(model.shieldAddOn).toTag(), model.toTag());
    code(() => model.withShieldAddOn(new EntSlotObject('scalar', Tags.double(null, 1))), 'E_FORMAT');
    const scalar = ManagerContainer.fromTag(managerTag({ 2: Tags.double('legacy-power', 8), 3: Tags.double('legacy-shield', 9) }));
    assert.equal(scalar.powerState.legacy, true); assert.equal(scalar.withPower(scalar.powerState.withPower(12)).toTag().getStruct()[2].type, TagType.DOUBLE);
    const changed = scalar.withInitialShields(-Infinity); assert.equal(changed.initialShields, -Infinity); assert.equal(changed.toTag().getStruct()[3].name, 'legacy-shield');
    assert.equal(ManagerContainer.fromTag(managerTag({ 2: Tags.byte(null, 0), 3: Tags.byte(null, 0), 16: Tags.nothing(null) })).pullPermission, PullPermission.ALL);
    code(() => new ManagerContainer(new Map(), 5, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, PullPermission.ALL, input.getStruct().slice(0, -1)), 'E_FORMAT');
  });

  it('validates construction, inventory coherence and every typed optional shape without partial fallback', () => {
    const base = ManagerContainer.EMPTY;
    assert.throws(() => new ManagerContainer(new Map(), 'x' as any, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, PullPermission.ALL, []));
    assert.throws(() => new ManagerContainer(new Map(), 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, 128, []));
    assert.throws(() => new ManagerContainer(new Map(), 0, {} as any, TextBlocks.EMPTY, SlotAssignment.EMPTY, 0, []));
    assert.throws(() => base.withTexts({} as any)); assert.throws(() => base.withSlotAssignment({} as any)); assert.throws(() => base.withPower({} as any));
    assert.throws(() => base.withInventoryAt({ x: 0, y: 0, z: 0 }, {} as any)); assert.throws(() => base.withInventory(0, {} as any));
    assert.throws(() => base.getInventory(-1)); assert.throws(() => base.withPullPermission(128)); assert.throws(() => base.withPullPermission(-129)); assert.throws(() => base.withPullPermission(0.5)); assert.throws(() => base.withInitialShields('x' as any)); assert.throws(() => ManagerContainer.fromTag(Tags.byte(null, 0)));
    for (const index of [2, 3, 6, 11, 16]) code(() => ManagerContainer.fromTag(managerTag({ [index]: Tags.string(null, 'wrong') })), 'E_FORMAT');
    for (const tag of [Tags.byte(null, 1), Tags.struct(null, []), Tags.struct(null, [Tags.short(null, 1)])]) {
      code(() => ManagerContainer.fromTag(managerTag({ 7: Tags.struct(null, [tag]) })), 'E_FORMAT');
    }
    code(() => ManagerContainer.fromTag(managerTag({ 0: Tags.byte(null, 0) })), 'E_FORMAT');
    const row = Tags.struct(null, [Tags.int(null, 3), Tags.vector3i(null, 1, 2, 3), Inventory.EMPTY.add(5, 1).toTag()]);
    const children = managerTag({ 0: Tags.struct(null, [row]) }).getStruct().slice(0, -1);
    for (const map of [new Map([[3, Inventory.EMPTY]]), new Map([[4, Inventory.EMPTY]])]) {
      code(() => new ManagerContainer(map, 40, new PowerState(100, 20), TextBlocks.EMPTY, SlotAssignment.EMPTY, 7, children), 'E_FORMAT');
    }
    code(() => new ManagerContainer(new Map([[3, Inventory.EMPTY]]), 0, PowerState.EMPTY, TextBlocks.EMPTY, SlotAssignment.EMPTY, 0, [Tags.nothing(null)]), 'E_INCOMPLETE');
    const counts = ManagerContainer.fromTag(managerTag()).relevantElementCountMap!; assert.equal(counts.getCount(-5), -1); assert.equal(counts.totalBlocks, -1);
    assert.equal(base.mainInventory.size, 0); assert.equal(base.capsuleInventory.size, 0); assert.equal(base.microInventory.size, 0); assert.equal(base.macroInventory.size, 0);
    assert.match(base.toString(), /ManagerContainer/); assert.equal(base.getField('missing'), null);
    assert.equal(base.powerReactor.present, false); assert.equal(base.shieldAddOn.present, false);
  });

  it('retains names, extensions and typed views across all modeled edits', () => {
    const model = ManagerContainer.fromTag(managerTag()), before = writeTo(model.toTag());
    const objects = { warpGateInfo: new WarpGateInfo(), modules: new ManagerModulesState(), aiConfiguration: new AiConfigurationState(),
      raceGateInfo: new RaceGateInfo(), unloadedDummies: new UnloadedDummiesState(), moduleExplosions: new ModuleExplosionsState(), modData: new ModDataState() };
    for (const [key, value] of Object.entries(objects)) {
      const edited = model.getField(key)!.withValue(value);
      assert.ok((edited as any)[key] instanceof value.constructor);
      assert.throws(() => model.getField(key)!.withValue({}));
      const detached = (edited as any)[key].toTag(); if (detached.type === TagType.STRUCT) detached.getStruct().length = 0;
      assert.doesNotThrow(() => edited.toTag());
    }
    const texts = model.texts.set(9007199254740993n, 'persist');
    assert.equal(model.withTexts(texts).texts.get(9007199254740993n), 'persist');
    const slots = model.slotAssignment.assign(2, 9007199254740993n); assert.equal(model.withSlotAssignment(slots).slotAssignment.slots.get(2), 9007199254740993n);
    assert.equal(model.getField('texts')!.withValue(texts).texts.size, 1);
    assert.equal(model.getField('slotAssignment')!.withValue(slots).slotAssignment.slots.size, 1);
    assert.equal(model.getField('pullPermission')!.withValue(1).pullPermission, 1);
    assert.equal(model.getField('shieldAddOn')!.withValue(7).initialShields, 7);
    assert.throws(() => model.getField('texts')!.withValue({})); assert.throws(() => model.getField('powerAddOn')!.withValue({}));
    assert.throws(() => model.getField('powerReactor')!.withValue({}));
    assert.deepEqual(writeTo(model.toTag()), before);
    assert.equal(ManagerContainer.EMPTY.withModData(new ModDataState()).modData.kind, new ModDataState().kind);
  });

  it('retains high custom depth and charges shared parsing budgets only for the external read', () => {
    let deep = Tags.long('leaf', 9007199254740993n); for (let i = 0; i < 70; i++) deep = Tags.struct(null, [deep]);
    const root = managerTag({ 15: deep, 8: deep, 18: deep });
    const raw = writeTo(root, { maxDepth: 80 }), gzip = gzipSync(raw.subarray(2));
    const sharedNodeBudget = { remainingNodes: 2000 }, sharedInflationBudget = { remainingBytes: raw.length - 2 };
    const options = { maxDepth: 80, maxInputBytes: gzip.length, maxInflatedBytes: raw.length + 100, sharedNodeBudget, sharedInflationBudget };
    const tag = readFrom(gzip, options), remaining = sharedNodeBudget.remainingNodes;
    const model = ManagerContainer.fromTag(tag, options); options.maxDepth = 1;
    assert.equal(sharedInflationBudget.remainingBytes, 0); assert.equal(sharedNodeBudget.remainingNodes, remaining);
    assert.doesNotThrow(() => model.powerReactor.toTag()); assert.doesNotThrow(() => model.warpGateInfo.toTag());
    const edited = model.withPullPermission(3).withPower(new PowerState(200, 9));
    same(edited.powerReactor.toTag(), model.powerReactor.toTag()); assert.equal(edited.pullPermission, 3);
    assert.equal(sharedNodeBudget.remainingNodes, remaining); assert.equal(sharedInflationBudget.remainingBytes, 0);
    code(() => ManagerContainer.fromTag(root), 'E_LIMIT'); code(() => ManagerContainer.fromTag(managerTag(), { maxNodes: 1 }), 'E_LIMIT');
    const limited = ManagerContainer.fromTag(managerTag(), { maxInflatedBytes: writeTo(managerTag()).length });
    code(() => limited.withTexts(TextBlocks.EMPTY.set(1n, 'x'.repeat(1000))), 'E_LIMIT');
    assert.equal(limited.texts.size, 0);
    const emptyLimited = ManagerContainer.fromTag(managerTag(), { maxNodes: 100 });
    code(() => emptyLimited.getInventory(99).set(ItemStack.special(1, { id: 1, type: -5, subId: 0, payload: deep }, { maxDepth: 80 })), 'E_LIMIT');
  });
});
