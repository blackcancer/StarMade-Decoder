/** @fileoverview Player-state format view with positional, field-preserving immutable edits. */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { DecodeError } from '../core/DecodeError.js';
import { TagModelFile, replaceTagField } from '../core/TagModelFile.js';
import type { Vector3i, Vector3f } from '../types/Vectors.js';

/** A lossless player-state file view; domain policies remain the consumer's responsibility. */
export class PlayerState {
  readonly credits: bigint;
  readonly currentSector: Vector3i | null;
  readonly logoutSector: Vector3i | null;
  readonly logoutLocalPos: Vector3f | null;
  readonly lastLogin: bigint;
  readonly lastLogout: bigint;
  readonly hasCreativeMode: boolean;
  readonly lastEnteredEntity: string;
  readonly factionId: number;
  readonly factionSuspended: number;
  /** @deprecated The pFac slot is suspension state, not a member rank; use factionSuspended. */
  get factionRank(): number { return this.factionSuspended; }
  /** Derives immutable values exclusively from the stored root, avoiding inconsistent parallel state. */
  private constructor(private readonly file: TagModelFile) {
    const s = file.root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (![TagType.INT, TagType.LONG].includes(s[0]?.type)) throw new DecodeError('E_FORMAT', 'Player credits require INT or LONG at slot 0');
    this.credits = s[0].type === TagType.INT ? BigInt(s[0].getInt()) : s[0].getLong();
    this.lastLogin = PlayerState.optional(s[7],TagType.LONG,0n);
    this.lastLogout = PlayerState.optional(s[8],TagType.LONG,0n);
    this.hasCreativeMode = PlayerState.optional(s[10],TagType.BYTE,0) !== 0;
    this.lastEnteredEntity = PlayerState.optional(s[11],TagType.STRING,'');
    const current=s.find(t=>t.name==='sector'), logout=s.find(t=>t.name==='lsector'), local=s.find(t=>t.name==='lspawn');
    this.currentSector = current ? Object.freeze(current.getVector3i()) : null;
    this.logoutSector = logout ? Object.freeze(logout.getVector3i()) : null;
    this.logoutLocalPos = local ? Object.freeze(local.getVector3f()) : null;
    const faction=s.find(t=>t.name==='pFac-v0'||t.name==='pFac');
    if (faction) {
      const p=faction.getStruct(); this.factionId=p[0].getInt(); this.factionSuspended=p[1].getInt();
    } else { this.factionId=0; this.factionSuspended=0; }
    Object.freeze(this);
  }
  /** Checks present optional values instead of substituting corrupt fields. */
  private static optional<T extends bigint|number|string>(tag:Tag|undefined,type:TagType,fallback:T):T {
    if(!tag)return fallback;
    if(tag.type!==type)throw new DecodeError('E_FORMAT','Invalid optional player field');
    return tag.value as T;
  }
  /** Edits the real credit slot even when its stored name is absent or noncanonical. */
  withCredits(credits: bigint): PlayerState {
    const original=this.file.originalRoot.getStruct()[0];
    const value=original.type===TagType.INT&&credits>=-2147483648n&&credits<=2147483647n?Tags.int(null,Number(credits)):Tags.long(null,credits);
    return this.updated(replaceTagField(this.file.root,0,value,[TagType.INT,TagType.LONG]));
  }
  /** Edits the existing creative flag without silently ignoring a missing legacy field. */
  withCreativeMode(enabled: boolean): PlayerState {
    if(typeof enabled!=='boolean')throw new DecodeError('E_RANGE','Creative flag must be boolean');
    const original=this.file.originalRoot.getStruct()[10];
    const value=original?.type===TagType.BYTE&&(original.getByte()!==0)===enabled?original:Tags.bool(null,enabled);
    return this.updated(replaceTagField(this.file.root,10,value));
  }
  /** Updates the stored faction and suspension state, retaining extensions and field names. */
  withFaction(id: number, suspended=0): PlayerState {
    const root=this.file.root,s=root.getStruct(),index=s.findIndex(t=>t.name==='pFac-v0'||t.name==='pFac');
    if(index<0)throw new DecodeError('E_FORMAT','Player has no faction tuple');
    let faction=replaceTagField(s[index],0,Tags.int(null,id)); faction=replaceTagField(faction,1,Tags.int(null,suspended));
    return this.updated(replaceTagField(root,index,faction));
  }
  /** Constructs a revised view only after the edited tree passes limits and schema checks. */
  private updated(root:Tag):PlayerState { return new PlayerState(this.file.withRoot(root)); }
  /** Detached complete Tag, including unknown fields. */
  toTag():Tag { return this.file.root; }
  /** Exact original bytes when unchanged or reverted. */
  toBuffer():Buffer { return this.file.toBuffer(); }
  /** Reads a detached tree with explicit traversal and output limits. */
  static fromTag(root:Tag,options:TagReadOptions={}):PlayerState { return new PlayerState(new TagModelFile(root,options)); }
  /** Opens a file without losing compression, version or trailing bytes. */
  static fromBuffer(data:Uint8Array,options:TagReadOptions={}):PlayerState { return new PlayerState(TagModelFile.fromBuffer(data,options)); }
  /** JSON projection with exact decimal 64-bit values. */
  toJSON():object { return {credits:String(this.credits),currentSector:this.currentSector,logoutSector:this.logoutSector,
    logoutLocalPos:this.logoutLocalPos,lastLogin:String(this.lastLogin),lastLogout:String(this.lastLogout),
    hasCreativeMode:this.hasCreativeMode,lastEnteredEntity:this.lastEnteredEntity,factionId:this.factionId,factionSuspended:this.factionSuspended}; }
  /** Human-readable file summary. */
  toString():string { return `PlayerState(credits=${this.credits}, sector=${JSON.stringify(this.currentSector)}, creative=${this.hasCreativeMode})`; }
}
