/** @fileoverview Bounded segment-controller file views and wrapper-preserving edits. */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../core/TagModelFile.js';
import { DecodeError } from '../core/DecodeError.js';
import { RawElement } from '../serializable/Factories.js';
import { ControlElementMapper, ElementCountMap, Long2Vector3fMap, Long2TransformMap } from './Serializables.js';
import type { Vector3i } from '../types/Vectors.js';
import type { Matrix4f } from '../types/Matrices.js';

/** Locates the controller inside a direct file or one of the game's wrapper structures. */
function controllerPath(root:Tag):number[] {
  const children=root.getStruct();
  if(children.some(tag=>tag.name==='uniqueId'&&tag.type===TagType.STRING))return [];
  const index=children.findIndex(tag=>tag.type===TagType.STRUCT&&tag.getStruct().some(child=>child.name==='uniqueId'&&child.type===TagType.STRING));
  if(index<0)throw new DecodeError('E_FORMAT','No segment-controller record found');
  return [index];
}
/** Retrieves a controller while preserving the surrounding structure separately. */
function controller(root:Tag,path:readonly number[]):Tag {return path.length?root.getStruct()[path[0]]:root;}
/** Reads a positional optional scalar without substituting corrupt present values. */
function optional<T>(tag:Tag|undefined,type:TagType,fallback:T):T {
  if(!tag)return fallback;
  if(tag.type!==type)throw new DecodeError('E_FORMAT','Invalid segment-controller field');
  return tag.value as T;
}

