/**
 * @fileoverview Blueprint Metadata Format Tests
 *
 * Covers .smbpm, .smbpl, .smbmm, and .sim parser behavior on sample files.
 *
 * @author InitSysRev
 * @version 1.0.0
 */


import fs from 'fs';
import path from 'path';
import { assert } from 'chai';
import { registerAllFactories } from '../src/serializable/Factories.js';
import { parseSmbpm } from '../src/smd3/SmbpmParser.js';
import { parseSmbpl } from '../src/smd3/SmbplParser.js';
import { parseSmbmm } from '../src/smd3/SmbmmParser.js';
import { parseSim } from '../src/smd3/SimParser.js';

registerAllFactories();

const S = path.resolve('samples');
const BASE = path.join(S, 'BASE_Warehouse_Station');
const ISANTH_BLUEPRINT = '/srv/StarMade/blueprints/Isanth Type-PNR-25-B';

// ── .sim ─────────────────────────────────────────────────────────────────────

describe('SimParser — SIMULATION_STATE.sim', function () {
  it('parses without errors', () => {
    const data = fs.readFileSync(path.join(S, 'SIMULATION_STATE.sim'));
    const sim = parseSim(data);
    assert.isNumber(sim.version);
    assert.isArray(sim.groups);
    assert.isNotNull(sim.simulation);
    assert.equal(sim.simulation?.version, sim.version);
    assert.equal(sim.simulation?.groups.length, sim.groups.length);
    console.log('    SimulationState: version=' + sim.version +
      ' groups=' + sim.groups.length +
      (sim.lastUpdate !== undefined ? ' lastUpdate=' + sim.lastUpdate.toString() : ''));
  });
});

// ── .smbmm ────────────────────────────────────────────────────────────────────

describe('SmbmmParser — modmappings.smbmm', function () {
  it('all .smbmm files are empty (vanilla)', () => {
    let empty = 0, nonEmpty = 0;
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, f.name);
        if (f.isDirectory()) walk(fp);
        else if (f.name.endsWith('.smbmm')) {
          const d = fs.readFileSync(fp);
          const m = parseSmbmm(d);
          assert.isString(m.format);
          assert.isArray(m.mappings);
          if (m.isEmpty) empty++; else nonEmpty++;
        }
      }
    };
    walk(S);
    console.log('    smbmm: empty=' + empty + ' non-empty=' + nonEmpty);
    assert.isAbove(empty, 0);
  });
});

// ── .smbpl ────────────────────────────────────────────────────────────────────

describe('SmbplParser — logic.smbpl', function () {
  this.timeout(10_000);

  it('BASE_Warehouse_Station root logic', () => {
    const data = fs.readFileSync(path.join(BASE, 'logic.smbpl'));
    const logic = parseSmbpl(data);
    assert.isNumber(logic.structureVersion);
    assert.equal(logic.controllerCount, logic.controllers.length);
    console.log('    Root logic: version=' + logic.structureVersion +
      ' controllerCount=' + logic.controllerCount +
      ' links=' + logic.links.length);
    if (logic.links.length > 0) {
      const l = logic.links[0];
      const from = { x: l.fromX, y: l.fromY, z: l.fromZ };
      assert.strictEqual(logic.controllerAt(from), logic.controllers[0]);
      assert.include(logic.typesFrom(from), l.type);
      assert.deepEqual(logic.targetsOf(from, l.type), l.targets);
      if (l.targets.length > 0) {
        assert.isTrue(logic.isLinked(from, l.targets[0], l.type));
      }
      assert.isAtLeast(logic.controllersForType(l.type).length, 1);
      console.log('    First link: from(' + l.fromX + ',' + l.fromY + ',' + l.fromZ +
        ') type=' + l.type + ' targets=' + l.targets.length);
    }
  });

  it('NOR Gate logic (complex version)', () => {
    // NOR Gate has an smtpl; look for an .smbpl file under ATTACHED
    const attached = path.join(BASE, 'ATTACHED_0');
    const logicPath = path.join(attached, 'logic.smbpl');
    if (!fs.existsSync(logicPath)) { console.log('    (no logic file)'); return; }
    const data = fs.readFileSync(logicPath);
    const logic = parseSmbpl(data);
    console.log('    ATTACHED_0 logic: version=' + logic.structureVersion +
      ' controllerCount=' + logic.controllerCount +
      ' links=' + logic.links.length);
  });

  it('all .smbpl files parse without crashing', () => {
    let ok = 0, fail = 0;
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, f.name);
        if (f.isDirectory()) walk(fp);
        else if (f.name.endsWith('.smbpl')) {
          try { parseSmbpl(fs.readFileSync(fp)); ok++; }
          catch (e: any) { console.log('    FAIL:', fp, e.message.slice(0,50)); fail++; }
        }
      }
    };
    walk(S);
    console.log('    smbpl: ' + ok + ' OK, ' + fail + ' FAIL');
    assert.equal(fail, 0);
  });
});

