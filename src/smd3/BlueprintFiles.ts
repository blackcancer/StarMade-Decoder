/**
 * @fileoverview Complete blueprint file snapshots and staged folder publication.
 * Preserves opaque extensions and empty directories alongside Java's
 * blueprintnw/BlueprintEntry hierarchy (DATA, ATTACHED_N and metadata files).
 * File contents are preserved; permissions, timestamps and ZIP attributes are not.
 * Synchronous checks detect ordinary input changes but do not sandbox concurrent
 * processes replacing ancestor directories. Publication uses same-filesystem
 * renames with rollback, not a multi-file transaction across processes.
 * @author InitSysRev
 * @version 1.5.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { DecodeError } from '../core/DecodeError.js';
import { BlueprintReadContext } from './BlueprintReadContext.js';
import type { BlueprintParseOptions } from './BlueprintReadContext.js';

/**
 * Checks a relative archive-style name without silently normalizing it.
 * @param name - Name including its root component and optional directory slash.
 * @returns Validated path components.
 */
function components(name: string): string[] {
  const parts = name.replace(/\/$/, '').split('/');
  if (!name || name.length > 4096 || /[\\\0:]/.test(name) ||
      parts.some(part => !part || part === '.' || part === '..')) {
    throw new DecodeError('E_FORMAT', 'Unsafe blueprint entry path', { path: name });
  }
  return parts;
}

/**
 * Requires a concrete directory rather than following a symbolic link.
 * @param directory - Existing directory path.
 * @returns Its filesystem identity.
 */
function directoryStat(directory: string): fs.Stats {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DecodeError('E_FORMAT', 'Expected a regular blueprint directory', { path: directory });
  }
  return stat;
}

/**
 * Compares identity and mutation indicators for one filesystem snapshot.
 * @param before - Initial stat.
 * @param after - Subsequent stat.
 * @returns Whether both observations describe unchanged contents.
 */
function unchanged(before: fs.Stats, after: fs.Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/**
 * Reads an already classified file without unbounded readFile allocation.
 * @param filename - Absolute source path.
 * @param initial - Initial lstat, before opening the file.
 * @param context - Shared entry and byte limits.
 * @returns Independent snapshot bytes.
 */
function readFile(filename: string, initial: fs.Stats, context: BlueprintReadContext): Buffer {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !unchanged(initial, opened)) {
      throw new DecodeError('E_IO', 'Blueprint file changed before reading', { path: filename });
    }
    context.chargeBytes(opened.size);
    const data = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, null);
      if (!count) throw new DecodeError('E_IO', 'Blueprint file was truncated while reading', { path: filename });
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(fd, extra, 0, 1, null) !== 0 || !unchanged(opened, fs.fstatSync(fd)) ||
        !unchanged(opened, fs.lstatSync(filename))) {
      throw new DecodeError('E_IO', 'Blueprint file changed while reading', { path: filename });
    }
    return data;
  } finally { fs.closeSync(fd); }
}

/**
 * Captures every blueprint file, including unrecognized files and empty folders.
 * Keys include the source folder basename as their root; directory values are
 * null and names end with '/'. Limits apply to all files and directories,
 * including the root. Depth counts directories below the blueprint root.
 * @param folderPath - Existing blueprint root directory.
 * @param options - Aggregate byte, entry and directory-depth limits.
 * @returns A complete independent map; failures never return a partial snapshot.
 * @throws {Error} For unsafe paths, unsupported nodes, changing files or I/O errors.
 */
export function readBlueprintFiles(folderPath: string, options: BlueprintParseOptions = {}): Map<string, Buffer | null> {
  const context = new BlueprintReadContext(options);
  const folder = path.resolve(folderPath);
  const rootName = path.basename(folder);
  components(rootName);
  const entries = new Map<string, Buffer | null>();
  /** Reads a single directory under the operation's aggregate limits. */
  function visit(directory: string, name: string, depth: number): void {
    if (depth > context.maxDepth) throw new DecodeError('E_LIMIT', 'Blueprint directory depth budget exceeded', { path: name });
    const initial = directoryStat(directory);
    context.chargeFile();
    entries.set(`${name}/`, null);
    const handle = fs.opendirSync(directory);
    try {
      let child: fs.Dirent | null;
      while ((child = handle.readSync()) !== null) {
        const entryName = `${name}/${child.name}`;
        components(entryName);
        const filename = path.join(directory, child.name);
        const stat = fs.lstatSync(filename);
        if (stat.isSymbolicLink()) throw new DecodeError('E_FORMAT', 'Blueprint symlinks are not supported', { path: entryName });
        if (stat.isDirectory()) visit(filename, entryName, depth + 1);
        else {
          if (!stat.isFile()) throw new DecodeError('E_FORMAT', 'Expected a regular blueprint file', { path: entryName });
          context.chargeFile();
          entries.set(entryName, readFile(filename, stat, context));
        }
      }
    } finally { handle.closeSync(); }
    if (!unchanged(initial, fs.lstatSync(directory))) {
      throw new DecodeError('E_IO', 'Blueprint directory changed while reading', { path: name });
    }
  }
  visit(folder, rootName, 0);
  return entries;
}

