/** @fileoverview Skin archives preserve opaque PNG resources and enforce ZIP/model budgets. */
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { SkinDocument, SKIN_TEXTURE_FILES, type SkinTextures, type SkinOptions } from '../../src/skin/index.js';
import { DecodeError } from '../../src/core/DecodeError.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
const textures = (): SkinTextures => ({ mainDiffuse: Buffer.from(png), mainEmission: Buffer.from(png), helmetDiffuse: Buffer.from(png), helmetEmission: Buffer.from(png) });
const code = (fn: () => unknown, expected: string) => assert.throws(fn, (error: unknown) => error instanceof DecodeError && error.code === expected);
function fixture(): Buffer {
  const zip = new AdmZip(); zip.addZipComment('skin envelope');
  for (const name of Object.values(SKIN_TEXTURE_FILES)) zip.addFile(name.replace('skin_', 'personal_'), png, 'texture metadata');
  zip.addFile('extension.bin', Buffer.from([9, 8, 7])); zip.addFile('notes/', Buffer.alloc(0));
  return zip.toBuffer();
}

describe('SkinDocument', () => {
  it('creates all four canonical textures and exposes detached indexed resources', () => {
    const inputs = textures(), doc = SkinDocument.create(inputs);
    assert.ok(Object.isFrozen(doc)); assert.ok(Object.isFrozen(SKIN_TEXTURE_FILES));
    assert.equal(doc.files.size, 4); assert.equal(doc.textureInfo('helmetEmission').name, 'skin_helmet_em.png');
    assert.equal(doc.textureInfo('mainDiffuse').byteLength, png.length);
    assert.deepEqual(SkinDocument.fromBuffer(doc.toBuffer()).texture('mainEmission'), png);
    inputs.mainDiffuse.fill(0); doc.texture('mainDiffuse').fill(0); doc.files.get('skin_main_diff.png')!.fill(0);
    doc.files.clear(); const json = doc.toJSON(); json.textures.mainDiffuse.name = 'changed'; json.files.length = 0;
    assert.deepEqual(doc.texture('mainDiffuse'), png); assert.equal(doc.toJSON().files.length, 4);
    assert.equal(doc.toJSON().textures.mainDiffuse.name, 'skin_main_diff.png');
    assert.deepEqual(SkinDocument.fromBuffer(doc.toBuffer()).toJSON(), doc.toJSON());
    code(() => doc.texture('other' as any), 'E_RANGE'); code(() => doc.textureInfo('__proto__' as any), 'E_RANGE');
  });

  it('retains ZIP metadata, custom prefixes, ancillary entries and exact edit/revert bytes', () => {
    const source = fixture(), doc = SkinDocument.fromBuffer(source);
    assert.deepEqual(doc.toBuffer(), source); assert.equal(doc.textureInfo('mainDiffuse').name, 'personal_main_diff.png');
    assert.equal(doc.files.get('notes/'), null); assert.deepEqual(doc.files.get('extension.bin'), Buffer.from([9, 8, 7]));
    const altered = Buffer.concat([png, Buffer.from('opaque image bytes')]);
    const edited = doc.withTexture('mainDiffuse', altered);
    altered.fill(0); assert.notDeepEqual(edited.texture('mainDiffuse'), doc.texture('mainDiffuse'));
    const decoded = SkinDocument.fromBuffer(edited.toBuffer());
    assert.deepEqual(decoded.texture('helmetEmission'), png);
    assert.deepEqual(decoded.files.get('extension.bin'), Buffer.from([9, 8, 7]));
    const zip = new AdmZip(edited.toBuffer()); assert.equal(zip.getZipComment(), 'skin envelope');
    assert.equal(zip.getEntry('personal_main_diff.png')!.comment, 'texture metadata');
    assert.deepEqual(edited.withTexture('mainDiffuse', png).toBuffer(), source);
    assert.deepEqual(doc.withFile('added.bin', Buffer.from([3])).withoutFile('added.bin').toBuffer(), source);
    assert.deepEqual(doc.withFile('empty/', null).withoutFile('empty/').toBuffer(), source);
    assert.deepEqual(doc.withoutFile('missing').toBuffer(), source);
    const noAncillary = doc.withoutFile('extension.bin'); assert.equal(noAncillary.files.has('extension.bin'), false);
    source.fill(0); assert.deepEqual(doc.texture('mainDiffuse'), png);
  });

  it('rejects incomplete or ambiguous skins and PNG signature errors without decoding pixels', () => {
    const doc = SkinDocument.create(textures());
    code(() => doc.withoutFile('skin_main_diff.png'), 'E_INCOMPLETE');
    code(() => doc.withFile('other_main_diff.png', png), 'E_FORMAT');
    code(() => doc.withFile('skin_main_diff.png', null), 'E_FORMAT');
    code(() => doc.withTexture('helmetDiffuse', Buffer.alloc(7)), 'E_FORMAT');
    code(() => doc.withTexture('helmetEmission', Buffer.alloc(8)), 'E_FORMAT');
    code(() => doc.withTexture('mainDiffuse', 'png' as any), 'E_FORMAT');
    code(() => SkinDocument.create({ ...textures(), mainDiffuse: undefined } as any), 'E_FORMAT');
    const zip = new AdmZip(); zip.addFile('directory/skin_main_diff.png', png);
    code(() => SkinDocument.fromBuffer(zip.toBuffer()), 'E_INCOMPLETE');
    assert.deepEqual(doc.texture('mainDiffuse'), png);
  });

  it('inherits byte/entry limits on every revision and rejects invalid policy values', () => {
    const original = SkinDocument.create(textures()).toBuffer();
    for (const options of [{maxInputBytes:original.length-1}, {maxEntryBytes:png.length-1}, {maxTotalBytes:png.length*4-1}, {maxEntries:3}, {maxOutputBytes:original.length-1}]) {
      code(() => SkinDocument.fromBuffer(original, options), 'E_LIMIT');
    }
    for (const key of ['maxInputBytes', 'maxEntryBytes', 'maxTotalBytes', 'maxEntries', 'maxOutputBytes']) {
      code(() => SkinDocument.create(textures(), { [key]: -1 }), 'E_RANGE');
    }
    const options: SkinOptions = {maxInputBytes:original.length, maxEntryBytes:png.length, maxTotalBytes:png.length*4, maxEntries:4, maxOutputBytes:original.length};
    const doc = SkinDocument.fromBuffer(original, options); options.maxEntryBytes = 1_000_000;
    assert.deepEqual(doc.toBuffer(), original);
    code(() => doc.withTexture('mainDiffuse', Buffer.concat([png, Buffer.from([1])])), 'E_LIMIT');
    code(() => doc.withFile('extra', Buffer.from([1])), 'E_LIMIT');
    code(() => SkinDocument.create(textures(), {maxEntryBytes:png.length-1}), 'E_LIMIT');
    code(() => SkinDocument.create(textures(), {maxEntries:3}), 'E_LIMIT');
  });

  it('uses the existing ZIP corruption, path, encryption and decompression guards', () => {
    const original = SkinDocument.create(textures()).toBuffer();
    assert.throws(() => SkinDocument.fromBuffer(original.subarray(0, 12)), DecodeError);
    const encrypted = Buffer.from(original), central = encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    assert.throws(() => SkinDocument.fromBuffer(encrypted), DecodeError);
    const corrupt = Buffer.from(original); corrupt[30 + corrupt.readUInt16LE(26)] ^= 1;
    assert.throws(() => SkinDocument.fromBuffer(corrupt), DecodeError);
    const doc = SkinDocument.fromBuffer(original);
    code(() => doc.withFile('../escape', Buffer.from([1])), 'E_FORMAT');
    code(() => doc.withFile('dir/', Buffer.from([1])), 'E_FORMAT');
    code(() => doc.withFile('ordinary-file', null), 'E_FORMAT');
  });
});
