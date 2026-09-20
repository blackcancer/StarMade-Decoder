/** @fileoverview Health component wire widths, retained fields and detached payloads. */
import { assert } from 'chai';
import { SerializableTagRegister } from '../../../src/serializable/SerializableTagRegister.js';
import { Tags } from '../../../src/core/TagBuilder.js';
import { Tag } from '../../../src/core/Tag.js';
import { TagType } from '../../../src/core/TagType.js';
import { writeTo } from '../../../src/core/TagParser.js';
import { RawElement, registerAllFactories } from '../../../src/serializable/Factories.js';
import { HpState } from '../../../src/objects/components/HpState.js';
registerAllFactories();
function record(long = false, recover = true): Tag {
  const hp = long ? Tags.long : Tags.int;
  return Tags.struct('health', [Tags.byte('controller', 1), Tags.struct('values', [
    hp('hp', long ? 50n : 50), hp('max', long ? 100n : 100), Tags.long('armor', 12n), Tags.long('armor-max', 15n),
    Tags.long('start', 0n), Tags.long('time', 25n), new Tag(TagType.SERIALIZABLE, 'map', new RawElement(1, Buffer.from([0,0,0,1,0,5,0,0,0,3]))),
    ...(recover ? [Tags.byte('recover', -1), Tags.string('future', 'preserve')] : []),
  ]), Tags.byteArray('extension', Buffer.from([0,255]))]);
}
function same(a: Tag,b: Tag): void { assert.deepEqual(writeTo(a),writeTo(b)); }
describe('HpState faithful component', () => {
  it('preserves actual class 1 with independent integer widths, unknowns and edit reverts', () => {
    for(const long of [false,true]) for(const recover of [false,true]) {
      const tag=record(long,recover), model=HpState.fromTag(tag); same(model.toTag(),tag);
      assert.equal(model.classId,1); assert.equal(model.hpType,long?TagType.LONG:TagType.INT);
      assert.equal(model.armorType,TagType.LONG); assert.equal(model.rebootRecover,recover);
      same(model.withHp(40n).withHp(50n).toTag(),tag);
      const changed=model.withMaxHp(101n).toTag(); assert.equal(changed.getStruct()[1].getStruct()[1].value,long?101n:101);
      assert.equal(changed.getStruct()[1].getStruct()[2].name,'armor');
      assert.equal(changed.getStruct()[2].name,'extension');
    }
  });
  it('isolates the serializable payload at construction, access and serialization', () => {
    const raw=new RawElement(1,Buffer.from([0,0,0,0])); const model=new HpState(0,1n,2n,0n,0n,0n,0n,false,raw);
    raw.raw[3]=9; (model.currentHPMatch as RawElement).raw[3]=8;
    (model.toTag().getStruct()[1].getStruct()[6].getSerializable() as RawElement).raw[3]=7;
    assert.equal((model.currentHPMatch as RawElement).raw[3],0);
    assert.equal(model.toTag().getStruct()[0].getByte(),1);
  });
  it('rejects malformed required types and unsupported controllers', () => {
    assert.throws(()=>HpState.fromTag(Tags.struct(null,[])));
    const tag=record(); tag.getStruct()[0]=Tags.byte(null,9); assert.throws(()=>HpState.fromTag(tag));
    const mixed=record(); mixed.getStruct()[1].getStruct()[1]=Tags.long(null,100n); assert.throws(()=>HpState.fromTag(mixed));
  });
});

