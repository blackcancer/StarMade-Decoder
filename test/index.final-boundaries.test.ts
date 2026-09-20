/**
 * @fileoverview Final error-envelope, chamber-root and sparse metadata regressions.
 * These fixtures exercise public boundary behavior rather than altering the
 * coverage counters, filtering modules, or mutating production enum tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assert } from 'chai';
import { BlockConfig } from '../src/config/BlockConfig.js';
import { Tags } from '../src/core/TagBuilder.js';
import { BufferWriter } from '../src/core/BufferWriter.js';
import { parseFactions } from '../src/entity/Factions.js';
import { parseSmbpm } from '../src/smd3/SmbpmParser.js';
import { parseBlueprintFolder } from '../src/smd3/BlueprintFolderParser.js';
import { BlueprintReadContext } from '../src/smd3/BlueprintReadContext.js';
import { BLOCK_COUNT, HEADER_SIZE, SEGMENT_SECTOR } from '../src/smd3/Smd3Parser.js';

describe('Final boundaries — complete error envelopes and optional data', () => {
  it('finds the root of a non-upgraded general reactor chamber', () => {
    const cfg = BlockConfig.fromXml('<Config><Block type="5" name="Chamber"><GeneralChamber>true</GeneralChamber></Block></Config>');
    const info = cfg.getById(5)!.toElementInfo(cfg);
    assert.equal(info.chamber.upgradedRoot!.id, 5);
    assert.equal(info.chamber.upgraded, false);
  });

  it('uses the integer ID of an unwrapped faction entry', () => {
    const factions = parseFactions(Tags.struct(null, [Tags.byte(null, 0), Tags.struct(null, [Tags.int(null, 99), Tags.string(null, 'Guild')])]));
    assert.equal(factions.factions[0].id, 99);
  });

  for (const kind of [2, 5, 9]) {
    it(`preserves a structured decoder cause in metadata section ${kind}`, () => {
      const w = new BufferWriter(); w.writeInt32BE(5); w.writeInt8(kind);
      // Anonymous LIST with invalid element type: structurally recognizable but unsupported.
      const bytes = Buffer.from('0000f4ff00000000', 'hex');
      if (kind === 5) w.writeInt32BE(bytes.length);
      w.writeBytes(bytes);
      try { parseSmbpm(w.toBuffer()); assert.fail('Expected invalid embedded Tag'); }
      catch (error: any) { assert.equal(error.code, 'E_FORMAT'); assert.equal(error.cause.code, 'E_FORMAT'); }
    });
  }

  it('counts structurally rejected region-table records in the aggregate block budget', () => {
    const input = Buffer.alloc(HEADER_SIZE + 2 * SEGMENT_SECTOR);
    input[0] = 7;
    input.writeInt16BE(-1, 4); input.writeUInt16BE(30, 6);
    input.writeInt16BE(-2, 8); input.writeUInt16BE(30, 10);
    assert.throws(() => new BlueprintReadContext({ maxBlocks: BLOCK_COUNT, mode: 'recover' }).readSegments(input, 'bad'), /Blueprint block budget/);
  });

  it('does not attach a child for an empty basename in legacy docking metadata', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-dock-'));
    try {
      fs.writeFileSync(path.join(temp, 'header.smbph'), Buffer.alloc(36));
      const w = new BufferWriter(); w.writeInt32BE(5); w.writeInt8(3); w.writeInt32BE(1); w.writeJavaUTF('/');
      for (let i = 0; i < 3; i++) w.writeInt32BE(16);
      for (let i = 0; i < 3; i++) w.writeFloat32BE(1);
      w.writeInt16BE(0); w.writeInt8(0);
      fs.writeFileSync(path.join(temp, 'meta.smbpm'), w.toBuffer());
      assert.equal(parseBlueprintFolder(temp).root.children.length, 0);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
});
