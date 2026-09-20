/** @fileoverview Lossless block-text collections with detached maps and bounded immutable edits. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import type { TagReadOptions } from '../../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../../core/TagModelFile.js';
import { DecodeError } from '../../core/DecodeError.js';
import { indexToPos, type BlockPosition } from '../ElementPosition.js';

/** Text records indexed by the game's stored block-position key. */
export class TextBlocks {
  private readonly data:ReadonlyMap<bigint,string>;
  /** Projects validated records from immutable private storage. */
  private constructor(private readonly file:TagModelFile){
    const entries=new Map<bigint,string>();
    for(const tag of file.root.getStruct().filter(value=>value.type!==TagType.FINISH)){
      const pair=tag.getStruct();
      if(pair[0]?.type!==TagType.LONG||pair[1]?.type!==TagType.STRING)throw new DecodeError('E_FORMAT','Invalid block-text record');
      const position=pair[0].getLong();if(entries.has(position))throw new DecodeError('E_FORMAT','Duplicate block-text position');
      entries.set(position,pair[1].getString());
    }
    this.data=entries;Object.freeze(this);
  }
  /** Empty typed collection with default codec limits. */
  static readonly EMPTY=TextBlocks.fromTag(Tags.struct(null,[]));
  /** Reads all records strictly, retaining entry extensions and names. */
  static fromTag(tag:Tag,options:TagReadOptions={}):TextBlocks{return new TextBlocks(new TagModelFile(tag,options));}
  /** Detached complete collection tree. */
  toTag():Tag{return this.file.root;}
  /** Number of represented block positions. */
  get size():number{return this.data.size;}
  /** Exact stored-key lookup. */
  has(position:bigint):boolean{return this.data.has(position);}
  /** Returns the text for an existing position. */
  get(position:bigint):string|undefined{return this.data.get(position);}
  /** Detached map; mutating it cannot change the source collection. */
  entries():ReadonlyMap<bigint,string>{return new Map(this.data);}
  /** Decodes packed integer coordinates only; performs no rendering or geometry computation. */
  positions():Array<{pos:bigint;block:BlockPosition;text:string}>{return [...this.data].map(([pos,text])=>({pos,block:indexToPos(pos),text}));}
  /** Adds or edits one record, retaining names and unknown per-entry extensions. */
  set(position:bigint,text:string):TextBlocks{
    if(typeof position!=='bigint'||position<-(1n<<63n)||position>=(1n<<63n))throw new DecodeError('E_RANGE','Text position requires a signed 64-bit bigint');
    const root=this.file.root,children=root.getStruct().filter(tag=>tag.type!==TagType.FINISH);
    const index=children.findIndex(tag=>tag.getStruct()[0].getLong()===position);
    if(index<0)children.push(Tags.struct(null,[Tags.long(null,position),Tags.string(null,text)]));
    else children[index]=replaceTagField(children[index],1,Tags.string(null,text));
    return new TextBlocks(this.file.withRoot(Tags.struct(root.name,children)));
  }
  /** Removes a position, preserving the source and all unrelated entries. */
  delete(position:bigint):TextBlocks{
    const root=this.file.root,children=root.getStruct().filter(tag=>tag.type!==TagType.FINISH&&tag.getStruct()[0].getLong()!==position);
    return new TextBlocks(this.file.withRoot(Tags.struct(root.name,children)));
  }
  /** Exact JSON keys represented as decimal strings. */
  toJSON():Array<{position:string;text:string}>{return [...this.data].map(([position,text])=>({position:String(position),text}));}
  /** Human-readable collection summary. */
  toString():string{return `TextBlocks(${this.size} entries)`;}
}
