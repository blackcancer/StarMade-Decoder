/**
 * @fileoverview Immutable server chat channels with strict historical schemas and retained Tag envelopes.
 * Server versions 0/1 store password and permanence at slots 4/5; version 2 adds
 * the muted list at slot 4 and stores password/permanence/public at slots 5/6/7.
 * @author InitSysRev
 * @version 2.0.0
 */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { readFrom, readTagDocument, writeTo, type TagDocument, type TagReadOptions } from '../core/TagParser.js';
import { DecodeError } from '../core/DecodeError.js';

/** Named editable values; the saved server version remains explicit and immutable. */
export interface ChatChannelFields {
  uid: string;
  password: string;
  isPermanent: boolean;
  isPublic: boolean;
  moderators: readonly string[];
  banned: readonly string[];
  muted: readonly string[];
}
/** Original binary record and its semantic baseline for changed-field comparison. */
interface ChannelSource { bytes: Buffer; fields: Buffer[]; }
/** Private snapshots cannot be changed through model fields or returned Tags. */
const sources = new WeakMap<object, ChannelSource>();
/** Complete file envelopes are retained across manager updates. */
const documents = new WeakMap<ChatChannelManager, TagDocument>();

/** Internal copies reuse per-tree limits without consuming an external file budget again. */
function localOptions(options: TagReadOptions): TagReadOptions {
  const { maxInputBytes, sharedInflationBudget, sharedNodeBudget, allowTrailingBytes, ...limits } = options;
  return { ...limits };
}
/** Reads the private canonical snapshot, whose byte count was already validated on creation. */
function restore(bytes: Buffer, options: TagReadOptions): Tag {
  return readFrom(bytes, { ...options, maxInputBytes: bytes.length });
}
/** Requires a complete STRUCT instead of inventing an empty record. */
function children(tag: Tag): Tag[] {
  if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Chat channels require a STRUCT');
  return tag.getStruct().filter(child => child.type !== TagType.FINISH);
}
/** Records the original schema, names and extensions independently from caller-owned data. */
function remember(model: object, tag: Tag, fields: Tag[], options: TagReadOptions): void {
  sources.set(model, { bytes: writeTo(tag, options), fields: fields.map(field => writeTo(field, options)) });
}
/** Shares immutable private bytes between an original model and its validated replacement. */
function inherit<T extends object>(source: object, target: T): T {
  const saved = sources.get(source);
  if (saved) sources.set(target, saved);
  return target;
}
/** Retains the names of surviving list members, including duplicate strings in historical files. */
function namedStrings(previous: Tag, values: Tag): Tag {
  const byValue = new Map<string, { tags: Tag[]; next: number }>();
  for (const tag of children(previous)) {
    const key = tag.getString(), existing = byValue.get(key);
    if (existing) existing.tags.push(tag);
    else byValue.set(key, { tags: [tag], next: 0 });
  }
  return Tags.struct(previous.name, children(values).map(tag => {
    const saved = byValue.get(tag.getString());
    return saved ? saved.tags[saved.next++] ?? tag : tag;
  }));
}
/** Patches only changed known fields; untouched fields retain their original bytes and names. */
function render(model: object, fields: Tag[], initial: Tag, options: TagReadOptions, stringLists: readonly number[]): Tag {
  const saved = sources.get(model);
  if (!saved) return initial;
  const root = restore(saved.bytes, options), data = children(root);
  fields.forEach((field, index) => {
    if (saved.fields[index].equals(writeTo(field, options))) return;
    data[index] = stringLists.includes(index) ? namedStrings(data[index], field) : Tags.rename(field, data[index].name);
  });
  return Tags.struct(root.name, data);
}
/** Validates and detaches a complete string list before a constructor exposes it. */
function strings(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new DecodeError('E_FORMAT', 'Expected a complete chat string list');
  return Object.freeze([...values]);
}
/** Reads every list member; a non-string cannot be silently removed from a moderation list. */
function readStrings(tag: Tag): string[] {
  return children(tag).map(value => {
    if (value.type !== TagType.STRING) throw new DecodeError('E_FORMAT', 'Chat moderation lists require STRING entries');
    return value.getString();
  });
}

/** An immutable saved server channel; historical versions remain unchanged during edits. */
export class ChatChannel implements ChatChannelFields {
  private readonly mods: readonly string[];
  private readonly bans: readonly string[];
  private readonly mutes: readonly string[];
  private readonly options: TagReadOptions;

