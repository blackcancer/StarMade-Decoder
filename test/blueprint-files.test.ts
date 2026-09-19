/** @fileoverview Blueprint file snapshots and staged filesystem publication contracts. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { readBlueprintFiles, writeBlueprintFiles } from '../src/smd3/BlueprintFiles.js';

/** Runs a fixture in a private disposable directory. */
function temporary(run: (directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-files-'));
  try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
/** Replaces only selected synchronous I/O boundaries, restoring them even on failure. */
function patchFs(patch: Partial<typeof fs>, run: () => void): void {
  const original = Object.fromEntries(Object.keys(patch).map(key => [key, (fs as any)[key]]));
  Object.assign(fs, patch);
  try { run(); } finally { Object.assign(fs, original); }
}
/** Snapshot containing Java's blueprint hierarchy and an opaque extension. */
function inventory(): Map<string, Buffer | null> {
  return new Map<string, Buffer | null>([
    ['Root/', null], ['Root/header.smbph', Buffer.alloc(36)], ['Root/meta.smbpm', Buffer.from([0, 0, 0, 5, 1])],
    ['Root/logic.smbpl', Buffer.from([0, 0, 0, 0])], ['Root/modmappings.smbmm', Buffer.from([4, 5, 6])],
    ['Root/DATA/', null], ['Root/DATA/entity.0.0.0.smd3', Buffer.from([0, 1, 255])],
    ['Root/ATTACHED_0/', null], ['Root/ATTACHED_0/header.smbph', Buffer.alloc(36, 7)],
    ['Root/ATTACHED_0/ATTACHED_9/', null], ['Root/unknown/empty/', null],
    ['Root/unknown/extension.bin', Buffer.from([0, 255, 128])],
  ]);
}

describe('Blueprint files: complete snapshots and bounded writes', () => {
  it('preserves unknown bytes, empty directories and attached hierarchy through folders', () => temporary(directory => {
    const target = path.join(directory, 'Root');
    const entries = inventory();
    writeBlueprintFiles(entries, target, 'Root');
    const actual = readBlueprintFiles(target);
    for (const [name, bytes] of entries) assert.deepEqual(actual.get(name), bytes, name);
    assert.equal(actual.get('Root/unknown/'), null);
    assert.equal(actual.size, entries.size + 1);
    const copied = path.join(directory, 'Renamed');
    writeBlueprintFiles(actual, copied, 'Root');
    assert.deepEqual(fs.readFileSync(path.join(copied, 'unknown/extension.bin')), Buffer.from([0, 255, 128]));
    actual.get('Root/header.smbph')![0] = 99;
    assert.equal(fs.readFileSync(path.join(target, 'header.smbph'))[0], 0);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['Renamed', 'Root']);
  }));

  it('refuses existing targets by default and replaces them only with explicit overwrite', () => temporary(directory => {
    const target = path.join(directory, 'Root'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'old'), 'old');
    assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root'), /exist/i);
    assert.equal(fs.readFileSync(path.join(target, 'old'), 'utf8'), 'old');
    writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true });
    assert.equal(fs.existsSync(path.join(target, 'old')), false);
    assert.deepEqual(fs.readdirSync(directory), ['Root']);
  }));

  it('validates unsafe names, entry kinds and file/parent conflicts before creating anything', () => temporary(directory => {
    const target = path.join(directory, 'Output');
    const bad: Map<string, Buffer | null>[] = [
      new Map([['Other/a', Buffer.alloc(0)]]), new Map([['Root/../a', Buffer.alloc(0)]]),
      new Map([['Root/a\\b', Buffer.alloc(0)]]), new Map([['Root/a//b', Buffer.alloc(0)]]),
      new Map([['Root/a/', Buffer.alloc(0)]]), new Map([['Root/a', null]]),
      new Map([['Root/a', Buffer.alloc(0)], ['Root/a/b', Buffer.alloc(0)]]),
      new Map([['Root/a/b', Buffer.alloc(0)], ['Root/a', Buffer.alloc(0)]]),
      new Map([['Root/a', Buffer.alloc(0)], ['Root/a/', null]]),
    ];
    for (const entries of bad) assert.throws(() => writeBlueprintFiles(entries, target, 'Root'));
    for (const name of ['', '.', '..', 'Root/child', 'C:', 'bad\0name']) {
      assert.throws(() => writeBlueprintFiles(new Map(), target, name));
    }
    assert.deepEqual(fs.readdirSync(directory), []);
  }));

  it('enforces aggregate bytes, single-file size, entry count and directory depth on both directions', () => temporary(directory => {
    const target = path.join(directory, 'Root');
    for (const limits of [{ maxEntries: 0 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }, { maxDepth: 0 }]) {
      assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', limits), /budget/i);
      assert.equal(fs.existsSync(target), false);
    }
    writeBlueprintFiles(inventory(), target, 'Root');
    for (const limits of [{ maxEntries: 0 }, { maxEntryBytes: 1 }, { maxTotalBytes: 1 }, { maxDepth: 0 }]) {
      assert.throws(() => readBlueprintFiles(target, limits), /budget/i);
    }
    assert.throws(() => readBlueprintFiles(target, { maxDepth: -1 }));
  }));

  it('rejects filesystem symlinks and non-directory roots or publication parents', () => temporary(directory => {
    const source = path.join(directory, 'Root'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'regular'), 'x');
    const link = path.join(directory, 'Link'); fs.symlinkSync(source, link);
    assert.throws(() => readBlueprintFiles(link));
    assert.throws(() => readBlueprintFiles(path.join(source, 'regular')));
    assert.throws(() => writeBlueprintFiles(inventory(), link, 'Root', { overwrite: true }));
    assert.throws(() => writeBlueprintFiles(inventory(), path.join(link, 'out'), 'Root'));
    fs.symlinkSync(path.join(source, 'regular'), path.join(source, 'link'));
    assert.throws(() => readBlueprintFiles(source));
  }));
});

