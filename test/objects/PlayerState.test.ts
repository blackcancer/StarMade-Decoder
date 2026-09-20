/** @fileoverview Lossless positional player-state edits and bounded snapshots. */
import { assert } from 'chai';
import { gzipSync } from 'node:zlib';
import { PlayerState } from '../../src/objects/PlayerState.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo } from '../../src/core/TagParser.js';
import { Tag } from '../../src/core/Tag.js';

/** Stored optional slots and a faction extension with noncanonical scalar names. */
function root():Tag{return Tags.struct('PlayerState',[Tags.int(null,12),Tags.byte(null,0),Tags.byte(null,0),
  Tags.vector3i('sector',1,2,3),Tags.vector3f('lspawn',4,5,6),Tags.vector3i('lsector',7,8,9),
  Tags.struct('pFac-v0',[Tags.int('faction',2),Tags.int('rank',3),Tags.string('extension','future')]),
  Tags.long('login',9007199254740993n),Tags.long('logout',4n),Tags.struct('hist',[]),Tags.byte('creative',0),Tags.string('entered','entity')]);}

describe('PlayerState V2 contracts',()=>{
  it('updates actual positions, retains faction extras and file metadata and supports edit/revert',()=>{
    const tag=root(),bytes=gzipSync(Buffer.concat([writeTo(tag).subarray(2),Buffer.from([11])])),model=PlayerState.fromBuffer(bytes);
    tag.getStruct()[0]=Tags.long(null,100n);assert.equal(model.credits,12n);assert.equal(model.currentSector!.x,1);
    assert.equal(model.logoutSector!.z,9);assert.equal(model.logoutLocalPos!.y,5);
    assert.deepEqual(model.toBuffer(),bytes);assert.equal(model.withCredits(999n).credits,999n);
    assert.equal(model.withCredits(999n).toTag().getStruct()[0].name,null);
    const edited=model.withCreativeMode(true).withFaction(9,10),faction=edited.toTag().getStruct()[6];
    assert.equal(faction.getStruct()[0].name,'faction');assert.equal(faction.getStruct()[2].getString(),'future');
    assert.equal(edited.factionId,9);assert.equal(edited.factionRank,10);assert.isTrue(edited.hasCreativeMode);
    assert.equal(edited.toTag().getStruct()[10].name,'creative');
    assert.deepEqual(edited.withCreativeMode(false).withFaction(2,3).toBuffer(),bytes);
    model.toTag().getStruct()[0]=Tags.long(null,44n);assert.equal(model.credits,12n);
    assert.equal(JSON.parse(JSON.stringify(model)).lastLogin,'9007199254740993');assert.include(model.toString(),'credits=12');
    const canonical=PlayerState.fromTag(root());assert.deepEqual(canonical.toBuffer(),writeTo(root()));
    const long=canonical.withCredits(2n**60n);assert.equal(PlayerState.fromTag(long.toTag()).credits,2n**60n);
  });
  it('validates inputs, immutable coordinates, absent edits and explicit limits',()=>{
    const minimal=PlayerState.fromTag(Tags.struct(null,[Tags.long(null,0n)]));assert.equal(minimal.lastLogin,0n);
    assert.equal(minimal.lastLogout,0n);assert.equal(minimal.factionId,0);assert.isNull(minimal.currentSector);assert.equal(minimal.lastEnteredEntity,'');
    assert.throws(()=>minimal.withCreativeMode(true));assert.throws(()=>minimal.withFaction(1));assert.throws(()=>minimal.withCredits(2n**63n));
    assert.throws(()=>minimal.withCreativeMode(1 as any));assert.throws(()=>PlayerState.fromTag(Tags.struct(null,[])));
    assert.throws(()=>PlayerState.fromTag(root(),{maxNodes:2}));assert.throws(()=>PlayerState.fromBuffer(writeTo(root()),{maxInputBytes:1}));
    const wrong=root();wrong.getStruct()[7]=Tags.string(null,'time');assert.throws(()=>PlayerState.fromTag(wrong));
    assert.throws(()=>{(PlayerState.fromTag(root()).logoutSector as any).x=99;});
    const legacy=root();legacy.getStruct()[6]=Tags.rename(legacy.getStruct()[6],'pFac');assert.equal(PlayerState.fromTag(legacy).withFaction(4).factionId,4);
  });
});