  /** Creates a channel in an explicit server schema; versions 0/1 cannot encode mutes or private visibility. */
  constructor(readonly uid: string, readonly password: string, readonly isPermanent: boolean, readonly isPublic: boolean,
    moderators: readonly string[], banned: readonly string[], muted: readonly string[], readonly version = 2, options: TagReadOptions = {}) {
    if (![0, 1, 2].includes(version)) throw new DecodeError('E_UNSUPPORTED', 'Unsupported server chat channel version');
    if (typeof uid !== 'string' || typeof password !== 'string' || typeof isPermanent !== 'boolean' || typeof isPublic !== 'boolean') {
      throw new DecodeError('E_FORMAT', 'Invalid chat channel identity, password or flags');
    }
    this.mods = strings(moderators); this.bans = strings(banned); this.mutes = strings(muted);
    if (version < 2 && (this.mutes.length !== 0 || !isPublic)) throw new DecodeError('E_UNSUPPORTED', 'Historical server channels cannot encode mutes or private visibility');
    this.options = Object.freeze(localOptions(options));
    this.toTag(); Object.freeze(this);
  }
  /** Detached moderator names, preserving the stored spelling and order. */
  get moderators(): string[] { return [...this.mods]; }
  /** Detached banned player names. */
  get banned(): string[] { return [...this.bans]; }
  /** Detached muted player names; absent in historical versions. */
  get muted(): string[] { return [...this.mutes]; }
  /** Returns a validated immutable edit while retaining the saved version and unmodelled fields. */
  with(changes: Partial<ChatChannelFields>): ChatChannel {
    const fields = { uid: this.uid, password: this.password, isPermanent: this.isPermanent, isPublic: this.isPublic,
      moderators: this.mods, banned: this.bans, muted: this.mutes, ...changes };
    const result = inherit(this, new ChatChannel(fields.uid, fields.password, fields.isPermanent, fields.isPublic,
      fields.moderators, fields.banned, fields.muted, this.version, this.options));
    result.toTag(); return result;
  }
  /** Parses required slots for server versions 0/1/2 and snapshots every additional field. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): ChatChannel {
    const limits = localOptions(options), root = restore(writeTo(tag, limits), limits), data = children(root);
    if (data[0]?.type !== TagType.BYTE) throw new DecodeError('E_FORMAT', 'Missing chat channel version');
    const version = data[0].getByte();
    if (![0, 1, 2].includes(version)) throw new DecodeError('E_UNSUPPORTED', 'Unsupported server chat channel version');
    const types = [TagType.BYTE, TagType.STRING, TagType.STRUCT, TagType.STRUCT,
      ...(version < 2 ? [TagType.STRING, TagType.BYTE] : [TagType.STRUCT, TagType.STRING, TagType.BYTE, TagType.BYTE])];
    if (types.some((type, index) => data[index]?.type !== type)) throw new DecodeError('E_FORMAT', 'Missing or invalid server chat channel fields');
    const result = new ChatChannel(data[1].getString(), data[version < 2 ? 4 : 5].getString(),
      data[version < 2 ? 5 : 6].getByte() > 0, version < 2 || data[7].getByte() > 0,
      readStrings(data[2]), readStrings(data[3]), version < 2 ? [] : readStrings(data[4]), version, limits);
    remember(result, root, result.fields(), limits); return result;
  }
  /** Rebuilds changed known fields and returns a detached, budget-checked Tag tree. */
  toTag(): Tag {
    const fields = this.fields();
    const result = render(this, fields, Tags.struct(null, fields), this.options, this.version < 2 ? [2, 3] : [2, 3, 4]);
    writeTo(result, this.options); return result;
  }
  /** Describes channel visibility and moderator count without exposing its password. */
  toString(): string { return `ChatChannel(uid="${this.uid}", version=${this.version}, permanent=${this.isPermanent}, public=${this.isPublic}, mods=${this.mods.length})`; }
  /** Current values mapped to the actual historical field positions. */
  private fields(): Tag[] {
    const list = (values: readonly string[]) => Tags.struct(null, values.map(value => Tags.string(null, value)));
    return [Tags.byte(null, this.version), Tags.string(null, this.uid), list(this.mods), list(this.bans),
      ...(this.version < 2 ? [] : [list(this.mutes)]), Tags.string(null, this.password), Tags.bool(null, this.isPermanent),
      ...(this.version < 2 ? [] : [Tags.bool(null, this.isPublic)])];
  }
}

/** Complete immutable router archive with positional channel records and lossless file edits. */
export class ChatChannelManager {
  private readonly records: readonly ChatChannel[];
  private readonly options: TagReadOptions;

