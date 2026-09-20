/** @fileoverview Audit A07/A10: resource regressions run with process memory/time ceilings. */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('Audit resource isolation', () => {
  it('rejects hostile lengths, nesting and inflation without hanging or exhausting the parent', function () {
    this.timeout(15000);
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx/esm', '--input-type=module', '-e', `
      import { strict as assert } from 'node:assert';
      import { gzipSync } from 'node:zlib';
      import { BufferReader, BufferWriter, readFrom, decodeFleetCommand, decodeTradeNodeItems } from './src/index.ts';
      const writer = new BufferWriter(0); writer.writeUInt8(42);
      assert.equal(writer.toBuffer()[0], 42);
      const reader = BufferReader.from(Buffer.alloc(8)); reader.readInt32BE();
      assert.throws(() => reader.readBytes(-2)); assert.equal(reader.offset, 4);
      const nested = Buffer.concat([Buffer.alloc(2), Buffer.alloc(10000, 243), Buffer.from([0])]);
      assert.throws(() => readFrom(nested, {maxDepth: 16}), error => error.code === 'E_LIMIT');
      const gzip = gzipSync(Buffer.alloc(4 * 1024 * 1024));
      assert.throws(() => readFrom(gzip, {maxInflatedBytes: 128}), error => error.code === 'E_LIMIT');
      const command = Buffer.concat([Buffer.alloc(12), Buffer.from(Array(10000).fill([1, 9]).flat()), Buffer.from([0])]);
      assert.throws(() => decodeFleetCommand(command), error => error.code === 'E_LIMIT');
      const trade = Buffer.alloc(8); trade.writeInt32BE(0x7fffffff);
      assert.throws(() => decodeTradeNodeItems(trade), error => error.code === 'E_LIMIT');
      console.log('bounded resource cases passed');
    `], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024,
    });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /bounded resource cases passed/);
  });
});
