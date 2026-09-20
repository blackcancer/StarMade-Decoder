/** @fileoverview Faithful cv0 catalog entries, permissions and per-user ratings with retained Tag envelopes. */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { writeTo, type TagReadOptions } from '../core/TagParser.js';
import { DecodeError } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, type FormatLimits } from '../core/FormatLimits.js';
import { copyTagModel, inheritTagModel, rememberTagModel, renderTagModel, tagModelOptions, type TagModelFields } from '../core/TagModel.js';
import { TagModelFile } from '../core/TagModelFile.js';
import { BLUEPRINT_TYPE } from '../smd3/SmentParser.js';

/** Named persisted entry fields; permission flags are provided by the caller, never inferred from server rules. */
export interface CatalogEntryFields {
  uid: string; ownerUID: string; price: bigint; description: string; mass: number;
  blueprintType: string; dateCreated: bigint; timesSpawned: number; classification: number;
  permission: number; wavePermissions: readonly Tag[];
}
/** Tag budgets plus collection/output ceilings for one catalog. */
export interface CatalogOptions extends TagReadOptions, FormatLimits {}
/** Original file envelopes survive collection edits. */
const documents = new WeakMap<Catalog, TagModelFile>();
/** Internal construction origin, installed before validating the actual file output. */
interface CatalogSource { original: Tag | Catalog; document?: TagModelFile; }

