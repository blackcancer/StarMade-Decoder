/**
 * @fileoverview
 * Regression tests for a single TypeScript ESM module graph under Mocha.
 *
 * Mixing CommonJS-transpiled tests with dynamic ESM imports creates independent
 * Tag classes and SERIALIZABLE registries. These checks detect that loader
 * regression without weakening runtime validation or using global registries.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { strict as assert } from 'node:assert';
import {
  Tag, TagType, RawElement, SerializableTagRegister, registerAllFactories,
  readFrom, writeTo,
} from '../src/index.js';

// All imports intentionally refer to the same source modules through different
// supported paths. No cache-busting query strings or duplicate SDK installations.
describe('ESM module identity', () => {
  it('shares the Tag constructor across static, dynamic and barrel imports', async () => {
    const leaf = await import('../src/core/Tag.js');
    const publicApi = await import('../src/index.js');
    assert.equal(leaf.Tag, Tag, 'Dynamic leaf import created a second Tag class');
    assert.equal(publicApi.Tag, Tag, 'Dynamic public import created a second Tag class');
    const tag = new leaf.Tag(TagType.INT, 'answer', 42);
    assert.equal(readFrom(writeTo(tag)).getInt(), 42);
  });

  it('shares SERIALIZABLE registration with dynamically imported parsers', async () => {
    const registry = await import('../src/serializable/SerializableTagRegister.js');
    const parser = await import('../src/core/TagParser.js');
    assert.equal(registry.SerializableTagRegister, SerializableTagRegister,
      'Dynamic import created an independent factory registry');
    registerAllFactories();
    const tag = new Tag(TagType.SERIALIZABLE, 'emptyLongSet',
      new RawElement(3, new Uint8Array(4)));
    const bytes = writeTo(tag);
    const decoded = parser.readFrom(bytes);
    assert.ok(decoded instanceof Tag);
    assert.equal(decoded.getSerializable().getFactoryId(), 3);
    assert.deepEqual(parser.writeTo(decoded), bytes);
  });
});