describe('Blueprint files: filesystem failures preserve existing data', () => {
  it('creates empty roots and zero-byte files while rejecting malformed map iterators and destination kinds', () => temporary(directory => {
    const empty = path.join(directory, 'Empty');
    writeBlueprintFiles(new Map(), empty, 'Root', { maxEntries: 1, maxDepth: 0, maxTotalBytes: 0 });
    assert.deepEqual(readBlueprintFiles(empty), new Map([['Empty/', null]]));
    const output = path.join(directory, 'Output');
    writeBlueprintFiles(new Map([['Root/zero', Buffer.alloc(0)]]), output, 'Root', { maxDepth: 0 });
    assert.equal(readBlueprintFiles(output).get('Output/zero')!.length, 0);
    const duplicate = { *[Symbol.iterator]() { yield ['Root/a', Buffer.alloc(0)]; yield ['Root/a', Buffer.alloc(0)]; } };
    assert.throws(() => writeBlueprintFiles(duplicate as any, path.join(directory, 'Duplicate'), 'Root'), /Duplicate/);
    assert.throws(() => writeBlueprintFiles(new Map(), output, 'Root/'), /root name/);
    assert.throws(() => writeBlueprintFiles(new Map([['Root', Buffer.alloc(0)]]), output, 'Root'), /root or kind/);
    assert.throws(() => writeBlueprintFiles(new Map(), path.parse(directory).root, 'Root'), /filesystem root/);
    assert.throws(() => writeBlueprintFiles(new Map(), path.join(output, 'zero'), 'Root', { overwrite: true }), /directory/);
    assert.throws(() => writeBlueprintFiles(new Map(), path.join(directory, 'missing', 'Root'), 'Root'));
    assert.throws(() => writeBlueprintFiles(new Map([['Root/' + 'x'.repeat(4096), Buffer.alloc(0)]]), output, 'Root'), /Unsafe/);
  }));

  it('cleans staging files after a failed write without replacing the existing destination', () => temporary(directory => {
    const target = path.join(directory, 'Root'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'old'), 'preserve');
    const originalWrite = fs.writeFileSync;
    patchFs({ writeFileSync: ((filename: any, ...args: any[]) => {
      if (String(filename).includes('-stage-')) throw new Error('simulated full disk');
      return (originalWrite as any)(filename, ...args);
    }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true }), /full disk/));
    assert.equal(fs.readFileSync(path.join(target, 'old'), 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(directory), ['Root']);
  }));

  it('restores the old folder if installation fails and removes an unsuccessful new publication', () => temporary(directory => {
    const rename = fs.renameSync;
    for (const overwrite of [false, true]) {
      const target = path.join(directory, overwrite ? 'Existing' : 'New');
      if (overwrite) { fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'old'), 'preserve'); }
      patchFs({ renameSync: ((source: any, destination: any) => {
        if (path.basename(String(source)) === 'next') throw new Error('simulated installation failure');
        return rename(source, destination);
      }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite }), /installation failure/));
      if (overwrite) assert.equal(fs.readFileSync(path.join(target, 'old'), 'utf8'), 'preserve');
      else assert.equal(fs.existsSync(target), false);
    }
    assert.deepEqual(fs.readdirSync(directory), ['Existing']);
  }));

  it('retains and identifies the backup when both installation and rollback fail', () => temporary(directory => {
    const target = path.join(directory, 'Root'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'old'), 'preserve');
    const rename = fs.renameSync;
    let backup = '';
    patchFs({ renameSync: ((source: any, destination: any) => {
      if (['next', 'previous'].includes(path.basename(String(source)))) throw new Error('destination unavailable');
      return rename(source, destination);
    }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true }), (error: any) => {
      backup = error.path;
      return error.code === 'E_IO' && error.cause instanceof AggregateError && /original data retained/.test(error.message);
    }));
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readFileSync(path.join(backup, 'old'), 'utf8'), 'preserve');
    assert.equal(fs.readdirSync(directory).length, 1);
  }));

  it('does not replace destinations created, removed or changed while output is staged', () => temporary(directory => {
    const write = fs.writeFileSync;
    for (const mutation of ['created', 'removed', 'changed']) {
      const target = path.join(directory, mutation);
      if (mutation !== 'created') fs.mkdirSync(target);
      let changed = false;
      patchFs({ writeFileSync: ((filename: any, ...args: any[]) => {
        const result = (write as any)(filename, ...args);
        if (!changed && String(filename).includes('-stage-')) {
          changed = true;
          if (mutation === 'created') fs.mkdirSync(target);
          else if (mutation === 'removed') fs.rmdirSync(target);
          else fs.utimesSync(target, 1, 1);
        }
        return result;
      }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true }), /changed before publication/));
      assert.equal(fs.existsSync(target), mutation !== 'removed');
    }
    assert.deepEqual(fs.readdirSync(directory).sort(), ['changed', 'created']);
  }));

  it('propagates permission failures and backup-rename failures without removing old data', () => temporary(directory => {
    const target = path.join(directory, 'Root'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'old'), 'preserve');
    const lstat = fs.lstatSync, rename = fs.renameSync;
    patchFs({ lstatSync: ((filename: any, ...args: any[]) => {
      if (String(filename) === target) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return (lstat as any)(filename, ...args);
    }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true }), /permission/));
    patchFs({ renameSync: ((source: any, destination: any) => {
      if (String(source) === target) throw new Error('backup unavailable');
      return rename(source, destination);
    }) as any }, () => assert.throws(() => writeBlueprintFiles(inventory(), target, 'Root', { overwrite: true }), /backup unavailable/));
    assert.equal(fs.readFileSync(path.join(target, 'old'), 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(directory), ['Root']);
  }));
});

