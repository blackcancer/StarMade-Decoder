/** @fileoverview Editable player-character records without transform calculations. */
import { Tag } from '../core/Tag.js';
import { Tags } from '../core/TagBuilder.js';
import { TagType } from '../core/TagType.js';
import { DecodeError } from '../core/DecodeError.js';
import type { TagReadOptions } from '../core/TagParser.js';
import { TagModelFile, replaceTagField } from '../core/TagModelFile.js';
import type { Vector3i } from '../types/Vectors.js';
import { AiConfigurationState } from './EntitySlotObjects.js';

/** Named persisted transformable values; the matrix remains an uninterpreted 16-float list. */
export interface PlayerTransformableFields {
  mass: number; transformValues: readonly number[];
  /** Legacy boolean projection of the BYTE placeholder; use aiConfiguration to inspect AI data. */
  noAI: boolean;
  sectorPosition: Vector3i; factionId: number; owner: string;
}
/** Rejects values that cannot survive float32 storage without becoming infinite. */
function float(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE','Player field must fit finite float32');
  return Math.fround(value);
}
/** Immutable transformable record; opaque AI/spawn/controller fields are retained. */
export class PlayerTransformable implements PlayerTransformableFields {
  private readonly file: TagModelFile;
  private readonly matrix: readonly number[];
  readonly sectorPosition: Vector3i;
  /** Creates a complete record from explicit values, without generating any geometry. */
  constructor(readonly mass: number, transformValues: readonly number[], readonly noAI: boolean,
    sectorPosition: Vector3i, readonly factionId: number, readonly owner: string,
    extra: readonly Tag[] = [], options: TagReadOptions = {}, source?: TagModelFile) {
    this.mass=float(mass);
    if(transformValues.length!==16)throw new DecodeError('E_FORMAT','Player transform requires exactly 16 floats');
    this.matrix=Object.freeze(transformValues.map(float));
    if(!sectorPosition||typeof noAI!=='boolean')throw new DecodeError('E_FORMAT','Player sector and boolean flag are required');
    this.sectorPosition=Object.freeze({...sectorPosition});
    this.file=source??new TagModelFile(Tags.struct('transformable',[
      Tags.float('mass',this.mass),Tags.list('transform',this.matrix.map(value=>Tags.float(null,value))),
      Tags.bool('noAI',noAI),Tags.vector3i('sPos',sectorPosition.x,sectorPosition.y,sectorPosition.z),
      Tags.int('fid',factionId),Tags.string('own',owner),...extra]),options);
    Object.freeze(this);
  }
  /** Detached values in the original stored order; no matrix multiplication or inversion is performed. */
  get transformValues():number[] {return [...this.matrix];}
  /** Saved AI configuration, or null when the slot contains the no-AI byte placeholder. */
  get aiConfiguration():AiConfigurationState|null {
    const tag=this.file.root.getStruct()[2];
    return tag?.type===TagType.STRUCT?new AiConfigurationState(tag,this.file.options):null;
  }
  /** Explicitly replaces an AI configuration or writes the game's no-AI byte placeholder. */
  withAiConfiguration(value:AiConfigurationState|null):PlayerTransformable {
    return PlayerTransformable.fromFile(this.file.withRoot(replaceTagField(this.file.root,2,value===null?Tags.byte('noAI',0):value.toTag(),[TagType.BYTE,TagType.STRUCT])));
  }
  /** Reads mandatory mass/matrix and legacy optional fields while retaining all source data. */
  static fromTag(tag:Tag,options:TagReadOptions={}):PlayerTransformable {return PlayerTransformable.fromFile(new TagModelFile(tag,options));}
  /** Derives a complete view from private bounded storage. */
  private static fromFile(file:TagModelFile):PlayerTransformable {
    const s=file.root.getStruct().filter(tag=>tag.type!==TagType.FINISH);
    if(s[0]?.type!==TagType.FLOAT||s[1]?.type!==TagType.LIST)throw new DecodeError('E_FORMAT','Invalid player transformable fields');
    if(s[2]&&![TagType.BYTE,TagType.STRUCT].includes(s[2].type))throw new DecodeError('E_FORMAT','Invalid optional player transformable AI field');
    for(const [index,type] of [[3,TagType.VECTOR3i],[4,TagType.INT],[5,TagType.STRING]]) {
      if(s[index]&&s[index].type!==type)throw new DecodeError('E_FORMAT','Invalid optional player transformable field');
    }
    const matrix=s[1].getList().map(tag=>tag.getFloat());
    // Legacy files may omit optional slots; callers cannot edit an absent slot silently.
    const position=s[3]?.type===TagType.VECTOR3i?s[3].getVector3i():{x:0,y:0,z:0};
    return new PlayerTransformable(s[0].getFloat(),matrix,s[2]?.type===TagType.BYTE?s[2].getByte()!==0:false,
      position,s[4]?.type===TagType.INT?s[4].getInt():0,s[5]?.type===TagType.STRING?s[5].getString():'',[],file.options,file);
  }
  /** Returns a validated revision preserving names and every untouched source field. */
  with(changes:Partial<PlayerTransformableFields>):PlayerTransformable {
    let root=this.file.root;
    if(changes.mass!==undefined)root=replaceTagField(root,0,Tags.float(null,float(changes.mass)));
    if(changes.transformValues!==undefined){
      if(changes.transformValues.length!==16)throw new DecodeError('E_FORMAT','Player transform requires exactly 16 floats');
      root=replaceTagField(root,1,Tags.list(null,changes.transformValues.map(value=>Tags.float(null,float(value)))));
    }
    if(changes.noAI!==undefined){
      if(typeof changes.noAI!=='boolean')throw new DecodeError('E_RANGE','Player flag must be boolean');
      const before=this.file.originalRoot.getStruct()[2];
      root=replaceTagField(root,2,before?.type===TagType.BYTE&&(before.getByte()!==0)===changes.noAI?before:Tags.bool(null,changes.noAI));
    }
    if(changes.sectorPosition!==undefined){const v=changes.sectorPosition;root=replaceTagField(root,3,Tags.vector3i(null,v.x,v.y,v.z));}
    if(changes.factionId!==undefined)root=replaceTagField(root,4,Tags.int(null,changes.factionId));
    if(changes.owner!==undefined)root=replaceTagField(root,5,Tags.string(null,changes.owner));
    return PlayerTransformable.fromFile(this.file.withRoot(root));
  }
  /** Detached complete record, including unknown AI/spawn fields. */
  toTag():Tag{return this.file.root;}
  /** JSON exposes only represented data, not private binary storage. */
  toJSON():PlayerTransformableFields{return {mass:this.mass,transformValues:this.transformValues,noAI:this.noAI,sectorPosition:{...this.sectorPosition},factionId:this.factionId,owner:this.owner};}
}

