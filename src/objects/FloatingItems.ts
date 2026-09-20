/**
 * @fileoverview Archived metadata objects grouped by sector, as saved by MetaObjectManager.
 * The root INT is the next identifier, not an item quantity. Each sector contains
 * records [INT id, SHORT blockType, opaque payload, optional SHORT subtype].
 * Unknown fields and existing Tag/file envelopes survive immutable edits.
 * @author InitSysRev
 * @version 2.0.0
 */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { readFrom, readTagDocument, writeTo } from '../core/TagParser.js';
import { boundedInteger, DecodeError } from '../core/DecodeError.js';

/** Integer sector coordinates; snapshots never borrow caller-owned positions. */
export interface FloatingItemPosition { x: number; y: number; z: number; }

/** Returns the content of a validated STRUCT without its terminator. */
function children(tag: Tag): Tag[] {
  if (tag.type !== TagType.STRUCT) throw new DecodeError('E_FORMAT', 'Expected archived metadata STRUCT');
  return tag.getStruct().filter(child => child.type !== TagType.FINISH);
}
/** Validates a signed binary integer before a builder can coerce it. */
function integer(value: number, bits: 16 | 32, label: string): void {
  const limit = 2 ** (bits - 1);
  if (!Number.isInteger(value) || value < -limit || value >= limit) throw new DecodeError('E_RANGE', `Invalid ${label}: signed ${bits}-bit integer required`);
}
/** Validates and snapshots a sector coordinate. */
function position(value: FloatingItemPosition): FloatingItemPosition {
  if (!value) throw new DecodeError('E_FORMAT', 'Missing archived-item sector');
  for (const axis of ['x', 'y', 'z'] as const) integer(value[axis], 32, `sector ${axis}`);
  return { x: value.x, y: value.y, z: value.z };
}
/** Computes the unique identity of a validated sector. */
function sectorKey(value: FloatingItemPosition): string { return `${value.x},${value.y},${value.z}`; }
/** Keeps scalar field names from a saved file. */
function scalar(previous: Tag | undefined, value: Tag): Tag { return previous ? Tags.rename(value, previous.name) : value; }

/** One metadata object; its opaque payload is never interpreted as an item count. */
export class FloatingItem {
  private readonly payloadBytes: Buffer;
  private readonly template?: Buffer;

  /**
   * Creates a detached archived metadata object.
   * @param id Unique nonnegative signed-int metadata identifier.
   * @param blockType Signed-short metadata type from the installation.
   * @param payload Complete metadata Tag, including unrecognized contents.
   * @param subObjectId Signed-short subtype, or -1 when unspecified.
   * @param template Internal original record snapshot for preserving extensions.
   */
  constructor(readonly id: number, readonly blockType: number, payload: Tag,
    readonly subObjectId = -1, template?: Buffer) {
    boundedInteger(id, 'metadata id', 0x7fffffff);
    integer(blockType, 16, 'metadata type'); integer(subObjectId, 16, 'metadata subtype');
    if (!(payload instanceof Tag) || payload.type === TagType.FINISH) throw new DecodeError('E_FORMAT', 'An archived item requires its complete metadata payload');
    this.payloadBytes = writeTo(payload);
    this.template = template ? Buffer.from(template) : undefined;
    Object.freeze(this);
  }

  /** Returns an independent payload tree. */
  get payload(): Tag { return readFrom(this.payloadBytes); }
  /** Returns a detached copy with another identifier. */
  withId(id: number): FloatingItem { return new FloatingItem(id, this.blockType, this.payload, this.subObjectId, this.template); }
  /** Returns a detached copy with another metadata type. */
  withBlockType(blockType: number): FloatingItem { return new FloatingItem(this.id, blockType, this.payload, this.subObjectId, this.template); }
  /** Returns a detached copy with a replacement opaque payload. */
  withPayload(payload: Tag): FloatingItem { return new FloatingItem(this.id, this.blockType, payload, this.subObjectId, this.template); }
  /** Returns a detached copy with another subtype. */
  withSubObjectId(subObjectId: number): FloatingItem { return new FloatingItem(this.id, this.blockType, this.payload, subObjectId, this.template); }