/** Immutable file view for ships, stations and shops, without geometry or server actions. */
export class SegmentControllerObject {
  readonly uniqueId:string; readonly realName:string;
  readonly minPos:Vector3i|null; readonly maxPos:Vector3i|null;
  readonly factionCode:number; readonly owner:string; readonly sectorPosition:Vector3i|null;
  readonly transform:Matrix4f|null;
  private readonly matrixValues:readonly number[]|null;
  readonly creatorId:number; readonly spawner:string; readonly lastModifier:string;
  readonly seed:bigint; readonly nonEmptySegments:number;
  readonly currentOwner:string; readonly lastDockerPlayer:string;
  readonly scrap:boolean; readonly vulnerable:boolean; readonly minable:boolean; readonly factionRights:number;
  private readonly path:readonly number[];
  /** Derives a view from a validated private file snapshot. */
  private constructor(private readonly file:TagModelFile){
    const root=file.root;this.path=controllerPath(root);const s=controller(root,this.path).getStruct().filter(t=>t.type!==TagType.FINISH);
    this.uniqueId=s.find(t=>t.name==='uniqueId')!.getString();
    this.realName=(s.find(t=>t.name==='realName'||t.name==='realname')??s[5])?.getString()??'';
    const min=s.find(t=>t.name==='minPos')??s[1],max=s.find(t=>t.name==='maxPos')??s[2];
    this.minPos=min?Object.freeze(min.getVector3i()):null;this.maxPos=max?Object.freeze(max.getVector3i()):null;
    this.creatorId=optional(s[8],TagType.INT,0);this.spawner=optional(s[9],TagType.STRING,'');
    this.lastModifier=optional(s[10],TagType.STRING,'');this.seed=optional(s[11],TagType.LONG,0n);
    this.nonEmptySegments=optional(s[20],TagType.INT,0);
    this.currentOwner=optional(s[25],TagType.STRING,'');this.lastDockerPlayer=optional(s[26],TagType.STRING,'');
    this.scrap=s[15]?.type===TagType.STRUCT?false:optional(s[15],TagType.BYTE,0)>0;
    this.vulnerable=optional(s[16],TagType.BYTE,1)>0;this.minable=optional(s[17],TagType.BYTE,1)>0;
    this.factionRights=optional(s[18],TagType.BYTE,-2);
    const tr=s.find(t=>t.name==='transformable')??s[6];
    let faction=0,owner='',position:Vector3i|null=null,matrix:Matrix4f|null=null,values:number[]|null=null;
    if(tr){
      const ts=tr.getStruct().filter(t=>t.type!==TagType.FINISH);
      if(ts[1]?.type===TagType.MATRIX4f)matrix=Object.freeze(ts[1].getMatrix4f());
      else if(ts[1]?.type===TagType.LIST){values=ts[1].getList().map(t=>t.getFloat());if(values.length!==16)throw new DecodeError('E_FORMAT','Transform requires 16 stored floats');}
      else if(ts[1])throw new DecodeError('E_FORMAT','Invalid stored transform');
      if(ts[3])position=Object.freeze(ts[3].getVector3i());
      if(ts[4])faction=ts[4].getInt();if(ts[5])owner=ts[5].getString();
    }
    this.factionCode=faction;this.owner=owner;this.sectorPosition=position;this.transform=matrix;this.matrixValues=values;
    Object.freeze(this);
  }
  /** Actual float-list payload in stored order, without conversion or 3D calculations. */
  get transformValues():number[]|null{return this.matrixValues?[...this.matrixValues]:null;}
  /** Walks only the already bounded, detached tree. */
  private serializables():RawElement[]{
    const result:RawElement[]=[],pending=[this.file.root];
    while(pending.length){const tag=pending.pop()!;
      if(tag.type===TagType.SERIALIZABLE)result.push(tag.value as RawElement);
      if(tag.type===TagType.STRUCT||tag.type===TagType.LIST)pending.push(...[...(tag.value as Tag[])].reverse());
    }
    return result;
  }
  /** Retains the caller's budgets when projecting nested serialized values. */
  private get limits(){return {maxBytes:this.file.options.maxInflatedBytes,maxEntries:this.file.options.maxNodes};}
  /** First represented controller mapping, detached from the saved bytes. */
  get controlElementMapper():ControlElementMapper|null{const tag=controller(this.file.root,this.path).getStruct()[4];return tag&&tag.type!==TagType.FINISH?ControlElementMapper.fromTag(tag,this.file.options):null;}
  /** First stored block count map. */
  get elementCountMap():ElementCountMap|null{const raw=this.serializables().find(value=>value.factoryId===1);return raw?ElementCountMap.fromRaw(raw.raw,this.limits):null;}
  /** Stored vector maps; no positions are calculated. */
  get long2Vector3fMaps():Long2Vector3fMap[]{return this.serializables().filter(value=>value.factoryId===5).map(value=>Long2Vector3fMap.fromRaw(value.raw,this.limits));}
  /** Stored transform maps; no transforms are applied. */
  get long2TransformMaps():Long2TransformMap[]{return this.serializables().filter(value=>value.factoryId===6).map(value=>Long2TransformMap.fromRaw(value.raw,this.limits));}
  /** Updates the controller UID inside its original wrapper. */
  withName(name:string):SegmentControllerObject{return this.edit(sc=>{
    const index=sc.getStruct().findIndex(t=>t.name==='uniqueId');return replaceTagField(sc,index,Tags.string(null,name));});}
  /** Updates the existing display-name slot, preserving either realname spelling. */
  withRealName(name:string):SegmentControllerObject{return this.edit(sc=>{
    const index=sc.getStruct().findIndex(t=>t.name==='realName'||t.name==='realname');return replaceTagField(sc,index<0?5:index,Tags.string(null,name));});}
  /** Updates the existing nested faction field without inserting a second transformable. */
  withFactionCode(code:number):SegmentControllerObject{return this.edit(sc=>{
    const s=sc.getStruct(),index=s.findIndex(t=>t.name==='transformable'),slot=index<0?6:index;
    if(!s[slot])throw new DecodeError('E_FORMAT','Controller has no transformable');
    return replaceTagField(sc,slot,replaceTagField(s[slot],4,Tags.int(null,code)));});}
  /** Replaces precisely the located controller, retaining wrapper siblings and file metadata. */
  private edit(update:(sc:Tag)=>Tag):SegmentControllerObject{
    const root=this.file.root,sc=update(controller(root,this.path));
    return new SegmentControllerObject(this.file.withRoot(this.path.length?replaceTagField(root,this.path[0],sc):sc));
  }
  /** Detached complete root, including wrapper and unknown fields. */
  toTag():Tag{return this.file.root;}
  /** Exact source bytes for untouched and reverted models. */
  toBuffer():Buffer{return this.file.toBuffer();}
  /** Reads one controller tree with resource limits. */
  static fromTag(root:Tag,options:TagReadOptions={}):SegmentControllerObject{return new SegmentControllerObject(new TagModelFile(root,options));}
  /** Reads a complete envelope-preserving file. */
  static fromBuffer(data:Uint8Array,options:TagReadOptions={}):SegmentControllerObject{return new SegmentControllerObject(TagModelFile.fromBuffer(data,options));}
  /** JSON projection excluding retained private bytes. */
  toJSON():object{return {uniqueId:this.uniqueId,realName:this.realName,minPos:this.minPos,maxPos:this.maxPos,factionCode:this.factionCode,
    owner:this.owner,sectorPosition:this.sectorPosition,transform:this.transform,transformValues:this.transformValues,creatorId:this.creatorId,
    spawner:this.spawner,lastModifier:this.lastModifier,seed:String(this.seed),nonEmptySegments:this.nonEmptySegments,
    currentOwner:this.currentOwner,lastDockerPlayer:this.lastDockerPlayer,scrap:this.scrap,vulnerable:this.vulnerable,minable:this.minable,factionRights:this.factionRights};}
  /** Human-readable record summary. */
  toString():string{return `SegmentControllerObject(id="${this.uniqueId}", name="${this.realName}", sector=${JSON.stringify(this.sectorPosition)}, faction=${this.factionCode})`;}
}
