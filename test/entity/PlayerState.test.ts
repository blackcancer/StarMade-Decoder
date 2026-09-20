/** @fileoverview Legacy player-state DTOs share the validated schema and retain exact longs without mutable aliases. */
import { strict as assert } from 'node:assert';
import { Tags } from '../../src/core/TagBuilder.js';
import { Tag } from '../../src/core/Tag.js';
import { writeTo } from '../../src/core/TagParser.js';
import { parsePlayerState } from '../../src/entity/PlayerState.js';
import { PlayerState } from '../../src/objects/PlayerState.js';
function record():Tag{return Tags.struct('PlayerState',[Tags.long('credits',9007199254740993n),Tags.struct(null,[]),Tags.struct(null,[]),
  Tags.vector3i('sector',1,-2,3),Tags.vector3f('lspawn',.25,.5,.75),Tags.vector3i('lsector',4,5,-6),
  Tags.struct('pFac-v0',[Tags.int('id',7),Tags.int('suspended',2),Tags.string('extension','keep')]),
  Tags.long('login',9007199254740995n),Tags.long('logout',9007199254740997n),Tags.struct('history',[]),Tags.byte('creative',-1),Tags.string('entered','ship')]);}
describe('parsePlayerState validated DTO',()=>{
  it('projects exact INT/LONG credits, timestamps and suspension using the shared class',()=>{
    const root=record(),model=PlayerState.fromTag(root),dto=parsePlayerState(root);
    assert.equal(dto.credits,9007199254740993n);assert.equal(dto.lastLogin,9007199254740995n);assert.equal(dto.lastLogout,9007199254740997n);
    assert.equal(dto.credits,model.credits);assert.equal(dto.factionId,7);assert.equal(dto.factionSuspended,2);assert.equal(dto.factionRank,dto.factionSuspended);
    assert.equal(dto.hasCreativeMode,true);assert.equal(dto.lastEnteredEntity,'ship');assert.equal(dto.currentSector?.y,-2);assert.equal(dto.logoutSector?.z,-6);assert.equal(dto.logoutLocalPos?.z,.75);
    const minimal=parsePlayerState(Tags.struct(null,[Tags.int(null,-123)]));assert.equal(minimal.credits,-123n);assert.equal(minimal.factionSuspended,0);
    assert.equal(minimal.currentSector,undefined);assert.equal(minimal.logoutSector,undefined);assert.equal(minimal.logoutLocalPos,undefined);
    assert.equal(minimal.hasCreativeMode,false);assert.equal(minimal.lastLogin,0n);
    const legacy=record();legacy.getStruct()[6]=Tags.rename(legacy.getStruct()[6],'pFac');assert.equal(parsePlayerState(legacy).factionSuspended,2);
  });
  it('returns mutable DTO coordinates detached from source Tags and other projections',()=>{
    const root=record(),bytes=writeTo(root),a=parsePlayerState(root),b=parsePlayerState(root);
    a.currentSector!.x=99;a.logoutSector!.y=88;a.logoutLocalPos!.z=77;
    assert.deepEqual(writeTo(root),bytes);assert.equal(b.currentSector!.x,1);assert.equal(b.logoutSector!.y,5);assert.equal(b.logoutLocalPos!.z,.75);
    root.getStruct()[3].getVector3i().z=55;assert.equal(b.currentSector!.z,3);
  });
  it('rejects invalid shared schemas and honors configurable opaque-tree limits without charging twice',()=>{
    for(const root of [Tags.byte(null,0),Tags.struct(null,[]),Tags.struct(null,[Tags.string(null,'credit')])])assert.throws(()=>parsePlayerState(root));
    const invalid=record();invalid.getStruct()[7]=Tags.int(null,5);assert.throws(()=>parsePlayerState(invalid));
    const invalidFaction=record();invalidFaction.getStruct()[6]=Tags.struct('pFac',[Tags.int(null,1)]);assert.throws(()=>parsePlayerState(invalidFaction));
    const deep=record();let extra=Tags.string('payload','opaque');for(let i=0;i<80;i++)extra=Tags.struct(null,[extra]);deep.getStruct().splice(-1,0,extra);
    assert.throws(()=>parsePlayerState(deep),{code:'E_LIMIT'});const sharedNodeBudget={remainingNodes:0},sharedInflationBudget={remainingBytes:0};
    assert.equal(parsePlayerState(deep,{maxDepth:100,sharedNodeBudget,sharedInflationBudget}).credits,9007199254740993n);
    assert.equal(sharedNodeBudget.remainingNodes,0);assert.equal(sharedInflationBudget.remainingBytes,0);
    assert.throws(()=>parsePlayerState(record(),{maxNodes:3}),{code:'E_LIMIT'});assert.throws(()=>parsePlayerState(record(),{maxInflatedBytes:5}),{code:'E_LIMIT'});
  });
});