  /** Parses a complete metadata record, retaining optional subtype and unknown fields. */
  static fromTag(tag: Tag): FloatingItem {
    const snapshot = writeTo(tag), data = children(readFrom(snapshot));
    if (data[0]?.type !== TagType.INT || data[1]?.type !== TagType.SHORT || !data[2]) {
      throw new DecodeError('E_FORMAT', 'Expected metadata record [INT id, SHORT type, payload]; SDK type/count tuples are not game records');
    }
    return new FloatingItem(data[0].getInt(), data[1].getShort(), data[2],
      data[3]?.type === TagType.SHORT ? data[3].getShort() : -1, snapshot);
  }

  /** Rebuilds known fields while preserving names and unrecognized record extensions. */
  toTag(): Tag {
    const original = this.template ? readFrom(this.template) : Tags.struct(null, []);
    const data = children(original);
    data[0] = scalar(data[0], Tags.int(null, this.id));
    data[1] = scalar(data[1], Tags.short(null, this.blockType)); data[2] = this.payload;
    if (!this.template || data[3]?.type === TagType.SHORT) data[3] = scalar(data[3], Tags.short(null, this.subObjectId));
    else if (this.subObjectId !== -1) data.splice(3, 0, Tags.short(null, this.subObjectId));
    return Tags.struct(original.name, data);
  }
  /** Describes the identifier and metadata type without exposing opaque bytes. */
  toString(): string { return `FloatingItem(id=${this.id}, type=${this.blockType}, subtype=${this.subObjectId})`; }
}

/** One sector and its independently identified metadata objects. */
export class FloatingItemSector {
  private readonly coordinates: FloatingItemPosition;
  private readonly records: readonly FloatingItem[];
  private readonly template?: Buffer;

  /**
   * Creates a sector with detached coordinates and immutable object records.
   * @param sector Sector coordinates.
   * @param items Distinct metadata identifiers within the sector.
   * @param template Internal original sector snapshot for preserving extensions.
   */
  constructor(sector: FloatingItemPosition, items: readonly FloatingItem[], template?: Buffer) {
    this.coordinates = position(sector);
    const ids = new Set<number>();
    for (const item of items) {
      if (!(item instanceof FloatingItem) || ids.has(item.id)) throw new DecodeError('E_FORMAT', 'Invalid or duplicate archived metadata object');
      ids.add(item.id);
    }
    this.records = Object.freeze([...items]); this.template = template ? Buffer.from(template) : undefined;
    Object.freeze(this);
  }
  /** Detached integer coordinates. */
  get position(): FloatingItemPosition { return { ...this.coordinates }; }
  /** Detached list of immutable metadata objects. */
  get items(): FloatingItem[] { return [...this.records]; }
  /** Replaces this sector's records while retaining its unrecognized fields. */
  withItems(items: readonly FloatingItem[]): FloatingItemSector { return new FloatingItemSector(this.coordinates, items, this.template); }
  /** Moves the complete sector without borrowing the provided coordinates. */
  withPosition(sector: FloatingItemPosition): FloatingItemSector { return new FloatingItemSector(sector, this.records, this.template); }

  /** Parses the actual [VECTOR3i sector, STRUCT objects] archive pair. */
  static fromTag(tag: Tag): FloatingItemSector {
    const snapshot = writeTo(tag), data = children(readFrom(snapshot));
    if (data[0]?.type !== TagType.VECTOR3i || data[1]?.type !== TagType.STRUCT) {
      throw new DecodeError('E_FORMAT', 'Expected archived sector [VECTOR3i, STRUCT objects]');
    }
    return new FloatingItemSector(data[0].getVector3i(), children(data[1]).map(item => FloatingItem.fromTag(item)), snapshot);
  }
  /** Preserves the sector envelope and extensions while encoding all current records. */
  toTag(): Tag {
    const original = this.template ? readFrom(this.template) : Tags.struct(null, []);
    const data = children(original), p = this.coordinates;
    data[0] = scalar(data[0], Tags.vector3i(null, p.x, p.y, p.z));
    data[1] = Tags.struct(data[1]?.name ?? null, this.records.map(item => item.toTag()));
    return Tags.struct(original.name, data);
  }
}

