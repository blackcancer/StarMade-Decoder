/** @fileoverview Require test suite directories to mirror the production source tree. */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const suites = readdirSync(join(root, 'test'), { recursive: true }).filter(name => name.endsWith('.test.ts'));
if (suites.length === 0) throw new Error('No test suites found');
for (const suite of suites) {
  const directory = join(root, 'src', dirname(suite));
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Test directory must mirror src: test/${suite}`);
  }
}
console.log(`Test layout passed: ${suites.length} suites mirror src directories.`);
