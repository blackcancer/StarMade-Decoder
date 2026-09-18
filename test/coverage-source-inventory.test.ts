/**
 * @fileoverview Import-safety and full-source coverage inventory regressions.
 * Every production module, including type-only modules, must be importable.
 * This keeps the all-source coverage inventory independent of the public barrel.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { assert } from 'chai';

const source = fileURLToPath(new URL('../src/', import.meta.url));
describe('Source inventory — independent module import safety', () => {
  for (const file of readdirSync(source, { recursive: true }) as string[]) {
    if (!file.endsWith('.ts')) continue;
    it(`imports ${file} without requiring a local game installation`, async () => {
      const module = await import(pathToFileURL(join(source, file)).href);
      assert.equal(Object.prototype.toString.call(module), '[object Module]');
    });
  }
});
