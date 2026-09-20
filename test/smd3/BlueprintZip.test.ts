/** Byte-level ZIP fixtures exercise the complete carrier independently of SDK serialization. */
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { BlueprintZip, createBlueprintZip } from '../../src/smd3/BlueprintZip.js';

/** Independent bit-at-a-time CRC oracle (the implementation uses a lookup table). */
function checksum(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

interface FixtureEntry {
  name: string;
  bytes: Buffer;
  method?: number;
  descriptor?: 'signed' | 'bare';
  localExtra?: Buffer;
  centralExtra?: Buffer;
  comment?: Buffer;
}

/** Builds local records and the directory directly from the ZIP32 wire layout. */
function fixture(entries: FixtureEntry[], options: { prefix?: Buffer; gap?: Buffer; trailer?: Buffer; reverse?: boolean; comment?: Buffer } = {}): Buffer {
  const chunks: Buffer[] = [options.prefix ?? Buffer.alloc(0)], central: Buffer[] = [];
  let offset = chunks[0].length;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), method = entry.method ?? 8;
    const payload = method === 0 ? entry.bytes : deflateRawSync(entry.bytes, { level: 1 });
    const localExtra = entry.localExtra ?? Buffer.alloc(0), centralExtra = entry.centralExtra ?? Buffer.alloc(0), comment = entry.comment ?? Buffer.alloc(0);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46), crc = checksum(entry.bytes);
    const flags = 0x800 | (entry.descriptor ? 8 : 0);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x1234, 10); local.writeUInt16LE(0x2345, 12);
    if (!entry.descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(entry.bytes.length, 22); }
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(entry.descriptor ? (entry.descriptor === 'signed' ? 16 : 12) : 0);
    if (descriptor.length) {
      if (descriptor.length === 16) descriptor.writeUInt32LE(0x08074b50);
      const pos = descriptor.length - 12;
      descriptor.writeUInt32LE(crc, pos); descriptor.writeUInt32LE(payload.length, pos + 4); descriptor.writeUInt32LE(entry.bytes.length, pos + 8);
    }
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(method, 10); local.copy(directory, 12, 10, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(payload.length, 20); directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(centralExtra.length, 30); directory.writeUInt16LE(comment.length, 32);
    directory.writeUInt32LE(entry.name.endsWith('/') ? 0x10 : 0, 38); directory.writeUInt32LE(offset, 42);
    const record = Buffer.concat([local, name, localExtra, payload, descriptor]), gap = options.gap ?? Buffer.alloc(0);
    chunks.push(record, gap); offset += record.length + gap.length;
    central.push(Buffer.concat([directory, name, centralExtra, comment]));
  }
  if (options.reverse) central.reverse();
  const table = Buffer.concat(central), comment = options.comment ?? Buffer.alloc(0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...chunks, table, options.trailer ?? Buffer.alloc(0), end, comment]);
}

/** Inspects locations without using the carrier, for byte-level preservation checks. */
function locations(bytes: Buffer) {
  let end = bytes.length - 22;
  while (bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) end--;
  const start = bytes.readUInt32LE(end + 16), records: { name: string; central: number; local: number; data: number; compressedSize: number; size: number }[] = [];
  let central = start;
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    const local = bytes.readUInt32LE(central + 42), nameLength = bytes.readUInt16LE(central + 28);
    records.push({ name: bytes.subarray(central + 46, central + 46 + nameLength).toString(), central, local,
      data: local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28),
      compressedSize: bytes.readUInt32LE(central + 20), size: bytes.readUInt32LE(central + 24) });
    central += 46 + nameLength + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  return { end, start, records };
}

const extra = Buffer.from('feca0300010203', 'hex');
const richEntries: FixtureEntry[] = [
  { name: 'Root/', bytes: Buffer.alloc(0), method: 0 },
  { name: 'Root/header.smbph', bytes: Buffer.alloc(36), method: 0, localExtra: extra, centralExtra: extra, comment: Buffer.from('header-comment') },
  { name: 'Root/DATA/a.smd3', bytes: Buffer.from('keep this payload '.repeat(1000)), descriptor: 'signed' },
  { name: 'Root/é.txt', bytes: Buffer.from('original metadata'), descriptor: 'bare', localExtra: extra, centralExtra: extra },
];

