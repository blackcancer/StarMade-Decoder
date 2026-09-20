/**
 * @fileoverview Immutable faction records with strict historical schemas, explicit roles and retained file envelopes.
 * Current and historical manager layouts follow the local FactionManager/Faction
 * format. Opaque sections and record extensions survive edits without inventing
 * administrative permissions or policies for invitations and news.
 */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { readFrom, writeTo, readTagDocument, type TagDocument, type TagReadOptions } from '../core/TagParser.js';
import { DecodeError } from '../core/DecodeError.js';

/** Enemy relation wire code, distinct from the game's sorting weight. */
export const RELATION_WAR = 1;
/** Neutral relation wire code. */
export const RELATION_NEUTRAL = 0;
/** Friend relation wire code. */
export const RELATION_ALLY = 2;
/** Immutable labels; future signed-byte codes remain representable as UNKNOWN. */
export const RELATION_NAMES: Readonly<Record<number, string>> = Object.freeze({ 0: 'NEUTRAL', 1: 'WAR', 2: 'ALLY' });
/** Original bytes and semantic values are inaccessible to callers. */
interface Origin { bytes: Buffer; fields: Map<number, Buffer>; }
/** Known positional fields of one model. */
type Fields = Map<number, Tag>;
/** Private immutable wire snapshots. */
const origins = new WeakMap<object, Origin>();
/** Per-model tree limits exclude budgets already charged while reading an external file. */
const limits = new WeakMap<object, TagReadOptions>();
/** Original wrapped faction entries, keyed by their actual inner faction identity. */
const wrappers = new WeakMap<FactionManager, Map<number, Tag>>();
/** File envelopes survive manager updates. */
const documents = new WeakMap<FactionManager, TagDocument>();

/** Copies local limits; internal snapshots never debit shared external-file counters. */
function localOptions(options: TagReadOptions): TagReadOptions {
  const { maxInputBytes, sharedInflationBudget, sharedNodeBudget, allowTrailingBytes, ...rest } = options;
  return Object.freeze({ ...rest });
}
/** Returns a model's snapshotted options. */
function options(model: object): TagReadOptions { return limits.get(model)!; }
/** Requires an actual STRUCT and retains every positional non-terminator field. */
function parts(tag: Tag): Tag[] {
  if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Faction record requires STRUCT');
  return tag.getStruct().filter(child => child.type !== TagType.FINISH);
}
/** Reads an already bounded canonical snapshot without applying compressed input-byte limits again. */
function restore(bytes: Buffer, opts: TagReadOptions): Tag { return readFrom(bytes, { ...opts, maxInputBytes: bytes.length }); }
/** Validates and detaches complete Tag graphs, including opaque payloads. */
function copyTag(tag: Tag, opts: TagReadOptions): Tag { return restore(writeTo(tag, opts), opts); }
/** Captures original bytes and baseline field values. */
function remember(model: object, tag: Tag, fields: Fields): void {
  origins.set(model, { bytes: writeTo(tag, options(model)), fields: new Map([...fields].map(([index, value]) => [index, writeTo(value, options(model))])) });
}
/** Restores a detached source tree. */
function source(model: object): Tag | undefined { const saved = origins.get(model); return saved && restore(saved.bytes, options(model)); }
/** Transfers immutable source data to an independently validated model. */
function inherit<T extends object>(before: object, after: T): T {
  const saved = origins.get(before); if (saved) origins.set(after, saved); return after;
}
/** Patches changed fields, filling newly introduced historical slots with their actual wire defaults. */
function render(model: object, fields: Fields, initial: Tag): Tag {
  const origin = origins.get(model), root = source(model) ?? initial, children = parts(root), defaults = parts(initial);
  for (const [index, value] of fields) {
    if (origin?.fields.get(index)?.equals(writeTo(value, options(model)))) continue;
    while (children.length <= index) children.push(defaults[children.length]);
    children[index] = Tags.rename(copyTag(value, options(model)), children[index].name);
  }
  const result = Tags.struct(root.name, children); writeTo(result, options(model)); return result;
}
/** Preserves a collection's original name while replacing its validated records. */
function collection(model: object, index: number, values: Tag[], name: string | null): Tag {
  const before = source(model), previous = before && parts(before)[index];
  return Tags.struct(previous ? previous.name : name, values);
}
/** Validates actual signed wire ranges before builders can normalize values. */
function integer(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new DecodeError('E_RANGE', 'Faction integer exceeds its wire range');
}
/** Rejects truthy non-booleans and non-string fields without coercion. */
function primitives(strings: readonly unknown[], booleans: readonly unknown[]): void {
  if (strings.some(value => typeof value !== 'string') || booleans.some(value => typeof value !== 'boolean')) throw new DecodeError('E_FORMAT', 'Invalid faction string or boolean field');
}
/** Requires all supplied field types; omitted historical suffixes are checked separately. */
function types(data: Tag[], required: readonly TagType[]): void {
  if (required.some((type, index) => data[index]?.type !== type)) throw new DecodeError('E_FORMAT', 'Missing or invalid faction fields');
}
/** Validates a present historical suffix without inventing fields when it is absent. */
function optional(data: Tag[], index: number, type: TagType): void {
  if (data[index] && data[index].type !== type) throw new DecodeError('E_FORMAT', 'Invalid optional faction field');
}
/** Checks a typed collection in full, including entries outside the modeled fields. */
function typedList(tag: Tag, type: TagType): void {
  if (parts(tag).some(value => value.type !== type)) throw new DecodeError('E_FORMAT', 'Invalid faction collection entry');
}
/** Checks the five persisted role masks/names without assigning any permissions. */
function checkRoles(tag: Tag, id: number): void {
  if (tag.type !== TagType.STRUCT || tag.name !== '0') throw new DecodeError('E_FORMAT', 'Faction roles require the named 0 STRUCT');
  const data = parts(tag);
  if (data[0]?.type !== TagType.INT || data[0].getInt() !== id || data[1]?.type !== TagType.STRUCT || data[2]?.type !== TagType.STRUCT) {
    throw new DecodeError('E_FORMAT', 'Faction roles require matching id, masks and names');
  }
  const masks = parts(data[1]), names = parts(data[2]);
  if (masks.length < 5 || names.length < 5 || masks.slice(0, 5).some(value => value.type !== TagType.LONG) || names.slice(0, 5).some(value => value.type !== TagType.STRING)) {
    throw new DecodeError('E_FORMAT', 'Faction roles require five long masks and five names');
  }
}
/** The exact NPC interval used by the game. */
function npc(id: number): boolean { return id >= -10000000 && id < -10000; }

