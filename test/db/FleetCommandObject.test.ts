import { assert } from 'chai';
import { FleetCommandObject } from '../../src/db/FleetCommandObject.js';
import { type CommandArg, encodeFleetCommand } from '../../src/db/FleetDb.js';

describe('FleetCommandObject integrity', () => {
  it('detaches nested structs and bytes at every public boundary', () => {
    const bytes = new Uint8Array([1, 2]);
    const args: CommandArg[] = [{ kind: 'struct', value: [{ kind: 'bytes', value: bytes }, { kind: 'long', value: 9007199254740993n }] }];
    const command = FleetCommandObject.create(-1n, 'IDLE', args);
    const expected = command.toBytes(0);
    bytes[0] = 99;
    (args[0] as any).value.push({ kind: 'int', value: 1 });
    const exposed = command.args as CommandArg[];
    (exposed[0] as any).value[0].value[1] = 98;
    exposed.push({ kind: 'int', value: 2 });
    assert.deepEqual(command.toBytes(0), expected);
    const json = JSON.parse(JSON.stringify(command));
    assert.equal(json.fleetDbId, '-1');
    assert.equal(json.args[0].value[1].value, '9007199254740993');
    assert.deepEqual(json.args[0].value[0].value, [1, 2]);
  });
  it('rejects unrepresentable edits before changing the original', () => {
    const command = FleetCommandObject.create(1n, 'IDLE');
    const bytes = command.toBytes();
    assert.throws(() => command.withFleetDbId(1n << 63n));
    assert.throws(() => command.withArgs([{ kind: 'boolean', value: 1 } as any]));
    assert.throws(() => command.withArgs([{ kind: 'float', value: '1' } as any]));
    assert.throws(() => command.withArgs([{ kind: 'float', value: 1e100 }]));
    assert.deepEqual(command.toBytes(), bytes);
  });
  it('round-trips every wire argument and preserves unknown commands', () => {
    const args: CommandArg[] = [
      { kind: 'int', value: -2147483648 }, { kind: 'int', value: 2147483647 },
      { kind: 'long', value: -(1n << 63n) }, { kind: 'long', value: (1n << 63n) - 1n },
      { kind: 'short', value: -32768 }, { kind: 'short', value: 32767 },
      { kind: 'byte', value: -128 }, { kind: 'byte', value: 127 },
      { kind: 'float', value: 1.25 }, { kind: 'string', value: 'nul\0🚀' },
      { kind: 'boolean', value: false }, { kind: 'bytes', value: new Uint8Array([0, 255]) },
      { kind: 'struct', value: [] }, { kind: 'vec3i', x: -1, y: 0, z: 1 },
      { kind: 'vec3f', x: 1.5, y: -2.25, z: -0 },
      { kind: 'vec4f', x: Infinity, y: -Infinity, z: NaN, w: 0.5 },
    ];
    const command = FleetCommandObject.create(9223372036854775807n, 'PATROL_FLEET', args);
    assert.deepEqual(FleetCommandObject.fromBytes(new Uint8Array(command.toBytes(0)))!.args, args);
    const vector = command.firstVec3iArg!; vector.x = 99;
    assert.equal(command.firstVec3iArg!.x, -1);
    const json = JSON.parse(JSON.stringify(command));
    assert.deepEqual(json.args[15], { kind: 'vec4f', x: 'Infinity', y: '-Infinity', z: 'NaN', w: 0.5 });
    const unknownWire = encodeFleetCommand({ fleetDbId: -1n, commandOrdinal: -2147483648, commandType: undefined, args }, 0);
    const unknown = FleetCommandObject.fromBytes(unknownWire)!;
    assert.deepEqual(unknown.withFleetDbId(-1n).toBytes(0), unknownWire);
    assert.equal(unknown.toJSON().commandOrdinal, -2147483648);
    const jsonCopy = command.toJSON(); (jsonCopy.args[0] as any).value = 8;
    assert.equal((command.args[0] as any).value, -2147483648);
    assert.throws(() => { (command as any).fleetDbId = 7n; }, TypeError);
  });

  it('enforces integer widths, argument counts, nesting, byte types and modified UTF lengths', () => {
    const invalid: CommandArg[] = [
      { kind: 'int', value: 2147483648 }, { kind: 'int', value: 0.5 },
      { kind: 'long', value: -(1n << 63n) - 1n },
      { kind: 'short', value: -32769 }, { kind: 'byte', value: 128 },
      { kind: 'bytes', value: [1, 2] } as any,
      { kind: 'string', value: '\0'.repeat(32768) },
      { kind: 'vec3i', x: 0, y: NaN, z: 0 },
      { kind: 'vec3f', x: 0, y: '1', z: 0 } as any,
      { kind: 'vec4f', x: 0, y: 0, z: 0, w: 1e100 },
      { kind: 'struct', value: [{ kind: 'boolean', value: null } as any] },
      { kind: 'unknown' } as any,
    ];
    const original = FleetCommandObject.create(0n, 'IDLE');
    for (const arg of invalid) {
      assert.throws(() => FleetCommandObject.create(0n, 'IDLE', [arg]));
      assert.throws(() => original.withCommand('MOVE_FLEET', [arg]));
      assert.throws(() => original.withArgs([arg]));
    }
    assert.throws(() => FleetCommandObject.create(1 as any, 'IDLE'));
    assert.throws(() => original.withArgs(Array(256).fill({ kind: 'int', value: 0 })));
    assert.lengthOf(original.withArgs(Array(255).fill({ kind: 'boolean', value: false })).args, 255);
    let nested: CommandArg[] = [];
    for (let i = 0; i < 65; i++) nested = [{ kind: 'struct', value: nested }];
    assert.throws(() => original.withArgs(nested));
    const cycle: CommandArg[] = []; cycle.push({ kind: 'struct', value: cycle });
    assert.throws(() => original.withArgs(cycle));
    assert.throws(() => original.toBytes(-1));
    assert.deepEqual(original.args, []);
  });
});
