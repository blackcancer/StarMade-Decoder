/** @fileoverview Private source snapshots for field-preserving immutable Tag model edits. */
import { Tag } from './Tag.js';
import { Tags } from './TagBuilder.js';
import { TagType } from './TagType.js';
import { DecodeError } from './DecodeError.js';
import { readFrom, writeTo, type TagReadOptions } from './TagParser.js';

/** Complete source bytes plus the original semantic projection of known slots. */
interface ModelSource { bytes: Buffer; fields: Map<number, Buffer>; options: TagReadOptions; }
/** Original records are not part of the model's public data or JSON. */
const sources = new WeakMap<object, ModelSource>();
/** A field projection maps actual wire positions to their current semantic values. */
export type TagModelFields = ReadonlyMap<number, Tag>;

/** Copies and validates complete Tag graphs through the bounded binary codec. */
export function copyTagModel(tag: Tag, options: TagReadOptions = {}): Tag {
  return readFrom(writeTo(tag, options), tagModelOptions(options));
}

/** Internal copies retain traversal limits without charging the caller's shared read counters twice. */
export function tagModelOptions(options: TagReadOptions = {}): TagReadOptions {
  const {sharedNodeBudget: _nodes, sharedInflationBudget: _bytes, ...local} = options;
  return {...local, maxInputBytes: local.maxInflatedBytes};
}

/** Captures the source and semantic baseline without retaining mutable caller references. */
export function rememberTagModel(model: object, tag: Tag, fields: TagModelFields, options: TagReadOptions = {}): void {
  const local = tagModelOptions(options);
  sources.set(model, { bytes: writeTo(tag, local), fields: new Map([...fields].map(([index, value]) => [index, writeTo(value, local)])), options: local });
}

/** Preserves source metadata when an immutable update creates another model. */
export function inheritTagModel<T extends object>(source: object, target: T): T {
  const original = sources.get(source); if (original) sources.set(target, original); return target;
}

/** Patches changed known fields while preserving names, original types and all unmodelled slots. */
export function renderTagModel(model: object, fields: TagModelFields, initial: Tag, options: TagReadOptions = {}): Tag {
  const original = sources.get(model), local = original?.options ?? tagModelOptions(options);
  const root = original ? readFrom(original.bytes, local) : copyTagModel(initial, local);
  const children = root.getStruct().filter(tag => tag.type !== TagType.FINISH);
  for (const [index, value] of fields) {
    if (!Number.isSafeInteger(index) || index < 0) throw new DecodeError('E_RANGE', 'A model field index must be a nonnegative safe integer');
    if (value.type === TagType.FINISH) throw new DecodeError('E_FORMAT', 'A model field cannot be FINISH');
    if (original?.fields.get(index)?.equals(writeTo(value, local))) continue;
    // Check before filling positional gaps: the STRUCT itself and its FINISH also consume nodes.
    if (index >= Math.min((local.maxListLength ?? 1_000_000) - 1, (local.maxNodes ?? 1_000_000) - 2)) {
      throw new DecodeError('E_LIMIT', 'Model field index exceeds the output collection budget');
    }
    while (children.length <= index) children.push(Tags.nothing(null));
    children[index] = Tags.rename(value, children[index].name);
  }
  // A complete copy validates aggregate depth, bytes and SERIALIZABLE counts, and detaches
  // unchanged initial fields as well as replacements supplied by the caller.
  return copyTagModel(Tags.struct(root.name, children), local);
}