/** Editable identity and role of one member. */
export interface FactionMemberFields { playerUID: string; role: number; }
/** An immutable member retaining optional activity, position and last-seen data. */
export class FactionMember implements FactionMemberFields {
  /** Creates a member; activity defaults affect only newly created records. */
  constructor(readonly playerUID: string, readonly role: number, opts: TagReadOptions = {}) {
    limits.set(this, localOptions(opts)); primitives([playerUID], []); integer(role, -128, 127);
    for (const value of this.fields().values()) writeTo(value, options(this)); Object.freeze(this);
  }
  /** Creates a detached edit preserving all unmodelled member data. */
  with(changes: Partial<FactionMemberFields>): FactionMember {
    const fields = { playerUID: this.playerUID, role: this.role, ...changes };
    const result = inherit(this, new FactionMember(fields.playerUID, fields.role, options(this))); result.toTag(); return result;
  }
  /** Reads mandatory STRING/BYTE fields, retaining the historical SDK INT rank until an explicit edit. */
  static fromTag(tag: Tag, opts: TagReadOptions = {}): FactionMember {
    const local = localOptions(opts), root = copyTag(tag, local), data = parts(root);
    if (data[0]?.type !== TagType.STRING || ![TagType.BYTE, TagType.INT].includes(data[1]?.type)) throw new DecodeError('E_FORMAT', 'Invalid faction member identity or role');
    optional(data, 2, TagType.LONG); optional(data, 3, TagType.VECTOR3i); optional(data, 4, TagType.LONG);
    const result = new FactionMember(data[0].getString(), data[1].value as number, local);
    remember(result, root, result.fields()); return result;
  }
  /** Semantic field projection used to preserve unchanged original encodings. */
  private fields(): Fields { return new Map([[0, Tags.string(null, this.playerUID)], [1, Tags.byte(null, this.role)]]); }
  /** Serializes without resetting retained activity or last-seen fields. */
  toTag(): Tag {
    return render(this, this.fields(), Tags.struct(null, [Tags.string(null, ''), Tags.byte(null, 0),
      Tags.long(null, 0n), Tags.vector3i(null, 0, 0, 0), Tags.long(null, 0n)]));
  }
}

