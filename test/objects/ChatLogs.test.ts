/** @fileoverview StarMade ChannelRouter text chatlogs: parsing and bounded file reads. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { ChatLogReader, parseChatLogLine } from '../../src/objects/ChatLogs.js';

const line = (text = 'teste message') => `2026/09/23 - 22:29:11 [InitSysRev]: ${text}`;
function game(): { root: string; file: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starmade-chatlog-'));
  return { root, file: path.join(root, 'chatlogs', 'all.txt'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function write(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data);
}

describe('ChatLogs', () => {
  it('parses the exact ChannelRouter channel and direct formats without inventing a timezone', () => {
    const parsed = parseChatLogLine(line());
    assert.equal(parsed.kind, 'message');
    if (parsed.kind !== 'message') return;
    assert.equal(parsed.timestamp, '2026/09/23 - 22:29:11');
    assert.deepEqual(parsed.calendar, { year: 2026, month: 9, day: 23, hour: 22, minute: 29, second: 11 });
    assert.equal(parsed.author, 'InitSysRev'); assert.equal(parsed.message, 'teste message');
    assert.equal(parsed.recipient, undefined);
    const direct = parseChatLogLine('2000/02/29 - 00:00:00 [Émile -> Admin]: message: [avec] 🚀');
    assert.equal(direct.kind, 'message');
    if (direct.kind === 'message') {
      assert.equal(direct.author, 'Émile'); assert.equal(direct.recipient, 'Admin');
      assert.equal(direct.message, 'message: [avec] 🚀');
    }
    assert.equal(parseChatLogLine(line('')).kind, 'message');
  });

  it('keeps malformed syntax, dates and authors as explicit unparsed records', () => {
    for (const raw of ['', 'noise', '2026/09/23 - 22:29:11 [x]: no\nnewline',
      '2026/09/23 - 22:29:11 [x] no colon']) {
      assert.deepEqual(parseChatLogLine(raw), { kind: 'unparsed', raw, reason: 'format' });
    }
    for (const timestamp of ['0000/01/01 - 00:00:00', '2026/00/01 - 00:00:00',
      '2026/13/01 - 00:00:00', '2026/09/00 - 00:00:00', '2026/09/31 - 00:00:00',
      '1900/02/29 - 00:00:00', '2026/09/23 - 24:00:00',
      '2026/09/23 - 00:60:00', '2026/09/23 - 00:00:60']) {
      const raw = `${timestamp} [x]: a`;
      assert.deepEqual(parseChatLogLine(raw), { kind: 'unparsed', raw, reason: 'date' });
    }
    assert.equal(parseChatLogLine('2024/02/29 - 00:00:00 [x]: a').kind, 'message');
    for (const raw of ['2026/09/23 - 22:29:11 [   ]: x',
      '2026/09/23 - 22:29:11 [ -> Bob]: x', '2026/09/23 - 22:29:11 [Alice ->  ]: x']) {
      assert.deepEqual(parseChatLogLine(raw), { kind: 'unparsed', raw, reason: 'author' });
    }
    assert.throws(() => parseChatLogLine(null as any), TypeError);
  });

  it('treats absent chatlogs as empty and follows only complete appended lines', () => {
    const fixture = game();
    try {
      const reader = new ChatLogReader(fixture.root);
      assert.deepEqual(reader.readRecent().records, []);
      assert.deepEqual(reader.poll({ offset: 0, fileId: null }).records, []);
      fs.mkdirSync(path.dirname(fixture.file));
      assert.equal(reader.readRecent().cursor.fileId, null);
      fs.appendFileSync(fixture.file, line('one'));
      assert.equal(reader.readRecent().records.length, 0);
      fs.appendFileSync(fixture.file, '\n');
      const first = reader.poll({ offset: 0, fileId: null });
      assert.equal(first.reset, true); assert.equal(first.records[0].byteOffset, 0);
      assert.equal(first.records[0].kind, 'message');
      assert.equal(reader.poll(first.cursor).records.length, 0);
      fs.appendFileSync(fixture.file, `${line('two')}\r\n${line('three')}`);
      const second = reader.poll(first.cursor);
      assert.equal(second.records.length, 1);
      assert.equal(second.records[0].raw, line('two'));
      fs.appendFileSync(fixture.file, '\n');
      assert.deepEqual(reader.poll(second.cursor).records.map(record => record.raw), [line('three')]);
      fs.unlinkSync(fixture.file);
      assert.equal(reader.poll(second.cursor).reset, true);
      assert.equal(reader.poll(second.cursor).cursor.fileId, null);
    } finally { fixture.cleanup(); }
  });

  it('bounds recent history, preserves malformed lines and polls a long backlog in pages', () => {
    const fixture = game();
    try {
      const rows = Array.from({ length: 5000 }, (_, i) => `${line(String(i))}\n`);
      rows.push('garbage\n');
      write(fixture.file, rows.join(''));
      const recent = new ChatLogReader(fixture.root, 'all.txt', { maxBytes: 1024, maxLines: 3, maxLineBytes: 100 }).readRecent();
      assert.equal(recent.truncated, true); assert.equal(recent.records.length, 3);
      assert.deepEqual(recent.records.map(record => record.raw), [line('4998'), line('4999'), 'garbage']);
      assert.equal(recent.records[2].kind, 'unparsed');
      const reader = new ChatLogReader(fixture.root, 'all.txt', { maxBytes: 256, maxLines: 2, maxLineBytes: 100 });
      let cursor = { offset: 0, fileId: null as string | null }, seen = 0;
      while (true) {
        const batch = reader.poll(cursor);
        seen += batch.records.length;
        if (seen === 2) assert.equal(batch.hasMore, true);
        cursor = batch.cursor;
        if (!batch.hasMore) break;
        assert.ok(seen < 6000);
      }
      assert.equal(seen, 5001);
      assert.equal(cursor.offset, Buffer.byteLength(rows.join('')));
      assert.equal(reader.poll(cursor).hasMore, false);
    } finally { fixture.cleanup(); }
  });

  it('resets after rotation and truncation, and limits incomplete/oversized lines', () => {
    const fixture = game();
    try {
      write(fixture.file, `${line('old')}\n`);
      const reader = new ChatLogReader(fixture.root, 'all.txt', { maxBytes: 256, maxLines: 2, maxLineBytes: 100 });
      const prior = reader.readRecent().cursor;
      fs.renameSync(fixture.file, `${fixture.file}.old`);
      write(fixture.file, `${line('new')}\n`);
      const rotated = reader.poll(prior);
      assert.equal(rotated.reset, true); assert.equal(rotated.records[0].raw, line('new'));
      fs.truncateSync(fixture.file, 0);
      const short = reader.poll(rotated.cursor);
      assert.equal(short.reset, true); assert.equal(short.records.length, 0);
      write(fixture.file, 'x'.repeat(101));
      assert.throws(() => reader.poll(short.cursor), { code: 'E_LIMIT' });
      write(fixture.file, `${'x'.repeat(101)}\n`);
      assert.throws(() => reader.readRecent(), { code: 'E_LIMIT' });
      write(fixture.file, 'x'.repeat(300));
      assert.throws(() => reader.readRecent(), { code: 'E_LIMIT' });
    } finally { fixture.cleanup(); }
  });

  it('rejects path traversal, symlinks, directories, invalid limits and invalid cursors', () => {
    const fixture = game();
    try {
      for (const name of ['../all.txt', 'dir/all.txt', 'dir\\all.txt', 'all.log', 'a\0.txt', 'a\n.txt', `${'a'.repeat(252)}.txt`]) {
        assert.throws(() => new ChatLogReader(fixture.root, name), { code: 'E_RANGE' });
      }
      assert.throws(() => new ChatLogReader('', 'all.txt'), TypeError);
      assert.throws(() => new ChatLogReader(fixture.root, 'all.txt', { maxBytes: 100, maxLineBytes: 100 }), { code: 'E_RANGE' });
      assert.throws(() => new ChatLogReader(fixture.root, 'all.txt', { maxLines: 0 }), { code: 'E_RANGE' });
      assert.throws(() => new ChatLogReader(fixture.root, 'all.txt', { maxLineBytes: 0 }), { code: 'E_RANGE' });
      assert.throws(() => new ChatLogReader(fixture.root, 'all.txt', { maxBytes: 64 * 1024 * 1024 + 1 }), { code: 'E_RANGE' });
      const reader = new ChatLogReader(fixture.root);
      for (const cursor of [null, { offset: -1, fileId: null }, { offset: 1.5, fileId: null },
        { offset: 0, fileId: 2 }, { offset: 0, fileId: 'bad' }]) {
        assert.throws(() => reader.poll(cursor as any), { code: 'E_RANGE' });
      }
      fs.mkdirSync(path.dirname(fixture.file));
      fs.symlinkSync(fixture.root, fixture.file);
      assert.throws(() => reader.readRecent(), { code: 'E_IO' });
      fs.unlinkSync(fixture.file);
      fs.mkdirSync(fixture.file);
      assert.throws(() => reader.readRecent(), { code: 'E_IO' });
      fs.rmdirSync(fixture.file);
      fs.rmdirSync(path.dirname(fixture.file));
      fs.symlinkSync(fixture.root, path.dirname(fixture.file));
      assert.throws(() => reader.readRecent(), { code: 'E_IO' });
      assert.throws(() => new ChatLogReader(path.join(fixture.root, 'missing')).readRecent(), { code: 'E_IO' });
    } finally { fixture.cleanup(); }
  });

  it('decodes UTF-8 strictly and accepts the installed game sample when present', () => {
    const fixture = game();
    try {
      write(fixture.file, Buffer.from([0xff, 0x0a]));
      assert.throws(() => new ChatLogReader(fixture.root).readRecent(), { code: 'E_FORMAT' });
      const installed = process.env.STARMADE_TEST_DIR;
      if (installed && fs.existsSync(path.join(installed, 'chatlogs', 'all.txt'))) {
        const records = new ChatLogReader(installed).readRecent().records;
        assert.ok(records.some(record => record.kind === 'message'));
      }
    } finally { fixture.cleanup(); }
  });

  it('reports inspection/open failures and replacement between stat and open', () => {
    const fixture = game();
    const replace = (method: 'lstatSync' | 'openSync' | 'fstatSync', replacement: (...args: any[]) => any,
      check: () => void): void => {
      const original = (fs as any)[method];
      try { (fs as any)[method] = replacement; check(); }
      finally { (fs as any)[method] = original; }
    };
    try {
      write(fixture.file, `${line()}\n`);
      const reader = new ChatLogReader(fixture.root);
      const lstat = fs.lstatSync;
      replace('lstatSync', (...args) => {
        if (args[0] === fixture.file) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return lstat(...args as [any]);
      }, () => assert.throws(() => reader.readRecent(), { code: 'E_IO' }));
      for (const code of ['ENOENT', 'EACCES']) {
        replace('openSync', () => { throw Object.assign(new Error(code), { code }); }, () => {
          if (code === 'ENOENT') assert.equal(reader.readRecent().records.length, 0);
          else assert.throws(() => reader.readRecent(), { code: 'E_IO' });
        });
      }
      const fstat = fs.fstatSync;
      for (const change of [{ isFile: () => false }, { dev: -1n }, { ino: -1n },
        { size: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]) {
        replace('fstatSync', (...args) => {
          const stat = fstat(...args as [any]);
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, change);
        }, () => assert.throws(() => reader.readRecent(), { code: 'size' in change ? 'E_LIMIT' : 'E_IO' }));
      }
    } finally { fixture.cleanup(); }
  });

  it('reports truncation and same-length rewrites during a bounded read', () => {
    const fixture = game();
    try {
      write(fixture.file, `${line()}\n`);
      const reader = new ChatLogReader(fixture.root);
      const originalRead = fs.readSync;
      try {
        (fs as any).readSync = () => 0;
        assert.throws(() => reader.readRecent(), { code: 'E_IO' });
      } finally { (fs as any).readSync = originalRead; }
      const originalStat = fs.fstatSync;
      for (const change of [(stat: fs.BigIntStats) => ({ size: stat.size - 1n }),
        (stat: fs.BigIntStats) => ({ mtimeNs: stat.mtimeNs + 1n })]) {
        let count = 0;
        try {
          (fs as any).fstatSync = (...args: any[]) => {
            const stat = originalStat(...args as [any]);
            return ++count === 3 ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, change(stat)) : stat;
          };
          assert.throws(() => reader.readRecent(), { code: 'E_IO' });
        } finally { (fs as any).fstatSync = originalStat; }
      }
    } finally { fixture.cleanup(); }
  });
});
