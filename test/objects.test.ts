/**
 * @fileoverview Catalog and FactionManager Object Tests
 *
 * Exercises Tag to object to modified object to Tag round-trips for catalog
 * and faction business objects.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { readFrom, writeTo } from '../src/core/TagParser.js';
import { Catalog, CatalogEntry } from '../src/objects/Catalog.js';
import { FactionManager, Faction, FactionMember, FactionRelation, RELATION_ALLY, RELATION_WAR } from '../src/objects/Factions.js';

registerAllFactories();
const S = path.resolve('samples');
const load = (f: string) => readFrom(fs.readFileSync(path.join(S, f)));

// ── Catalog ───────────────────────────────────────────────────────────────────

describe('Catalog — business object', function () {

  it('parses from CATALOG.cat', () => {
    const tag = load('CATALOG.cat');
    const catalog = Catalog.fromTag(tag);

    assert.instanceOf(catalog, Catalog);
    assert.isAbove(catalog.entries.length, 0, 'must have player entries');
    console.log('    Catalog:', catalog.toString());
    catalog.entries.forEach(e =>
      console.log('    -', JSON.stringify({
        uid: e.uid,
        owner: e.ownerUID,
        type: e.blueprintType,
        mass: e.mass.toFixed(1),
        price: e.price.toString(),
      }))
    );
  });

  it('API access : find, byOwner, byType', () => {
    const tag = load('CATALOG.cat');
    const catalog = Catalog.fromTag(tag);
    const first = catalog.entries[0];

    // find par UID
    const found = catalog.find(first.uid);
    assert.isDefined(found);
    assert.equal(found!.uid, first.uid);

    // byType
    const ships = catalog.byType('SHIP');
    console.log('    SHIP entries:', ships.length);
  });

  it('update: addEntry → round-trip', () => {
    const tag = load('CATALOG.cat');
    const catalog = Catalog.fromTag(tag);
    const original = catalog.entries.length;

    // Add an entry
    const newEntry = new CatalogEntry(
      'MY_TEST_SHIP',
      'InitSysRev',
      5000n,
      'A test ship',
      1234.5,
      'SHIP',
      BigInt(Date.now()),
      0n,
      0,
    );

    const modified = catalog.addEntry(newEntry);
    assert.equal(modified.entries.length, original + 1);

    // Round-trip Tag → readFrom → Catalog
    const newTag = modified.toTag();
    const newCatalog = Catalog.fromTag(newTag);
    assert.equal(newCatalog.entries.length, original + 1);
    const found = newCatalog.find('MY_TEST_SHIP');
    assert.isDefined(found);
    assert.equal(found!.ownerUID, 'InitSysRev');
    assert.equal(found!.price, 5000n);
    assert.closeTo(found!.mass, 1234.5, 0.1);
    console.log('    addEntry round-trip: ok');
  });

  it('update: removeEntry → round-trip', () => {
    const tag = load('CATALOG.cat');
    const catalog = Catalog.fromTag(tag);
    const original = catalog.entries.length;
    const uidToRemove = catalog.entries[0].uid;

    const modified = catalog.removeEntry(uidToRemove);
    assert.equal(modified.entries.length, original - 1);
    assert.isUndefined(modified.find(uidToRemove));

    // Round-trip
    const rt = Catalog.fromTag(modified.toTag());
    assert.equal(rt.entries.length, original - 1);
    assert.isUndefined(rt.find(uidToRemove));
    console.log('    removeEntry round-trip: ok (removed:', uidToRemove + ')');
  });

  it('update: updateEntry — change price and description', () => {
    const tag = load('CATALOG.cat');
    const catalog = Catalog.fromTag(tag);
    const entry = catalog.entries[0];

    const updated = new CatalogEntry(
      entry.uid, entry.ownerUID,
      999999n,              // new price
      'Modified description!',
      entry.mass,
      entry.blueprintType,
      entry.dateCreated, entry.timeSpawned,
      entry.classification,
    );

    const modified = catalog.updateEntry(entry.uid, updated);
    const rt = Catalog.fromTag(modified.toTag());
    const found = rt.find(entry.uid)!;
    assert.equal(found.price, 999999n);
    assert.equal(found.description, 'Modified description!');
    console.log('    updateEntry round-trip: ok (price=999999, description modified)');
  });
});

// ── FactionManager ────────────────────────────────────────────────────────────

describe('FactionManager — business object', function () {

  it('parses from FACTIONS.fac', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);

    assert.instanceOf(fm, FactionManager);
    assert.isAbove(fm.factions.size, 0);
    console.log('    FactionManager:', fm.toString());
    fm.all.forEach(f => console.log('    -', `Faction(id=${f.id}, members=${f.memberCount}, npc=${f.isNPC})`));
  });

  it('API access : get, playerFactions, npcFactions, getRelation', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);

    console.log('    playerFactions:', fm.playerFactions.length);
    console.log('    npcFactions:', fm.npcFactions.length);
    console.log('    relations:', fm.relations.length);

    fm.relations.forEach(r =>
      console.log('    relation:', r.factionA, '↔', r.factionB, '=', r.relationName)
    );
  });

  it('Faction properties', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);
    const faction = fm.all[0];
    assert.isDefined(faction);
    assert.isString(faction.name);
    assert.isNumber(faction.id);
    assert.isArray(faction.members);
    assert.typeOf(faction.dateCreated, 'bigint');
    console.log('    Faction[0]:', JSON.stringify({
      id: faction.id,
      members: faction.memberCount,
      openToJoin: faction.openToJoin,
      homebaseUID: faction.homebaseUID,
      factionPoints: faction.factionPoints,
      isNPC: faction.isNPC,
    }));
  });

  it('update: setFaction (change name) → round-trip', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);
    const faction = fm.playerFactions[0] ?? fm.all[0];
    assert.isDefined(faction);

    const originalName = faction.name;
    const modified = new Faction(
      faction.id, 'NEW TEST NAME', faction.description,
      faction.dateCreated, faction.members, faction.openToJoin,
      faction.homebaseUID, faction.password, faction.allyNeutral,
      faction.attackNeutral, faction.factionPoints, faction.factionMode,
      faction.showInHub, faction.isNPC,
    );

    const fm2 = fm.setFaction(modified);
    const factionTag = fm2.toTag();
    const fm3 = FactionManager.fromTag(factionTag);

    const found = fm3.get(faction.id);
    assert.isDefined(found);
    assert.equal(found!.name, 'NEW TEST NAME');
    console.log('    setFaction: "' + originalName + '" → "NEW TEST NAME" → ok');
  });

  it('update: removeFaction → round-trip', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);
    const original = fm.factions.size;
    const toRemove = fm.all[0].id;

    const fm2 = fm.removeFaction(toRemove);
    assert.equal(fm2.factions.size, original - 1);
    assert.isUndefined(fm2.get(toRemove));

    const fm3 = FactionManager.fromTag(fm2.toTag());
    assert.equal(fm3.factions.size, original - 1);
    console.log('    removeFaction id=' + toRemove + ' → ok');
  });

  it('update: setRelation → round-trip', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);
    const ids = fm.all.map(f => f.id);
    if (ids.length < 2) { console.log('    (not enough factions — skip)'); return; }

    const [a, b] = ids;
    const fm2 = fm.setRelation(a, b, RELATION_ALLY);
    const fm3 = FactionManager.fromTag(fm2.toTag());

    const rel = fm3.getRelation(a, b);
    assert.isDefined(rel);
    assert.equal(rel!.relation, RELATION_ALLY);
    assert.isTrue(rel!.isAlly);
    console.log('    setRelation ' + a + '↔' + b + '=ALLY → ok');

    // Changer en guerre
    const fm4 = fm3.setRelation(a, b, RELATION_WAR);
    const fm5 = FactionManager.fromTag(fm4.toTag());
    assert.equal(fm5.getRelation(a, b)!.relation, RELATION_WAR);
    console.log('    setRelation ' + a + '↔' + b + '=WAR → ok');
  });

  it('addMember + round-trip', () => {
    const tag = load('FACTIONS.fac');
    const fm = FactionManager.fromTag(tag);
    const faction = fm.all[0];

    const newMember = new FactionMember('NewPlayer', 0);
    const updatedFaction = new Faction(
      faction.id, faction.name, faction.description,
      faction.dateCreated,
      [...faction.members, newMember],
      faction.openToJoin, faction.homebaseUID, faction.password,
      faction.allyNeutral, faction.attackNeutral, faction.factionPoints,
      faction.factionMode, faction.showInHub, faction.isNPC,
    );

    const fm2 = fm.setFaction(updatedFaction);
    const fm3 = FactionManager.fromTag(fm2.toTag());
    const found = fm3.get(faction.id)!;
    const hasNewMember = found.members.some(m => m.playerUID === 'NewPlayer');
    assert.isTrue(hasNewMember, 'NewPlayer must be a member');
    console.log('    addMember "NewPlayer" → ok (total:', found.memberCount + ')');
  });
});
