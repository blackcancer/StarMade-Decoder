/** @fileoverview Independently constructed fixtures matching the inspected simulation wire schema. */
import { Tag } from '../../src/core/Tag.js';
import { TagType } from '../../src/core/TagType.js';
import { Tags } from '../../src/core/TagBuilder.js';
import { writeTo } from '../../src/core/TagParser.js';
import { gzipSync } from 'node:zlib';

/** Type-specific metadata, including an extension on the attack target. */
export function metadata(type = 2): Tag {
  if (type === 0) return Tags.vector3i('target-sector', 11, -12, 13);
  if (type === 1) return Tags.byte('empty-metadata', 0);
  return Tags.struct('attack-target', [Tags.vector3i('target-sector', 11, -12, 13), Tags.string('target-uid', 'ENTITY_Target'), Tags.long('future-metadata', 17n)]);
}
/** A complete group with field names and one unknown trailing field. */
export function groupTag(type = 2, version = 1): Tag {
  return Tags.struct('group-record', [Tags.byte('version', version), Tags.int('type', type),
    Tags.struct('members', [Tags.string('first', 'ENTITY_A'), Tags.string('second', 'ENTITY_B')]),
    Tags.long('start', 1234567890123456n), Tags.vector3i('origin-sector', 1, -2, 3), Tags.int('program', 1),
    metadata(type), Tags.byteArray('future-group', Buffer.from([0, 255, 19]))]);
}
/** State counter exceeds Number precision to detect accidental timestamp/number conversion. */
export function stateTag(): Tag {
  return Tags.struct('SimulationState', [Tags.byte('version', 0), Tags.struct('groups', [groupTag()]),
    Tags.long('uniquegroups', 9007199254740993n), Tags.string('future-state', 'preserved')]);
}
/** Replaces a single fixture slot without reconstructing unrelated data. */
export function replace(tag: Tag, index: number, value: Tag): Tag {
  const entries = [...tag.getStruct()]; entries[index] = value; return new Tag(TagType.STRUCT, tag.name, entries);
}
/** Removes the specified slot, retaining the existing terminator. */
export function omit(tag: Tag, index: number): Tag {
  const entries = [...tag.getStruct()]; entries.splice(index, 1); return new Tag(TagType.STRUCT, tag.name, entries);
}
/** Non-default file version and trailing bytes, optionally inside a GZIP envelope. */
export function envelope(tag: Tag, compressed: boolean): Buffer {
  const body = writeTo(tag); body.writeInt16BE(23); const tail = Buffer.from([5, 0, 255, 18]);
  return compressed ? gzipSync(Buffer.concat([body.subarray(2), tail])) : Buffer.concat([body, tail]);
}
