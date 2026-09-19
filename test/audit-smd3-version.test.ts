/**
 * @fileoverview Rejects malformed source versions before semantic v7 migration.
 */
import { assert } from 'chai';
import { DecodeError } from '../src/core/DecodeError.js';
import { parseSmd3 } from '../src/smd3/Smd3Parser.js';
import { emptySegment, emptySmd3File, writeSmd3 } from '../src/smd3/Smd3Writer.js';

describe('Audit SMD3 source versions', () => {
  for (const version of [NaN, 6.5, undefined, '6', Infinity, -Infinity, 5, 8]) {
    it(`rejects source version ${String(version)} (${typeof version})`, () => {
      const segment = emptySegment();
      segment.version = version as number;
      const error = assert.throws(() => writeSmd3({ ...emptySmd3File(), segments: [segment] }), DecodeError);
      assert.equal((error as DecodeError).code, 'E_UNSUPPORTED');
    });
  }

  for (const version of [6, 7]) {
    it(`retains editable fields while migrating source version ${version} to v7`, () => {
      const segment = emptySegment();
      segment.version = version;
      segment.blocks[123] = { type: 1234, hp: 93, orientation: 17, active: true };
      const decoded = parseSmd3(writeSmd3({ ...emptySmd3File(), segments: [segment] })).segments[0];
      assert.equal(decoded.version, 7);
      assert.equal(decoded.blockCount, 1);
      assert.deepEqual(decoded.blocks, segment.blocks);
      assert.equal(segment.version, version);
    });
  }
});
