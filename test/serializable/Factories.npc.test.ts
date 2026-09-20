/** Independent NPC vectors from the subtype wire definitions in StarMade-Open decf3a1. */
import assert from 'node:assert/strict';
import { BufferReader } from '../../src/core/BufferReader.js';
import { registerAllFactories, RawElement } from '../../src/serializable/Factories.js';
import { SerializableTagRegister } from '../../src/serializable/SerializableTagRegister.js';
import { NPCFactionNewsEvent } from '../../src/objects/Serializables.js';

registerAllFactories();
describe('Factories NPC wire boundaries', () => {
  it('consumes each exact subtype payload without swallowing the next record', () => {
    const names = ['GROWN', 'WAR', 'PEACE', 'ALLIES', 'TRADING', 'LOST_STATION', 'LOST_TERRITORY'];
    for (let ordinal = 0; ordinal < 7; ordinal++) {
      const prefix = Buffer.alloc(13); prefix[0] = ordinal; prefix.writeBigInt64BE(9223372036854775807n, 1); prefix.writeInt32BE(-12, 9);
      const vector = Buffer.from('800000007fffffff00000001', 'hex');
      const extra = ordinal === 0 || ordinal === 6 ? vector : ordinal === 4 ? Buffer.concat([vector, vector]) : Buffer.from('000441c08042', 'hex');
      const raw = Buffer.concat([prefix, extra]), input = Buffer.concat([raw, Buffer.from([0x7e])]);
      const reader = BufferReader.from(input), model = SerializableTagRegister.register[2]!.create(reader) as RawElement;
      assert.deepEqual(Buffer.from(model.raw), raw); assert.equal(reader.readUInt8(), 0x7e); assert.ok(reader.isEOF());
      const object = NPCFactionNewsEvent.fromRaw(raw); assert.equal(object.eventType, names[ordinal]); assert.equal(object.time, 9223372036854775807n);
      if (ordinal === 4) assert.deepEqual(object.route, { from: { x: -2147483648, y: 2147483647, z: 1 }, to: { x: -2147483648, y: 2147483647, z: 1 } });
      else if (ordinal !== 0 && ordinal !== 6) assert.equal(object.otherEnt, 'A\0B');
      assert.deepEqual(Buffer.from(object.toRaw()), raw);
      assert.throws(() => SerializableTagRegister.register[2]!.create(BufferReader.from(raw.subarray(0, -1))));
    }
  });
  it('rejects unknown ordinals rather than treating their payload as the following Tag', () => {
    const raw = Buffer.alloc(13); raw[0] = 255;
    assert.throws(() => SerializableTagRegister.register[2]!.create(BufferReader.from(raw)), /Unknown NPC event ordinal/);
  });
});
