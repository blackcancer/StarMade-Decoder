/**
 * @fileoverview Negative tests for the exact coverage acceptance gate.
 * A rounded percentage, a missing module, or a skipped counter must fail even
 * when the remaining summary claims 100%. Run after generating real coverage.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const summary = JSON.parse(readFileSync(join(root, 'coverage/coverage-summary.json'), 'utf8'));
const source = Object.keys(summary).find(key => key !== 'total' && summary[key].branches.total > 0);
assert.ok(source, 'A measured production module is required');
const temp = mkdtempSync(join(tmpdir(), 'decoder-coverage-gate-'));
try {
  for (const scenario of ['missing-module', 'rounded-branch', 'rounded-line', 'skipped-line']) {
    const report = structuredClone(summary);
    if (scenario === 'missing-module') delete report[source];
    if (scenario === 'rounded-branch') report[source].branches.covered--;
    if (scenario === 'rounded-line') report[source].lines.covered--;
    if (scenario === 'skipped-line') report[source].lines.skipped = 1;
    const file = join(temp, `${scenario}.json`);
    writeFileSync(file, JSON.stringify(report));
    const run = spawnSync(process.execPath, ['scripts/check-coverage.mjs', file], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 1, `Invalid coverage report was accepted: ${scenario}\n${run.stderr}`);
    console.log(`Rejected invalid coverage report: ${scenario}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
