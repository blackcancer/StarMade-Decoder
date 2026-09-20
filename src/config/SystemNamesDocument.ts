/** @fileoverview Immutable syllable/flag collections with exact unchanged .syl bytes. */
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, formatOutput, formatText,
  inheritFormatSource, rememberFormatSource, type FormatLimits } from '../core/FormatLimits.js';
import { parseSystemNames, writeSystemNames, type SystemNameSyllable, type SystemNamesFile } from './SystemNames.js';

/** Stored name-generator tokens; the SDK does not run the game naming algorithm. */
export class SystemNamesDocument implements SystemNamesFile {
  private readonly data: readonly SystemNameSyllable[];
  private readonly limits: Required<FormatLimits>;
  /** Takes a validated snapshot of tokens and flags without interpreting generation rules. */
  constructor(syllables: readonly SystemNameSyllable[] = [], options: FormatLimits = {}) {
    this.limits = formatLimits(options); checkEntryCount(syllables.length, this.limits);
    this.data = Object.freeze(syllables.map(syllable => {
      for (const token of [syllable.value, ...syllable.flags]) {
        if (typeof token !== 'string' || !token || /\s/.test(token)) throw new DecodeError('E_FORMAT', 'Syllables and flags must be single nonempty tokens');
        formatBytes(token, this.limits);
      }
      if (syllable.value.startsWith('#')) throw new DecodeError('E_FORMAT', 'A syllable cannot be a comment');
      return Object.freeze({ value: syllable.value, flags: Object.freeze([...syllable.flags]) as unknown as string[] });
    }));
    Object.freeze(this);
  }
  /** Parses bounded UTF-8 while retaining comments, whitespace and original line endings. */
  static fromBuffer(input: string | Uint8Array, options: FormatLimits = {}): SystemNamesDocument {
    const bytes = formatBytes(input, formatLimits(options));
    const result = new SystemNamesDocument(parseSystemNames(formatText(bytes)).syllables, options);
    rememberFormatSource(result, bytes, writeSystemNames(result)); return result;
  }
  /** Detached ordered tokens; duplicates retain their original meaning and position. */
  get syllables(): SystemNameSyllable[] { return this.data.map(item => ({ value: item.value, flags: [...item.flags] })); }
  /** Returns all tokens carrying one exact flag. */
  withFlag(flag: string): SystemNameSyllable[] { return this.syllables.filter(item => item.flags.includes(flag)); }
  /** Replaces one entry or appends at the current collection length. */
  set(index: number, syllable: SystemNameSyllable): SystemNamesDocument {
    boundedInteger(index, 'syllable index', this.data.length);
    const data = this.syllables; data[index] = syllable;
    return inheritFormatSource(this, new SystemNamesDocument(data, this.limits));
  }
  /** Removes one existing entry; invalid indices fail instead of changing another entry. */
  remove(index: number): SystemNamesDocument {
    boundedInteger(index, 'syllable index', this.data.length - 1);
    const data = this.syllables; data.splice(index, 1);
    return inheritFormatSource(this, new SystemNamesDocument(data, this.limits));
  }
  /** Writes canonical tokens after edits, preserving original bytes for unchanged/reverted data. */
  toBuffer(): Buffer { return formatOutput(this, writeSystemNames(this), this.limits); }
  /** Detached JSON representation of stored tokens and flags. */
  toJSON(): SystemNamesFile { return { syllables: this.syllables }; }
}
