/** @fileoverview Demand-driven folder and ZIP blueprint events for renderer consumers. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import AdmZip from 'adm-zip';
import { registerAllFactories } from '../../src/serializable/Factories.js';
import { BlueprintHeader, parseSment } from '../../src/smd3/SmentParser.js';
import { parseBlueprintFolder } from '../../src/smd3/BlueprintFolderParser.js';
import { streamBlueprintFolder } from '../../src/smd3/BlueprintStream.js';
import { streamSment } from '../../src/smd3/SmentStream.js';
import { ZipStreamIndex } from '../../src/smd3/ZipStreamIndex.js';
import { writeSmbph } from '../../src/smd3/SmbphWriter.js';
import { emptySegment, emptySmd3File, setBlock, writeSmd3 } from '../../src/smd3/Smd3Writer.js';
import { BLOCK_COUNT } from '../../src/smd3/Smd3Parser.js';

registerAllFactories();
const header = (): Buffer => writeSmbph(new BlueprintHeader({ headerVersion: 5, entityType: 'SHIP',
  boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 31, maxY: 31, maxZ: 31 },
  blockCountByType: [{ type: 5, count: 1 }], totalBlockCount: 1 }));
const region = (): Buffer => {
  const segment = emptySegment(); segment.lastChanged = 123n;
  setBlock(segment, 0, 0, 0, { type: 5, hp: 127, active: true, orientation: 31, extra: 3 });
  return writeSmd3({ ...emptySmd3File(), segments: [segment] });
};
function folder(): { root: string; cleanup: () => void } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-stream-'));
  const root = path.join(parent, 'Ship');
  fs.mkdirSync(path.join(root, 'DATA'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ATTACHED_0'));
  fs.writeFileSync(path.join(root, 'header.smbph'), header());
  fs.writeFileSync(path.join(root, 'DATA', 'Ship.0.0.0.smd3'), region());
  fs.writeFileSync(path.join(root, 'ATTACHED_0', 'header.smbph'), header());
  return { root, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
function archive(files: Array<[string, Buffer]>): { filename: string; cleanup: () => void } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sment-stream-'));
  const filename = path.join(parent, 'Ship.sment');
  const zip = new AdmZip();
  for (const [name, bytes] of files) zip.addFile(name, bytes);
  fs.writeFileSync(filename, zip.toBuffer());
  return { filename, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}
const files = (): Array<[string, Buffer]> => [
  ['Ship/header.smbph', header()], ['Ship/DATA/Ship.0.0.0.smd3', region()],
  ['Ship/ATTACHED_0/header.smbph', header()],
];
async function collect(source: AsyncIterable<any>): Promise<any[]> {
  const events = [];
  for await (const event of source) events.push(event);
  return events;
}

describe('BlueprintStream — folders and .sment', () => {
  it('preserves real folder entity metadata, docking hierarchy and compact blocks', async () => {
    const eager = parseBlueprintFolder('samples/BASE_Warehouse_Station');
    const entities = [], segments = []; let end;
    for await (const event of streamBlueprintFolder('samples/BASE_Warehouse_Station')) {
      if (event.kind === 'entity') entities.push(event);
      else if (event.kind === 'segment') segments.push(event);
      else end = event;
    }
    assert.equal(end?.status, 'complete'); assert.equal(entities.length, eager.totalEntities);
    assert.equal(segments.length, eager.entities.reduce((sum, e) => sum + e.segments.reduce((n, r) => n + r.segments.length, 0), 0));
    assert.equal(entities[0].name, eager.root.name);
    assert.equal(entities[0].header?.entityType, eager.root.header.entityType);
    assert.equal(entities[0].meta?.childTransforms.length, eager.root.meta?.childTransforms.length);
    const child = entities.find(event => event.parentPath === entities[0].path)!;
    const expected = eager.root.child(child.name)!;
    assert.deepEqual(child.offset, expected.offset); assert.deepEqual(child.worldOffset, expected.worldOffset);
    assert.ok(segments.every(event => event.words instanceof Uint32Array && event.words.length === 32768));
    assert.ok(segments.some(event => event.blockCount > 0));
  });

  it('preserves real .sment hierarchy and metadata while inflating only the requested entry', async () => {
    const file = 'samples/firestorm class battlecruiser.sment';
    const eager = parseSment(fs.readFileSync(file));
    const entities = [], segments = []; let end;
    for await (const event of streamSment(file)) {
      if (event.kind === 'entity') entities.push(event);
      else if (event.kind === 'segment') segments.push(event);
      else end = event;
    }
    assert.equal(end?.status, 'complete'); assert.equal(entities.length, eager.totalEntities);
    assert.equal(segments.length, eager.entities.reduce((sum, e) => sum + e.segments.reduce((n, r) => n + r.segments.length, 0), 0));
    assert.equal(entities[0].header?.entityType, eager.root.header.entityType);
    assert.equal(entities[0].meta?.childTransforms.length, eager.root.meta?.childTransforms.length);
    const child = entities.find(event => event.parentPath === entities[0].path)!;
    assert.deepEqual(child.offset, eager.root.child(child.name)!.offset);
    assert.ok(segments.every(event => event.words.length === 32768));
  });

  it('streams a small folder in entity order and reports cancellation or partial recovery', async () => {
    const fixture = folder();
    try {
      const events = [];
      for await (const event of streamBlueprintFolder(fixture.root)) events.push(event);
      assert.deepEqual(events.map(event => event.kind), ['entity', 'segment', 'entity', 'end']);
      const root = events[0], child = events[2];
      if (root.kind === 'entity' && child.kind === 'entity') {
        assert.equal(child.parentPath, root.path); assert.deepEqual(child.worldOffset, { x: 0, y: 0, z: 0 });
      }
      if (events[1].kind === 'segment') assert.equal(events[1].words[0] & 8191, 5);
      const controller = new AbortController();
      const iterator = streamBlueprintFolder(fixture.root, { signal: controller.signal });
      assert.equal((await iterator.next()).value?.kind, 'entity');
      controller.abort();
      const cancelled = await iterator.next();
      assert.equal(cancelled.value?.kind, 'end');
      if (cancelled.value?.kind === 'end') assert.equal(cancelled.value.status, 'cancelled');
      assert.equal((await iterator.next()).done, true);
      fs.writeFileSync(path.join(fixture.root, 'DATA', 'Ship.0.0.0.smd3'), Buffer.alloc(3));
      const recovered = [];
      for await (const event of streamBlueprintFolder(fixture.root, { mode: 'recover' })) recovered.push(event);
      const terminal = recovered.at(-1);
      assert.equal(terminal?.kind, 'end');
      if (terminal?.kind === 'end') assert.equal(terminal.status, 'partial');
      const strict = [];
      for await (const event of streamBlueprintFolder(fixture.root)) strict.push(event);
      if (strict.at(-1)?.kind === 'end') assert.equal(strict.at(-1)!.status, 'error');
    } finally { fixture.cleanup(); }
  });

  it('streams a small ZIP, handles incomplete resources and rejects entry budgets', async () => {
    const fixture = archive(files());
    try {
      const events = [];
      for await (const event of streamSment(fixture.filename)) events.push(event);
      assert.deepEqual(events.map(event => event.kind), ['entity', 'segment', 'entity', 'end']);
      const preAbort = new AbortController(); preAbort.abort();
      const aborted = [];
      for await (const event of streamSment(fixture.filename, { signal: preAbort.signal })) aborted.push(event);
      if (aborted[0].kind === 'end') assert.equal(aborted[0].status, 'cancelled');
      const limited = [];
      for await (const event of streamSment(fixture.filename, { maxEntryBytes: 100 })) limited.push(event);
      if (limited.at(-1)?.kind === 'end') assert.equal(limited.at(-1)!.status, 'error');
    } finally { fixture.cleanup(); }
    const broken = archive([['Ship/header.smbph', header()], ['Ship/DATA/Ship.0.0.0.smd3', Buffer.alloc(3)]]);
    try {
      const events = [];
      for await (const event of streamSment(broken.filename, { mode: 'recover' })) events.push(event);
      if (events.at(-1)?.kind === 'end') assert.equal(events.at(-1)!.status, 'partial');
    } finally { broken.cleanup(); }
  });

  it('bounds folder paths, metadata, regions and block count', async () => {
    const fixture = folder();
    try {
      const first = async (options = {}) => (await collect(streamBlueprintFolder(fixture.root, options))).at(-1);
      const controller = new AbortController(); controller.abort();
      assert.equal((await first({ signal: controller.signal })).status, 'cancelled');
      assert.equal((await first({ maxMetadataBytes: 1 })).status, 'error');
      assert.equal((await first({ segmentOptions: { maxSegments: 0 } })).status, 'error');
      assert.equal((await first({ maxBlocks: BLOCK_COUNT })).status, 'complete');
      fs.writeFileSync(path.join(fixture.root, 'DATA', 'Old.smd2'), Buffer.alloc(1));
      assert.equal((await first()).status, 'error');
      assert.equal((await first({ mode: 'recover' })).status, 'partial');
      fs.rmSync(path.join(fixture.root, 'DATA', 'Old.smd2'));
      fs.symlinkSync('missing', path.join(fixture.root, 'DATA', 'link.smd3'));
      assert.equal((await first()).status, 'error');
      fs.rmSync(path.join(fixture.root, 'DATA', 'link.smd3'));
      fs.symlinkSync('missing', path.join(fixture.root, 'meta.smbpm'));
      assert.equal((await first()).status, 'error');
      fs.rmSync(path.join(fixture.root, 'meta.smbpm'));
      fs.writeFileSync(path.join(fixture.root, 'meta.smbpm'), Buffer.from('invalid'));
      assert.equal((await first({ mode: 'recover' })).status, 'partial');
      fs.rmSync(path.join(fixture.root, 'meta.smbpm'));
      fs.rmSync(path.join(fixture.root, 'header.smbph'));
      assert.equal((await first()).status, 'error');
      assert.equal((await first({ mode: 'recover' })).status, 'partial');
      fs.symlinkSync('missing', path.join(fixture.root, 'danger'));
      assert.equal((await first()).status, 'error');
    } finally { fixture.cleanup(); }
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'not-blueprint-'));
    try {
      fs.writeFileSync(path.join(empty, 'file'), Buffer.alloc(1));
      assert.equal((await collect(streamBlueprintFolder(path.join(empty, 'file')))).at(-1)?.status, 'error');
      fs.symlinkSync('file', path.join(empty, 'link'));
      assert.equal((await collect(streamBlueprintFolder(path.join(empty, 'link')))).at(-1)?.status, 'error');
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });

  it('stops at the next folder boundary and enforces cumulative geometry', async () => {
    const fixture = folder();
    try {
      const data = path.join(fixture.root, 'DATA');
      fs.writeFileSync(path.join(data, 'Second.smd3'), region());
      assert.equal((await collect(streamBlueprintFolder(fixture.root, { maxBlocks: BLOCK_COUNT }))).at(-1)?.status, 'error');
      const cancel = new AbortController();
      const iterator = streamBlueprintFolder(fixture.root, { signal: cancel.signal });
      assert.equal((await iterator.next()).value?.kind, 'entity');
      cancel.abort();
      assert.equal((await iterator.next()).value?.status, 'cancelled');
      assert.equal((await iterator.next()).done, true);
      const between = new AbortController();
      const next = streamBlueprintFolder(fixture.root, { signal: between.signal });
      assert.equal((await next.next()).value?.kind, 'entity');
      assert.equal((await next.next()).value?.kind, 'segment');
      between.abort();
      assert.equal((await next.next()).value?.status, 'cancelled');
      assert.equal((await next.next()).done, true);
    } finally { fixture.cleanup(); }
  });

  it('reports ZIP root, legacy and metadata problems distinctly', async () => {
    for (const content of [
      [['other.txt', Buffer.alloc(1)]] as Array<[string, Buffer]>,
      [['A/header.smbph', header()], ['B/header.smbph', header()]],
      [['Ship/header.smbph', header()], ['Ship/DATA/Old.smd2', Buffer.alloc(1)]],
      [['Ship/header.smbph', Buffer.alloc(1)]],
    ]) {
      const fixture = archive(content);
      try {
        assert.equal((await collect(streamSment(fixture.filename))).at(-1)?.status, 'error');
        if (content[0][0].startsWith('Ship/')) {
          assert.equal((await collect(streamSment(fixture.filename, { mode: 'recover' }))).at(-1)?.status, 'partial');
        }
      } finally { fixture.cleanup(); }
    }
    const fixture = archive([...files(), ['Outside/other.txt', Buffer.alloc(1)]]);
    try {
      const abort = new AbortController();
      const iterator = streamSment(fixture.filename, { signal: abort.signal });
      assert.equal((await iterator.next()).value?.kind, 'entity');
      abort.abort();
      assert.equal((await iterator.next()).value?.status, 'cancelled');
      assert.equal((await iterator.next()).done, true);
      assert.equal((await collect(streamSment(fixture.filename, { maxBlocks: 1 }))).at(-1)?.status, 'error');
    } finally { fixture.cleanup(); }
  });

  it('detects metadata replacement, truncation and same-size mutation while reading', async () => {
    const fixture = folder(), original = fs.promises.open;
    try {
      for (const mutation of ['before', 'truncate', 'after']) {
        fs.promises.open = async (...args: any[]) => {
          const handle = await original(...args as [any, any]);
          if (!String(args[0]).endsWith('header.smbph')) return handle;
          const stat = handle.stat.bind(handle), read = handle.read.bind(handle);
          let calls = 0;
          handle.stat = async (...statArgs: any[]) => {
            const value = await stat(...statArgs as [any]); calls++;
            if (mutation === 'before' && calls === 1) return Object.assign(
              Object.create(Object.getPrototypeOf(value)), value, { ino: value.ino + 1n });
            if (mutation === 'after' && calls === 2) return Object.assign(
              Object.create(Object.getPrototypeOf(value)), value, { mtimeNs: value.mtimeNs + 1n });
            return value;
          };
          handle.read = async (...readArgs: any[]) => mutation === 'truncate' ?
            { bytesRead: 0, buffer: readArgs[0] } as any : read(...readArgs as [any, any, any, any]);
          return handle;
        };
        assert.equal((await collect(streamBlueprintFolder(fixture.root))).at(-1)?.status, 'error');
        assert.equal((await collect(streamBlueprintFolder(fixture.root, { mode: 'recover' }))).at(-1)?.status, 'partial');
      }
    } finally { fs.promises.open = original; fixture.cleanup(); }
  });

  it('can cancel between entities, before a region and inside a region', async () => {
    for (const boundary of ['entities', 'region', 'inside']) {
      const fixture = folder();
      try {
        if (boundary === 'entities') fs.rmSync(path.join(fixture.root, 'DATA'), { recursive: true });
        const controller = new AbortController();
        const iterator = streamBlueprintFolder(fixture.root, { signal: controller.signal });
        assert.equal((await iterator.next()).value?.kind, 'entity');
        if (boundary === 'inside') assert.equal((await iterator.next()).value?.kind, 'segment');
        controller.abort();
        assert.equal((await iterator.next()).value?.status, 'cancelled');
        assert.equal((await iterator.next()).done, true);
      } finally { fixture.cleanup(); }
    }
  });

  it('recovers a malformed segment table and rejects a directory masquerading as a region', async () => {
    const fixture = folder();
    try {
      const filename = path.join(fixture.root, 'DATA', 'Ship.0.0.0.smd3');
      const bytes = fs.readFileSync(filename);
      for (let offset = 4; offset < 4 + 4096 * 4; offset += 4) {
        if (bytes.readInt16BE(offset) !== 0) { bytes.writeInt16BE(-1, offset); break; }
      }
      fs.writeFileSync(filename, bytes);
      assert.equal((await collect(streamBlueprintFolder(fixture.root, { mode: 'recover' }))).at(-1)?.status, 'partial');
      fs.rmSync(filename);
      fs.mkdirSync(filename);
      assert.equal((await collect(streamBlueprintFolder(fixture.root))).at(-1)?.status, 'error');
    } finally { fixture.cleanup(); }
  });

  it('cancels ZIP traversal at each boundary and enforces cumulative block limits', async () => {
    for (const boundary of ['entity', 'region', 'inside']) {
      const content = boundary === 'entity' ? files().filter(([name]) => !name.includes('/DATA/')) : files();
      const fixture = archive(content);
      try {
        const controller = new AbortController();
        const iterator = streamSment(fixture.filename, { signal: controller.signal });
        assert.equal((await iterator.next()).value?.kind, 'entity');
        if (boundary === 'inside') assert.equal((await iterator.next()).value?.kind, 'segment');
        controller.abort();
        assert.equal((await iterator.next()).value?.status, 'cancelled');
        assert.equal((await iterator.next()).done, true);
      } finally { fixture.cleanup(); }
    }
    const fixture = archive([...files(), ['Ship/DATA/Second.smd3', region()]]);
    try {
      assert.equal((await collect(streamSment(fixture.filename, { maxBlocks: BLOCK_COUNT }))).at(-1)?.status, 'error');
    } finally { fixture.cleanup(); }
  });

  it('recovers ZIP metadata and malformed SMD3 records without claiming complete', async () => {
    const bad = region();
    for (let offset = 4; offset < 4 + 4096 * 4; offset += 4) {
      if (bad.readInt16BE(offset) !== 0) { bad.writeInt16BE(-1, offset); break; }
    }
    const fixture = archive([
      ['Ship/header.smbph', header()], ['Ship/meta.smbpm', Buffer.from('bad')],
      ['Ship/DATA/Bad.smd3', bad], ['Ship/ATTACHED_0/header.smbph', header()],
    ]);
    try {
      const events = await collect(streamSment(fixture.filename, { mode: 'recover' }));
      assert.equal(events.at(-1)?.status, 'partial');
      assert.ok(events.at(-1)?.diagnostics.length >= 2);
      assert.equal((await collect(streamSment(fixture.filename))).at(-1)?.status, 'error');
    } finally { fixture.cleanup(); }
  });

  it('reports absent child metadata and does not recover from a metadata byte limit', async () => {
    const missing = archive([['Ship/header.smbph', header()],
      ['Ship/ATTACHED_0/DATA/child.smd3', region()]]);
    try {
      assert.equal((await collect(streamSment(missing.filename))).at(-1)?.status, 'error');
      assert.equal((await collect(streamSment(missing.filename, { mode: 'recover' }))).at(-1)?.status, 'partial');
    } finally { missing.cleanup(); }
    const limited = archive(files());
    try {
      assert.equal((await collect(streamSment(limited.filename, { mode: 'recover',
        maxMetadataBytes: 1 }))).at(-1)?.status, 'error');
    } finally { limited.cleanup(); }
  });

  it('spools ZIP geometry in chunks and removes its temporary file', async () => {
    const fixture = archive(files());
    const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-'));
    try {
      const events = await collect(streamSment(fixture.filename, { maxBufferedEntryBytes: 0 }));
      assert.deepEqual(events.map(event => event.kind), ['entity', 'segment', 'entity', 'end']);
      assert.equal(events.at(-1)?.status, 'complete');
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-')), before);
      const iterator = streamSment(fixture.filename, { maxBufferedEntryBytes: 0 });
      assert.equal((await iterator.next()).value?.kind, 'entity');
      assert.equal((await iterator.next()).value?.kind, 'segment');
      await iterator.return(undefined);
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-')), before);
    } finally { fixture.cleanup(); }
  });

  it('removes temporary geometry after a failed extraction or cancellation', async () => {
    const fixture = archive(files());
    const original = ZipStreamIndex.prototype.readChunks;
    const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-'));
    try {
      ZipStreamIndex.prototype.readChunks = async function* () {
        throw new Error('injected decompression failure');
      };
      assert.equal((await collect(streamSment(fixture.filename, { maxBufferedEntryBytes: 0 }))).at(-1)?.status, 'error');
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-')), before);
      const controller = new AbortController();
      ZipStreamIndex.prototype.readChunks = async function* () {
        controller.abort();
        throw new Error('interrupted extraction');
      };
      assert.equal((await collect(streamSment(fixture.filename,
        { maxBufferedEntryBytes: 0, signal: controller.signal }))).at(-1)?.status, 'cancelled');
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-')), before);
    } finally { ZipStreamIndex.prototype.readChunks = original; fixture.cleanup(); }
  });

  it('rejects a stalled temporary write and cleans the partial file', async () => {
    const fixture = archive(files()), original = fs.promises.open;
    const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-'));
    try {
      fs.promises.open = async (...args: any[]) => {
        const handle = await original(...args as [any, any]);
        if (String(args[0]).includes('starmade-sment-')) {
          handle.write = async () => ({ bytesWritten: 0, buffer: Buffer.alloc(0) }) as any;
        }
        return handle;
      };
      assert.equal((await collect(streamSment(fixture.filename, { maxBufferedEntryBytes: 0 }))).at(-1)?.status, 'error');
      assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('starmade-sment-')), before);
    } finally { fs.promises.open = original; fixture.cleanup(); }
  });
});