/** Player-character format model with immutable edits and original file envelopes. */
export class PlayerCharacter {
  private readonly file:TagModelFile;
  /** Creates a complete character record with explicit persisted values. */
  constructor(readonly id:number,readonly speed:number,readonly stepHeight:number,readonly transformable:PlayerTransformable,
    options:TagReadOptions={},source?:TagModelFile){
    this.speed=float(speed);this.stepHeight=float(stepHeight);
    this.file=source??new TagModelFile(Tags.struct('PlayerCharacter',[Tags.int('id',id),Tags.float('speed',this.speed),
      Tags.float('stepHeight',this.stepHeight),transformable.toTag()]),options);Object.freeze(this);
  }
  /** Stored sector coordinate; no world-space transformation is applied. */
  get sectorPosition():Vector3i{return {...this.transformable.sectorPosition};}
  /** Stored faction ID. */
  get factionId():number{return this.transformable.factionId;}
  /** Stored owner string. */
  get owner():string{return this.transformable.owner;}
  /** Updates the positional ID while retaining its actual source name. */
  withId(id:number):PlayerCharacter{return this.updated(replaceTagField(this.file.root,0,Tags.int(null,id)));}
  /** Updates a finite float32 speed. */
  withSpeed(speed:number):PlayerCharacter{return this.updated(replaceTagField(this.file.root,1,Tags.float(null,float(speed))));}
  /** Updates the stored step-height value. */
  withStepHeight(height:number):PlayerCharacter{return this.updated(replaceTagField(this.file.root,2,Tags.float(null,float(height))));}
  /** Updates only the nested faction field. */
  withFactionId(id:number):PlayerCharacter{return this.withTransformable(this.transformable.with({factionId:id}));}
  /** Updates only the nested owner field. */
  withOwner(owner:string):PlayerCharacter{return this.withTransformable(this.transformable.with({owner}));}
  /** Replaces the nested record without rebuilding or losing the character's extensions. */
  withTransformable(value:PlayerTransformable):PlayerCharacter{return this.updated(replaceTagField(this.file.root,3,value.toTag()));}
  /** Validates an edited root before exposing it. */
  private updated(root:Tag):PlayerCharacter{return PlayerCharacter.fromFile(this.file.withRoot(root));}
  /** Detached complete root. */
  toTag():Tag{return this.file.root;}
  /** Preserves original compression, version and trailing bytes. */
  toBuffer():Buffer{return this.file.toBuffer();}
  /** Reads the actual positional tuple, independent from field names. */
  static fromTag(root:Tag,options:TagReadOptions={}):PlayerCharacter{return PlayerCharacter.fromFile(new TagModelFile(root,options));}
  /** Projects known fields from a private immutable root. */
  private static fromFile(file:TagModelFile):PlayerCharacter{
    const s=file.root.getStruct();
    if(s[0]?.type!==TagType.INT||s[1]?.type!==TagType.FLOAT||s[2]?.type!==TagType.FLOAT||s[3]?.type!==TagType.STRUCT)throw new DecodeError('E_FORMAT','Invalid player-character fields');
    return new PlayerCharacter(s[0].getInt(),s[1].getFloat(),s[2].getFloat(),PlayerTransformable.fromTag(s[3],file.options),file.options,file);
  }
  /** Reads a complete file with shared resource budgets charged once. */
  static fromBuffer(data:Uint8Array,options:TagReadOptions={}):PlayerCharacter{return PlayerCharacter.fromFile(TagModelFile.fromBuffer(data,options));}
  /** Plain JSON data without retained binary metadata. */
  toJSON():object{return {id:this.id,speed:this.speed,stepHeight:this.stepHeight,transformable:this.transformable.toJSON()};}
  /** Human-readable file summary. */
  toString():string{return `PlayerCharacter(id=${this.id}, speed=${this.speed}, sector=${JSON.stringify(this.sectorPosition)}, faction=${this.factionId}, owner="${this.owner}")`;}
}