/**
 * Validates a complete publication map and includes implicit parent directories.
 * @param entries - Archive-style file inventory.
 * @param rootName - Single root component to remove from every entry.
 * @param context - Limits charged before filesystem changes.
 * @returns Relative output names and defensive copies of all file contents.
 */
function planFiles(entries: ReadonlyMap<string, Buffer | null>, rootName: string,
  context: BlueprintReadContext): Map<string, Buffer | null> {
  if (components(rootName).length !== 1 || rootName.endsWith('/')) throw new DecodeError('E_FORMAT', 'Invalid blueprint root name');
  const planned = new Map<string, Buffer | null>([['', null]]);
  context.chargeFile();
  const explicit = new Set<string>();
  for (const [name, bytes] of entries) {
    const parts = components(name);
    const directory = name.endsWith('/');
    if (parts[0] !== rootName || (!directory && parts.length === 1) ||
        (directory ? bytes !== null : !Buffer.isBuffer(bytes))) {
      throw new DecodeError('E_FORMAT', 'Invalid blueprint entry root or kind', { path: name });
    }
    if (explicit.has(name)) throw new DecodeError('E_FORMAT', 'Duplicate blueprint entry', { path: name });
    explicit.add(name);
    const relative = parts.slice(1).join('/');
    const depth = parts.length - (directory ? 1 : 2);
    if (depth > context.maxDepth) throw new DecodeError('E_LIMIT', 'Blueprint directory depth budget exceeded', { path: name });
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(1, index).join('/');
      if (planned.has(parent) && planned.get(parent) !== null) {
        throw new DecodeError('E_FORMAT', 'Blueprint file conflicts with a parent directory', { path: name });
      }
      if (!planned.has(parent)) context.chargeFile();
      planned.set(parent, null);
    }
    if (planned.has(relative) && (!directory || planned.get(relative) !== null)) {
      throw new DecodeError('E_FORMAT', 'Blueprint file/directory conflict', { path: name });
    }
    if (!directory) context.chargeBytes(bytes!.length);
    if (!planned.has(relative)) context.chargeFile();
    planned.set(relative, bytes);
  }
  for (const [name, bytes] of planned) {
    if (bytes !== null) planned.set(name, Buffer.from(bytes));
  }
  return planned;
}

/**
 * Looks up a destination without hiding permission failures or dangling links.
 * @param filename - Destination path.
 * @returns Its lstat or null only when the path does not exist.
 */
function existingStat(filename: string): fs.Stats | null {
  try { return fs.lstatSync(filename); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Publishes a complete blueprint folder using a sibling staging directory.
 * All entry validation and byte snapshots precede filesystem changes. The
 * target directory itself becomes the blueprint root. Its parent must exist.
 * Existing targets require overwrite:true; they are moved to a backup before
 * installation and restored on failure. If restoration fails, the backup is
 * retained and its location is reported. Cleanup failure after installation
 * can leave a sibling staging directory; the installed output remains intact.
 * @param entries - Full inventory with root-prefixed ZIP-style keys.
 * @param targetDirectory - Output root folder, not its parent.
 * @param rootName - Root prefix to strip from the inventory.
 * @param options - Resource limits and explicit replacement authorization.
 * @throws {Error} For invalid input, existing targets, limits or filesystem failures.
 */
export function writeBlueprintFiles(entries: ReadonlyMap<string, Buffer | null>, targetDirectory: string,
  rootName: string, options: BlueprintParseOptions & { overwrite?: boolean } = {}): void {
  const planned = planFiles(entries, rootName, new BlueprintReadContext(options));
  const target = path.resolve(targetDirectory);
  const parent = path.dirname(target);
  if (target === parent) throw new DecodeError('E_FORMAT', 'Cannot replace a filesystem root');
  directoryStat(parent);
  const initial = existingStat(target);
  if (initial && (!initial.isDirectory() || initial.isSymbolicLink())) {
    throw new DecodeError('E_FORMAT', 'Expected a regular blueprint destination directory', { path: target });
  }
  if (initial && options.overwrite !== true) throw new DecodeError('E_IO', 'Blueprint destination already exists', { path: target });
  const temporary = fs.mkdtempSync(path.join(parent, `.${path.basename(target)}-stage-`));
  const staged = path.join(temporary, 'next');
  const backup = path.join(temporary, 'previous');
  let retainBackup = false;
  try {
    fs.mkdirSync(staged);
    for (const [name, bytes] of planned) {
      const filename = path.join(staged, name);
      if (bytes === null) fs.mkdirSync(filename, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, bytes, { flag: 'wx' });
      }
    }
    const current = existingStat(target);
    if (initial ? !current || !unchanged(initial, current) : current !== null) {
      throw new DecodeError('E_IO', 'Blueprint destination changed before publication', { path: target });
    }
    if (initial) fs.renameSync(target, backup);
    try { fs.renameSync(staged, target); }
    catch (error) {
      if (initial) {
        try { fs.renameSync(backup, target); }
        catch (rollbackError) {
          retainBackup = true;
          throw new DecodeError('E_IO', `Blueprint installation and rollback failed; original data retained at ${backup}`,
            { path: backup, cause: new AggregateError([error, rollbackError]) });
        }
      }
      throw error;
    }
  } finally {
    if (!retainBackup) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
