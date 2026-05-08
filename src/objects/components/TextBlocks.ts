/**
 * @fileoverview Text Blocks
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * TextBlocks — texts associated with blocks (panels, screens, etc.)
 *
 * Port of SegmentController.textMap + readTextBlockData() Java.
 *
 * Structure Tag (Tag.listToTagStruct(textMap)) :
 *   STRUCT [
 *     STRUCT entry [
 *       LONG   pos (block position index, format ElementCollection)
 *       STRING text
 *       FINISH
 *     ]
 *     ... (one entry per text block)
 *     FINISH
 *   ]
 */

import { Tag } from '../../core/Tag.js';
import { Tags } from '../../core/TagBuilder.js';
import { TagType } from '../../core/TagType.js';
import { FINISH_TAG } from '../../core/Tag.js';
import { indexToPos } from '../ElementPosition.js';
import type { BlockPosition } from '../ElementPosition.js';

export class TextBlocks {
  /** Map<blockIndex, text> */
  private readonly _entries: Map<bigint, string>;

  private constructor(entries: Map<bigint, string>) {
    this._entries = entries;
  }

  static EMPTY = new TextBlocks(new Map());

  static fromTag(tag: Tag): TextBlocks {
    const entries = new Map<bigint, string>();
    if (tag.type !== TagType.STRUCT) return TextBlocks.EMPTY;
    for (const entry of tag.getStruct().filter(t => t.type !== TagType.FINISH)) {
      if (entry.type !== TagType.STRUCT) continue;
      const children = entry.getStruct().filter(t => t.type !== TagType.FINISH);
      if (children.length < 2) continue;
      const pos  = children[0]?.type === TagType.LONG   ? children[0].getLong()   : null;
      const text = children[1]?.type === TagType.STRING ? children[1].getString() : null;
      if (pos !== null && text !== null) entries.set(pos, text);
    }
    return new TextBlocks(entries);
  }

  toTag(): Tag {
    const entryTags: Tag[] = [];
    for (const [pos, text] of this._entries) {
      entryTags.push(Tags.struct(null, [
        Tags.long(null, pos),
        Tags.string(null, text),
      ]));
    }
    entryTags.push(FINISH_TAG);
    return new Tag(TagType.STRUCT, null, entryTags);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  get size(): number { return this._entries.size; }
  has(pos: bigint): boolean  { return this._entries.has(pos); }
  get(pos: bigint): string | undefined { return this._entries.get(pos); }
  entries(): ReadonlyMap<bigint, string> { return this._entries; }

  /** Positions decoded as (x, y, z) from long indexes. */
  positions(): Array<{ pos: bigint; block: BlockPosition; text: string }> {
    return [...this._entries.entries()].map(([pos, text]) => ({
      pos,
      block: indexToPos(pos),
      text,
    }));
  }

  // ── Immutable updates ──────────────────────────────────────────────

  set(pos: bigint, text: string): TextBlocks {
    const m = new Map(this._entries);
    m.set(pos, text);
    return new TextBlocks(m);
  }

  delete(pos: bigint): TextBlocks {
    const m = new Map(this._entries);
    m.delete(pos);
    return new TextBlocks(m);
  }

  toString(): string { return `TextBlocks(${this._entries.size} entries)`; }
}
