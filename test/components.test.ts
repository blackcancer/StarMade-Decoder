/**
 * @fileoverview Phase 2 Component Tests
 *
 * Covers SectorPosition, EntityTransform, SpawnData, DockingState, HpState,
 * TextBlocks, SlotAssignment, Inventory, PowerState, ThrustConfig, and
 * ManagerContainer behavior.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { Tags } from '../src/core/TagBuilder.js';
import { TagType } from '../src/core/TagType.js';

import { SectorPosition, EntityTransform }    from '../src/objects/components/Transform.js';
import { SpawnPoint, PlayerSpawnData, SpawnMarker, SpawnController } from '../src/objects/components/SpawnData.js';
import { DockingState }     from '../src/objects/components/DockingState.js';
import { HpState }          from '../src/objects/components/HpState.js';
import { TextBlocks }       from '../src/objects/components/TextBlocks.js';
import { SlotAssignment }   from '../src/objects/components/SlotAssignment.js';
import { Inventory, ItemStack } from '../src/objects/components/Inventory.js';
import { PowerState, ThrustConfig } from '../src/objects/components/PowerAndThrust.js';
import { ManagerContainer, PullPermission } from '../src/objects/components/ManagerContainer.js';
import { posToIndex } from '../src/objects/ElementPosition.js';

registerAllFactories();
const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

// ── SectorPosition ────────────────────────────────────────────────────────────

describe('SectorPosition', () => {
  it('fromTag / toTag round-trip', () => {
    const pos = new SectorPosition(4, 5, 6);
    const tag = pos.toTag('sPos');
    const rt  = SectorPosition.fromTag(tag);
    assert.equal(rt.x, 4); assert.equal(rt.y, 5); assert.equal(rt.z, 6);
  });

  it('extracts from ENTITY_SHIP', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const tr   = root.getStruct().filter(t => t.type !== TagType.FINISH)[6];
    if (tr?.type === TagType.STRUCT) {
      const ts = tr.getStruct().filter(t => t.type !== TagType.FINISH);
      if (ts[3]?.type === TagType.VECTOR3i) {
        const pos = SectorPosition.fromTag(ts[3]);
        console.log('    Ship sector:', pos.toString());
        assert.isNumber(pos.x);
      }
    }
  });
});

// ── EntityTransform ───────────────────────────────────────────────────────────

describe('EntityTransform', () => {
  it('fromMatrix4fList / toMatrix4fList round-trip', () => {
    const t = new EntityTransform(10, 20, 30, 1,0,0, 0,1,0, 0,0,1);
    const tag = t.toMatrix4fList('transform');
    const rt  = EntityTransform.fromMatrix4fList(tag);
    assert.closeTo(rt.originX, 10, 0.01);
    assert.closeTo(rt.originY, 20, 0.01);
    assert.closeTo(rt.m00, 1, 0.01);
    console.log('    EntityTransform round-trip:', rt.toString());
  });

  it('extracts from PlayerCharacter', () => {
    const root = load('ENTITY_PLAYERCHARACTER_InitSysRev.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    const tr = s.find(t => t.name === 'transformable' && t.type === TagType.STRUCT);
    if (tr) {
      const ts = tr.getStruct().filter(t => t.type !== TagType.FINISH);
      if (ts[1]?.type === TagType.LIST) {
        const tf = EntityTransform.fromMatrix4fList(ts[1]);
        console.log('    PlayerChar transform:', tf.toString());
        assert.isNumber(tf.originX);
      }
    }
  });
});

// ── SpawnData ─────────────────────────────────────────────────────────────────

describe('SpawnPoint + PlayerSpawnData', () => {
  it('SpawnPoint fromTag / toTag round-trip', () => {
    const sp  = new SpawnPoint('ENTITY_SHIP_Test', new SectorPosition(2,3,4), 1,2,3, 0,-9.8,0);
    const tag = sp.toTag();
    const rt  = SpawnPoint.fromTag(tag);
    assert.equal(rt.entityUID, 'ENTITY_SHIP_Test');
    assert.equal(rt.sector.x, 2);
    assert.closeTo(rt.localX, 1, 0.01);
    assert.closeTo(rt.gravY, -9.8, 0.01);
    console.log('    SpawnPoint round-trip:', rt.toString());
  });

  it('SpawnMarker + SpawnController round-trip', () => {
    const marker = new SpawnMarker(12345n, 1, 2, 3);
    const ctrl   = new SpawnController([marker]);
    const tag    = ctrl.toTag();
    const rt     = SpawnController.fromTag(tag);
    assert.equal(rt.markers.length, 1);
    assert.equal(rt.markers[0].sectorX, 1);
    assert.equal(rt.markers[0].lastSpawned, 12345n);
    console.log('    SpawnController round-trip:', rt.toString());
  });

  it('PlayerSpawnData extracts from ENTITY_PLAYERSTATE', () => {
    const root = load('ENTITY_PLAYERSTATE_InitSysRev.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    // [1] = spawnData
    if (s[1]?.type === TagType.STRUCT) {
      const sd = PlayerSpawnData.fromTag(s[1]);
      console.log('    PlayerSpawnData:', sd.toString());
      assert.instanceOf(sd, PlayerSpawnData);
      assert.instanceOf(sd.deathSpawn, SpawnPoint);
    }
  });

  it('PlayerSpawnData fromTag / toTag round-trip', () => {
    const death  = new SpawnPoint('', new SectorPosition(2,2,2), -6, 251.5, 0, 0,-9.8,0);
    const logout = new SpawnPoint('', new SectorPosition(1,2,2), 1, 2, 3, 0,-9.8,0);
    const sd = new PlayerSpawnData(0, death, logout, null, 0,0,0);
    const rt = PlayerSpawnData.fromTag(sd.toTag());
    assert.equal(rt.deathSpawn.sector.x, 2);
    assert.equal(rt.logoutSpawn.sector.z, 2);
    console.log('    PlayerSpawnData round-trip: ok');
  });
});

// ── DockingState ──────────────────────────────────────────────────────────────

describe('DockingState', () => {
  it('UNDOCKED round-trip', () => {
    const d = DockingState.UNDOCKED;
    const rt = DockingState.fromTag(d.toTag());
    assert.isFalse(rt.isDocked);
    console.log('    DockingState UNDOCKED round-trip: ok');
  });

  it('DOCKED round-trip', () => {
    const d  = DockingState.UNDOCKED.dockTo('ENTITY_SHIP_Test', 10, 20, 30, 3);
    const rt = DockingState.fromTag(d.toTag());
    assert.isTrue(rt.isDocked);
    assert.equal(rt.dockedTo, 'ENTITY_SHIP_Test');
    assert.equal(rt.dockPosX, 10);
    assert.equal(rt.localOrientation, 3);
    console.log('    DockingState DOCKED round-trip:', rt.toString());
  });

  it('extracts from ENTITY_SHIP (index [3])', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (s[3]?.type === TagType.STRUCT) {
      const dc = DockingState.fromTag(s[3]);
      console.log('    Ship docking:', dc.toString());
      assert.isString(dc.dockedTo);
    }
  });
});

// ── HpState ───────────────────────────────────────────────────────────────────

describe('HpState', () => {
  it('fromTag / toTag round-trip (INT)', () => {
    const hp = new HpState(HpState.CLASS_INT, 5000n, 10000n, 0n, 0n, 0n, 0n, false);
    const rt = HpState.fromTag(hp.toTag());
    assert.equal(rt.hp, 5000n);
    assert.equal(rt.maxHp, 10000n);
    assert.equal(rt.hpPercent, 50);
    console.log('    HpState round-trip:', rt.toString());
  });

  it('extracts from ENTITY_SHIP (index [21])', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (s[21]?.type === TagType.STRUCT) {
      const hp = HpState.fromTag(s[21]);
      console.log('    Ship HP:', hp.toString());
      assert.instanceOf(hp, HpState);
    }
  });
});

// ── TextBlocks ────────────────────────────────────────────────────────────────

describe('TextBlocks', () => {
  it('set / get / delete + toTag / fromTag round-trip', () => {
    const pos1 = posToIndex(1, 2, 3);
    const pos2 = posToIndex(4, 5, 6);
    const tb1 = TextBlocks.EMPTY
      .set(pos1, 'Hello World')
      .set(pos2, 'Panneau 2');
    const rt = TextBlocks.fromTag(tb1.toTag());
    assert.equal(rt.size, 2);
    assert.equal(rt.get(pos1), 'Hello World');
    assert.equal(rt.get(pos2), 'Panneau 2');
    const tb2 = rt.delete(pos1);
    assert.equal(tb2.size, 1);
    console.log('    TextBlocks round-trip: ok (positions:', tb1.positions().map(p => JSON.stringify(p.block)).join(', ') + ')');
  });
});

// ── SlotAssignment ────────────────────────────────────────────────────────────

describe('SlotAssignment', () => {
  it('assign / unassign + toTag / fromTag round-trip', () => {
    const pos = posToIndex(10, 20, 30);
    const sa1 = SlotAssignment.EMPTY.assign(0, pos).assign(1, 99999n);
    const rt  = SlotAssignment.fromTag(sa1.toTag());
    assert.equal(rt.slots.size, 2);
    assert.equal(rt.slots.get(0), pos);
    assert.equal(rt.slots.get(1), 99999n);
    const sa2 = rt.unassign(0);
    assert.equal(sa2.slots.size, 1);
    console.log('    SlotAssignment round-trip:', rt.toString());
  });

  it('throws RangeError for an invalid slot', () => {
    assert.throws(() => SlotAssignment.EMPTY.assign(10, 0n), RangeError);
    assert.throws(() => SlotAssignment.EMPTY.assign(-1, 0n), RangeError);
  });
});

// ── Inventory ─────────────────────────────────────────────────────────────────

describe('Inventory', () => {
  it('set / remove + toTag / fromTag round-trip', () => {
    const inv1 = Inventory.EMPTY
      .set(new ItemStack(0, 1, 100))  // slot 0, type 1 (Ship Core), count 100
      .set(new ItemStack(1, 2, 50));  // slot 1, type 2 (Reactor), count 50

    const rt = Inventory.fromTag(inv1.toTag());
    assert.equal(rt.size, 2);
    assert.equal(rt.get(0)?.type, 1);
    assert.equal(rt.get(0)?.count, 100);
    assert.equal(rt.get(1)?.count, 50);
    assert.equal(rt.countOf(1), 100);
    const inv2 = rt.remove(0);
    assert.equal(inv2.size, 1);
    console.log('    Inventory round-trip:', rt.toString());
  });
});

// ── PowerState + ThrustConfig ──────────────────────────────────────────────────

describe('PowerState + ThrustConfig', () => {
  it('PowerState fromTag / toTag round-trip', () => {
    const ps = new PowerState(1234567.89, 987654.32);
    const rt = PowerState.fromTag(ps.toTag());
    assert.closeTo(rt.initialPower, 1234567.89, 1);
    assert.closeTo(rt.initialBatteryPower, 987654.32, 1);
    console.log('    PowerState round-trip:', rt.toString());
  });

  it('ThrustConfig fromTag / toTag round-trip', () => {
    const tc = new ThrustConfig(0, true, false, 0.5, 0.3, 0.2, 0.7, true, false, 0.1);
    const rt = ThrustConfig.fromTag(tc.toTag());
    assert.isTrue(rt.automaticDampeners);
    assert.isFalse(rt.automaticReactivateDampeners);
    assert.closeTo(rt.rotationBalance, 0.7, 0.001);
    assert.isTrue(rt.automaticDampenersOnExit);
    assert.isFalse(rt.thrustSharing);
    console.log('    ThrustConfig round-trip:', rt.toString());
  });

  it('ThrustConfig.withDampeners immutable', () => {
    const tc1 = ThrustConfig.DEFAULT;
    const tc2 = tc1.withDampeners(false);
    assert.isTrue(tc1.automaticDampeners);
    assert.isFalse(tc2.automaticDampeners);
  });
});

// ── ManagerContainer ───────────────────────────────────────────────────────────

describe('ManagerContainer', () => {
  it('extracts from ENTITY_SHIP (index [7])', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (s[7]?.type === TagType.STRUCT) {
      const mc = ManagerContainer.fromTag(s[7]);
      console.log('    ManagerContainer:', mc.toString());
      assert.instanceOf(mc, ManagerContainer);
    }
  });

  it('withTexts + semantic round-trip', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (!s[7] || s[7].type !== TagType.STRUCT) { console.log('    (skip)'); return; }
    const mc = ManagerContainer.fromTag(s[7]);
    const pos = posToIndex(5, 5, 5);
    const mc2 = mc.withTexts(mc.texts.set(pos, 'Test Text'));
    assert.equal(mc2.texts.get(pos), 'Test Text');
    // Round-trip
    const mc3 = ManagerContainer.fromTag(mc2.toTag());
    assert.equal(mc3.texts.get(pos), 'Test Text');
    console.log('    ManagerContainer.withTexts round-trip: ok');
  });

  it('withPullPermission + round-trip', () => {
    const root = load('ENTITY_SHIP_Traders Homerl110.ent');
    const s = root.getStruct().filter(t => t.type !== TagType.FINISH);
    if (!s[7] || s[7].type !== TagType.STRUCT) { console.log('    (skip)'); return; }
    const mc  = ManagerContainer.fromTag(s[7]);
    const mc2 = mc.withPullPermission(PullPermission.NONE);
    const mc3 = ManagerContainer.fromTag(mc2.toTag());
    assert.equal(mc3.pullPermission, PullPermission.NONE);
    console.log('    ManagerContainer.withPullPermission round-trip: ok');
  });
});
