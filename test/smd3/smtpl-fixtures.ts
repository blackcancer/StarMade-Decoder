/** Independently assembled wire vectors, without the SDK writer or bit packer. */
import type { SmtplFileInput } from '../../src/smd3/SmtplParser.js';

export function int32(value: number): Buffer {
  const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes;
}

export function int64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8); bytes.writeBigInt64BE(value); return bytes;
}

export function templateInput(version: number): SmtplFileInput {
  return {
    version, minX: -1, minY: 2, minZ: -3, maxX: 4, maxY: 5, maxZ: 6,
    pieces: [{ x: -1, y: 2, z: -3, type: 0x345, hp: 85, active: true, orientation: 13 }],
    connections: [{ from: -2n, targets: [3n, -4n] }],
    texts: new Map(version >= 2 ? [[5n, 'A\0é']] : []),
    filters: version >= 3 ? [{ position: 6n, entries: [{ type: 300, count: 7 }] }] : [],
    production: version >= 3 ? [{ position: 8n, type: 400 }] : [],
    productionLimits: version >= 5 ? [{ position: 9n, limit: 10 }] : [],
    fillUpFilters: version >= 5 ? [{ position: 11n, entries: [{ type: 500, count: 12 }] }] : [],
  };
}

export function templateWire(version: number): Buffer {
  // Same logical piece, three distinct encodings: legacy BE, modern LE, extended BE.
  const piece = version <= 3 ? 'd2ab45' : version <= 5 ? '45ab6e' : '01baa345';
  return Buffer.concat([
    Buffer.from([version]), ...[-1, 2, -3, 4, 5, 6, 1, -1, 2, -3].map(int32),
    Buffer.from(piece, 'hex'),
    int32(1), int64(-2n), int32(2), int64(3n), int64(-4n),
    ...(version >= 2 ? [int32(1), int64(5n), Buffer.from('000541c080c3a9', 'hex')] : []),
    ...(version >= 3 ? [int32(1), int64(6n), int32(1), Buffer.from('012c', 'hex'), int32(7),
      int32(1), int64(8n), Buffer.from('0190', 'hex')] : []),
    ...(version >= 5 ? [int32(1), int64(9n), int32(10),
      int32(1), int64(11n), int32(1), Buffer.from('01f4', 'hex'), int32(12)] : []),
  ]);
}
