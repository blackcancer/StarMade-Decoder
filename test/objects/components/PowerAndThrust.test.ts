/** @fileoverview Power and thrust actual current/legacy wire layouts and immutable field edits. */
import { assert } from 'chai';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { writeTo } from '../../../src/core/TagParser.js';
import { PowerState, ThrustConfig } from '../../../src/objects/components/PowerAndThrust.js';
function same(a: Tag,b: Tag): void { assert.deepEqual(writeTo(a),writeTo(b)); }
function thrust(): Tag { return Tags.struct('thrust',[Tags.byte('version',0),Tags.byte('dampeners',-1),Tags.byte('reactivate',1),Tags.vector3f('axis',.25,.5,.75),
  Tags.float('rotation',.125),Tags.byte('exit',1),Tags.byte('sharing',0),Tags.float('repulsor',.875),Tags.byteArray('extension',Buffer.from([0,255]))]); }
describe('PowerAndThrust faithful components',()=>{
  it('keeps scalar legacy power until a battery is explicitly added and supports revert',()=>{
    const tag=Tags.double('power-old',123.5), model=PowerState.fromTagOld(tag);same(model.toTag(),tag);
    assert.equal(model.withPower(124).toTag().type,TagType.DOUBLE);
    const added=model.withBattery(25);assert.equal(added.toTag().type,TagType.STRUCT);same(added.withBattery(0).toTag(),tag);
    const current=Tags.struct('power',[Tags.double('reactor',50),Tags.double('battery',60),Tags.string('extra','keep')]);
    same(PowerState.fromTag(current).withPower(55).withPower(50).toTag(),current);
    assert.equal(PowerState.fromTag(current).withBattery(9).toTag().getStruct()[2].getString(),'keep');
  });
  it('preserves thrust switches, names, unknown fields and old absent suffixes',()=>{
    const tag=thrust(), model=ThrustConfig.fromTag(tag);same(model.toTag(),tag);
    same(model.withDampeners(false).withDampeners(true).toTag(),tag);
    assert.equal(model.withThrustSharing(true).toTag().getStruct()[8].name,'extension');
    const old=Tags.struct('ship-extra',[Tags.long('timer',99n),...tag.getStruct().slice(1,5)]);
    const legacy=ThrustConfig.fromTagOld(old);same(legacy.toTag(),old);assert.equal(legacy.legacyTimer,99n);
    const updated=legacy.withThrustSharing(true).toTag();assert.equal(updated.getStruct()[5].getByte(),0);assert.equal(updated.getStruct()[6].getByte(),1);
    same(legacy.withThrustSharing(true).withThrustSharing(false).toTag(),old);
  });
  it('rejects missing required fields, future versions and fictitious VECTOR4f saved thrust',()=>{
    for(const Model of [PowerState,ThrustConfig]) assert.throws(()=>Model.fromTag(Tags.struct(null,[])));
    const tag=thrust();tag.getStruct()[0]=Tags.byte(null,1);assert.throws(()=>ThrustConfig.fromTag(tag));
    const axis=thrust();axis.getStruct()[3]=Tags.vector4f(null,0,0,0,0);assert.throws(()=>ThrustConfig.fromTag(axis));
  });
});

