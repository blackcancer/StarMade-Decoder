/** @fileoverview Private immutable Tag storage shared by entity format models. */
import { Tag } from './Tag.js';
import { Tags } from './TagBuilder.js';
import { TagType } from './TagType.js';
import { DecodeError } from './DecodeError.js';
import { readFrom, writeTo, readTagDocument, type TagDocument, type TagReadOptions } from './TagParser.js';
import { tagModelOptions } from './TagModel.js';

/** Validated detached root and an optional original file envelope. */
export class TagModelFile {
  private readonly bytes: Buffer;
  private readonly originalBytes: Buffer;
  readonly options: TagReadOptions;
  /** Validates and snapshots a supplied tree; only an explicit file read has a source envelope. */
  constructor(root: Tag, options: TagReadOptions = {}, private readonly document?: TagDocument, originalBytes?: Buffer) {
    this.options = Object.freeze(tagModelOptions(options)); this.bytes = writeTo(root, this.options);
    this.originalBytes = Buffer.from(originalBytes ?? this.bytes);
    if (document) document.toBuffer(root); Object.freeze(this);
  }
  /** Complete detached tree, safe to edit without mutating the source model. */
  get root(): Tag { return readFrom(this.bytes, this.options); }
  /** Original representation for restoring legacy scalar types and noncanonical boolean bytes after a revert. */
  get originalRoot(): Tag { return readFrom(this.originalBytes, this.options); }
  /** Returns a validated revision carrying the original envelope and limits. */
  withRoot(root: Tag): TagModelFile { return new TagModelFile(root, this.options, this.document, this.originalBytes); }
  /** Emits an unchanged source exactly and preserves its envelope after edits. */
  toBuffer(): Buffer { return this.document ? this.document.toBuffer(this.root) : Buffer.from(this.bytes); }
  /** Reads once with shared budgets, then uses local limits for internal copies. */
  static fromBuffer(data: Uint8Array, options: TagReadOptions = {}): TagModelFile {
    const document = readTagDocument(data, options);
    const local = { ...options };
    if (document.compressed && local.maxInflatedBytes !== undefined) local.maxInflatedBytes += 2;
    return new TagModelFile(document.root, local, document);
  }
}

/**
 * Builds a mutable intermediate tree, retaining a known slot's name and checking its old type.
 * Unchanged and replacement values may share Tag payloads until TagModelFile.withRoot validates
 * and snapshots the revision; this low-level operation does not publish an immutable model.
 */
export function replaceTagField(root: Tag, index: number, value: Tag, accepted: readonly TagType[] = [value.type]): Tag {
  const children = root.getStruct().filter(tag => tag.type !== TagType.FINISH), previous = children[index];
  if (!previous || !accepted.includes(previous.type)) throw new DecodeError('E_FORMAT', `Cannot edit absent or incompatible field ${index}`);
  children[index] = Tags.rename(value, previous.name); return Tags.struct(root.name, children);
}
