/**
 * @fileoverview
 * Explicit ESM entry point for all TypeScript Mocha test suites.
 *
 * Mocha 12 may require .ts files before importing them. Native TypeScript
 * stripping and CommonJS transpilation can then bypass the registered ESM
 * loader or instantiate a second copy of SDK classes and factory registries.
 * Mocha always imports .mjs entries; this module imports every .test.ts file
 * through that same ESM graph. The normal CLI grep, reporter and timeout
 * options remain available. A failed import fails the run instead of being
 * treated as a successful empty suite.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(directory, { recursive: true })
  .filter(name => name.endsWith('.test.ts') && statSync(join(directory, name)).isFile())
  .sort();

if (files.length === 0) throw new Error('No TypeScript test suites were found');
for (const file of files) await import(pathToFileURL(join(directory, file)).href);
