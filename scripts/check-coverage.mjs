/**
 * @fileoverview Exact, all-source line and branch coverage acceptance gate.
 *
 * Requires one report entry for every production TypeScript module, including
 * files never imported by a test. Compares integer counters rather than rounded
 * percentages, preventing a tiny uncovered region from rounding up to 100%.
 * Coverage-ignore directives and a narrowed c8 inventory are rejected.
 *
 * @example
 * node scripts/check-coverage.mjs
 * node scripts/check-coverage.mjs /tmp/candidate-coverage-summary.json
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const configuration = JSON.parse(readFileSync(path.join(root, '.c8rc.json'), 'utf8'));
assert.equal(configuration.all, true, 'c8 must measure all production files');
assert.deepEqual(configuration.include, ['src/**/*.ts'], 'Production coverage inventory must not be narrowed');
assert.deepEqual(configuration.exclude, [], 'Production coverage exclusions are not allowed');
const sourceRoot = path.join(root, 'src');
const expected = readdirSync(sourceRoot, { recursive: true })
  .filter(file => file.endsWith('.ts'))
  .map(file => path.resolve(sourceRoot, file)).sort();
assert.ok(expected.length > 0, 'Production source inventory is empty');
for (const file of expected) {
  assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:c8|v8|istanbul)\s+ignore\s+(?:next|start|stop|file|if|else)/i,
    `Coverage-ignore directive in ${path.relative(root, file)}`);
}
const reportPath = process.argv[2] ?? path.join(root, 'coverage/coverage-summary.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const actual = Object.keys(report).filter(file => file !== 'total').map(file => path.resolve(file)).sort();
assert.deepEqual(actual, expected, 'Coverage report must contain exactly every production source file');
for (const [file, metrics] of Object.entries(report)) {
  for (const category of ['lines', 'branches', 'statements']) {
    const metric = metrics[category];
    assert.ok(Number.isSafeInteger(metric.total) && metric.total >= 0, `${file}: invalid ${category} total`);
    assert.equal(metric.covered, metric.total, `${file}: uncovered ${category}`);
    assert.equal(metric.skipped, 0, `${file}: skipped ${category}`);
  }
}
assert.ok(report.total.functions.pct >= 70, 'Existing global function coverage floor must not regress');
console.log(JSON.stringify({ files: expected.length, lines: report.total.lines,
  branches: report.total.branches, functions: report.total.functions }, null, 2));
console.log('Exact coverage gate passed: every source file has 100% lines and branches, with zero skips.');