describe('Blueprint ZIP — lossless resource carrier', () => {
  it('defensively snapshots archives, maps, payloads and returned ZIP bytes', () => {
    const original = fixture(richEntries, { comment: Buffer.from('archive-comment') }), input = new Uint8Array(original);
    const zip = new BlueprintZip(input), entries = zip.getEntries();
    input.fill(0); entries.get('Root/header.smbph')!.fill(9); entries.delete('Root/é.txt');
    assert.deepEqual(zip.getEntries().get('Root/header.smbph'), Buffer.alloc(36));
    const first = zip.toBuffer(zip.getEntries()); assert.deepEqual(first, original); first.fill(0);
    assert.deepEqual(zip.toBuffer(zip.getEntries()), original);
  });

  it('keeps physical records, gaps, prefix, comments, extras and central order through edits', () => {
    const prefix = Buffer.from('prefix'), gap = Buffer.from('gap'), comment = Buffer.from('archive-comment');
    const original = fixture(richEntries, { prefix, gap, comment, reverse: true }), zip = new BlueprintZip(original), entries = zip.getEntries();
    entries.set('Root/header.smbph', Buffer.from('new header of a different size'));
    entries.delete('Root/é.txt'); entries.set('Root/new/', null); entries.set('Root/new/z.txt', Buffer.from('last'));
    entries.set('Root/new/a.txt', Buffer.from('first'));
    const output = zip.toBuffer(entries), before = locations(original), after = locations(output);
    assert.deepEqual(output.subarray(0, prefix.length), prefix);
    assert.deepEqual(output.subarray(-comment.length), comment);
    assert.deepEqual(after.records.map(record => record.name), ['Root/DATA/a.smd3', 'Root/header.smbph', 'Root/', 'Root/new/', 'Root/new/a.txt', 'Root/new/z.txt']);
    const oldData = before.records.find(record => record.name.endsWith('a.smd3'))!, newData = after.records.find(record => record.name.endsWith('a.smd3'))!;
    assert.deepEqual(output.subarray(newData.local, newData.data + newData.compressedSize + 16), original.subarray(oldData.local, oldData.data + oldData.compressedSize + 16));
    assert.deepEqual(output.subarray(newData.data + newData.compressedSize + 16, newData.data + newData.compressedSize + 19), gap);
    const oldHeader = before.records.find(record => record.name.endsWith('smbph'))!, newHeader = after.records.find(record => record.name.endsWith('smbph'))!;
    assert.deepEqual(output.subarray(newHeader.data - extra.length, newHeader.data), extra);
    const oldCentralTail = original.subarray(oldHeader.central + 46, oldHeader.central + 46 + 'Root/header.smbph'.length + extra.length + 'header-comment'.length);
    assert.deepEqual(output.subarray(newHeader.central + 46, newHeader.central + 46 + oldCentralTail.length), oldCentralTail);
    assert.deepEqual(new BlueprintZip(output).getEntries(), new Map(after.records.map(({ name }) => [name, entries.get(name)!])));
    const independent = new AdmZip(output);
    for (const [name, value] of entries) if (value !== null) assert.deepEqual(independent.getEntry(name)!.getData(), value);
  });

  for (const descriptor of ['signed', 'bare'] as const) {
    it(`rewrites ${descriptor} descriptors and their CRC/size fields`, () => {
      const input = fixture([{ name: 'Root/a', bytes: Buffer.from('old'), descriptor }]), zip = new BlueprintZip(input);
      const values = zip.getEntries(); values.set('Root/a', Buffer.from('new data '.repeat(100)));
      const output = zip.toBuffer(values), position = locations(output).records[0], descriptorStart = position.data + position.compressedSize;
      const fields = descriptorStart + (descriptor === 'signed' ? 4 : 0);
      assert.equal(output.readUInt32LE(fields), checksum(values.get('Root/a')!));
      assert.equal(output.readUInt32LE(fields + 4), position.compressedSize);
      assert.equal(output.readUInt32LE(fields + 8), 900);
      assert.deepEqual(new BlueprintZip(output).getEntries(), values);
    });
  }

  it('distinguishes a bare descriptor whose CRC equals the optional signature', () => {
    const value = Buffer.from('ac0a7ad5', 'hex');
    assert.equal(checksum(value), 0x08074b50);
    const bytes = fixture([{ name: 'Root/a', bytes: value, descriptor: 'bare' }], { gap: Buffer.alloc(4) });
    const zip = new BlueprintZip(bytes);
    assert.deepEqual(zip.getEntries().get('Root/a'), value);
    assert.deepEqual(zip.toBuffer(zip.getEntries()), bytes);
  });

  it('reads a JDK ZipOutputStream fixture matching the reference FolderZipper conventions', () => {
    // Produced by JDK ZipOutputStream, as used by StarMade-Open FolderZipper at
    // decf3a1990f29b9505041f122188bf19489bcf7e; UTF-8 name, signed descriptor.
    const bytes = Buffer.from('504b0304140008080800000021000000000000000000000000000b000000526f6f742fc3a92e7478746360646266610500504b07084acfeb300800000006000000504b01021400140008080800000021004acfeb3008000000060000000b0000000000000000000000000000000000526f6f742fc3a92e747874504b0506000000000100010039000000410000000b006a6176612d6f7261636c65', 'hex');
    const zip = new BlueprintZip(bytes);
    assert.deepEqual(zip.getEntries().get('Root/é.txt'), Buffer.from([0, 1, 2, 3, 4, 5]));
    assert.deepEqual(zip.toBuffer(zip.getEntries()), bytes);
  });

  it('creates deterministic new archives independent of map insertion order and preserves empty files', () => {
    const entries = new Map<string, Buffer | null>([['Root/z', Buffer.alloc(0)], ['Root/', null], ['Root/a', Buffer.from('content')]]);
    const first = createBlueprintZip(entries), second = createBlueprintZip(new Map([...entries].reverse()));
    assert.deepEqual(first, second);
    const parsed = new BlueprintZip(first);
    assert.deepEqual([...parsed.getEntries().keys()], ['Root/', 'Root/a', 'Root/z']);
    assert.deepEqual(parsed.getEntries().get('Root/z'), Buffer.alloc(0));
    assert.equal(createBlueprintZip(new Map()).length, 22);
    assert.equal(new BlueprintZip(first).toBuffer(new Map()).length, 22);
  });

  for (const file of ['samples/Sobek Dreadnought 2025-jun-02.sment', 'samples/firestorm class battlecruiser.sment', 'samples/retrocompat/starmadedock/the-black-51-2014.sment']) {
    it(`preserves every byte and resource in ${file}`, function () {
      this.timeout(15000);
      const bytes = fs.readFileSync(file), zip = new BlueprintZip(bytes), entries = zip.getEntries(), independent = new AdmZip(bytes);
      assert.equal(entries.size, independent.getEntries().length);
      for (const [name, value] of entries) if (value !== null) assert.deepEqual(value, independent.getEntry(name)!.getData(), name);
      assert.deepEqual(zip.toBuffer(entries), bytes);
    });
  }

  it('retains an opaque central-directory trailer exactly but refuses to edit it', () => {
    const input = fixture([richEntries[1]], { trailer: Buffer.from('unknown directory trailer') }), zip = new BlueprintZip(input), values = zip.getEntries();
    assert.deepEqual(zip.toBuffer(values), input); values.set('Root/header.smbph', Buffer.from('change'));
    assert.throws(() => zip.toBuffer(values), /opaque/);
  });
});

