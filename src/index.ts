/**
 * @fileoverview StarMade Decoder Public API
 *
 * Public entry point for the StarMade-Decoder SDK, re-exporting parser, object, configuration, and type modules.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Public entry point for the StarMade-Decoder SDK.
 */

// Core
export { TagType, TAG_TYPE_NAMES } from './core/TagType.js';
export { Tag, FINISH_TAG, NULL_STRING } from './core/Tag.js';
export type { TagValue } from './core/Tag.js';
export { BufferReader } from './core/BufferReader.js';
export { BufferWriter } from './core/BufferWriter.js';
export { readFrom, writeTo } from './core/TagParser.js';
export { Tags, StructBuilder, ListBuilder } from './core/TagBuilder.js';
export { toObject, toJSON } from './core/TagSerializer.js';
export type { TagObject } from './core/TagSerializer.js';

// Public type exports
export { Vector3b, Vector3i, Vector3f, Vector4f } from './types/Vectors.js';
export { Matrix3f, Matrix4f } from './types/Matrices.js';

// Serializable
export type { SerializableTagElement } from './serializable/SerializableTagElement.js';
export { FACTORY_IDS } from './serializable/SerializableTagElement.js';
export type { SerializableTagFactory } from './serializable/SerializableTagFactory.js';
export { SerializableTagRegister } from './serializable/SerializableTagRegister.js';
export { registerAllFactories, RawElement } from './serializable/Factories.js';

// Config
export * from './config/index.js';

// Domain object exports
export * from './objects/index.js';

// DB VARBINARY decoders/encoders
export * from './db/index.js';

// Entity parsers
export * from './entity/index.js';

// Smd3 parser
export * from './smd3/index.js';
