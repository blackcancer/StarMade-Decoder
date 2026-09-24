/** @fileoverview Native inventory meta-object summaries against StarMade-Open Tag layouts. */
import fs from 'node:fs';
import { strict as assert } from 'node:assert';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { writeTo } from '../../../src/core/TagParser.js';
import { ItemStack } from '../../../src/objects/components/Inventory.js';
import { describeMetaObject } from '../../../src/objects/components/MetaObjectDetails.js';
import { PlayerStateEntity } from '../../../src/objects/entities/PlayerStateEntity.js';

const color = () => Tags.vector4f(null, 0.25, 0.5, 0.75, 1);
const weapon = (subtype: number, parts: Tag[]) => special(-32, Tags.struct(null, parts), subtype);
const special = (type: number, payload: Tag, subId = -1, id = 900719): ItemStack =>
  ItemStack.special(3, { type, id, subId, payload });
const snapshot = (item: ItemStack): Buffer => writeTo(item.meta!.payload!);

describe('MetaObjectDetails — StarMade-Open native inventory objects', () => {
  it('decodes every weapon subtype with exact game-specific field types and icon indices', () => {
    const marker = -(1n << 63n);
    const layouts: Array<[number, Tag[], Record<string, unknown>]> = [
      [1, [Tags.int(null, -2147483648), Tags.float(null, 12.5), Tags.int(null, 0), color()],
        { damage: -2147483648, projectileSpeed: 12.5, reloadMs: 0, colorRgba: [0.25, 0.5, 0.75, 1] }],
      [2, [Tags.int(null, 35), Tags.float(null, 4), Tags.int(null, 100), color()],
        { healingPower: 35, projectileSpeed: 4, reloadMs: 100, colorRgba: [0.25, 0.5, 0.75, 1] }],
      [3, [Tags.int(null, 99), Tags.float(null, 5), Tags.int(null, 200), color()],
        { supplyPower: 99, projectileSpeed: 5, reloadMs: 200, colorRgba: [0.25, 0.5, 0.75, 1] }],
      [4, [Tags.string(null, 'mark'), Tags.string(null, 'Base'), Tags.long(null, marker)],
        { marking: 'mark', markerName: 'Base', markerLocation: marker.toString() }],
      [5, [Tags.int(null, 80), Tags.float(null, 20), Tags.int(null, 500), color(), Tags.float(null, 7), Tags.float(null, 120)],
        { damage: 80, projectileSpeed: 20, reloadMs: 500, colorRgba: [0.25, 0.5, 0.75, 1], radius: 7, range: 120 }],
      [6, [Tags.int(null, 180), Tags.float(null, 100), Tags.float(null, 650.5), color(), Tags.float(null, 2000)],
        { damage: 180, projectileSpeed: 100, reloadMs: 650.5, colorRgba: [0.25, 0.5, 0.75, 1], range: 2000 }],
      [7, [Tags.float(null, 123.5), color(), Tags.float(null, 300)],
        { reloadMs: 123.5, colorRgba: [0.25, 0.5, 0.75, 1], range: 300 }],
      [8, [Tags.int(null, 75), Tags.float(null, 18.5), color(), Tags.float(null, 3)],
        { damage: 75, reloadMs: 18.5, colorRgba: [0.25, 0.5, 0.75, 1], range: 3 }],
      [9, [Tags.string(null, 'transport'), Tags.string(null, 'Port'), Tags.long(null, 9223372036854775807n), Tags.float(null, 2.5)],
        { marking: 'transport', markerName: 'Port', markerLocation: '9223372036854775807', chargePerSecond: 2.5 }],
    ];
    for (const [subtype, parts, expected] of layouts) {
      const item = weapon(subtype, parts), before = snapshot(item);
      const result = describeMetaObject(item)!;
      assert.equal(result.status, 'ready', String(subtype));
      assert.equal(result.category, 'weapon'); assert.equal(result.typeId, -32);
      assert.equal(result.subtype, subtype); assert.equal(result.instanceId, 900719);
      assert.equal(result.iconIndex, 31 + subtype); assert.deepEqual(result.properties, expected);
      assert.deepEqual(result.invalidFields, []);
      assert.deepEqual(snapshot(item), before);
      assert.deepEqual(Buffer.from(item.toJSON().meta!.payloadTagBase64!, 'base64'), before);
    }
  });

  it('decodes the other native type families and bounded binary sizes', () => {
    const cases: Array<[number, Tag, string, Record<string, unknown>]> = [
      [-9, Tags.struct(null, [Tags.byteArray(null, [1, 2]), Tags.byteArray(null, [3]), Tags.string(null, 'Ship')]),
        'blueprint', { blueprintGoalBytes: 2, blueprintProgressBytes: 1, blueprintName: 'Ship' }],
      [-11, Tags.string(null, 'Journal 🚀'), 'logbook', { text: 'Journal 🚀' }],
      [-12, Tags.byte(null, -128), 'helmet', { model: -128 }],
      [-13, Tags.struct(null, [Tags.float(null, 0), Tags.byte(null, 2)]), 'build-prohibiter', { radius: 0, active: true }],
      [-14, Tags.struct(null, [color(), Tags.byte(null, 0)]), 'flashlight',
        { colorRgba: [0.25, 0.5, 0.75, 1], active: false }],
      [-15, Tags.struct(null, [Tags.string(null, 'UID'), Tags.string(null, 'Virtual')]),
        'virtual-blueprint', { blueprintUid: 'UID', blueprintName: 'Virtual' }],
      [-16, Tags.struct(null, [Tags.byteArray(null, new Uint8Array(8192))]),
        'block-storage', { storageBytes: 8192 }],
    ];
    for (const [type, tag, category, expected] of cases) {
      const result = describeMetaObject(special(type, tag))!;
      assert.equal(result.status, 'ready'); assert.equal(result.category, category);
      assert.equal(result.iconIndex, -type); assert.deepEqual(result.properties, expected);
    }
  });

  it('summarizes versioned recipes without interpreting nested product bytes', () => {
    for (const [version, produced, extra, expected] of [
      ['v0', Tags.int(null, 0), [], { recipeVersion: 'v0', recipeProductCount: 1, producedGoods: '0' }],
      ['v1', Tags.long(null, 9223372036854775807n), [Tags.long(null, -1n)],
        { recipeVersion: 'v1', recipeProductCount: 1, producedGoods: '9223372036854775807', fixedPrice: '-1' }],
      ['v2', Tags.long(null, 4n), [Tags.long(null, 500n), Tags.byte(null, 127)],
        { recipeVersion: 'v2', recipeProductCount: 1, producedGoods: '4', fixedPrice: '500', maxLevel: 127 }],
    ] as const) {
      const product = Tags.struct(null, [Tags.struct(null, [Tags.int(null, 7)])]);
      const result = describeMetaObject(special(-10, Tags.struct(version, [product, produced, ...extra])))!;
      assert.equal(result.status, 'ready'); assert.equal(result.category, 'recipe');
      assert.deepEqual(result.properties, expected); assert.deepEqual(result.invalidFields, []);
    }
  });

  it('separates ordinary, absent, unknown and invalid payloads without fabricating fields', () => {
    assert.equal(describeMetaObject(new ItemStack(1, 5, 3)), null);
    assert.equal(describeMetaObject(ItemStack.grouped(1, 'group', [{ type: 5, count: 1 }, { type: 6, count: 2 }])), null);
    const absent = describeMetaObject(new ItemStack(1, -12, 1))!;
    assert.equal(absent.status, 'absent'); assert.equal(absent.category, 'helmet');
    assert.equal(absent.iconIndex, 12); assert.equal(absent.instanceId, null);
    assert.deepEqual(absent.properties, {});
    const absentPayload = describeMetaObject(new ItemStack(1, -11, 1,
      { id: 4, type: -11, subId: -1, orientation: 0 }))!;
    assert.equal(absentPayload.status, 'absent'); assert.equal(absentPayload.instanceId, 4);
    const mod = special(-501, Tags.struct(null, [Tags.int(null, 8)]), 77);
    const modBefore = snapshot(mod), unknown = describeMetaObject(mod)!;
    assert.equal(unknown.category, 'unknown'); assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.iconIndex, null); assert.deepEqual(unknown.properties, {});
    assert.deepEqual(snapshot(mod), modBefore);
    const variant = describeMetaObject(weapon(77, [Tags.int(null, 8)]))!;
    assert.equal(variant.category, 'weapon'); assert.equal(variant.status, 'unknown');
    assert.equal(variant.iconIndex, null);
    const missing = describeMetaObject(weapon(1, [Tags.int(null, 8)]))!;
    assert.equal(missing.status, 'invalid'); assert.deepEqual(missing.properties, { damage: 8 });
    assert.deepEqual(missing.invalidFields, ['projectileSpeed', 'reloadMs', 'colorRgba']);
    const malformed = describeMetaObject(weapon(1, [Tags.string(null, '8'), Tags.float(null, 1), Tags.int(null, 2), color()]))!;
    assert.equal(malformed.status, 'invalid'); assert.deepEqual(malformed.invalidFields, ['damage']);
    assert.deepEqual(malformed.properties, { projectileSpeed: 1, reloadMs: 2, colorRgba: [0.25, 0.5, 0.75, 1] });
    const wrongRoot = describeMetaObject(special(-9, Tags.byte(null, 1)))!;
    assert.equal(wrongRoot.status, 'invalid'); assert.deepEqual(wrongRoot.invalidFields, ['$root']);
    const wrongFields = describeMetaObject(special(-14, Tags.struct(null,
      [Tags.int(null, 1), Tags.string(null, 'on')])))!;
    assert.deepEqual(wrongFields.invalidFields, ['colorRgba', 'active']);
    const wrongBinary = describeMetaObject(special(-16, Tags.struct(null, [Tags.string(null, 'bytes')])))!;
    assert.deepEqual(wrongBinary.invalidFields, ['storageBytes']);
  });

  it('rejects oversized logbook text and non-finite fields while retaining the original Tag', () => {
    const edge = special(-11, Tags.string(null, 'x'.repeat(1025)));
    const before = snapshot(edge), result = describeMetaObject(edge)!;
    assert.equal(result.status, 'invalid'); assert.deepEqual(result.invalidFields, ['text']);
    assert.deepEqual(result.properties, {}); assert.deepEqual(snapshot(edge), before);
    assert.equal(describeMetaObject(special(-11, Tags.string(null, 'x'.repeat(1024))))!.status, 'ready');
    const longName = describeMetaObject(special(-15, Tags.struct(null,
      [Tags.string(null, 'uid'), Tags.string(null, 'n'.repeat(4097))])))!;
    assert.equal(longName.status, 'invalid'); assert.deepEqual(longName.invalidFields, ['blueprintName']);
    assert.deepEqual(longName.properties, { blueprintUid: 'uid' });
    const badFloat = describeMetaObject(weapon(6,
      [Tags.int(null, 1), Tags.float(null, Infinity), Tags.float(null, 0), color(), Tags.float(null, 1)]))!;
    assert.equal(badFloat.status, 'invalid'); assert.deepEqual(badFloat.invalidFields, ['projectileSpeed']);
    const badColor = describeMetaObject(special(-14, Tags.struct(null,
      [Tags.vector4f(null, 0, NaN, 0, 1), Tags.byte(null, 1)])))!;
    assert.equal(badColor.status, 'invalid'); assert.deepEqual(badColor.invalidFields, ['colorRgba']);
    assert.deepEqual(badColor.properties, { active: true });
  });

  it('reports partial or incompatible recipe layouts without claiming their contents', () => {
    for (const tag of [Tags.byte(null, 1),
      Tags.struct('v2', [Tags.string(null, 'wrong'), Tags.byte(null, 1), Tags.int(null, 4), Tags.int(null, 2)])]) {
      const result = describeMetaObject(special(-10, tag))!;
      assert.equal(result.status, 'invalid'); assert.ok(result.invalidFields.length);
    }
    for (const tag of [Tags.struct(null, []), Tags.struct('v3', [])]) {
      const result = describeMetaObject(special(-10, tag))!;
      assert.equal(result.status, 'unknown'); assert.deepEqual(result.properties, {});
    }
    const partial = describeMetaObject(special(-10, Tags.struct('v2', [Tags.struct(null, []), Tags.int(null, 4)])))!;
    assert.deepEqual(partial.properties, { recipeVersion: 'v2', recipeProductCount: 0, producedGoods: '4' });
    assert.deepEqual(partial.invalidFields, ['fixedPrice', 'maxLevel']);
  });

  it('projects real InitSysRev inventory objects and leaves the full entity byte-identical', () => {
    const bytes = fs.readFileSync('samples/ENTITY_PLAYERSTATE_InitSysRev.ent');
    const player = PlayerStateEntity.fromBuffer(bytes);
    const categories = new Set<string>(), subtypes = new Set<number>();
    for (const item of player.inventory.items.filter(stack => stack.type < 0)) {
      const original = snapshot(item), result = describeMetaObject(item)!;
      assert.equal(result.status, 'ready', `${item.type}/${item.meta?.subId}`);
      categories.add(result.category);
      if (result.category === 'weapon') subtypes.add(result.subtype!);
      assert.deepEqual(snapshot(item), original);
    }
    assert.deepEqual([...subtypes].sort(), [1, 2, 3, 4]);
    assert.deepEqual([...categories].sort(), ['blueprint', 'flashlight', 'helmet', 'logbook', 'weapon']);
    assert.deepEqual(player.toBuffer(), bytes);
  });
});
