/** @fileoverview Bounded ZIP32 index, malformed archive and read integrity tests. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import AdmZip from 'adm-zip';
import { ZipStreamIndex } from '../../src/smd3/ZipStreamIndex.js';

function zipBytes(files: Array<[string, Buffer]> = [['Ship/header.smbph', Buffer.from('header')]]): Buffer {
  const zip = new AdmZip();
  for (const [name, bytes] of files) zip.addFile(name, bytes);
  return zip.toBuffer();
}
function withFile<T>(bytes: Buffer, task: (name: string) => Promise<T>): Promise<T> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-index-'));
  const name = path.join(folder, 'fixture.sment');
  fs.writeFileSync(name, bytes);
  return task(name).finally(() => fs.rmSync(folder, { recursive: true, force: true }));
}
function central(bytes: Buffer): number { return bytes.readUInt32LE(bytes.length - 6); }
function mutate(visit: (bytes: Buffer, centralOffset: number, endOffset: number) => void): Buffer {
  const bytes = zipBytes();
  visit(bytes, central(bytes), bytes.length - 22);
  return bytes;
}
async function rejectsOpen(bytes: Buffer, options = {}): Promise<void> {
  await withFile(bytes, async name => assert.rejects(ZipStreamIndex.open(name, options)));
}
async function rejectsRead(bytes: Buffer, entry = 'Ship/header.smbph', options = {}): Promise<void> {
  await withFile(bytes, async name => {
    const index = await ZipStreamIndex.open(name, options);
    try { await assert.rejects(index.read(entry)); } finally { await index.close(); }
  });
}

describe('ZipStreamIndex', () => {
  it('reads stored/deflated entries only on demand and closes', async () => {
    for (const bytes of [zipBytes(), zipBytes([['Ship/header.smbph', Buffer.alloc(5000, 7)]])]) {
      await withFile(bytes, async name => {
        const index = await ZipStreamIndex.open(name);
        try {
          assert.deepEqual(index.names(), ['Ship/header.smbph']);
          assert.equal(index.get('missing'), undefined);
          assert.equal(await index.read('missing'), null);
          assert.equal((await index.read('Ship/header.smbph'))?.length, index.get('Ship/header.smbph')?.size);
        } finally { await index.close(); }
      });
    }
    await withFile(zipBytes([['empty', Buffer.alloc(0)]]), async name => {
      const index = await ZipStreamIndex.open(name);
      try { assert.deepEqual(await index.read('empty'), Buffer.alloc(0)); }
      finally { await index.close(); }
    });
  });

  it('rejects source, EOCD and index budget failures', async () => {
    await rejectsOpen(Buffer.alloc(4));
    await rejectsOpen(Buffer.alloc(30));
    await rejectsOpen(zipBytes(), { maxInputBytes: 22 });
    await rejectsOpen(zipBytes(), { maxEntries: 0 });
    await rejectsOpen(zipBytes(), { maxCentralDirectoryBytes: 1 });
    for (const [offset, value, size] of [
      [4, 1, 2], [6, 1, 2], [8, 2, 2], [10, 0xffff, 2],
      [12, 0xffffffff, 4], [16, 0xffffffff, 4], [16, 0xffffff00, 4],
    ]) {
      await rejectsOpen(mutate((bytes, _c, e) => size === 2 ? bytes.writeUInt16LE(value, e + offset) :
        bytes.writeUInt32LE(value, e + offset)));
    }
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt32LE(0, c)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt16LE(0xffff, c + 28)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt16LE(1, c + 8)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt16LE(99, c + 10)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt16LE(1, c + 34)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt16LE(0xffff, c + 46)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt32LE(0xffffffff, c + 20)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt32LE(0xffffffff, c + 24)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt32LE(0xffffffff, c + 42)));
    await rejectsOpen(mutate((bytes, c) => bytes.writeUInt32LE(0xa0000000, c + 38)));
    await rejectsOpen(mutate((bytes, _c, e) => bytes.writeUInt32LE(1, e + 12)));
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-symlink-'));
    try {
      const link = path.join(folder, 'archive.sment'); fs.symlinkSync('missing', link);
      await assert.rejects(ZipStreamIndex.open(link));
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('rejects unsafe, conflicting and duplicate names', async () => {
    for (const name of ['../evil.smbph', './evil.smbph', 'a//b.smbph', 'a\\b.smbph', 'a:b.smbph']) {
      const bytes = mutate((buffer, c) => {
        const length = buffer.readUInt16LE(c + 28);
        buffer.fill(0x61, c + 46, c + 46 + length);
        Buffer.from(name).copy(buffer, c + 46, 0, Math.min(length, Buffer.byteLength(name)));
      });
      if (name.length <= zipBytes().readUInt16LE(central(zipBytes()) + 28)) await rejectsOpen(bytes);
    }
    await rejectsOpen(zipBytes([['Ship', Buffer.from('a')], ['Ship/header.smbph', Buffer.from('b')]]));
  });

  it('rejects corrupted local records, body and moving sources', async () => {
    await rejectsRead(mutate(bytes => bytes.writeUInt32LE(0, 0)));
    await rejectsRead(mutate(bytes => bytes.writeUInt16LE(99, 8)));
    await rejectsRead(mutate(bytes => bytes[30] = 0x58));
    await rejectsRead(mutate((bytes, c) => bytes.writeUInt32LE(0, c + 16)));
    await rejectsRead(mutate((bytes, c) => bytes.writeUInt32LE(0, c + 24)));
    await rejectsRead(mutate((bytes, c) => bytes.writeUInt32LE(c, c + 20)));
    await rejectsRead(mutate((bytes, c) => bytes.writeUInt32LE(c - 25, c + 42)));
    await withFile(zipBytes(), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        fs.utimesSync(name, new Date(0), new Date(0));
        await assert.rejects(index.read('Ship/header.smbph'));
      } finally { await index.close(); }
    });
  });

  it('rejects duplicate records, trailing index bytes and directory/file conflicts', async () => {
    const duplicate = zipBytes([['a/file', Buffer.from('x')], ['b/file', Buffer.from('y')]]);
    const first = central(duplicate), second = first + 46 + duplicate.readUInt16LE(first + 28);
    duplicate[first + 46] = 0x61; duplicate[second + 46] = 0x61;
    await rejectsOpen(duplicate);
    const trailing = zipBytes([['a/file', Buffer.from('x')], ['b/file', Buffer.from('y')]]);
    trailing.writeUInt16LE(1, trailing.length - 14);
    trailing.writeUInt16LE(1, trailing.length - 12);
    await rejectsOpen(trailing);
    await rejectsOpen(zipBytes([['a', Buffer.from('x')], ['a/', Buffer.alloc(0)]]));
    await rejectsOpen(zipBytes([['a', Buffer.from('x')], ['a/b', Buffer.from('y')]]));
  });

  it('rejects bounded extraction and invalid compression without reading later entries', async () => {
    await withFile(zipBytes([['directory/', Buffer.alloc(0)], ['file', Buffer.from('x')]]), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        await assert.rejects(index.read('directory/'));
        await assert.rejects(index.read('file', 0));
      } finally { await index.close(); }
    });
    const compressed = zipBytes([['data', Buffer.alloc(5000, 7)]]);
    const localName = compressed.readUInt16LE(26), localExtra = compressed.readUInt16LE(28);
    compressed[30 + localName + localExtra] ^= 0xff;
    await rejectsRead(compressed, 'data');
    await rejectsRead(mutate((bytes, c) => bytes.writeUInt32LE(c + 999, c + 42)));
  });

  it('detects archive replacement between stat and open', async () => {
    const original = fs.promises.open;
    await withFile(zipBytes(), async name => {
      try {
        for (const size of [123n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
          fs.promises.open = async (...args: any[]) => {
            const handle = await original(...args as [any, any]);
            const stat = handle.stat.bind(handle);
            handle.stat = async (...statArgs: any[]) => {
              const value = await stat(...statArgs as [any]);
              return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { size });
            };
            return handle;
          };
          await assert.rejects(ZipStreamIndex.open(name));
        }
      } finally { fs.promises.open = original; }
    });
  });

  it('streams stored and deflated bytes with incremental size and CRC checks', async () => {
    for (const data of [Buffer.alloc(0), Buffer.alloc(200_000, 7)]) {
      await withFile(zipBytes([['data', data]]), async name => {
        const index = await ZipStreamIndex.open(name);
        try {
          const chunks = [];
          for await (const chunk of index.readChunks(index.get('data')!)) chunks.push(chunk);
          assert.deepEqual(Buffer.concat(chunks), data);
        } finally { await index.close(); }
      });
    }
  });

  it('rejects unsafe chunk extraction and honours cancellation', async () => {
    const cases = [
      mutate(bytes => bytes.writeUInt32LE(0, 0)),
      mutate(bytes => bytes.writeUInt16LE(99, 8)),
      mutate(bytes => bytes[30] = 0x58),
      mutate((bytes, c) => bytes.writeUInt32LE(c, c + 20)),
      mutate((bytes, c) => bytes.writeUInt32LE(0, c + 16)),
      mutate((bytes, c) => bytes.writeUInt32LE(0, c + 24)),
    ];
    for (const bytes of cases) {
      await withFile(bytes, async name => {
        const index = await ZipStreamIndex.open(name);
        try {
          await assert.rejects(async () => {
            for await (const _ of index.readChunks(index.get('Ship/header.smbph')!)) { /* consume */ }
          });
        } finally { await index.close(); }
      });
    }
    await withFile(zipBytes([['data', Buffer.alloc(200_000, 7)]]), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        const abort = new AbortController(); abort.abort();
        await assert.rejects(async () => {
          for await (const _ of index.readChunks(index.get('data')!, abort.signal)) { /* consume */ }
        });
      } finally { await index.close(); }
    });
  });

  it('covers stored non-empty entries, entry ceilings and malformed deflate output', async () => {
    const stored = new AdmZip(); stored.addFile('data', Buffer.from('stored bytes'));
    stored.getEntry('data')!.header.method = 0;
    await withFile(stored.toBuffer(), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        const parts = [];
        for await (const part of index.readChunks(index.get('data')!)) parts.push(part);
        assert.equal(Buffer.concat(parts).toString(), 'stored bytes');
      } finally { await index.close(); }
    });
    await withFile(zipBytes([['dir/', Buffer.alloc(0)], ['data', Buffer.alloc(500, 7)]]), async name => {
      const index = await ZipStreamIndex.open(name, { maxEntryBytes: 100 });
      try {
        await assert.rejects(async () => { for await (const _ of index.readChunks(index.get('dir/')!)) { /* consume */ } });
        await assert.rejects(async () => { for await (const _ of index.readChunks(index.get('data')!)) { /* consume */ } });
      } finally { await index.close(); }
    });
    const inflated = zipBytes([['data', Buffer.alloc(5000, 7)]]);
    inflated[30 + inflated.readUInt16LE(26) + inflated.readUInt16LE(28)] = 0xff;
    await withFile(inflated, async name => {
      const index = await ZipStreamIndex.open(name);
      try { await assert.rejects(async () => { for await (const _ of index.readChunks(index.get('data')!)) { /* consume */ } }); }
      finally { await index.close(); }
    });
    const oversized = zipBytes([['data', Buffer.alloc(5000, 7)]]);
    oversized.writeUInt32LE(1, central(oversized) + 24);
    await withFile(oversized, async name => {
      const index = await ZipStreamIndex.open(name);
      try { await assert.rejects(async () => { for await (const _ of index.readChunks(index.get('data')!)) { /* consume */ } }); }
      finally { await index.close(); }
    });
  });

  it('detects changes and abort after the first output chunk', async () => {
    const data = Buffer.alloc(300_000, 7);
    await withFile(zipBytes([['data', data]]), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        const controller = new AbortController();
        const iterator = index.readChunks(index.get('data')!, controller.signal);
        assert.equal((await iterator.next()).done, false);
        controller.abort();
        await assert.rejects(iterator.next());
        const after = index.readChunks(index.get('data')!);
        assert.equal((await after.next()).done, false);
        fs.utimesSync(name, new Date(0), new Date(0));
        await assert.rejects(async () => { for await (const _ of after) { /* consume */ } });
      } finally { await index.close(); }
    });
  });

  it('closes a second descriptor when the indexed file changes or fstat fails', async () => {
    const original = fs.fstatSync;
    await withFile(zipBytes([['data', Buffer.alloc(5000, 7)]]), async name => {
      const index = await ZipStreamIndex.open(name);
      try {
        for (const broken of ['changed', 'fstat']) {
          fs.fstatSync = ((fd: number, options: any) => {
            if (broken === 'fstat') throw new Error('injected fstat failure');
            const value = original(fd, options) as fs.BigIntStats;
            return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { ino: value.ino + 1n });
          }) as typeof fs.fstatSync;
          await assert.rejects(async () => {
            for await (const _ of index.readChunks(index.get('data')!)) { /* consume */ }
          });
        }
      } finally { fs.fstatSync = original; await index.close(); }
    });
  });
});
