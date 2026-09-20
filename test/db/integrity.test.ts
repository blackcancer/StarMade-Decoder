/** @fileoverview Audit A07/A08: database corruption must not become valid empty data. */
import { assert } from 'chai';
import { deflateRawSync } from 'node:zlib';
import { decodeFleetCommand, decodeFleetRemotes, encodeFleetCommand, encodeFleetRemotes } from '../../src/db/FleetDb.js';
import { FleetRemotesObject } from '../../src/db/FleetRemotesObject.js';
import { decodeSystemInfos, decodeSystemResources } from '../../src/db/SystemDb.js';
import { decodeSectorItems, encodeSectorItems, MAX_ITEMS_PER_SECTOR } from '../../src/db/SectorItems.js';
import { decodeTradeNodeItems } from '../../src/db/TradeNodeItems.js';
import { MAX_DATABASE_BYTES } from '../../src/db/DatabaseValidation.js';
import type { CommandArg } from '../../src/db/FleetDb.js';

// Produced independently by JDK ObjectOutputStream.writeObject(HashMap<String,Boolean>).
const javaRemotes = Buffer.from('aced0005737200116a6176612e7574696c2e486173684d61700507dac1c31660d103000246000a6c6f6164466163746f724900097468726573686f6c6478703f4000000000000c7708000000100000000674000a736c6173682f6e616d65737200116a6176612e6c616e672e426f6f6c65616ecd207280d59cfaee0200015a000576616c7565787000740005616c7068617371007e000301740008646f742e6e616d6571007e0006740008c080eda0bdedba8071007e000674000576616c756571007e00067400046265746171007e000478', 'hex');
const states = new Map([['slash/name', false], ['alpha', true], ['dot.name', true], ['\u0000🚀', true], ['value', true], ['beta', false]]);