/** Editable undirected relation fields, with original endpoint order retained. */
export interface FactionRelationFields { factionA: number; factionB: number; relation: number; }
/** An immutable relation; unknown signed-byte relation codes remain explicit. */
export class FactionRelation implements FactionRelationFields {
  /** Creates a relation without imposing diplomatic gameplay policy. */
  constructor(readonly factionA: number, readonly factionB: number, readonly relation: number, opts: TagReadOptions = {}) {
    limits.set(this, localOptions(opts)); integer(factionA, -2147483648, 2147483647); integer(factionB, -2147483648, 2147483647); integer(relation, -128, 127);
    for (const value of this.fields().values()) writeTo(value, options(this)); Object.freeze(this);
  }
  /** Returns an immutable edit while retaining extensions and saved endpoint names. */
  with(changes: Partial<FactionRelationFields>): FactionRelation {
    const fields = { factionA: this.factionA, factionB: this.factionB, relation: this.relation, ...changes };
    const result = inherit(this, new FactionRelation(fields.factionA, fields.factionB, fields.relation, options(this))); result.toTag(); return result;
  }
  /** Human-readable relation name, including unknown future codes. */
  get relationName(): string { return RELATION_NAMES[this.relation] ?? 'UNKNOWN'; }
  /** Whether this relation is enemy. */
  get isWar(): boolean { return this.relation === RELATION_WAR; }
  /** Whether this relation is neutral. */
  get isNeutral(): boolean { return this.relation === RELATION_NEUTRAL; }
  /** Whether this relation is friend. */
  get isAlly(): boolean { return this.relation === RELATION_ALLY; }
  /** Requires the actual INT/INT/BYTE triple before exposing a relation. */
  static fromTag(tag: Tag, opts: TagReadOptions = {}): FactionRelation {
    const local = localOptions(opts), root = copyTag(tag, local), data = parts(root); types(data, [TagType.INT, TagType.INT, TagType.BYTE]);
    const result = new FactionRelation(data[0].getInt(), data[1].getInt(), data[2].getByte(), local); remember(result, root, result.fields()); return result;
  }
  /** Current relation fields with their actual storage widths. */
  private fields(): Fields { return new Map([[0, Tags.int(null, this.factionA)], [1, Tags.int(null, this.factionB)], [2, Tags.byte(null, this.relation)]]); }
  /** Writes only explicit relation changes. */
  toTag(): Tag { return render(this, this.fields(), Tags.struct(null, [Tags.int(null, this.factionA), Tags.int(null, this.factionB), Tags.byte(null, this.relation)])); }
}

