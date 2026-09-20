/** @fileoverview Immutable power and thrust records preserving actual current and historical saved layouts. */
import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { readFrom, writeTo, type TagReadOptions } from '../../core/TagParser.js';
import { copyTagModel, tagModelOptions } from '../../core/TagModel.js';
import { DecodeError } from '../../core/DecodeError.js';

/** Private source bytes and semantic field baselines survive immutable edits. */
const origins = new WeakMap<object,{bytes:Buffer;fields:Buffer[]}>();
/** Removes only the validated STRUCT terminator. */
function parts(tag: Tag): Tag[] { return tag.getStruct().filter(t => t.type !== TagType.FINISH); }
/** Captures complete source records and canonical known values. */
function remember(model: object,tag: Tag,fields: Tag[],options: TagReadOptions): void {
  origins.set(model,{bytes:writeTo(tag,options),fields:fields.map(t=>writeTo(t,options))});
}
/** Transfers inaccessible source bytes without sharing public mutable state. */
function inherit<T extends object>(before: object,after: T): T { const saved=origins.get(before);if(saved) origins.set(after,saved);return after; }
/** Restores one independently owned source tree. */
function source(model: object,options: TagReadOptions): Tag | undefined { const saved=origins.get(model);return saved && readFrom(saved.bytes,options); }
/** Patches semantic changes and fills newly introduced suffixes with real format fields. */
function render(model: object,fields: Tag[],options: TagReadOptions): Tag {
  const previous=source(model,options), root=previous?.type===TagType.STRUCT ? previous : Tags.struct(previous?.name ?? null,fields), data=parts(root), original=origins.get(model);
  for(let index=0;index<fields.length;index++) {
    if(original?.fields[index].equals(writeTo(fields[index],options))) continue;
    while(data.length<=index) data.push(fields[data.length]);
    data[index]=Tags.rename(fields[index],data[index].name);
  }
  const result=Tags.struct(root.name,data);writeTo(result,options);return result;
}
/** Accepts only actual numeric double values, including persisted IEEE special values. */
function number(value: number): void { if(typeof value!=='number') throw new DecodeError('E_FORMAT','Expected a numeric stored value'); }
/** Rounds to the stored float32 width, rejecting overflow from finite caller input. */
function float(value: number): number {
  number(value);if(Number.isFinite(value) && !Number.isFinite(Math.fround(value))) throw new DecodeError('E_RANGE','Stored float32 overflow');return Math.fround(value);
}
/** Legacy DOUBLE power is retained until a nonzero battery is explicitly introduced. */
export interface PowerStateOptions extends TagReadOptions { legacy?: boolean; }
/** Editable raw reactor and battery values. */
export interface PowerStateFields { initialPower: number; initialBatteryPower: number; }
/** Persisted reactor/battery values, without capacity or game-rule calculations. */
export class PowerState implements PowerStateFields {
  #options: TagReadOptions;
  #legacy: boolean;
  /** Creates a current record unless legacy scalar storage is explicitly requested. */
  constructor(readonly initialPower: number,readonly initialBatteryPower: number,options: PowerStateOptions = {}) {
    const {legacy=false,...limits}=options;
    if(typeof legacy!=='boolean') throw new DecodeError('E_FORMAT','Invalid power layout');
    number(initialPower);number(initialBatteryPower);this.#legacy=legacy;this.#options=Object.freeze(tagModelOptions(limits));
    writeTo(this.toTag(),this.#options);Object.freeze(this);
  }
  /** Empty current-format reactor state. */
  static readonly EMPTY = new PowerState(0,0);
  /** Whether serialization currently fits the historical DOUBLE representation. */
  get legacy(): boolean { return this.#legacy && this.initialBatteryPower===0; }
  /** Parses the current two-DOUBLE schema and retains its extensions. */
  static fromTag(tag: Tag,options: TagReadOptions = {}): PowerState {
    const root=copyTagModel(tag,options),data=parts(root);
    if(data[0]?.type!==TagType.DOUBLE || data[1]?.type!==TagType.DOUBLE) throw new DecodeError('E_FORMAT','Power requires reactor and battery DOUBLE values');
    const result=new PowerState(data[0].getDouble(),data[1].getDouble(),options);remember(result,root,result.fields(),result.#options);return result;
  }
  /** Reads scalar historical power or delegates a current STRUCT without converting it. */
  static fromTagOld(tag: Tag,options: TagReadOptions = {}): PowerState {
    if(tag.type!==TagType.DOUBLE) return PowerState.fromTag(tag,options);
    const root=copyTagModel(tag,options),result=new PowerState(root.getDouble(),0,{...options,legacy:true});remember(result,root,result.fields(),result.#options);return result;
  }
  /** Known reactor and battery values. */
  private fields(): Tag[] { return [Tags.double(null,this.initialPower),Tags.double(null,this.initialBatteryPower)]; }
  /** Preserves legacy scalar names and current STRUCT extensions. */
  toTag(): Tag {
    if(this.legacy) {
      const result=Tags.double(source(this,this.#options)?.name ?? null,this.initialPower);writeTo(result,this.#options);return result;
    }
    return render(this,this.fields(),this.#options);
  }
  /** Edits reactor or battery; adding a nonzero legacy battery deliberately produces a STRUCT. */
  with(changes: Partial<PowerStateFields>): PowerState {
    const fields={initialPower:this.initialPower,initialBatteryPower:this.initialBatteryPower,...changes};
    const result=inherit(this,new PowerState(fields.initialPower,fields.initialBatteryPower,{...this.#options,legacy:this.#legacy}));result.toTag();return result;
  }
  /** Replaces only the persisted reactor power. */
  withPower(power: number): PowerState { return this.with({initialPower:power}); }
  /** Replaces only battery power; returning to zero restores an original scalar envelope. */
  withBattery(battery: number): PowerState { return this.with({initialBatteryPower:battery}); }
  /** Diagnostic stored values. */
  toString(): string { return `PowerState(power=${this.initialPower.toFixed(0)}, battery=${this.initialBatteryPower.toFixed(0)})`; }
}

/** Old Ship extra-data starts with an optional timer rather than a thrust version. */
export interface ThrustConfigOptions extends TagReadOptions { legacy?: boolean; legacyTimer?: bigint; }
/** Persisted thrust switches and balances; no normalization or balancing rules apply. */
export interface ThrustConfigFields {
  automaticDampeners: boolean; automaticReactivateDampeners: boolean;
  thrustBalanceX: number; thrustBalanceY: number; thrustBalanceZ: number; rotationBalance: number;
  automaticDampenersOnExit: boolean; thrustSharing: boolean; repulsorBalance: number;
}
/** Current saved thrust version 0 and explicitly parsed historical Ship extra-data. */
export class ThrustConfig implements ThrustConfigFields {
  #options: TagReadOptions;
  readonly legacy: boolean;
  readonly legacyTimer: bigint | null;
  /** Retains the existing scalar constructor signature with a final limits/layout argument. */
  constructor(readonly version: number,readonly automaticDampeners: boolean,readonly automaticReactivateDampeners: boolean,
    readonly thrustBalanceX: number,readonly thrustBalanceY: number,readonly thrustBalanceZ: number,readonly rotationBalance: number,
    readonly automaticDampenersOnExit: boolean,readonly thrustSharing: boolean,readonly repulsorBalance: number,options: ThrustConfigOptions = {}) {
    if(version!==0) throw new DecodeError('E_UNSUPPORTED','Unsupported saved thrust version');
    const {legacy=false,legacyTimer,...limits}=options;
    if([legacy,automaticDampeners,automaticReactivateDampeners,automaticDampenersOnExit,thrustSharing].some(v=>typeof v!=='boolean')) throw new DecodeError('E_FORMAT','Thrust switches require booleans');
    this.legacy=legacy;this.legacyTimer=legacyTimer ?? null;
    if(legacyTimer!==undefined && (!legacy || typeof legacyTimer!=='bigint')) throw new DecodeError('E_FORMAT','A legacy thrust timer requires a bigint and legacy layout');
    this.thrustBalanceX=float(thrustBalanceX);this.thrustBalanceY=float(thrustBalanceY);this.thrustBalanceZ=float(thrustBalanceZ);
    this.rotationBalance=float(rotationBalance);this.repulsorBalance=float(repulsorBalance);
    if(legacy && repulsorBalance!==0) throw new DecodeError('E_UNSUPPORTED','Legacy thrust has no repulsor field');
    this.#options=Object.freeze(tagModelOptions(limits));writeTo(Tags.struct(null,this.fields()),this.#options);Object.freeze(this);
  }
  /** New version-zero record using the established SDK constructor defaults. */
  static readonly DEFAULT = new ThrustConfig(0,true,false,0,0,0,0,true,false,0);
  /** Strictly reads the current saved version-zero layout. */
  static fromTag(tag: Tag,options: TagReadOptions = {}): ThrustConfig { return ThrustConfig.parse(tag,false,options); }
  /** Explicitly reads the historical Ship timer/placeholder plus thrust fields. */
  static fromTagOld(tag: Tag,options: TagReadOptions = {}): ThrustConfig { return ThrustConfig.parse(tag,true,options); }
  /** Common schema validation keeps required and historically optional suffixes distinct. */
  private static parse(tag: Tag,legacy: boolean,options: TagReadOptions): ThrustConfig {
    const root=copyTagModel(tag,options),data=parts(root);
    if(legacy ? ![TagType.LONG,TagType.BYTE].includes(data[0]?.type) : data[0]?.type!==TagType.BYTE) throw new DecodeError('E_FORMAT','Invalid thrust header');
    const version=legacy ? 0 : data[0].getByte();
    for(const [index,type] of [[1,TagType.BYTE],[2,TagType.BYTE],[3,TagType.VECTOR3f],[4,TagType.FLOAT]]) if(data[index]?.type!==type) throw new DecodeError('E_FORMAT','Missing or invalid thrust field');
    if(!legacy || data.length>5) {
      if(data[5]?.type!==TagType.BYTE || data[6]?.type!==TagType.BYTE) throw new DecodeError('E_FORMAT','Thrust exit/sharing switches must form a complete pair');
    }
    if(!legacy && data[7] && data[7].type!==TagType.FLOAT) throw new DecodeError('E_FORMAT','Invalid thrust repulsor field');
    const axis=data[3].getVector3f(),result=new ThrustConfig(version,data[1].getByte()!==0,data[2].getByte()!==0,axis.x,axis.y,axis.z,data[4].getFloat(),
      data[5] ? data[5].getByte()!==0 : false,data[6] ? data[6].getByte()!==0 : false,!legacy && data[7] ? data[7].getFloat() : 0,
      {...options,legacy,legacyTimer:legacy && data[0].type===TagType.LONG ? data[0].getLong() : undefined});
    remember(result,root,result.fields(),result.#options);return result;
  }
  /** Current known slots; old records never gain a repulsor value at an unknown extension position. */
  private fields(): Tag[] {
    const result=[this.legacyTimer===null ? Tags.byte(null,0) : Tags.long(null,this.legacyTimer),Tags.bool(null,this.automaticDampeners),Tags.bool(null,this.automaticReactivateDampeners),
      Tags.vector3f(null,this.thrustBalanceX,this.thrustBalanceY,this.thrustBalanceZ),Tags.float(null,this.rotationBalance),Tags.bool(null,this.automaticDampenersOnExit),Tags.bool(null,this.thrustSharing)];
    if(!this.legacy) result.push(Tags.float(null,this.repulsorBalance));return result;
  }
  /** Returns a detached record preserving unknowns, names and absent optional fields. */
  toTag(): Tag { return render(this,this.fields(),this.#options); }
  /** Edits stored balances and switches; unsupported old-format fields require explicit new construction. */
  with(changes: Partial<ThrustConfigFields>): ThrustConfig {
    const f={automaticDampeners:this.automaticDampeners,automaticReactivateDampeners:this.automaticReactivateDampeners,thrustBalanceX:this.thrustBalanceX,thrustBalanceY:this.thrustBalanceY,thrustBalanceZ:this.thrustBalanceZ,
      rotationBalance:this.rotationBalance,automaticDampenersOnExit:this.automaticDampenersOnExit,thrustSharing:this.thrustSharing,repulsorBalance:this.repulsorBalance,...changes};
    const result=inherit(this,new ThrustConfig(this.version,f.automaticDampeners,f.automaticReactivateDampeners,f.thrustBalanceX,f.thrustBalanceY,f.thrustBalanceZ,f.rotationBalance,f.automaticDampenersOnExit,f.thrustSharing,f.repulsorBalance,
      {...this.#options,legacy:this.legacy,legacyTimer:this.legacyTimer ?? undefined}));result.toTag();return result;
  }
  /** Changes the stored dampener switch. */
  withDampeners(enabled: boolean): ThrustConfig { return this.with({automaticDampeners:enabled}); }
  /** Changes the stored thrust-sharing switch. */
  withThrustSharing(enabled: boolean): ThrustConfig { return this.with({thrustSharing:enabled}); }
  /** Diagnostic persisted thrust configuration. */
  toString(): string { return `ThrustConfig(version=${this.version}, dampeners=${this.automaticDampeners}, sharing=${this.thrustSharing})`; }
}