describe('Audit database integrity', () => {
  it('bounds command recursion and aggregate arguments in both directions', () => {
    const base = { fleetDbId: 1n, commandOrdinal: 0, commandType: 'IDLE' as const, args: [] as CommandArg[] };
    let args: CommandArg[] = [];
    for (let i = 0; i < 66; i++) args = [{ kind: 'struct', value: args }];
    assert.throws(() => encodeFleetCommand({ ...base, args }, 0), /nesting budget/);
    assert.throws(() => decodeFleetCommand(Buffer.concat([Buffer.alloc(12), Buffer.from(Array(66).fill([1, 9]).flat()), Buffer.from([0])])), /nesting budget/);
    const leaf: CommandArg = { kind: 'byte', value: 0 };
    const groups: CommandArg[] = Array.from({ length: 255 }, () => ({ kind: 'struct', value: Array(255).fill(leaf) }));
    const overBudget: CommandArg[] = [{ kind: 'struct', value: groups }, { kind: 'struct', value: Array(255).fill(leaf) }];
    assert.throws(() => encodeFleetCommand({ ...base, args: overBudget }, 0), /argument budget/);
    // Independent nested wire: 255 groups of 255 BYTE args plus one additional group.
    const group = Buffer.concat([Buffer.from([255]), Buffer.from(Array(255).fill([6, 0]).flat())]);
    const body = Buffer.concat([Buffer.from([2, 9, 255]), ...Array.from({length: 255}, () => Buffer.concat([Buffer.from([9]), group])), Buffer.from([9]), group]);
    assert.throws(() => decodeFleetCommand(Buffer.concat([Buffer.alloc(12), body])), /argument budget/);
    assert.throws(() => encodeFleetCommand({ ...base, args: [{kind: 'unknown'} as any] }), /Unknown/);
  });
  it('validates remotes options, types, flags and immutable recovery snapshots', () => {
    assert.throws(() => decodeFleetRemotes(null, {mode: 'wrong' as any}), /mode/);
    assert.throws(() => encodeFleetRemotes(new Map(), 'wrong' as any), /format/);
    for (const format of ['java', 'network'] as const) {
      assert.throws(() => encodeFleetRemotes(new Map([[1, true]]) as any, format), /string\/boolean/);
      assert.throws(() => encodeFleetRemotes(new Map([['key', 1]]) as any, format), /string\/boolean/);
    }
    assert.throws(() => decodeFleetRemotes(Buffer.from([2])), /presence/);
    assert.throws(() => decodeFleetRemotes(Buffer.from([1, 0, 1, 0, 0, 2])), /boolean/);
    const invalid = Buffer.from([1]);
    const recovered = decodeFleetRemotes(invalid, {mode: 'recover'}); invalid[0] = 0;
    assert.equal(recovered.raw![0], 1);
    assert.equal(recovered.diagnostics[0].path, 'FLEETS.SAVED_REMOTES');
    const oversized = Buffer.alloc(MAX_DATABASE_BYTES + 1);
    assert.throws(() => decodeFleetRemotes(oversized, {mode: 'recover'}), /budget/);
  });
  it('rejects corrupt Java metadata, class schemas, tokens, handles and end markers', () => {
    const mutation = (offset: number, bytes: Buffer): Buffer => { const value = Buffer.from(javaRemotes); bytes.copy(value, offset); return value; };
    const position = (hex: string): number => { const at = javaRemotes.indexOf(Buffer.from(hex, 'hex')); assert.isAtLeast(at, 0); return at; };
    const int = (value: number): Buffer => { const b=Buffer.alloc(4); b.writeInt32BE(value); return b; };
    const float = (value: number): Buffer => { const b=Buffer.alloc(4); b.writeFloatBE(value); return b; };
    const block = position('77080000001000000006');
    const boolValue = position('5a000576616c7565787000') + 10;
    const descriptorReference = position('7371007e0003') + 1;
    const booleanReference = position('71007e0006');
    for (const bad of [
      mutation(3, Buffer.from([4])), mutation(4, Buffer.from([0x70])), mutation(5, Buffer.from([0x70])),
      mutation(25, Buffer.from([0])),
      mutation(block - 8, float(NaN)), mutation(block - 8, float(0)), mutation(block - 4, int(-1)),
      mutation(block, Buffer.from([0x70])), mutation(block + 1, Buffer.from([7])), mutation(block + 2, int(-1)),
      mutation(block + 6, int(-1)), mutation(block + 10, Buffer.from([0x70])),
      mutation(boolValue, Buffer.from([2])),
      mutation(descriptorReference + 1, int(0x7e0000)),
      mutation(booleanReference + 1, int(0x7dffff)), mutation(booleanReference + 1, int(0x7fffffff)),
      mutation(booleanReference + 1, int(0x7e0002)),
      mutation(javaRemotes.length - 1, Buffer.from([0])),
    ]) assert.throws(() => decodeFleetRemotes(bad));
    const extendedBlock = Buffer.concat([javaRemotes.subarray(0,block), Buffer.from([0x7a]), int(8), javaRemotes.subarray(block+2)]);
    assert.deepEqual(decodeFleetRemotes(extendedBlock).remotes, states);
    // Reusing a String handle as another key is a duplicate entry, not a new mapping.
    const lastKey = position('74000462657461');
    const duplicate = Buffer.concat([javaRemotes.subarray(0,lastKey), Buffer.from([0x71]), int(0x7e0002), javaRemotes.subarray(lastKey+7)]);
    assert.throws(() => decodeFleetRemotes(duplicate), /Duplicate/);
  });
  it('distinguishes absent commands from malformed nonempty commands', () => {
    assert.isNull(decodeFleetCommand(null));
    for (const bytes of [Buffer.from([0]), Buffer.concat([Buffer.alloc(12), Buffer.from([1, 99])])]) {
      assert.throws(() => decodeFleetCommand(bytes));
    }
    const command = { fleetDbId: 1n, commandOrdinal: 0, commandType: 'IDLE' as const, args: [] };
    const bytes = encodeFleetCommand(command, 16); bytes[15] = 1;
    assert.throws(() => decodeFleetCommand(bytes), /padding/);
    assert.throws(() => encodeFleetCommand(command, -1));
  });
  it('rejects negative remote counts, duplicates and trailing nonzero bytes', () => {
    for (const bytes of [Buffer.from([1, 255, 255]), Buffer.from([0, 1]), Buffer.from([1])]) {
      assert.throws(() => decodeFleetRemotes(bytes));
    }
    const entry = Buffer.from([0, 1, 97, 1]);
    assert.throws(() => decodeFleetRemotes(Buffer.concat([Buffer.from([1, 0, 2]), entry, entry])), /Duplicate/);
  });
  it('decodes genuine Java handles, punctuation and modified UTF keys exactly', () => {
    assert.deepEqual(decodeFleetRemotes(javaRemotes).remotes, states);
    assert.deepEqual(decodeFleetRemotes(encodeFleetRemotes(states, 'java')).remotes, states);
    assert.equal(FleetRemotesObject.fromBytes(javaRemotes).toBytes().readUInt16BE(), 0xaced);
  });
  it('makes malformed Java streams explicit and prevents rewriting recovery results', () => {
    const bad = javaRemotes.subarray(0, javaRemotes.length - 1);
    assert.throws(() => decodeFleetRemotes(bad));
    const recovered = FleetRemotesObject.fromBytes(bad, { mode: 'recover' });
    assert.isFalse(recovered.complete); assert.lengthOf(recovered.diagnostics, 1);
    assert.deepEqual(recovered.raw, bad);
    assert.throws(() => recovered.toBytes(), /incomplete/);
    assert.throws(() => recovered.withRemote('new', true), /incomplete/);
    assert.throws(() => recovered.withoutRemote('old'), /incomplete/);
  });
  it('rejects truncated fixed grids and nonzero partial item records', () => {
    assert.throws(() => decodeSystemInfos(Buffer.alloc(100)));
    assert.throws(() => decodeSystemResources(Buffer.alloc(1)));
    assert.throws(() => decodeSectorItems(Buffer.from([1])));
    assert.deepEqual(decodeSectorItems(Buffer.alloc(3)), []);
    const item = {blockType: 1, count: 1, posX: 0, posY: 0, posZ: 0, metaId: -1};
    assert.throws(() => encodeSectorItems(Array.from({length: MAX_ITEMS_PER_SECTOR + 1}, () => item)));
  });
  it('requires exact inflated trade length and rejects negative counts and suffixes', () => {
    const payload = Buffer.alloc(12); payload.writeBigInt64BE(1n); payload.writeInt32BE(-1, 8);
    const compressed = deflateRawSync(payload), header = Buffer.alloc(8);
    header.writeInt32BE(payload.length); header.writeInt32BE(compressed.length, 4);
    assert.throws(() => decodeTradeNodeItems(Buffer.concat([header, compressed])));
    payload.writeInt32BE(0, 8);
    const valid = deflateRawSync(payload); header.writeInt32BE(valid.length, 4);
    header.writeInt32BE(13);
    assert.throws(() => decodeTradeNodeItems(Buffer.concat([header, valid])), /size/);
    assert.throws(() => decodeTradeNodeItems(Buffer.alloc(4)));
    for (const invalidSize of [11, MAX_DATABASE_BYTES+1]) {
      header.writeInt32BE(invalidSize);
      assert.throws(() => decodeTradeNodeItems(Buffer.concat([header, valid])), /budget/);
    }
    const suffix = Buffer.concat([payload, Buffer.from([1])]);
    const deflated = deflateRawSync(suffix); header.writeInt32BE(suffix.length); header.writeInt32BE(deflated.length, 4);
    assert.throws(() => decodeTradeNodeItems(Buffer.concat([header, deflated])), /suffix/);
    header.writeInt32BE(payload.length); header.writeInt32BE(valid.length+1, 4);
    assert.throws(() => decodeTradeNodeItems(Buffer.concat([header, valid, Buffer.from([1])])), /size/);
  });
});