describe('HpState validation and limits',()=>{
  it('checks signed widths, controller options, reboot fields and count-map identity',()=>{
    const make=(changes:Record<string,unknown>={})=>{const f={width:0,hp:1n,max:2n,armor:0n,armorMax:0n,start:0n,time:0n,recover:false,map:new RawElement(1,Buffer.alloc(4)),options:{},...changes};return new HpState(f.width as number,f.hp as bigint,f.max as bigint,f.armor as bigint,f.armorMax as bigint,f.start as bigint,f.time as bigint,f.recover as boolean,f.map as RawElement,f.options);};
    for(const fields of [{width:2},{options:{hpType:TagType.FLOAT}},{options:{armorType:TagType.STRING}},{hp:2n**31n},{hp:-(2n**31n)-1n},{hp:1},{width:1,max:2n**63n},{width:1,max:-(2n**63n)-1n},{start:2n**63n},{time:'1'},{recover:1},{map:new RawElement(3,Buffer.alloc(4))},{map:new RawElement(1,Buffer.from([0,0,0,1]))}]) assert.throws(()=>make(fields));
    assert.equal(make({hp:-(2n**31n)}).hp,-(2n**31n));assert.equal(make({width:1,hp:-(2n**63n),max:2n**63n-1n}).hp,-(2n**63n));
    for(const index of [0,2,3,4,5,6,7]) {const tag=record();tag.getStruct()[1].getStruct()[index]=Tags.string(null,'wrong');assert.throws(()=>HpState.fromTag(tag));}
    assert.throws(()=>HpState.fromTag(Tags.byte(null,1)));
    const top=record();top.getStruct()[1]=Tags.int(null,1);assert.throws(()=>HpState.fromTag(top));
    const wrongMap=record();wrongMap.getStruct()[1].getStruct()[6]=new Tag(TagType.SERIALIZABLE,null,new RawElement(3,Buffer.alloc(4)));assert.throws(()=>HpState.fromTag(wrongMap));
    assert.throws(()=>make({map:new RawElement(1,Buffer.from([0,0,0,1,0,1,0,0,0,2])),options:{maxListLength:0}}));
  });
  it('edits every health field without mutable aliases or implicit clamping',()=>{
    const tag=record(false,false), before=writeTo(tag),model=HpState.fromTag(tag);
    tag.getStruct()[2].getByteArray()[0]=4;model.toTag().getStruct()[2].getByteArray()[0]=5;
    assert.deepEqual(writeTo(model.toTag()),before);assert.isTrue(Object.isFrozen(model));
    const edited=model.with({hp:-5n,maxHp:0n,armorHp:16n,maxArmorHp:12n,rebootStarted:100n,rebootTime:200n,rebootRecover:true,currentHPMatch:new RawElement(1,Buffer.alloc(4))});
    assert.equal(edited.hp,-5n);assert.equal(edited.armorHp,16n);assert.equal(edited.hpPercent,100);assert.isFalse(edited.isAlive);assert.isTrue(edited.isRebooting);
    assert.isTrue(HpState.fromTag(edited.toTag()).rebootRecover);assert.equal(model.hpPercent,50);assert.isTrue(model.isAlive);assert.isFalse(model.isRebooting);
    assert.include(edited.toString(),'rebooting=true');assert.include(HpState.EMPTY.toString(),'0/0');
    const longArmor=record();longArmor.getStruct()[1].getStruct()[2]=Tags.int('armor',12);longArmor.getStruct()[1].getStruct()[3]=Tags.int('armor-max',15);same(HpState.fromTag(longArmor).toTag(),longArmor);
  });
  it('applies caller limits to initial snapshots and retains elevated limits through edits',()=>{
    let deep=Tags.string('last','kept');for(let i=0;i<80;i++)deep=Tags.struct(null,[deep]);
    const tag=record();tag.getStruct().splice(2,0,deep);assert.throws(()=>HpState.fromTag(tag));
    const opts={maxDepth:100,maxNodes:500,maxInflatedBytes:20000};const model=HpState.fromTag(tag,opts);opts.maxDepth=1;
    assert.deepEqual(writeTo(model.withHp(1n).withHp(50n).toTag(),{maxDepth:100}),writeTo(tag,{maxDepth:100}));
    assert.throws(()=>HpState.fromTag(record(),{maxNodes:4}));assert.throws(()=>HpState.fromTag(record(),{maxInflatedBytes:10}));
  });
});

// Fresh construction/writing is valid before users register factories for parsing.
describe('HpState import and fresh writes',()=>{
  it('does not require parser-factory registration to construct or write a new state',()=>{
    const saved = [...SerializableTagRegister.register]; SerializableTagRegister.register.fill(null);
    try {
      const tag = HpState.EMPTY.withHp(12n).toTag();
      assert.equal(tag.getStruct()[0].getByte(),1); assert.equal(tag.getStruct()[1].getStruct()[0].getInt(),12);
    } finally { SerializableTagRegister.register.splice(0,SerializableTagRegister.register.length,...saved); }
  });
});