/** Immutable catalog permission record, including fields previously dropped by older SDKs. */
export class CatalogEntry implements CatalogEntryFields {
  readonly timesSpawned: number;
  private readonly waves: readonly Tag[];
  private readonly options: TagReadOptions;
  /** Creates a record; the legacy bigint spawn-count argument is accepted only when exactly representable. */
  constructor(readonly uid: string, readonly ownerUID: string, readonly price: bigint,
    readonly description: string, readonly mass: number, readonly blueprintType: string,
    readonly dateCreated: bigint, timesSpawned: number | bigint, readonly classification: number,
    readonly permission = 0, wavePermissions: readonly Tag[] = [], options: TagReadOptions = {}) {
    this.options = tagModelOptions(options);
    if (typeof price !== 'bigint' || typeof dateCreated !== 'bigint') throw new DecodeError('E_FORMAT','Catalog price and date require bigint');
    if (typeof timesSpawned !== 'number' && typeof timesSpawned !== 'bigint') throw new DecodeError('E_FORMAT','Catalog spawn count requires number or bigint');
    if (!Number.isFinite(mass) || !Number.isFinite(Math.fround(mass))) throw new DecodeError('E_RANGE','Catalog mass must be finite float32');
    this.mass = Math.fround(mass);
    if (!Number.isInteger(classification) || classification < -128 || classification > 127) throw new DecodeError('E_RANGE','Catalog classification must fit signed byte');
    this.timesSpawned = Number(timesSpawned); this.waves = wavePermissions.map(tag=>copyTagModel(tag,this.options));
    // Binary field validation rejects overflow and unrepresentable strings before any update is exposed.
    writeTo(Tags.struct(null, [...this.fields().values()]),this.options); Object.freeze(this);
  }
  /** Named construction avoids positional fields and requires explicit permission flags. */
  static create(fields: CatalogEntryFields, options: TagReadOptions = {}): CatalogEntry {
    return new CatalogEntry(fields.uid,fields.ownerUID,fields.price,fields.description,fields.mass,
      fields.blueprintType,fields.dateCreated,fields.timesSpawned,fields.classification,fields.permission,fields.wavePermissions,options);
  }
  /** Detached wave Tags retain their complete format-specific contents. */
  get wavePermissions(): Tag[] { return this.waves.map(tag=>copyTagModel(tag,this.options)); }
  /** @deprecated This value is a spawn count, not a timestamp; use timesSpawned. */
  get timeSpawned(): bigint { return BigInt(this.timesSpawned); }
  /** Returns a validated copy preserving the source's unknown fields and names. */
  with(changes: Partial<CatalogEntryFields>): CatalogEntry {
    const result = inheritTagModel(this, CatalogEntry.create({uid:this.uid,ownerUID:this.ownerUID,price:this.price,
      description:this.description,mass:this.mass,blueprintType:this.blueprintType,dateCreated:this.dateCreated,
      timesSpawned:this.timesSpawned,classification:this.classification,permission:this.permission,wavePermissions:this.wavePermissions,...changes},this.options));
    result.toTag(); return result;
  }
  /** Parses required real wire fields; incomplete or older invented SDK tuples fail explicitly. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): CatalogEntry {
    tag=copyTagModel(tag,options);
    const p=tag.getStruct().filter(t=>t.type!==TagType.FINISH);
    const required=[TagType.STRING,TagType.STRING,TagType.INT,null,TagType.STRING,TagType.LONG,TagType.INT];
    if (required.some((type,index)=>type!==null&&p[index]?.type!==type) || ![TagType.INT,TagType.LONG].includes(p[3]?.type)) {
      throw new DecodeError('E_FORMAT','Invalid catalog permission fields');
    }
    for (const [index,type] of [[8,TagType.INT],[9,TagType.STRUCT],[10,TagType.BYTE]]) {
      if (p[index] && p[index].type !== type) throw new DecodeError('E_FORMAT',`Invalid optional catalog field ${index}`);
    }
    const ordinal=p[8]?.type===TagType.INT?p[8].getInt():0;
    const result=new CatalogEntry(p[0].getString(),p[1].getString(),p[3].type===TagType.INT?BigInt(p[3].getInt()):p[3].getLong(),
      p[4].getString(),p[7]?.type===TagType.FLOAT?p[7].getFloat():0,BLUEPRINT_TYPE[ordinal]??`UNKNOWN(${ordinal})`,
      p[5].getLong(),p[6].getInt(),p[10]?.type===TagType.BYTE?p[10].getByte():0,p[2].getInt(),
      p[9]?.type===TagType.STRUCT?p[9].getStruct().filter(t=>t.type!==TagType.FINISH):[],options);
    rememberTagModel(result,tag,result.fields(),options); return result;
  }
  /** Writes actual INT permission and INT spawn-count fields, preserving unchanged source variants. */
  toTag(): Tag { return renderTagModel(this,this.fields(),Tags.struct(null,[]),this.options); }
  /** JSON projection retains exact monetary/time values and opaque wave payloads. */
  toJSON(): Omit<CatalogEntryFields,'price'|'dateCreated'|'wavePermissions'> & {price:string;dateCreated:string;wavePermissions:string[]} {
    return {uid:this.uid,ownerUID:this.ownerUID,price:this.price.toString(),description:this.description,mass:this.mass,
      blueprintType:this.blueprintType,dateCreated:this.dateCreated.toString(),timesSpawned:this.timesSpawned,
      classification:this.classification,permission:this.permission,wavePermissions:this.waves.map(tag=>writeTo(tag,this.options).toString('base64'))};
  }
  /** Current semantic values for exact source-field comparison. */
  private fields(): TagModelFields {
    const known=BLUEPRINT_TYPE.indexOf(this.blueprintType as typeof BLUEPRINT_TYPE[number]);
    const unknown=/^UNKNOWN\((-?\d+)\)$/.exec(this.blueprintType);
    if (known<0&&!unknown) throw new DecodeError('E_RANGE','Unknown blueprint type name');
    return new Map([
      [0,Tags.string(null,this.uid)],[1,Tags.string(null,this.ownerUID)],[2,Tags.int(null,this.permission)],
      [3,Tags.long(null,this.price)],[4,Tags.string(null,this.description)],[5,Tags.long(null,this.dateCreated)],
      [6,Tags.int(null,this.timesSpawned)],[7,Tags.float(null,this.mass)],
      [8,Tags.int(null,known<0?Number(unknown![1]):known)],[9,Tags.struct(null,[...this.waves])],[10,Tags.byte(null,this.classification)],
    ]);
  }
}