describe('Blueprint ZIP — malformed resources and bounded outputs', () => {
  for (const name of ['', '/absolute', '../escape', 'Root/./a', 'Root//a', 'C:/a', 'Root\\a', 'Root/\0a', 'a'.repeat(4097), '\ud800']) {
    it(`rejects unsafe requested path ${JSON.stringify(name).slice(0, 40)}`, () => {
      assert.throws(() => createBlueprintZip(new Map([[name, Buffer.alloc(0)]])), /path/);
    });
  }

  for (const names of [['Root/a', 'Root/a/'], ['Root/a/b', 'Root/a'], ['Root/a', 'Root/a/b']]) {
    it(`rejects file/directory conflicts ${names.join(', ')}`, () => {
      const values = new Map(names.map(name => [name, name.endsWith('/') ? null : Buffer.alloc(0)]));
      assert.throws(() => createBlueprintZip(values), /conflicts/);
      assert.throws(() => new BlueprintZip(fixture(names.map(name => ({ name, bytes: Buffer.alloc(0) })))), /conflicts/);
    });
  }

  it('rejects invalid map value types and duplicate input names', () => {
    for (const [name, value] of [['Root/', Buffer.alloc(0)], ['Root/a', null], ['Root/a', new Uint8Array(0)]]) {
      assert.throws(() => createBlueprintZip(new Map([[name, value]]) as any), /require/);
    }
    assert.throws(() => new BlueprintZip(fixture([richEntries[1], richEntries[1]])), /Duplicate/);
    assert.throws(() => new BlueprintZip(fixture([{ name: '../unsafe', bytes: Buffer.alloc(0) }])), /Unsafe/);
  });

  it('rejects invalid ZIP framing and input, decoded-entry, aggregate and count limits', () => {
    const bytes = fixture(richEntries);
    assert.throws(() => new BlueprintZip(Buffer.alloc(0)), /directory/);
    for (const options of [{ maxInputBytes: 1 }, { maxEntries: 1 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }]) {
      assert.throws(() => new BlueprintZip(bytes, options), /budget/);
    }
    const zip = new BlueprintZip(fixture([])), entries = new Map([['Root/a', Buffer.alloc(4)]]);
    assert.throws(() => new BlueprintZip(fixture([]), { maxEntries: 0 }).toBuffer(entries), /count/);
    assert.throws(() => new BlueprintZip(fixture([]), { maxEntryBytes: 1 }).toBuffer(entries), /budget/);
    for (const limit of [-1, 0.5, 0xffffffff]) assert.throws(() => zip.toBuffer(entries, limit), /maxOutputBytes/);
    assert.throws(() => zip.toBuffer(new Map(), 0), /output budget/);
    assert.throws(() => zip.toBuffer(entries, 1), /compression/);
    assert.throws(() => zip.toBuffer(new Map([['Root/', null]]), 1), /output budget/);
    const tooMany = new Map(Array.from({ length: 65535 }, (_, i) => [`Root/${i}`, Buffer.alloc(0)] as const));
    assert.throws(() => new BlueprintZip(fixture([]), { maxEntries: 65535 }).toBuffer(tooMany), /ZIP64/);
  });

  for (const [field, value] of [[8, 1], [10, 99], [34, 1], [20, 0xffffffff], [24, 0xffffffff], [42, 0xffffffff]]) {
    it(`rejects unsupported central field ${field}`, () => {
      const bytes = fixture([richEntries[1]]), position = locations(bytes).records[0];
      bytes.writeUIntLE(value, position.central + field, field >= 20 && field !== 34 ? 4 : 2);
      assert.throws(() => new BlueprintZip(bytes), /Unsupported/);
    });
  }

  it('rejects malformed UTF-8 entry names without replacement-character aliases', () => {
    const bytes = fixture([richEntries[1]]), position = locations(bytes).records[0];
    bytes[position.central + 46] = 0xff;
    assert.throws(() => new BlueprintZip(bytes), /UTF-8/);
  });

  for (const field of ['centralExtra', 'localExtra'] as const) {
    for (const hex of ['01', 'feca050001', '01000000']) {
      it(`rejects malformed or ZIP64 ${field}=${hex}`, () => {
        const bytes = fixture([{ name: 'Root/a', bytes: Buffer.alloc(0), [field]: Buffer.from(hex, 'hex') }]);
        assert.throws(() => new BlueprintZip(bytes), /extra|ZIP64/);
      });
    }
  }

  it('rejects local record bounds, names, header fields and overlapping entries', () => {
    for (const kind of ['offset', 'signature', 'size', 'name', 'flags', 'local-size'] as const) {
      const bytes = fixture([richEntries[1]]), position = locations(bytes).records[0];
      if (kind === 'offset') bytes.writeUInt32LE(bytes.length, position.central + 42);
      if (kind === 'signature') bytes.writeUInt32LE(0, position.local);
      if (kind === 'size') bytes.writeUInt32LE(bytes.length, position.central + 20);
      if (kind === 'name') bytes[position.local + 30] = 0x41;
      if (kind === 'flags') bytes.writeUInt16LE(0, position.local + 6);
      if (kind === 'local-size') bytes.writeUInt32LE(1, position.local + 22);
      assert.throws(() => new BlueprintZip(bytes), /bounds|signature|overlaps|disagree/, kind);
    }
    // A zero-length stored entry's payload contains another independently valid
    // local record: central paths are distinct, but physical records overlap.
    const inner = fixture([{ name: 'Root/b', bytes: Buffer.from('b'), method: 0 }]), innerRecord = inner.subarray(0, locations(inner).start);
    const bytes = fixture([{ name: 'Root/a', bytes: innerRecord, method: 0 }, { name: 'Root/b', bytes: Buffer.from('b'), method: 0 }]);
    const position = locations(bytes); bytes.writeUInt32LE(position.records[0].data, position.records[1].central + 42);
    assert.throws(() => new BlueprintZip(bytes), /Overlapping/);
  });

  it('rejects incorrect descriptor fields, truncation and nonzero placeholder mismatches', () => {
    for (const field of [0, 4, 8]) {
      const bytes = fixture([{ name: 'Root/a', bytes: Buffer.from('payload'), descriptor: 'bare' }]), pos = locations(bytes).records[0];
      bytes.writeUInt32LE(123, pos.data + pos.compressedSize + field);
      assert.throws(() => new BlueprintZip(bytes), /descriptor/);
    }
    const bytes = fixture([{ name: 'Root/a', bytes: Buffer.from('payload'), descriptor: 'signed' }]), pos = locations(bytes).records[0];
    bytes.writeUInt32LE(1, pos.local + 14);
    assert.throws(() => new BlueprintZip(bytes), /disagree/);
    const truncated = fixture([{ name: 'Root/a', bytes: Buffer.from('payload') }]), plain = locations(truncated).records[0];
    truncated.writeUInt16LE(0x808, plain.local + 6); truncated.writeUInt16LE(0x808, plain.central + 8);
    assert.throws(() => new BlueprintZip(truncated), /descriptor/);
  });

  it('rejects invalid compression, decompressed sizes, CRCs and directory payloads', () => {
    for (const kind of ['deflate', 'size', 'crc', 'stored-size'] as const) {
      const bytes = fixture([{ name: 'Root/a', bytes: Buffer.from('payload'), method: kind === 'stored-size' ? 0 : 8 }]), pos = locations(bytes).records[0];
      if (kind === 'deflate') bytes.fill(0xff, pos.data, pos.data + pos.compressedSize);
      if (kind === 'size' || kind === 'stored-size') { bytes.writeUInt32LE(8, pos.central + 24); bytes.writeUInt32LE(8, pos.local + 22); }
      if (kind === 'crc') { bytes.writeUInt32LE(0, pos.central + 16); bytes.writeUInt32LE(0, pos.local + 14); }
      assert.throws(() => new BlueprintZip(bytes), /payload|mismatch/, kind);
    }
    assert.throws(() => new BlueprintZip(fixture([{ name: 'Root/', bytes: Buffer.from('not empty') }])), /directory/);
  });
});
