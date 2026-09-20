import { assert } from 'chai';
import { FleetRemotesObject } from '../../src/db/FleetRemotesObject.js';
import { encodeFleetRemotes } from '../../src/db/FleetDb.js';

describe('FleetRemotesObject integrity', () => {
  it('detaches remotes and recovery diagnostics and serializes meaningful JSON', () => {
    const remotes = FleetRemotesObject.from({ door: true });
    (remotes.remotes as Map<string, boolean>).set('door', false);
    assert.isTrue(remotes.isActive('door'));
    assert.deepEqual(JSON.parse(JSON.stringify(remotes)).remotes, { door: true });
    const recovered = FleetRemotesObject.fromBytes(Buffer.from([1]), { mode: 'recover' });
    recovered.raw![0] = 0;
    assert.deepEqual(recovered.raw, Buffer.from([1]));
    const diagnostic = recovered.diagnostics[0];
    diagnostic.message = 'changed';
    assert.notEqual(recovered.diagnostics[0].message, 'changed');
  });
  it('validates new remote states immediately', () => {
    assert.throws(() => FleetRemotesObject.from({ bad: 1 } as any));
    const original = FleetRemotesObject.empty();
    assert.throws(() => original.withRemote('bad', 1 as any));
    assert.throws(() => original.withRemote(5 as any, true));
    assert.equal(original.size, 0);
  });
  it('retains network/Java formats, special names and every recovery field', () => {
    const record = Object.fromEntries([['__proto__', true], ['', false], ['nul\0🚀', true]]);
    const model = FleetRemotesObject.from(record);
    record['nul\0🚀'] = false;
    for (const format of ['network', 'java'] as const) {
      const bytes = encodeFleetRemotes(new Map(Object.entries(model.toJSON().remotes)), format);
      const parsed = FleetRemotesObject.fromBytes(bytes);
      const edited = parsed.withToggle('').withoutRemote('__proto__');
      assert.equal(edited.format, format);
      assert.isTrue(edited.isActive(''));
      assert.isTrue(edited.isActive('nul\0🚀'));
      assert.isFalse(edited.has('__proto__'));
      assert.deepEqual(FleetRemotesObject.fromBytes(edited.toBytes()).remotes, edited.remotes);
    }
    const json = model.toJSON(); json.remotes['nul\0🚀'] = false;
    assert.isTrue(model.isActive('nul\0🚀'));
    assert.isUndefined(model.raw);
    assert.throws(() => model.withoutRemote(1 as any), TypeError);
    const input = Buffer.from([1]);
    const recovered = FleetRemotesObject.fromBytes(input, { mode: 'recover' });
    input[0] = 0;
    assert.deepEqual(recovered.toJSON().raw, [1]);
    assert.equal(recovered.toJSON().diagnostics[0].code, 'E_FORMAT');
    const projection = recovered.toJSON(); projection.raw![0] = 0; projection.diagnostics[0].message = 'changed';
    assert.deepEqual(recovered.raw, Buffer.from([1]));
    assert.notEqual(recovered.diagnostics[0].message, 'changed');
    for (const operation of [() => recovered.toBytes(), () => recovered.withRemote('x', true),
      () => recovered.withToggle('x'), () => recovered.withoutRemote('x')]) assert.throws(operation, /incomplete/);
    assert.throws(() => { (recovered as any).complete = true; }, TypeError);
  });

  it('bounds remote count and modified UTF length before returning a new model', () => {
    const model = FleetRemotesObject.empty();
    const maximumKey = 'x'.repeat(65535);
    assert.isTrue(FleetRemotesObject.fromBytes(model.withRemote(maximumKey, true).toBytes()).isActive(maximumKey));
    assert.throws(() => model.withRemote(maximumKey + 'x', true));
    assert.throws(() => FleetRemotesObject.from(Object.fromEntries(Array.from({ length: 32768 }, (_, i) => [`key${i}`, true]))));
    assert.equal(model.size, 0);
  });
});
