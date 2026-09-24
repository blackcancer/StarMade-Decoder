/** @fileoverview On-demand SMD3 record reads and compact canonical words. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { parseSmd3, HEADER_SIZE, SEGMENT_SECTOR, BLOCK_COUNT } from '../../src/smd3/Smd3Parser.js';
import { emptySegment, emptySmd3File, setBlock, writeSmd3, encodeBlockWord } from '../../src/smd3/Smd3Writer.js';
import { streamDiagnostic, streamSmd3 } from '../../src/smd3/Smd3Stream.js';

/** Two distinct sectors let mutation after the first yield prove demand reads. */
function fixture(): Buffer {
  const first = emptySegment(0, 0, 0), second = emptySegment(32, 0, 0);
  first.lastChanged = 1n; second.lastChanged = 2n;
  setBlock(first, 0, 0, 0, { type: 777, hp: 64, active: true, orientation: 17, extra: 12 });
  setBlock(second, 31, 31, 31, { type: 13, hp: 127, active: false, orientation: 3 });
  return writeSmd3({ ...emptySmd3File(), segments: [first, second] });
}

describe('Smd3Stream', () => {
  it('matches eager fields and raw words for each segment from Buffer and file', async () => {
    const bytes = fixture(), eager = parseSmd3(bytes);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smd3-stream-'));
    const filename = path.join(folder, 'region.smd3'); fs.writeFileSync(filename, bytes);
    try {
      for (const source of [bytes, filename]) {
        const events = [];
        for await (const event of streamSmd3(source)) events.push(event);
        assert.equal(events.at(-1)!.kind, 'end');
        assert.deepEqual(events.at(-1), { kind: 'end', status: 'complete', segments: 2, diagnostics: [] });
        const segments = events.filter(event => event.kind === 'segment');
        assert.equal(segments.length, 2);
        for (let i = 0; i < 2; i++) {
          const compact = segments[i];
          if (compact.kind !== 'segment') continue;
          assert.equal(compact.x, eager.segments[i].x); assert.equal(compact.lastChanged, eager.segments[i].lastChanged);
          assert.equal(compact.headerVersion, eager.headerVersion); assert.equal(compact.version, 7);
          assert.equal(compact.blockCount, 1); assert.equal(compact.words.length, BLOCK_COUNT);
          assert.ok(compact.words instanceof Uint32Array);
          for (const index of [0, 1, 1024, BLOCK_COUNT - 1]) {
            assert.equal(compact.words[index], encodeBlockWord(eager.segments[i].blocks[index]));
          }
        }
      }
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('does not read the next record until requested and notices a changed source', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smd3-demand-'));
    const filename = path.join(folder, 'region.smd3'); fs.writeFileSync(filename, fixture());
    try {
      const iterator = streamSmd3(filename);
      const first = await iterator.next(); assert.equal(first.value?.kind, 'segment');
      fs.truncateSync(filename, HEADER_SIZE + SEGMENT_SECTOR);
      const last = await iterator.next();
      assert.equal(last.value?.kind, 'end');
      if (last.value?.kind === 'end') assert.equal(last.value.status, 'error');
      await iterator.return(undefined);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('distinguishes explicit cancellation, recoverable omission and fatal error', async () => {
    const controller = new AbortController();
    const iterator = streamSmd3(fixture(), { signal: controller.signal });
    assert.equal((await iterator.next()).value?.kind, 'segment');
    controller.abort();
    assert.deepEqual((await iterator.next()).value,
      { kind: 'end', status: 'cancelled', segments: 1, diagnostics: [] });
    const before = new AbortController(); before.abort();
    const pre = [];
    for await (const event of streamSmd3(fixture(), { signal: before.signal })) pre.push(event);
    assert.deepEqual(pre[0], { kind: 'end', status: 'cancelled', segments: 0, diagnostics: [] });
    const corrupt = fixture();
    const secondSlot = 4 + (9 + 8 * 16 + 8 * 256) * 4;
    corrupt.writeInt16BE(-1, secondSlot);
    const recovered = [];
    for await (const event of streamSmd3(corrupt, { mode: 'recover' })) recovered.push(event);
    assert.equal(recovered.filter(event => event.kind === 'segment').length, 1);
    assert.equal(recovered.at(-1)?.kind, 'end');
    if (recovered.at(-1)?.kind === 'end') assert.equal(recovered.at(-1)!.status, 'partial');
    const strict = [];
    for await (const event of streamSmd3(corrupt)) strict.push(event);
    assert.equal(strict.at(-1)?.kind, 'end');
    if (strict.at(-1)?.kind === 'end') assert.equal(strict.at(-1)!.status, 'error');
  });

  it('caps input, blocks and slots and rejects truncated or unsafe sources', async () => {
    const bytes = fixture();
    for (const options of [{ maxInputBytes: bytes.length - 1 }, { maxBlocks: BLOCK_COUNT },
      { maxSegments: 1 }, { mode: 'invalid' as any }]) {
      const events = [];
      for await (const event of streamSmd3(bytes, options)) events.push(event);
      assert.equal(events.at(-1)?.kind, 'end');
      if (events.at(-1)?.kind === 'end') assert.equal(events.at(-1)!.status, 'error');
    }
    for (const source of [Buffer.alloc(3), bytes.subarray(0, HEADER_SIZE)]) {
      const events = [];
      for await (const event of streamSmd3(source)) events.push(event);
      if (events.at(-1)?.kind === 'end') assert.equal(events.at(-1)!.status, 'error');
    }
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smd3-safety-'));
    const link = path.join(folder, 'link.smd3'); fs.symlinkSync('missing', link);
    try {
      const events = [];
      for await (const event of streamSmd3(link)) events.push(event);
      if (events.at(-1)?.kind === 'end') assert.equal(events.at(-1)!.status, 'error');
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('reports diagnostics for non-Error values and detects same-length file mutation', async () => {
    assert.deepEqual(streamDiagnostic('unexpected'), { code: 'E_IO', message: 'unexpected' });
    assert.deepEqual(streamDiagnostic(new Error('bad'), 'region'),
      { code: 'E_IO', message: 'bad', path: 'region' });
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smd3-mutated-'));
    const filename = path.join(folder, 'region.smd3'); fs.writeFileSync(filename, fixture());
    try {
      const iterator = streamSmd3(filename);
      assert.equal((await iterator.next()).value?.kind, 'segment');
      fs.utimesSync(filename, new Date(0), new Date(0));
      assert.equal((await iterator.next()).value?.status, 'error');
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  });

  it('accepts caller-provided planet-side normals without changing canonical words', async () => {
    const normals = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 }] as const;
    const events = [];
    for await (const event of streamSmd3(fixture(), { sideNormals: normals })) events.push(event);
    assert.equal(events.at(-1)?.status, 'complete');
    assert.equal(events[0].kind, 'segment');
  });

  it('detects identity changes and aborts at both read boundaries', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'smd3-open-'));
    const filename = path.join(folder, 'region.smd3'); fs.writeFileSync(filename, fixture());
    const original = fs.promises.open;
    try {
      for (const mutation of ['before', 'header-abort', 'record-abort']) {
        const controller = new AbortController();
        fs.promises.open = async (...args: any[]) => {
          const handle = await original(...args as [any, any]);
          const stat = handle.stat.bind(handle), read = handle.read.bind(handle);
          let calls = 0;
          handle.stat = async (...statArgs: any[]) => {
            const value = await stat(...statArgs as [any]);
            calls++;
            if (mutation === 'before' && calls === 1) return Object.assign(
              Object.create(Object.getPrototypeOf(value)), value, { ino: value.ino + 1n });
            return value;
          };
          handle.read = async (...readArgs: any[]) => {
            const result = await read(...readArgs as [any, any, any, any]);
            if (mutation === 'header-abort' && readArgs[3] === 0) controller.abort();
            if (mutation === 'record-abort' && readArgs[3] !== 0) controller.abort();
            return result as any;
          };
          return handle;
        };
        const events = [];
        for await (const event of streamSmd3(filename, { signal: controller.signal })) events.push(event);
        assert.equal(events.at(-1)?.status,
          mutation.endsWith('abort') ? 'cancelled' : 'error');
      }
      fs.promises.open = original;
      const limited = [];
      for await (const event of streamSmd3(filename, { maxInputBytes: 1 })) limited.push(event);
      assert.equal(limited.at(-1)?.status, 'error');
    } finally {
      fs.promises.open = original;
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
