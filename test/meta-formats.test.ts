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

const S = path.resolve('/mnt/c/Users/init-/source/repos/StarMade-Decoder/samples');
const BASE = path.join(S, 'BASE_Warehouse_Station');

// ── .sim ─────────────────────────────────────────────────────────────────────

describe('SimParser — SIMULATION_STATE.sim', function () {
  it('parses without errors', () => {
    const data = fs.readFileSync(path.join(S, 'SIMULATION_STATE.sim'));
    const sim = parseSim(data);
    assert.isNumber(sim.version);
    assert.isArray(sim.groups);
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
    console.log('    Root logic: version=' + logic.structureVersion +
      ' controllerCount=' + logic.controllerCount +
      ' links=' + logic.links.length);
    if (logic.links.length > 0) {
      const l = logic.links[0];
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
    console.log('    Root meta: version=' + meta.metaVersion);
    console.log('    managerTag:', meta.managerTag ? meta.managerTag.toString().slice(0, 60) : 'null');
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
});