/** Named faction creation/edit fields; role permissions must always be supplied explicitly. */
export interface FactionFields {
  id: number; name: string; description: string; dateCreated: bigint; members: readonly FactionMember[];
  openToJoin: boolean; homebaseUID: string; password: string; allyNeutral: boolean; attackNeutral: boolean;
  factionPoints: number; factionMode: number; showInHub: boolean; roles: Tag; code: string;
}
/** A detached faction retaining all unmodelled statistics, colors, home data and extensions. */
export class Faction implements FactionFields {
  private readonly people: readonly FactionMember[];
  private readonly roleBytes: Buffer;
  readonly factionPoints: number;
  /** Creates a faction with explicit roles; the final isNPC argument is checked against the actual ID interval. */
  constructor(readonly id: number, readonly name: string, readonly description: string, readonly dateCreated: bigint,
    members: readonly FactionMember[], readonly openToJoin: boolean, readonly homebaseUID: string, readonly password: string,
    readonly allyNeutral: boolean, readonly attackNeutral: boolean, factionPoints: number, readonly factionMode: number,
    readonly showInHub: boolean, readonly isNPC: boolean, roles?: Tag, readonly code = '', opts: TagReadOptions = {}) {
    limits.set(this, localOptions(opts)); integer(id, -2147483648, 2147483647); integer(factionMode, -2147483648, 2147483647);
    primitives([name, description, homebaseUID, password, code], [openToJoin, allyNeutral, attackNeutral, showInHub, isNPC]);
    if (isNPC !== npc(id)) throw new DecodeError('E_FORMAT', 'Faction NPC category disagrees with its identifier');
    if (!Number.isFinite(factionPoints) || !Number.isFinite(Math.fround(factionPoints))) throw new DecodeError('E_RANGE', 'Faction points must be finite float32');
    this.factionPoints = Math.fround(factionPoints);
    if (!Array.isArray(members)) throw new DecodeError('E_FORMAT', 'Expected faction member collection');
    const identities = new Set<string>();
    for (const member of members) {
      if (!(member instanceof FactionMember) || identities.has(member.playerUID)) throw new DecodeError('E_FORMAT', 'Invalid or duplicate faction member');
      identities.add(member.playerUID);
    }
    this.people = Object.freeze([...members]);
    if (!roles) throw new DecodeError('E_INCOMPLETE', 'New factions require an explicit roles Tag');
    const roleCopy = copyTag(roles, options(this)); checkRoles(roleCopy, id); this.roleBytes = writeTo(roleCopy, options(this));
    for (const value of [Tags.string(null, name), Tags.string(null, description), Tags.string(null, homebaseUID), Tags.string(null, password), Tags.string(null, code), Tags.long(null, dateCreated)]) writeTo(value, options(this));
    Object.freeze(this);
  }
  /** Named creation avoids positional permission/identity arguments. */
  static create(fields: FactionFields, opts: TagReadOptions = {}): Faction {
    return new Faction(fields.id, fields.name, fields.description, fields.dateCreated, fields.members, fields.openToJoin,
      fields.homebaseUID, fields.password, fields.allyNeutral, fields.attackNeutral, fields.factionPoints,
      fields.factionMode, fields.showInHub, npc(fields.id), fields.roles, fields.code, opts);
  }
  /** Detached immutable member list. */
  get members(): FactionMember[] { return [...this.people]; }
  /** Detached complete role configuration, including unknown role extensions. */
  get roles(): Tag { return restore(this.roleBytes, options(this)); }
  /** Number of complete modeled members. */
  get memberCount(): number { return this.people.length; }
  /** Returns an immutable edit preserving original records for surviving member UIDs. */
  with(changes: Partial<FactionFields>): Faction {
    const fields = { id: this.id, name: this.name, description: this.description, dateCreated: this.dateCreated,
      members: this.members, openToJoin: this.openToJoin, homebaseUID: this.homebaseUID, password: this.password,
      allyNeutral: this.allyNeutral, attackNeutral: this.attackNeutral, factionPoints: this.factionPoints,
      factionMode: this.factionMode, showInHub: this.showInHub, roles: this.roles, code: this.code, ...changes };
    if (Array.isArray(fields.members)) {
      const previous = new Map(this.people.map(member => [member.playerUID, member]));
      fields.members = fields.members.map(member => member instanceof FactionMember && previous.has(member.playerUID)
        ? previous.get(member.playerUID)!.with({ role: member.role }) : member);
    }
    const result = inherit(this, Faction.create(fields, options(this))); result.toTag(); return result;
  }
  /** Current modeled fields; collection and role names are retained from the source snapshot. */
  private fields(): Fields {
    return new Map([
      [0, Tags.string(null, this.code)], [1, Tags.string(null, this.name)], [2, Tags.string(null, this.description)],
      [3, Tags.long(null, this.dateCreated)], [4, collection(this, 4, this.people.map(member => member.toTag()), 'mem')],
      [5, Tags.bool(null, this.openToJoin)], [6, this.roles], [7, Tags.string('home', this.homebaseUID)],
      [8, Tags.string('pw', this.password)], [9, Tags.int('id', this.id)], [10, Tags.bool('fn', this.allyNeutral)],
      [11, Tags.bool('en', this.attackNeutral)], [15, Tags.int(null, this.factionMode)], [17, Tags.bool(null, this.showInHub)], [18, Tags.float(null, this.factionPoints)],
    ]);
  }
  /** Serializes edits with real defaults only when newly introduced optional fields need them. */
  toTag(): Tag {
    const initial = Tags.struct('f0', [Tags.string(null, ''), Tags.string(null, ''), Tags.string(null, ''), Tags.long(null, 0n),
      Tags.struct('mem', []), Tags.byte(null, 0), this.roles, Tags.string('home', ''), Tags.string('pw', ''), Tags.int('id', this.id),
      Tags.byte('fn', 0), Tags.byte('en', 0), Tags.vector3i(null, 0, 0, 0), Tags.byte('aw', 0), Tags.struct('mem', []), Tags.int(null, 0),
      Tags.vector3f(null, 0, 0, 0), Tags.byte(null, 0), Tags.float(null, 0), Tags.int(null, 0), ...Array.from({ length: 6 }, () => Tags.float(null, 0)),
      Tags.int(null, 0), Tags.float(null, 0), Tags.struct(null, []), Tags.byte(null, 0)]);
    const fields = this.fields(), before = source(this);
    // The game reads factionPoints only when the full statistics group through slot 25 exists.
    if (before && parts(before).length < 26 && this.factionPoints !== 0) for (let index = 19; index <= 25; index++) fields.set(index, parts(initial)[index]);
    return render(this, fields, initial);
  }
  /** Reads mandatory fields and only the historical optional suffixes supported by the game. */
  static fromTag(tag: Tag, id: number, opts: TagReadOptions = {}): Faction {
    integer(id, -2147483648, 2147483647);
    const local = localOptions(opts), root = copyTag(tag, local), data = parts(root);
    types(data, [TagType.STRING, TagType.STRING, TagType.STRING, TagType.LONG, TagType.STRUCT, TagType.BYTE,
      TagType.STRUCT, TagType.STRING, TagType.STRING, TagType.INT, TagType.BYTE, TagType.BYTE, TagType.VECTOR3i]);
    for (const [index, type] of [[13, TagType.BYTE], [14, TagType.STRUCT], [15, TagType.INT], [16, TagType.VECTOR3f], [17, TagType.BYTE],
      [18, TagType.FLOAT], [19, TagType.INT], ...Array.from({ length: 6 }, (_, i) => [20 + i, TagType.FLOAT]), [26, TagType.INT], [27, TagType.FLOAT], [28, TagType.STRUCT]]) optional(data, index, type);
    if ((data.length > 18 && data.length < 26) || data.length === 27) throw new DecodeError('E_FORMAT', 'Incomplete faction statistics group');
    if (data[14]) typedList(data[14], TagType.STRING);
    if (data[28]) typedList(data[28], TagType.VECTOR3i);
    const factionId = data[9].getInt(), result = new Faction(factionId, data[1].getString(), data[2].getString(), data[3].getLong(),
      parts(data[4]).map(member => FactionMember.fromTag(member, local)), data[5].getByte() === 1, data[7].getString(), data[8].getString(),
      data[10].getByte() !== 0, data[11].getByte() !== 0, data[18] ? data[18].getFloat() : 0, data[15] ? data[15].getInt() : 0,
      data[17] ? data[17].getByte() !== 0 : false, npc(factionId), data[6], data[0].getString(), local);
    origins.set(result, { bytes: writeTo(root, local), fields: new Map() }); remember(result, root, result.fields()); return result;
  }
  /** Describes the current faction without exposing passwords or permission masks. */
  toString(): string { return `Faction(id=${this.id}, name="${this.name}", members=${this.memberCount}, npc=${this.isNPC})`; }
}

