import { assert } from 'chai';
import { StarSystem } from '../../src/db/StarSystemObject.js';

describe('StarSystem integrity', () => {
  it('preserves hidden VOID metadata and unknown ordinals across unrelated edits', () => {
    const infos = StarSystem.empty().infosToBytes();
    infos[1] = 123;
    infos[2] = 254;
    infos[3] = 255;
    const model = StarSystem.fromBytes(infos, null)!;
    assert.isUndefined(model.getSector(0, 0, 0));
    assert.deepEqual(model.infosToBytes(), infos);
    const edited = model.withResourceDensity(0, 25);
    assert.equal(edited.getResourceDensity(0), 25);
    assert.deepEqual(edited.infosToBytes(), infos);
  });
  it('detaches sectors and resources and validates coordinate metadata relationships', () => {
    const model = StarSystem.empty().withSectorType(1, 2, 3, 'PLANET', 2).withResourceDensity(0, 1);
    const original = model.infosToBytes();
    const info = model.getSector(1, 2, 3)!;
    info.metadata = 99;
    model.resources[0].density = 99;
    assert.deepEqual(model.infosToBytes(), original);
    assert.equal(model.getResourceDensity(0), 1);
    assert.throws(() => model.withSector({ ...info, index: 0 }));
    assert.throws(() => model.withSectorType(16, 0, 0, 'SUN'));
    assert.throws(() => model.withSectorType(0, 0, 0, 'PLANET', -1));
    assert.throws(() => model.withResourceDensity(0.5, 1));
    assert.throws(() => model.withResourceDensity(0, 256));
    assert.deepEqual(model.infosToBytes(), original);
  });
  it('preserves full-grid views, unknown types, derived planet metadata and detached JSON', () => {
    const infos = StarSystem.empty('legacy-sdk').infosToBytes(); infos[1] = 45; infos[2] = 255; infos[3] = 67;
    const model = StarSystem.fromBytes(infos, new Uint8Array(19), { includeVoid: true, profile: 'legacy-sdk' })!;
    assert.lengthOf(model.sectors, 4096);
    assert.equal(model.getSector(0, 0, 0)!.metadata, 45);
    const unknown = model.getSector(1, 0, 0)!;
    const edited = model.withSector({ ...unknown, metadata: 68 }).withoutSector(0, 0, 0);
    assert.equal(edited.getSector(0, 0, 0)!.metadata, 0);
    assert.equal(edited.getSector(1, 0, 0)!.sectorTypeOrdinal, 255);
    assert.lengthOf(edited.sectors, 4096);
    assert.equal(edited.infosToBytes()[3], 68);
    assert.equal(model.infosToBytes()[1], 45);
    const planet = model.withSectorType(15, 15, 15, 'GAS_PLANET', 255).getSector(15, 15, 15)!;
    assert.equal(planet.planetType, 'BARREN');
    const withPlanet = model.withSector(planet);
    planet.metadata = 0;
    assert.equal(withPlanet.getSector(15, 15, 15)!.metadata, 255);
    assert.lengthOf(withPlanet.gasPlanets, 1);
    const typed = StarSystem.empty().withSectorType(1, 0, 0, 'ASTEROID').withSectorType(2, 0, 0, 'SPACE_STATION');
    assert.lengthOf(typed.asteroidFields, 1); assert.lengthOf(typed.stations, 1);
    typed.asteroidFields[0].metadata = 99; typed.sectors[0].metadata = 98;
    assert.equal(typed.getSectorByIndex(1)!.metadata, 0);
    const json = model.toJSON(); json.sectors[0].metadata = 99; json.resources[0].density = 99;
    assert.equal(model.getSectorByIndex(0)!.metadata, 45);
    assert.equal(model.getResourceDensity(0), 0);
    const hidden = StarSystem.fromBytes(infos, null)!;
    assert.equal(hidden.toJSON().sectors[0].metadata, 45);
    assert.equal(JSON.parse(JSON.stringify(hidden)).sectors[0].metadata, 45);
    assert.throws(() => { (hidden as any).sectors = []; }, TypeError);
  });

  it('rejects contradictory fields and all unsigned byte/coordinate overflows at edit time', () => {
    const model = StarSystem.empty().withSectorType(1, 2, 3, 'PLANET', 2);
    const info = model.getSector(1, 2, 3)!;
    const bytes = model.infosToBytes();
    for (const patch of [{ x: -1 }, { y: 16 }, { z: 0.5 }, { x: NaN }, { index: 0 },
      { metadata: 256 }, { metadata: -1 }, { sectorTypeOrdinal: 256 }, { sectorTypeOrdinal: -1 },
      { sectorType: 'SUN' }, { planetType: 'ICE' }]) assert.throws(() => model.withSector({ ...info, ...patch } as any), RangeError);
    assert.throws(() => model.withSector({ ...info, sectorType: 'SUN', sectorTypeOrdinal: 4 }), /Planet type/);
    assert.throws(() => model.withResourceDensity(NaN, 0), RangeError);
    assert.throws(() => model.withResourceDensity(0, NaN), RangeError);
    assert.throws(() => model.withResourceDensity(-1, 0), RangeError);
    assert.throws(() => model.withoutSector(0, Infinity, 0), RangeError);
    assert.deepEqual(model.infosToBytes(), bytes);
    const valid = model.withResourceDensity(18, 255).withSectorType(15, 15, 15, 'VOID', 255);
    assert.equal(valid.getResourceDensity(18), 255);
    assert.equal(valid.infosToBytes()[8191], 255);
    assert.deepEqual(StarSystem.fromBytes(valid.infosToBytes(), valid.resourcesToBytes(19))!.infosToBytes(), valid.infosToBytes());
  });
});