/** Complete modern or historical metadata archive with immutable, lossless edits. */
export class FloatingItemsArchive {
  private readonly groups: readonly FloatingItemSector[];
  private readonly template?: Buffer;
  private readonly original?: Buffer;
  readonly format: 'modern' | 'legacy';

  /**
   * Creates a modern archive; the counter is the next identifier, never a quantity.
   * @param version Current supported archive version (zero).
   * @param nextId Next unused metadata identifier stored in the file.
   * @param sectors Distinct sector records with globally unique item identifiers.
   * @param template Internal original root snapshot preserving unknown fields.
   * @param original Internal original complete file envelope.
   * @param legacy Internal historical direct-sector-root representation flag.
   */
  constructor(readonly version = 0, readonly nextId = 100010, sectors: readonly FloatingItemSector[] = [],
    template?: Buffer, original?: Buffer, legacy = false) {
    if (version !== 0) throw new DecodeError('E_UNSUPPORTED', 'Unsupported metadata archive version');
    boundedInteger(nextId, 'next metadata id', 0x7fffffff);
    const positions = new Set<string>(), ids = new Set<number>();
    for (const sector of sectors) {
      if (!(sector instanceof FloatingItemSector)) throw new DecodeError('E_FORMAT', 'Expected archived metadata sector');
      const key = sectorKey(sector.position);
      if (positions.has(key)) throw new DecodeError('E_FORMAT', 'Duplicate archived sector');
      positions.add(key);
      for (const item of sector.items) {
        if (ids.has(item.id)) throw new DecodeError('E_FORMAT', 'Duplicate metadata identifier across sectors');
        if (item.id >= nextId) throw new DecodeError('E_RANGE', 'Next metadata identifier must exceed every existing identifier');
        ids.add(item.id);
      }
    }
    this.groups = Object.freeze([...sectors]); this.format = legacy ? 'legacy' : 'modern';
    this.template = template ? Buffer.from(template) : undefined; this.original = original ? Buffer.from(original) : undefined;
    Object.freeze(this);
  }

  /** Creates an empty modern archive, using the initial counter saved by the game. */
  static create(nextId = 100010): FloatingItemsArchive { return new FloatingItemsArchive(0, nextId); }
  /** Detached sector list; each sector is immutable. */
  get sectors(): FloatingItemSector[] { return [...this.groups]; }
  /** All archived objects, with their identities and complete opaque payloads. */
  get items(): FloatingItem[] { return this.groups.flatMap(sector => sector.items); }
  /** Actual object count, independent of the next-id counter. */
  get totalCount(): number { return this.groups.reduce((sum, sector) => sum + sector.items.length, 0); }
  /** Finds one object by its globally unique metadata identifier. */
  item(id: number): FloatingItem | undefined { return this.items.find(item => item.id === id); }
  /** Finds the first metadata object with a given block type. */
  byType(blockType: number): FloatingItem | undefined { return this.items.find(item => item.blockType === blockType); }
  /** Returns all objects of a metadata type without merging unrelated identifiers. */
  itemsOfType(blockType: number): FloatingItem[] { return this.items.filter(item => item.blockType === blockType); }
  /** Finds an exact integer sector. */
  sector(coordinates: FloatingItemPosition): FloatingItemSector | undefined {
    const key = sectorKey(position(coordinates));
    return this.groups.find(sector => sectorKey(sector.position) === key);
  }
  /** Reuses complete source snapshots while creating a separately validated archive. */
  private updated(sectors: readonly FloatingItemSector[], nextId = this.nextId): FloatingItemsArchive {
    return new FloatingItemsArchive(this.version, nextId, sectors, this.template, this.original, this.format === 'legacy');
  }
  /** Adds a distinct metadata object at a sector and advances the counter when necessary. */
  addItem(coordinates: FloatingItemPosition, item: FloatingItem): FloatingItemsArchive {
    const added = new FloatingItemSector(coordinates, [item]);
    if (this.item(item.id)) throw new DecodeError('E_FORMAT', 'Duplicate archived metadata identifier');
    const existing = this.sector(coordinates);
    const sectors = existing ? this.groups.map(sector => sector === existing ? sector.withItems([...sector.items, item]) : sector)
      : [...this.groups, added];
    return this.updated(sectors, Math.max(this.nextId, item.id + 1));
  }
  /** Replaces an existing metadata object without moving it or losing its sector envelope. */
  updateItem(item: FloatingItem): FloatingItemsArchive {
    if (!(item instanceof FloatingItem) || !this.item(item.id)) throw new DecodeError('E_FORMAT', 'Unknown archived metadata identifier');
    return this.updated(this.groups.map(sector => sector.withItems(sector.items.map(current => current.id === item.id
      ? current.withBlockType(item.blockType).withPayload(item.payload).withSubObjectId(item.subObjectId) : current))));
  }
  /** Removes an object by identifier, retaining empty sector envelopes and extensions. */
  removeItem(id: number): FloatingItemsArchive {
    boundedInteger(id, 'metadata id', 0x7fffffff);
    return this.updated(this.groups.map(sector => sector.withItems(sector.items.filter(item => item.id !== id))));
  }
  /** Removes one complete sector explicitly. */
  removeSector(coordinates: FloatingItemPosition): FloatingItemsArchive {
    const key = sectorKey(position(coordinates));
    return this.updated(this.groups.filter(sector => sectorKey(sector.position) !== key));
  }
  /** Changes the modern next-id counter, refusing values that collide with existing objects. */
  withNextId(nextId: number): FloatingItemsArchive {
    if (this.format !== 'modern') throw new DecodeError('E_UNSUPPORTED', 'A legacy archive has no counter; migrate explicitly to modern format');
    return this.updated(this.groups, nextId);
  }
  /** Explicitly migrates a historical archive to the modern moi envelope. */
  toModern(nextId = this.nextId): FloatingItemsArchive {
    return this.format === 'modern' ? this.withNextId(nextId) : new FloatingItemsArchive(0, nextId, this.groups);
  }