describe('PowerAndThrust validation, snapshots and limits',()=>{
  it('rejects wrong numeric fields and invalid constructor layouts',()=>{
    assert.throws(()=>new PowerState('1' as any,0));assert.throws(()=>new PowerState(0,'2' as any));assert.throws(()=>new PowerState(0,0,{legacy:1 as any}));
    assert.throws(()=>PowerState.fromTag(Tags.struct(null,[Tags.double(null,1),Tags.float(null,2)])));
    assert.throws(()=>PowerState.fromTagOld(Tags.string(null,'1')));
    for(const changes of [{version:1},{damp:1},{x:'1'},{y:Number.MAX_VALUE},{options:{legacy:1}},{options:{legacyTimer:1n}},{options:{legacy:true,legacyTimer:1}},{options:{legacy:true,legacyTimer:1n<<63n}},{repulsor:.5,options:{legacy:true}}]) {
      const f={version:0,damp:false,x:0,y:0,z:0,repulsor:0,options:{},...changes};assert.throws(()=>new ThrustConfig(f.version,f.damp as boolean,false,f.x as number,f.y,f.z,0,false,false,f.repulsor,f.options as any));
    }
    assert.isNaN(new ThrustConfig(0,true,true,NaN,Infinity,-Infinity,0,true,true,0).thrustBalanceX);
    assert.equal(new PowerState(Infinity,NaN).initialPower,Infinity);
    assert.include(new PowerState(10,20).toString(),'battery=20');assert.include(ThrustConfig.DEFAULT.toString(),'version=0');
  });
  it('validates every required and optional saved thrust slot without silently filling corruption',()=>{
    for(const index of [0,1,2,3,4,5,6,7]) {const tag=thrust();tag.getStruct()[index]=Tags.string(null,'bad');assert.throws(()=>ThrustConfig.fromTag(tag));}
    const incomplete=Tags.struct(null,thrust().getStruct().slice(0,6));assert.throws(()=>ThrustConfig.fromTagOld(incomplete));
    const badHeader=thrust();badHeader.getStruct()[0]=Tags.string(null,'old');assert.throws(()=>ThrustConfig.fromTagOld(badHeader));
    assert.throws(()=>ThrustConfig.fromTag(Tags.byte(null,0)));
    const noRepulsor=Tags.struct('older',thrust().getStruct().slice(0,7)), model=ThrustConfig.fromTag(noRepulsor);same(model.toTag(),noRepulsor);
    assert.equal(model.with({repulsorBalance:.5}).toTag().getStruct()[7].getFloat(),.5);same(model.with({repulsorBalance:.5}).with({repulsorBalance:0}).toTag(),noRepulsor);
    const old=Tags.struct('old',[Tags.byte('placeholder',8),...thrust().getStruct().slice(1,7),Tags.string('opaque','extra')]);
    const legacy=ThrustConfig.fromTagOld(old);same(legacy.toTag(),old);same(legacy.withDampeners(false).withDampeners(true).toTag(),old);assert.isNull(legacy.legacyTimer);
    assert.throws(()=>legacy.with({repulsorBalance:.5}));assert.isTrue(legacy.automaticDampenersOnExit);assert.isFalse(legacy.thrustSharing);
    const flags=ThrustConfig.DEFAULT.with({automaticDampeners:false,automaticReactivateDampeners:true,automaticDampenersOnExit:false,thrustSharing:true,thrustBalanceX:4,rotationBalance:8,repulsorBalance:2});
    assert.equal(flags.thrustBalanceX,4);assert.equal(flags.rotationBalance,8);assert.equal(flags.repulsorBalance,2);assert.isTrue(flags.automaticReactivateDampeners);
  });
  it('returns detached data and preserves elevated limits during immutable edits',()=>{
    for(const kind of ['power','thrust']) {
      const tag=kind==='power'?Tags.struct('power',[Tags.double('p',1),Tags.double('b',2)]):thrust();
      let deep=Tags.byteArray('leaf',Buffer.from([5]));for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);tag.getStruct().splice(tag.getStruct().length-1,0,deep);
      const parse=kind==='power'?PowerState.fromTag:ThrustConfig.fromTag;assert.throws(()=>parse(tag));
      const options={maxDepth:100,maxNodes:1000,maxInflatedBytes:20000},model=parse(tag,options),expected=writeTo(tag,options);options.maxDepth=1;
      assert.isTrue(Object.isFrozen(model));tag.getStruct().splice(0,1,Tags.byte(null,99));
      const changed=model instanceof PowerState?model.withPower(9).withPower(1):model.withDampeners(false).withDampeners(true);
      assert.deepEqual(writeTo(changed.toTag(),{maxDepth:100}),expected);const out=changed.toTag();out.getStruct().pop();assert.deepEqual(writeTo(changed.toTag(),{maxDepth:100}),expected);
    }
    for(const [parse,tag] of [[PowerState.fromTag,PowerState.EMPTY.toTag()],[ThrustConfig.fromTag,thrust()]] as const) {
      assert.throws(()=>parse(tag,{maxNodes:1}));assert.throws(()=>parse(tag,{maxInflatedBytes:8}));
    }
    const direct=new PowerState(2,0,{legacy:true});assert.equal(direct.toTag().name,null);assert.equal(direct.withPower(3).toTag().getDouble(),3);
    const current=PowerState.EMPTY.toTag();same(PowerState.fromTagOld(current).toTag(),current);
  });
});