  /** Creates a version-zero router and snapshots its unique channel collection within the Tag limits. */
  constructor(readonly version: number, channels: readonly ChatChannel[], options: TagReadOptions = {}) {
    if (version !== 0) throw new DecodeError('E_UNSUPPORTED', 'Unsupported chat router version');
    if (!Array.isArray(channels)) throw new DecodeError('E_FORMAT', 'Expected chat channel collection');
    const ids = new Set<string>();
    for (const channel of channels) {
      if (!(channel instanceof ChatChannel) || ids.has(channel.uid)) throw new DecodeError('E_FORMAT', 'Invalid or duplicate chat channel UID');
      ids.add(channel.uid);
    }
    this.records = Object.freeze([...channels]); this.options = Object.freeze(localOptions(options));
    this.toTag(); Object.freeze(this);
  }
  /** Detached list of immutable channels. */
  get channels(): ChatChannel[] { return [...this.records]; }
  /** Looks up the exact stored channel identifier. */
  find(uid: string): ChatChannel | undefined { return this.records.find(channel => channel.uid === uid); }
  /** Detached permanent-channel selection. */
  get permanentChannels(): ChatChannel[] { return this.records.filter(channel => channel.isPermanent); }
  /** Detached public-channel selection. */
  get publicChannels(): ChatChannel[] { return this.records.filter(channel => channel.isPublic); }
  /** Adds a distinct channel while retaining every existing record and the original file envelope. */
  addChannel(channel: ChatChannel): ChatChannelManager { return this.updated([...this.records, channel]); }
  /** Removes the exact channel UID, retaining all unrelated fields and records. */
  removeChannel(uid: string): ChatChannelManager { return this.updated(this.records.filter(channel => channel.uid !== uid)); }
  /** Edits one existing record; its original schema and extensions survive a newly constructed replacement. */
  updateChannel(uid: string, updated: ChatChannel): ChatChannelManager {
    if (!(updated instanceof ChatChannel)) throw new DecodeError('E_FORMAT', 'Expected a chat channel replacement');
    if (!this.find(uid)) throw new DecodeError('E_RANGE', 'Chat channel UID does not exist');
    return this.updated(this.records.map(previous => previous.uid === uid ? previous.with({ uid: updated.uid,
      password: updated.password, isPermanent: updated.isPermanent, isPublic: updated.isPublic,
      moderators: updated.moderators, banned: updated.banned, muted: updated.muted }) : previous));
  }
  /** Parses actual positional router fields without skipping invalid channels or missing data. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): ChatChannelManager {
    const limits = localOptions(options), root = restore(writeTo(tag, limits), limits), data = children(root);
    if (data[0]?.type !== TagType.BYTE || data[1]?.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Missing chat router fields');
    const result = new ChatChannelManager(data[0].getByte(), children(data[1]).map(channel => ChatChannel.fromTag(channel, limits)), limits);
    remember(result, root, result.fields(), limits); return result;
  }
  /** Rebuilds the real positional root while retaining original names and additional fields. */
  toTag(): Tag {
    const fields = this.fields(), result = render(this, fields, Tags.struct(null, fields), this.options, []);
    writeTo(result, this.options); return result;
  }
  /** Writes unchanged input byte-exactly; edits retain compression, file version and trailing bytes. */
  toBuffer(): Buffer {
    const root = this.toTag(), document = documents.get(this);
    return document ? document.toBuffer(root) : writeTo(root, this.options);
  }
  /** Reads with caller-selected limits, charging shared file budgets exactly once. */
  static fromBuffer(data: Buffer | Uint8Array, options: TagReadOptions = {}): ChatChannelManager {
    const document = readTagDocument(data, options), limits = localOptions(options);
    // Internal snapshots have a two-byte prefix even when the original GZIP payload has none.
    if (document.compressed) limits.maxInflatedBytes = Math.min(Number.MAX_SAFE_INTEGER, (limits.maxInflatedBytes ?? 256 * 1024 * 1024) + 2);
    const result = ChatChannelManager.fromTag(document.root, limits);
    documents.set(result, document); return result;
  }
  /** Describes the router version and number of complete channel records. */
  toString(): string { return `ChatChannelManager(v${this.version}, ${this.records.length} channels)`; }
  /** Applies root snapshots, original envelope and output limits to a replacement collection. */
  private updated(channels: readonly ChatChannel[]): ChatChannelManager {
    const result = inherit(this, new ChatChannelManager(this.version, channels, this.options)), document = documents.get(this);
    if (document) documents.set(result, document);
    result.toBuffer(); return result;
  }
  /** Current known root fields; saved names are restored by the source snapshot. */
  private fields(): Tag[] {
    return [Tags.byte('VERSION', this.version), Tags.struct('CHANNELS', this.records.map(channel => channel.toTag()))];
  }
}
