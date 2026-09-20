/** @fileoverview Immutable docking data; positions, legacy fields and quaternions are stored without geometry calculations. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { writeTo, readFrom, type TagReadOptions } from '../../core/TagParser.js';
import { copyTagModel, tagModelOptions } from '../../core/TagModel.js';
import { DecodeError } from '../../core/DecodeError.js';

/** Stored quaternion coordinates, with no normalization or orientation conversion. */
export interface DockingQuaternion { x: number; y: number; z: number; w: number; }
/** Extra persisted fields and resource ceilings accepted after the original constructor arguments. */
export interface DockingStateOptions extends TagReadOptions {
  quaternion?: DockingQuaternion; legacyLandedTo?: Tag; legacyLandedPosition?: Tag;
}
/** Editable raw docking data. Historical slots remain Tags because their old layouts differ. */
export interface DockingStateFields {
  dockedTo: string; dockPosX: number; dockPosY: number; dockPosZ: number;
  sizeX: number; sizeY: number; sizeZ: number; localOrientation: number;
  quaternion: DockingQuaternion; legacyLandedTo: Tag; legacyLandedPosition: Tag;
}
/** Returns positional fields after validating the complete tree through the codec. */
function parts(tag: Tag): Tag[] { return tag.getStruct().filter(t => t.type !== TagType.FINISH); }
/** Checks the stored numeric representation, without adding game policy. */
function float(value: number): number {
  if (typeof value !== 'number' || (Number.isFinite(value) && !Number.isFinite(Math.fround(value)))) throw new DecodeError('E_RANGE', 'Invalid docking float32');
  return Math.fround(value);
}
/** Retains the actual docking schema, including historical optional suffixes. */
export class DockingState implements DockingStateFields {
  static readonly NONE = 'NONE';
  #options: TagReadOptions;
  #quaternion: DockingQuaternion;
  #landed: Tag;
  #landedPosition: Tag;
  #source?: Buffer;
  #baseline?: Buffer[];
  /** Creates a current record; legacy slots default to the actual BYTE placeholders. */
  constructor(readonly dockedTo: string, readonly dockPosX: number, readonly dockPosY: number, readonly dockPosZ: number,
    readonly sizeX: number, readonly sizeY: number, readonly sizeZ: number, readonly localOrientation: number, options: DockingStateOptions = {}) {
    if (typeof dockedTo !== 'string') throw new DecodeError('E_FORMAT', 'Docking host must be a string');
    if (!Number.isInteger(localOrientation) || localOrientation < -128 || localOrientation > 127) throw new DecodeError('E_RANGE', 'Docking orientation requires a signed byte');
    const {quaternion, legacyLandedTo, legacyLandedPosition, ...limits} = options;
    this.#options = Object.freeze(tagModelOptions(limits));
    this.sizeX = float(sizeX); this.sizeY = float(sizeY); this.sizeZ = float(sizeZ);
    const q = quaternion ?? {x:0,y:0,z:0,w:1}; this.#quaternion = {x:float(q.x),y:float(q.y),z:float(q.z),w:float(q.w)};
    this.#landed = copyTagModel(legacyLandedTo ?? Tags.byte(null,0), this.#options);
    this.#landedPosition = copyTagModel(legacyLandedPosition ?? Tags.byte(null,0), this.#options);
    if (this.#landed.type === TagType.FINISH || this.#landedPosition.type === TagType.FINISH) throw new DecodeError('E_FORMAT', 'A docking data slot cannot be FINISH');
    writeTo(Tags.struct(null, this.fields()), this.#options); Object.freeze(this);
  }
  /** Newly constructed undocked record. */
  static readonly UNDOCKED = new DockingState(DockingState.NONE,0,0,0,0,0,0,0);
  /** Detached quaternion values. */
  get quaternion(): DockingQuaternion { return {...this.#quaternion}; }
  /** Detached obsolete landed-host slot; current records contain BYTE zero. */
  get legacyLandedTo(): Tag { return copyTagModel(this.#landed, this.#options); }
  /** Detached obsolete landed-position slot; current records contain BYTE zero. */
  get legacyLandedPosition(): Tag { return copyTagModel(this.#landedPosition, this.#options); }
  /** Whether a host identity is stored. */
  get isDocked(): boolean { return this.dockedTo !== DockingState.NONE && this.dockedTo !== ''; }
  /** Parses required host data and validates every present typed optional field. */
  static fromTag(tag: Tag, options: TagReadOptions = {}): DockingState {
    const root = copyTagModel(tag, options), data = parts(root);
    if (data[0]?.type !== TagType.STRING) throw new DecodeError('E_FORMAT', 'Missing docking host');
    const host = data[0].getString();
    if ((host !== DockingState.NONE && !data[1]) || (data[1] && data[1].type !== TagType.VECTOR3i)) throw new DecodeError('E_FORMAT', 'Invalid docking position');
    for (const [index,type] of [[4,TagType.VECTOR3f],[5,TagType.BYTE],[6,TagType.VECTOR4f]]) if (data[index] && data[index].type !== type) throw new DecodeError('E_FORMAT', 'Invalid optional docking field');
    const pos = data[1]?.getVector3i() ?? {x:0,y:0,z:0}, size = data[4]?.getVector3f() ?? {x:0,y:0,z:0};
    const result = new DockingState(host,pos.x,pos.y,pos.z,size.x,size.y,size.z,data[5]?.getByte() ?? 0,
      {...options,quaternion:data[6]?.getVector4f(),legacyLandedTo:data[2],legacyLandedPosition:data[3]});
    result.#source = writeTo(root,result.#options); result.#baseline = result.fields().map(t => writeTo(t,result.#options)); return result;
  }
  /** Current semantic values, with detached legacy payloads. */
  private fields(): Tag[] {
    const q=this.#quaternion;
    return [Tags.string(null,this.dockedTo),Tags.vector3i(null,this.dockPosX,this.dockPosY,this.dockPosZ),this.legacyLandedTo,this.legacyLandedPosition,
      Tags.vector3f('s',this.sizeX,this.sizeY,this.sizeZ),Tags.byte(null,this.localOrientation),Tags.vector4f(null,q.x,q.y,q.z,q.w)];
  }
  /** Patches only changed fields, retaining all names, optional absences and unknown suffixes. */
  toTag(): Tag {
    const fields=this.fields(), root=this.#source ? readFrom(this.#source,this.#options) : Tags.struct(null,fields), data=parts(root);
    for(let i=0;i<fields.length;i++) {
      if(this.#baseline?.[i].equals(writeTo(fields[i],this.#options))) continue;
      while(data.length<=i) data.push(fields[data.length]);
      data[i]=Tags.rename(fields[i],data[i].name);
    }
    const result=Tags.struct(root.name,data); writeTo(result,this.#options); return result;
  }
  /** Applies stored values without normalizing positions, sizes or orientation. */
  with(changes: Partial<DockingStateFields>): DockingState {
    const f={dockedTo:this.dockedTo,dockPosX:this.dockPosX,dockPosY:this.dockPosY,dockPosZ:this.dockPosZ,sizeX:this.sizeX,sizeY:this.sizeY,sizeZ:this.sizeZ,localOrientation:this.localOrientation,
      quaternion:this.quaternion,legacyLandedTo:this.legacyLandedTo,legacyLandedPosition:this.legacyLandedPosition,...changes};
    const result=new DockingState(f.dockedTo,f.dockPosX,f.dockPosY,f.dockPosZ,f.sizeX,f.sizeY,f.sizeZ,f.localOrientation,
      {...this.#options,quaternion:f.quaternion,legacyLandedTo:f.legacyLandedTo,legacyLandedPosition:f.legacyLandedPosition});
    result.#source=this.#source; result.#baseline=this.#baseline; result.toTag(); return result;
  }
  /** Clears only the host, docking position and byte orientation. */
  undock(): DockingState { return this.with({dockedTo:DockingState.NONE,dockPosX:0,dockPosY:0,dockPosZ:0,localOrientation:0}); }
  /** Replaces host and stored docking position while retaining all other data. */
  dockTo(entityUID: string,posX: number,posY: number,posZ: number,orient=0): DockingState { return this.with({dockedTo:entityUID,dockPosX:posX,dockPosY:posY,dockPosZ:posZ,localOrientation:orient}); }
  /** Human-readable docking identity and position. */
  toString(): string { return this.isDocked ? `DockingState(dockedTo="${this.dockedTo}", pos=(${this.dockPosX},${this.dockPosY},${this.dockPosZ}))` : 'DockingState(UNDOCKED)'; }
}