  /** Parses modern moi or genuine historical sector-root archives without lossy fallbacks. */
  static fromTag(root: Tag): FloatingItemsArchive {
    const template = writeTo(root), copy = readFrom(template), data = children(copy);
    const legacy = copy.name !== 'moi';
    let version = 0, nextId = 0, records = data;
    if (!legacy) {
      if (data[0]?.type !== TagType.BYTE || data[1]?.type !== TagType.INT || data[2]?.type !== TagType.STRUCT) {
        throw new DecodeError('E_FORMAT', 'Missing modern metadata archive fields');
      }
      version = data[0].getByte(); nextId = data[1].getInt(); records = children(data[2]);
    }
    const sectors = records.map(record => FloatingItemSector.fromTag(record));
    if (legacy) for (const sector of sectors) for (const item of sector.items) nextId = Math.max(nextId, item.id + 1);
    return new FloatingItemsArchive(version, nextId, sectors, template, undefined, legacy);
  }
  /** Rebuilds the exact root schema, retaining all unrecognized modern fields. */
  toTag(): Tag {
    const root = this.template ? readFrom(this.template) : Tags.struct('moi', []);
    const sectors = this.groups.map(sector => sector.toTag());
    if (this.format === 'legacy') return Tags.struct(root.name, sectors);
    const data = children(root);
    data[0] = scalar(data[0], Tags.byte(null, this.version)); data[1] = scalar(data[1], Tags.int(null, this.nextId));
    data[2] = Tags.struct(data[2] ? data[2].name : 'floatingItems', sectors);
    return Tags.struct(root.name, data);
  }
  /** Serializes unchanged files byte-exactly and retains compression/version/trailing bytes on edits. */
  toBuffer(): Buffer { return this.original ? readTagDocument(this.original).toBuffer(this.toTag()) : writeTo(this.toTag()); }
  /** Reads a complete file and captures its original envelope independently of caller buffers. */
  static fromBuffer(data: Buffer | Uint8Array): FloatingItemsArchive {
    const document = readTagDocument(data), parsed = FloatingItemsArchive.fromTag(document.root);
    return new FloatingItemsArchive(parsed.version, parsed.nextId, parsed.groups, parsed.template, Buffer.from(data), parsed.format === 'legacy');
  }
  /** Describes the actual object count and independent identifier counter. */
  toString(): string { return `FloatingItemsArchive(${this.format}, nextId=${this.nextId}, sectors=${this.groups.length}, objects=${this.totalCount})`; }
}