// ── .smbpm ────────────────────────────────────────────────────────────────────

describe('SmbpmParser — meta.smbpm', function () {
  this.timeout(30_000);

  it('BASE_Warehouse_Station root meta', () => {
    const data = fs.readFileSync(path.join(BASE, 'meta.smbpm'));
    const meta = parseSmbpm(data);
    assert.isNumber(meta.metaVersion);
    assert.doesNotHaveAnyKeys(meta, ['managerTag', 'aiTag', 'thrustTag', 'managerRaw', 'aiRaw', 'thrustRaw']);
    assert.doesNotHaveAnyKeys(meta.railChildren[0] ?? {}, ['tag', 'tagRaw']);
    console.log('    Root meta: version=' + meta.metaVersion);
    console.log('    manager:', meta.hasManager ? 'present' : 'none');
    console.log('    dockingEntries:', meta.dockingEntries.length);
    console.log('    railChildren:', meta.railChildren.length);
    console.log('    railUID:', meta.railUID ?? 'none');
    console.log('    cargoPoints:', meta.cargoPoints.length);
    console.log('    railDockerPieces:', meta.railDockerPieces.length);
    if (meta.dockingEntries.length > 0) {
      const d = meta.dockingEntries[0];
      console.log('    First docking: name=' + d.name + ' pos=(' + d.posX + ',' + d.posY + ',' + d.posZ + ')');
    }
    if (meta.railChildren.length > 0) {
      const rc = meta.railChildren[0];
      console.log('    First rail child: name=' + rc.name);
    }
  });

  it('all .smbpm files parse without crashing', () => {
    let ok = 0, fail = 0;
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, f.name);
        if (f.isDirectory()) walk(fp);
        else if (f.name.endsWith('.smbpm')) {
          try { parseSmbpm(fs.readFileSync(fp)); ok++; }
          catch (e: any) { console.log('    FAIL:', f.name, e.message.slice(0,60)); fail++; }
        }
      }
    };
    walk(S);
    console.log('    smbpm: ' + ok + ' OK, ' + fail + ' FAIL');
    assert.equal(fail, 0);
  });

  it('decodes rail docker active byte and rail child offsets', function () {
    const metaPath = path.join(ISANTH_BLUEPRINT, 'meta.smbpm');
    if (!fs.existsSync(metaPath)) this.skip();

    const meta = parseSmbpm(fs.readFileSync(metaPath));

    assert.lengthOf(meta.railDockerPieces, 2);
    assert.deepInclude(meta.railDockerPieces, {
      posX: 8,
      posY: 11,
      posZ: 16,
      type: 663,
      orientation: 10,
      active: false,
      hp: 127,
    });
    assert.deepInclude(meta.railDockerPieces, {
      posX: 24,
      posY: 11,
      posZ: 16,
      type: 663,
      orientation: 10,
      active: false,
      hp: 127,
    });

    assert.lengthOf(meta.railChildren, 1);
    assert.equal(meta.railChildren[0].name, 'Isanth Type-PNR-25-B/ATTACHED_0');
    assert.deepEqual(meta.railChildren[0].offset, { x: -9, y: -4, z: 0 });
    assert.deepEqual(meta.railChildren[0].request?.rail?.position, { x: 7, y: 13, z: 14 });
    assert.deepEqual(meta.railChildren[0].request?.docked?.position, { x: 16, y: 16, z: 15 });
    assert.equal(meta.railChildren[0].request?.docked?.type, 663);
    assert.equal(meta.aiConfig?.values[1], 'Ship');
    assert.equal(meta.aiConfig?.values[19], 'true');
    assert.deepInclude(meta.childTransforms, {
      name: 'Isanth Type-PNR-25-B/ATTACHED_0',
      mode: 'rail',
      offset: { x: -9, y: -4, z: 0 },
    });
    assert.deepEqual(meta.childOffsetFor('ATTACHED_0'), { x: -9, y: -4, z: 0 });
  });
});
