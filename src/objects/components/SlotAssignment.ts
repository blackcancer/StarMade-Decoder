/** @fileoverview Stored control-slot mappings with bounded, non-lossy immutable edits. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';

/** Optional application bounds for assign(); decoding preserves every signed-byte stored slot. */
export interface SlotAssignmentOptions extends TagReadOptions {minSlot?:number;maxSlot?:number;}
/** Rejects lossy JavaScript numbers and positions outside the actual LONG wire range. */
function validatePosition(position:bigint):void{
  if(typeof position!=='bigint'||position<-(1n<<63n)||position>=(1n<<63n))throw new DecodeError('E_RANGE','Slot position requires a signed 64-bit bigint');
}
/** Immutable collection of stored slot IDs and packed block keys. */
export class SlotAssignment {
  private readonly data:ReadonlyMap<number,bigint>;
  private readonly file:TagModelFile;
  private readonly minSlot:number;
  private readonly maxSlot:number;
  /** Creates a validated collection; the leading byte is retained as the format's reserved version field. */
  constructor(readonly version:number,slots:ReadonlyMap<number,bigint>,options:SlotAssignmentOptions={},source?:TagModelFile){
    this.minSlot=options.minSlot??0;this.maxSlot=options.maxSlot??9;
    for(const value of [version,this.minSlot,this.maxSlot,...slots.keys()])if(!Number.isInteger(value)||value < -128||value>127)throw new DecodeError('E_RANGE','Slot field must fit signed byte');
    if(this.minSlot>this.maxSlot)throw new DecodeError('E_RANGE','Invalid assignment bounds');
    for(const position of slots.values())validatePosition(position);
    this.data=new Map(slots);this.file=source??new TagModelFile(Tags.struct(null,[Tags.byte(null,version),Tags.struct(null,[...slots].map(([slot,pos])=>Tags.struct(null,[Tags.byte(null,slot),Tags.long(null,pos)])))]),options);
    Object.freeze(this);
  }
  /** Empty assignments with the usual ten-slot edit bounds. */
  static readonly EMPTY=new SlotAssignment(0,new Map());
  /** Detached map, preserving stored order and signed-byte keys. */
  get slots():ReadonlyMap<number,bigint>{return new Map(this.data);}
  /** Reads the real tuple strictly, retaining root/list/entry extensions and names. */
  static fromTag(tag:Tag,options:SlotAssignmentOptions={}):SlotAssignment{return SlotAssignment.fromFile(new TagModelFile(tag,options),options);}
  /** Projects a private source snapshot without losing unmodeled slots. */
  private static fromFile(file:TagModelFile,options:SlotAssignmentOptions):SlotAssignment{
    const root=file.root,p=root.getStruct();
    if(p[0]?.type!==TagType.BYTE||p[1]?.type!==TagType.STRUCT)throw new DecodeError('E_FORMAT','Invalid slot-assignment tuple');
    const slots=new Map<number,bigint>();
    for(const entry of p[1].getStruct().filter(tag=>tag.type!==TagType.FINISH)){
      const values=entry.getStruct();
      if(values[0]?.type!==TagType.BYTE||values[1]?.type!==TagType.LONG||slots.has(values[0].getByte()))throw new DecodeError('E_FORMAT','Invalid or duplicate slot assignment');
      slots.set(values[0].getByte(),values[1].getLong());
    }
    return new SlotAssignment(p[0].getByte(),slots,options,file);
  }
  /** Detached complete record. */
  toTag():Tag{return this.file.root;}
  /** Assigns within caller-selected bounds; input keys/counts are never rounded or wrapped. */
  assign(slot:number,position:bigint):SlotAssignment{
    validatePosition(position);
    if(!Number.isInteger(slot)||slot<this.minSlot||slot>this.maxSlot)throw new RangeError(`SlotAssignment: slot outside [${this.minSlot}, ${this.maxSlot}]`);
    const root=this.file.root,list=root.getStruct()[1],children=list.getStruct().filter(tag=>tag.type!==TagType.FINISH);
    const index=children.findIndex(tag=>tag.getStruct()[0].getByte()===slot);
    if(index<0)children.push(Tags.struct(null,[Tags.byte(null,slot),Tags.long(null,position)]));
    else children[index]=replaceTagField(children[index],1,Tags.long(null,position));
    return this.updated(replaceTagField(root,1,Tags.struct(list.name,children)));
  }
  /** Removes a stored key without mutating the source map or imposing assignment policy. */
  unassign(slot:number):SlotAssignment{
    const root=this.file.root,list=root.getStruct()[1];
    const children=list.getStruct().filter(tag=>tag.type!==TagType.FINISH&&tag.getStruct()[0].getByte()!==slot);
    return this.updated(replaceTagField(root,1,Tags.struct(list.name,children)));
  }
  /** Carries both edit bounds and binary limits to a validated revision. */
  private updated(root:Tag):SlotAssignment{return SlotAssignment.fromFile(this.file.withRoot(root),{...this.file.options,minSlot:this.minSlot,maxSlot:this.maxSlot});}
  /** JSON preserves full signed-long keys as decimal strings. */
  toJSON():object{return {version:this.version,slots:[...this.data].map(([slot,position])=>({slot,position:String(position)}))};}
  /** Human-readable collection summary. */
  toString():string{return `SlotAssignment(${this.data.size} slots)`;}
}
