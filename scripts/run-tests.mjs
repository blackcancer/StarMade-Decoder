/**
 * @fileoverview Runs Mocha through the ESM tsx loader on supported Node releases.
 * Newer Node releases can strip TypeScript through require() before the ESM
 * loader runs. Disable that competing path when the runtime provides it, so
 * all tests share one module graph and one serializable-factory registry.
 * @author InitSysRev
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const flags = process.allowedNodeEnvironmentFlags.has('--no-experimental-strip-types')
  ? ['--no-experimental-strip-types'] : [];
const mocha = fileURLToPath(new URL('../node_modules/mocha/bin/mocha.js', import.meta.url));
const child = spawnSync(process.execPath, [
  ...flags, '--import', 'tsx/esm', '--no-warnings', mocha, ...process.argv.slice(2),
], { stdio: 'inherit', env: process.env });
if (child.error) throw child.error;
if (child.signal) process.kill(process.pid, child.signal);
else process.exitCode = child.status ?? 1;
