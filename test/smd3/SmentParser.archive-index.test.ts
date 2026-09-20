/** Regression coverage for exact and bounded archive entity discovery. */
import { assert } from 'chai';
import AdmZip from 'adm-zip';
import { parseSment } from '../../src/smd3/SmentParser.js';

/** Builds entity paths directly, without an SDK writer as the oracle. */
function archive(names: string[], extra: Record<string, Buffer> = {}): Buffer {
  const zip = new AdmZip();
  for (const name of names) zip.addFile(`${name}/header.smbph`, Buffer.alloc(36));
  for (const [name, data] of Object.entries(extra)) zip.addFile(name, data);
  return zip.toBuffer();
}

describe('Audit archives — indexed entity discovery', () => {
  it('keeps equal-length and different-length sibling descendants in their exact tree', () => {
    const result = parseSment(archive([
      'Root', 'Root/ATTACHED_0', 'Root/ATTACHED_1', 'Root/ATTACHED_10',
      'Root/ATTACHED_1/ATTACHED_9', 'Root/ATTACHED_10/ATTACHED_123',
      'Root/ATTACHED_10/ATTACHED_123/ATTACHED_0',
    ], {
      'Root/DATA/nested/invalid.smd3': Buffer.alloc(1),
      'Other/ATTACHED_2/notes.txt': Buffer.alloc(0),
      'Root/ordinary/ATTACHED_3/notes.txt': Buffer.alloc(0),
      'Root/ATTACHED_100': Buffer.alloc(0),
    }));
    assert.isTrue(result.complete);
    assert.equal(result.totalEntities, 7);
    assert.deepEqual(result.root.children.map(child => child.name), ['ATTACHED_0', 'ATTACHED_1', 'ATTACHED_10']);
    assert.lengthOf(result.root.children[0].children, 0);
    assert.deepEqual(result.root.children[1].children.map(child => child.name), ['ATTACHED_9']);
    assert.deepEqual(result.root.children[2].children.map(child => child.name), ['ATTACHED_123']);
    assert.equal(result.root.children[2].children[0].children[0].name, 'ATTACHED_0');
  });

  it('reports an explicitly listed empty child directory as missing its required header', () => {
    const input = archive(['Root'], { 'Root/ATTACHED_4/': Buffer.alloc(0) });
    assert.throws(() => parseSment(input), /Missing blueprint entity header/);
    const recovered = parseSment(input, { mode: 'recover' });
    assert.isFalse(recovered.complete);
    assert.lengthOf(recovered.root.children, 1);
    assert.equal(recovered.diagnostics[0].path, 'Root/ATTACHED_4/header.smbph');
  });

  it('bounds the index by entity and depth limits even in recovery mode', () => {
    const input = archive(['Root', 'Root/ATTACHED_0', 'Root/ATTACHED_0/ATTACHED_1']);
    for (const mode of ['strict', 'recover'] as const) {
      for (const options of [{ maxEntities: 1 }, { maxDepth: 0 }]) {
        const error = assert.throws(() => parseSment(input, { ...options, mode }), /budget/) as any;
        assert.equal(error.code, 'E_LIMIT');
        assert.equal(error.path, 'Root/ATTACHED_0');
      }
      assert.equal(parseSment(input, { mode, maxEntities: 3, maxDepth: 2 }).totalEntities, 3);
    }
  });

  it('bounds ZIP pathname decoding linearly when many entities share an archive', () => {
    const names = ['Root', ...Array.from({ length: 64 }, (_, i) => `Root/ATTACHED_${i}`)];
    const input = archive(names);
    const original = Buffer.prototype.toString;
    let pathDecodes = 0;
    // adm-zip decodes names from their byte buffers on every entryName access.
    // Count that observable work, avoiding machine-dependent time assertions.
    try {
      Buffer.prototype.toString = function (...args: Parameters<Buffer['toString']>): string {
        const value = original.apply(this, args);
        if (value.startsWith('Root/')) pathDecodes++;
        return value;
      };
      assert.equal(parseSment(input).totalEntities, names.length);
    } finally { Buffer.prototype.toString = original; }
    assert.isAtMost(pathDecodes, names.length * 30, 'entry-name work must not grow with entries × entities');
  });
});