describe('Blueprint files: input snapshots reject concurrent mutations', () => {
  it('rejects unsupported filesystem nodes and unsafe source names', () => temporary(directory => {
    const root = path.join(directory, 'Root'); fs.mkdirSync(root); const file = path.join(root, 'file'); fs.writeFileSync(file, 'x');
    const lstat = fs.lstatSync;
    patchFs({ lstatSync: ((filename: any, ...args: any[]) => {
      const stat = (lstat as any)(filename, ...args);
      if (String(filename) === file) return Object.assign(stat, { isFile: () => false });
      return stat;
    }) as any }, () => assert.throws(() => readBlueprintFiles(root), /regular blueprint file/));
    fs.writeFileSync(path.join(root, 'unsafe:name'), 'x');
    assert.throws(() => readBlueprintFiles(root), /Unsafe/);
  }));

  it('rejects changed identities or nonregular descriptors before allocating file contents', () => temporary(directory => {
    const root = path.join(directory, 'Root'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'file'), 'x');
    const fstat = fs.fstatSync;
    for (const patch of [{ dev: -1 }, { ino: -1 }, { size: 2 }, { mtimeMs: -1 }, { ctimeMs: -1 }, { isFile: () => false }]) {
      patchFs({ fstatSync: ((fd: any) => Object.assign(fstat(fd), patch)) as any },
        () => assert.throws(() => readBlueprintFiles(root), /changed before reading/));
    }
  }));

  it('detects truncation, growth, metadata changes and path replacement during reads', () => temporary(directory => {
    const root = path.join(directory, 'Root'); fs.mkdirSync(root); const file = path.join(root, 'file');
    const read = fs.readSync, fstat = fs.fstatSync, lstat = fs.lstatSync;
    for (const change of ['truncated', 'grown', 'modified', 'replaced']) {
      fs.writeFileSync(file, 'a'); let reads = 0;
      patchFs({
        readSync: ((...args: any[]) => {
          if (reads++ === 0) {
            if (change === 'truncated') fs.truncateSync(file);
            if (change === 'grown') fs.appendFileSync(file, 'b');
          }
          return (read as any)(...args);
        }) as any,
        fstatSync: ((...args: any[]) => {
          const stat = (fstat as any)(...args);
          if (change === 'modified' && reads > 0) stat.mtimeMs += 1;
          return stat;
        }) as any,
        lstatSync: ((filename: any, ...args: any[]) => {
          const stat = (lstat as any)(filename, ...args);
          if (change === 'replaced' && String(filename) === file && reads > 0) stat.ino += 1;
          return stat;
        }) as any,
      }, () => assert.throws(() => readBlueprintFiles(root), /truncated while reading|changed while reading/));
    }
  }));

  it('rejects directory identity changes after all children have been consumed', () => temporary(directory => {
    const root = path.join(directory, 'Root'); fs.mkdirSync(root); const lstat = fs.lstatSync; let calls = 0;
    patchFs({ lstatSync: ((filename: any, ...args: any[]) => {
      const stat = (lstat as any)(filename, ...args);
      if (String(filename) === root && calls++ > 0) stat.ino += 1;
      return stat;
    }) as any }, () => assert.throws(() => readBlueprintFiles(root), /directory changed/));
  }));
});