/** An immutable current or historical faction archive retaining opaque policy sections. */
export class FactionManager {
  private readonly entries: ReadonlyMap<number, Faction>;
  private readonly links: readonly FactionRelation[];
  /** Creates a current-layout manager and detaches caller-owned maps and arrays. */
  constructor(readonly version: number, factions: ReadonlyMap<number, Faction>, relations: readonly FactionRelation[], readonly lastUpdate: bigint, opts: TagReadOptions = {}) {
    limits.set(this, localOptions(opts));
    if (version !== 0) throw new DecodeError('E_UNSUPPORTED', 'Unsupported faction manager version');
    if (!(factions instanceof Map) || !Array.isArray(relations)) throw new DecodeError('E_FORMAT', 'Expected faction map and relation list');
    for (const [id, faction] of factions) if (!(faction instanceof Faction) || id !== faction.id) throw new DecodeError('E_FORMAT', 'Faction map key differs from faction.id');
    const pairs = new Set<string>();
    for (const relation of relations) {
      if (!(relation instanceof FactionRelation)) throw new DecodeError('E_FORMAT', 'Expected faction relation');
      const key = `${Math.min(relation.factionA, relation.factionB)},${Math.max(relation.factionA, relation.factionB)}`;
      if (pairs.has(key)) throw new DecodeError('E_FORMAT', 'Duplicate faction relation'); pairs.add(key);
    }
    this.entries = new Map(factions); this.links = Object.freeze([...relations]); writeTo(Tags.long(null, lastUpdate), options(this)); Object.freeze(this);
  }
  /** Detached map of immutable factions. */
  get factions(): Map<number, Faction> { return new Map(this.entries); }
  /** Detached relation list. */
  get relations(): FactionRelation[] { return [...this.links]; }
  /** Finds an actual faction identity. */
  get(id: number): Faction | undefined { return this.entries.get(id); }
  /** Returns factions in persisted map order. */
  get all(): Faction[] { return [...this.entries.values()]; }
  /** Selects the factions outside the NPC interval. */
  get playerFactions(): Faction[] { return this.all.filter(faction => !faction.isNPC); }
  /** Selects the game's exact NPC interval. */
  get npcFactions(): Faction[] { return this.all.filter(faction => faction.isNPC); }
  /** Looks up an undirected relation without changing its original endpoint order. */
  getRelation(a: number, b: number): FactionRelation | undefined {
    return this.links.find(relation => (relation.factionA === a && relation.factionB === b) || (relation.factionA === b && relation.factionB === a));
  }
  /** Selects all relations touching one faction. */
  getRelationsOf(id: number): FactionRelation[] { return this.links.filter(relation => relation.factionA === id || relation.factionB === id); }
  /** Applies a new collection snapshot while preserving wrappers, source fields and the file envelope. */
  private updated(factions: ReadonlyMap<number, Faction>, relations: readonly FactionRelation[], time = this.lastUpdate): FactionManager {
    const result = inherit(this, new FactionManager(this.version, factions, relations, time, options(this))), saved = wrappers.get(this), document = documents.get(this);
    if (saved) wrappers.set(result, saved); if (document) documents.set(result, document);
    result.toBuffer(); return result;
  }
  /** Adds or replaces a faction, retaining the existing faction's unmodelled fields on replacement. */
  setFaction(faction: Faction): FactionManager {
    if (!(faction instanceof Faction)) throw new DecodeError('E_FORMAT', 'Expected faction replacement');
    const entries = this.factions, previous = entries.get(faction.id);
    entries.set(faction.id, previous ? previous.with({ name: faction.name, description: faction.description, dateCreated: faction.dateCreated,
      members: faction.members, openToJoin: faction.openToJoin, homebaseUID: faction.homebaseUID, password: faction.password,
      allyNeutral: faction.allyNeutral, attackNeutral: faction.attackNeutral, factionPoints: faction.factionPoints,
      factionMode: faction.factionMode, showInHub: faction.showInHub, roles: faction.roles, code: faction.code }) : faction);
    return this.updated(entries, this.links);
  }
  /** Removes one faction and its modeled relations, leaving opaque policy sections untouched. */
  removeFaction(id: number): FactionManager {
    integer(id, -2147483648, 2147483647); const entries = this.factions; entries.delete(id);
    return this.updated(entries, this.links.filter(relation => relation.factionA !== id && relation.factionB !== id));
  }
  /** Changes or adds one relation while retaining existing endpoint order and record extensions. */
  setRelation(a: number, b: number, relation: number): FactionManager {
    const proposed = new FactionRelation(a, b, relation, options(this)), existing = this.getRelation(a, b);
    return this.updated(this.entries, existing ? this.links.map(link => link === existing ? link.with({ relation }) : link) : [...this.links, proposed]);
  }
  /** Changes the saved timestamp without altering the archive schema. */
  withLastUpdate(lastUpdate: bigint): FactionManager { return this.updated(this.entries, this.links, lastUpdate); }
  /** Parses only the recognized current/legacy manager layouts with their actual mandatory fields. */
  static fromTag(root: Tag, opts: TagReadOptions = {}): FactionManager {
    if (root.type !== TagType.STRUCT) throw new TypeError('FactionManager.fromTag: expected STRUCT root');
    const local = localOptions(opts), template = copyTag(root, local), data = parts(template);
    if (!['factions-v0', 'factions-v1', 'factions-v2'].includes(template.name!)) throw new DecodeError('E_UNSUPPORTED', 'Unsupported faction archive layout');
    const legacy = template.name !== 'factions-v2', factionIndex = legacy ? 0 : 3, relationIndex = legacy ? 3 : 6, timeIndex = legacy ? 5 : 8;
    types(data, legacy ? [TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT]
      : [TagType.BYTE, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.STRUCT, TagType.LONG, TagType.STRUCT]);
    optional(data, legacy ? 5 : 10, legacy ? TagType.LONG : TagType.INT);
    const entries = new Map<number, Faction>(), saved = new Map<number, Tag>();
    for (const entry of parts(data[factionIndex])) {
      const fields = parts(entry), unwrapped = template.name === 'factions-v0';
      if (!unwrapped) types(fields, [TagType.INT, TagType.STRUCT]);
      const tag = unwrapped ? entry : fields[1], id = unwrapped ? 0 : fields[0].getInt();
      const faction = Faction.fromTag(tag, id, local);
      if (entries.has(faction.id)) throw new DecodeError('E_FORMAT', 'Duplicate faction id');
      entries.set(faction.id, faction); saved.set(faction.id, entry);
    }
    const result = new FactionManager(legacy ? 0 : data[0].getByte(), entries,
      parts(data[relationIndex]).map(entry => FactionRelation.fromTag(entry, local)), data[timeIndex] ? data[timeIndex].getLong() : 0n, local);
    wrappers.set(result, saved); origins.set(result, { bytes: writeTo(template, local), fields: new Map() }); remember(result, template, result.fields()); return result;
  }
  /** Renders actual collection slots, preserving original wrapper keys even when an old key differs from the inner ID. */
  private fields(): Fields {
    const before = source(this), legacy = before?.name === 'factions-v0' || before?.name === 'factions-v1';
    const factionIndex = legacy ? 0 : 3, relationIndex = legacy ? 3 : 6, fields: Fields = new Map();
    const entries = [...this.entries].map(([id, faction]) => {
      const data = faction.toTag(); if (before?.name === 'factions-v0') return data;
      const wrapper = wrappers.get(this)?.get(id), children = wrapper ? parts(wrapper) : [Tags.int(null, id), data];
      children[1] = data; return Tags.struct(wrapper ? wrapper.name : null, children);
    });
    if (!legacy) fields.set(0, Tags.byte(null, this.version));
    fields.set(factionIndex, collection(this, factionIndex, entries, null));
    fields.set(relationIndex, collection(this, relationIndex, this.links.map(relation => relation.toTag()), null));
    fields.set(legacy ? 5 : 8, Tags.long(null, this.lastUpdate)); return fields;
  }
  /** Builds a current archive or retains the entire historical/opaque source tree. */
  toTag(): Tag {
    return render(this, this.fields(), Tags.struct('factions-v2', [Tags.byte(null, this.version), Tags.struct(null, []), Tags.struct(null, []),
      Tags.struct(null, []), Tags.struct(null, []), Tags.struct('NStruct', []), Tags.struct(null, []), Tags.struct(null, []),
      Tags.long(null, this.lastUpdate), Tags.struct(null, []), Tags.int(null, 0)]));
  }
  /** Returns detached file bytes, preserving compression/version/trailing data exactly when unchanged. */
  toBuffer(): Buffer { const document = documents.get(this); return document ? document.toBuffer(this.toTag()) : writeTo(this.toTag(), options(this)); }
  /** Reads within caller-selected limits and charges each shared external-file budget once. */
  static fromBuffer(data: Buffer | Uint8Array, opts: TagReadOptions = {}): FactionManager {
    const document = readTagDocument(data, opts), local = { ...localOptions(opts) };
    if (document.compressed) local.maxInflatedBytes = Math.min(Number.MAX_SAFE_INTEGER, (local.maxInflatedBytes ?? 256 * 1024 * 1024) + 2);
    const result = FactionManager.fromTag(document.root, local); documents.set(result, document); return result;
  }
  /** Describes the represented collections without exposing policy payloads. */
  toString(): string { return `FactionManager(v${this.version}, ${this.entries.size} factions, ${this.links.length} relations)`; }
}