/** Blueprint catalog entries and independent per-blueprint/per-user rating maps. */
export class Catalog {
  private readonly values: ReadonlyMap<string,CatalogEntry>;
  private readonly votes: ReadonlyMap<string,ReadonlyMap<string,number>>;
  private readonly options: CatalogOptions;
  private readonly limits: Required<FormatLimits>;
  /** Snapshots collections and rejects ambiguous identities; rating values retain the signed-byte wire range. */
  constructor(entries: readonly CatalogEntry[]=[], ratings: ReadonlyMap<string,ReadonlyMap<string,number>>=new Map(), options: CatalogOptions={}, source?: CatalogSource) {
    this.options={...tagModelOptions(options),maxBytes:options.maxBytes,maxEntries:options.maxEntries}; this.limits=formatLimits(options); checkEntryCount(entries.length,this.limits);
    this.values=new Map(entries.map(entry=>[entry.uid,entry]));
    if(this.values.size!==entries.length) throw new DecodeError('E_FORMAT','Duplicate catalog UID');
    if(!(ratings instanceof Map)) throw new DecodeError('E_FORMAT','Ratings must be indexed by blueprint and user');
    const votes=new Map<string,ReadonlyMap<string,number>>(); let count=entries.length;
    for(const [uid,map] of ratings) {
      count+=1+map.size; checkEntryCount(count,this.limits);
      const copy=new Map<string,number>(map); for(const [user,rating] of copy) {
        if (!Number.isInteger(rating) || rating < -128 || rating > 127) throw new DecodeError('E_RANGE','Catalog rating must fit signed byte');
        writeTo(Tags.struct(uid,[Tags.string(null,user),Tags.byte(null,rating)]),this.options);
      }
      votes.set(uid,copy);
    }
    this.votes=votes;
    if (source) {
      if (source.original instanceof Catalog) inheritTagModel(source.original,this);
      else rememberTagModel(this,source.original,this.fields(source.original),this.options);
      if (source.document) documents.set(this,source.document);
    }
    this.toBuffer(); Object.freeze(this);
  }
  /** Parses real pv0/r0 sections; unknown root sections and entry extensions are retained. */
  static fromTag(root: Tag, options: CatalogOptions={}): Catalog { return Catalog.read(root,options); }
  /** Parses sections before attaching their snapshot and optional original file envelope. */
  private static read(root: Tag, options: CatalogOptions, document?: TagModelFile): Catalog {
    root=copyTagModel(root,options);
    const p=root.getStruct().filter(t=>t.type!==TagType.FINISH);
    const permissions=p.find(t=>t.name==='pv0'), ratings=p.find(t=>t.name==='r0');
    if(p.filter(t=>t.name==='pv0').length!==1||p.filter(t=>t.name==='r0').length!==1||!permissions||permissions.type!==TagType.STRUCT||!ratings||ratings.type!==TagType.STRUCT) throw new DecodeError('E_FORMAT','Catalog requires pv0 permissions and r0 ratings');
    const values=permissions.getStruct().filter(t=>t.type!==TagType.FINISH).map(t=>CatalogEntry.fromTag(t,options));
    const votes=new Map<string,ReadonlyMap<string,number>>();
    for(const group of ratings.getStruct().filter(t=>t.type!==TagType.FINISH)) {
      if(group.name===null||votes.has(group.name)) throw new DecodeError('E_FORMAT','Duplicate or unnamed rating group');
      const map=new Map<string,number>();
      for(const tag of group.getStruct().filter(t=>t.type!==TagType.FINISH)) {
        const entry=tag.getStruct();
        if(entry[0]?.type!==TagType.STRING||entry[1]?.type!==TagType.BYTE||map.has(entry[0].getString())) throw new DecodeError('E_FORMAT','Invalid or duplicate user rating');
        map.set(entry[0].getString(),entry[1].getByte());
      }
      votes.set(group.name,map);
    }
    return new Catalog(values,votes,options,{original:root,document});
  }
  /** Reads with shared Tag limits and retains the original compression/version/trailing envelope. */
  static fromBuffer(input: Uint8Array, options: CatalogOptions={}): Catalog {
    const document=TagModelFile.fromBuffer(formatBytes(input,formatLimits(options)),options);
    return Catalog.read(document.root,{...options,...document.options},document);
  }
  /** Ordered immutable entries; the outer array is detached. */
  get entries(): CatalogEntry[] { return [...this.values.values()]; }
  /** All catalog permission entries; ratings are a separate collection. */
  get all(): CatalogEntry[] { return this.entries; }
  /** Detached nested rating maps. */
  get ratings(): ReadonlyMap<string,ReadonlyMap<string,number>> { return new Map([...this.votes].map(([uid,map])=>[uid,new Map(map)])); }
  /** Constant-time lookup by the blueprint's stored UID. */
  find(uid:string): CatalogEntry|undefined { return this.values.get(uid); }
  /** Case-insensitive owner filter. */
  byOwner(ownerUID:string): CatalogEntry[] { return this.entries.filter(entry=>entry.ownerUID.toLowerCase()===ownerUID.toLowerCase()); }
  /** Exact type-name filter, retaining unknown ordinal labels. */
  byType(type:string): CatalogEntry[] { return this.entries.filter(entry=>entry.blueprintType===type); }
  /** Adds a unique permission record without inventing ratings or server permissions. */
  addEntry(entry:CatalogEntry): Catalog { return this.updated([...this.entries,entry],this.ratings); }
  /** Removes an entry; associated rating retention is an explicit data policy left unchanged here. */
  removeEntry(uid:string): Catalog { return this.updated(this.entries.filter(entry=>entry.uid!==uid),this.ratings); }
  /** Replaces one existing entry; absent UIDs fail rather than silently ignoring the edit. */
  updateEntry(uid:string,entry:CatalogEntry): Catalog {
    if(!this.values.has(uid)) throw new DecodeError('E_RANGE','Catalog UID does not exist');
    return this.updated(this.entries.map(previous=>previous.uid===uid?entry:previous),this.ratings);
  }
  /** Sets one raw signed-byte vote without enforcing application rating policy. */
  withRating(uid:string,user:string,rating:number): Catalog {
    const votes=new Map(this.ratings), map=new Map(votes.get(uid)); map.set(user,rating); votes.set(uid,map); return this.updated(this.entries,votes);
  }
  /** Writes the editable Tag while preserving unmodelled root sections and original names. */
  toTag(): Tag { const initial=Tags.struct('cv0',[Tags.struct('pv0',[]),Tags.struct('r0',[])]); return renderTagModel(this,this.fields(renderTagModel(this,new Map(),initial,this.options)),initial,this.options); }
  /** Encodes the retained file envelope within the caller's byte ceiling. */
  toBuffer(): Buffer { const tag=this.toTag(); return formatBytes(documents.get(this)?.withRoot(tag).toBuffer()??writeTo(tag,this.options),this.limits); }
  /** JSON-safe entries and plain nested rating records. */
  toJSON(): {entries:ReturnType<CatalogEntry['toJSON']>[];ratings:Record<string,Record<string,number>>} {
    return {entries:this.entries.map(entry=>entry.toJSON()),ratings:Object.fromEntries([...this.votes].map(([uid,map])=>[uid,Object.fromEntries(map)]))};
  }
  /** Human-readable collection sizes. */
  toString(): string { return `Catalog(${this.values.size} entries, ${this.votes.size} rating groups)`; }
  /** Retains source/envelope ownership across validated collection updates. */
  private updated(entries:readonly CatalogEntry[],ratings:ReadonlyMap<string,ReadonlyMap<string,number>>):Catalog {
    return new Catalog(entries,ratings,this.options,{original:this,document:documents.get(this)});
  }
  /** Maps the real sections to their existing positions, retaining extra root fields. */
  private fields(root:Tag):TagModelFields {
    const p=root.getStruct(), permissionIndex=p.findIndex(t=>t.name==='pv0'), ratingsIndex=p.findIndex(t=>t.name==='r0');
    const oldGroups=p[ratingsIndex].getStruct().filter(tag=>tag.type!==TagType.FINISH);
    const groups=[...this.votes].map(([uid,map])=> {
      const old=oldGroups.find(tag=>tag.name===uid), members=old?.getStruct().filter(tag=>tag.type!==TagType.FINISH)??[];
      return Tags.struct(uid,[...map].map(([user,rating])=> {
        const previous=members.find(tag=>tag.getStruct()[0]?.value===user);
        const parts=previous?.getStruct().filter(tag=>tag.type!==TagType.FINISH)??[];
        parts[0]=Tags.string(parts[0]?.name??null,user); parts[1]=Tags.byte(parts[1]?.name??null,rating);
        return Tags.struct(previous?.name??null,parts);
      }));
    });
    return new Map([[permissionIndex,Tags.struct('pv0',this.entries.map(entry=>entry.toTag()))],
      [ratingsIndex,Tags.struct('r0',groups)]]);
  }
}
