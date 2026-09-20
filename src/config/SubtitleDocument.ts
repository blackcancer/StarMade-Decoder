/** @fileoverview Bounded SBV cue editing and timeline lookup without media rendering. */
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import { checkEntryCount, formatBytes, formatLimits, formatOutput, formatText,
  inheritFormatSource, rememberFormatSource, type FormatLimits } from '../core/FormatLimits.js';
import { parseSbvSubtitles, writeSbvSubtitles, type SbvSubtitleCue, type SbvSubtitleFile } from './SbvSubtitles.js';

/** Immutable subtitle cues in source order, with an independent chronological lookup index. */
export class SubtitleDocument implements SbvSubtitleFile {
  private readonly data: readonly SbvSubtitleCue[];
  private readonly starts: readonly { index: number; start: number }[];
  private readonly limits: Required<FormatLimits>;
  /** Validates timestamps and serializable cue text, retaining overlaps and source ordering. */
  constructor(cues: readonly SbvSubtitleCue[], options: FormatLimits = {}) {
    this.limits = formatLimits(options); checkEntryCount(cues.length, this.limits);
    if (!cues.length) throw new DecodeError('E_FORMAT', 'SBV requires at least one cue');
    this.data = Object.freeze(cues.map(cue => {
      boundedInteger(cue.startMs, 'cue start'); boundedInteger(cue.endMs, 'cue end');
      if (cue.endMs < cue.startMs || !cue.lines.length) throw new DecodeError('E_FORMAT', 'Invalid cue range or missing text');
      const lines = cue.lines.map(line => {
        if (typeof line !== 'string' || !line.trim() || line.trim() !== line || /[\r\n]/.test(line)) throw new DecodeError('E_FORMAT', 'Cue text requires nonempty individual lines');
        formatBytes(line, this.limits); return line;
      });
      return Object.freeze({ startMs: cue.startMs, endMs: cue.endMs, lines: Object.freeze(lines) });
    }));
    this.starts = this.data.map((cue, index) => ({ index, start: cue.startMs })).sort((left, right) => left.start - right.start);
    Object.freeze(this);
  }
  /** Reads bounded strict UTF-8 and preserves exact source bytes until data changes. */
  static fromBuffer(input: string | Uint8Array, options: FormatLimits = {}): SubtitleDocument {
    const bytes = formatBytes(input, formatLimits(options));
    const result = new SubtitleDocument(parseSbvSubtitles(formatText(bytes)).cues, options);
    rememberFormatSource(result, bytes, Buffer.from(writeSbvSubtitles(result))); return result;
  }
  /** Detached cues in source order. */
  get cues(): SbvSubtitleCue[] { return this.data.map(cue => ({ ...cue, lines: [...cue.lines] })); }
  /** Looks up active cues in source order using half-open ranges [start,end). */
  at(timeMs: number): SbvSubtitleCue[] {
    boundedInteger(timeMs, 'subtitle time');
    let low = 0, high = this.starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (this.starts[mid].start <= timeMs) low = mid + 1; else high = mid; }
    return this.starts.slice(0, low).filter(item => this.data[item.index].endMs > timeMs)
      .sort((left, right) => left.index - right.index).map(item => ({ ...this.data[item.index], lines: [...this.data[item.index].lines] }));
  }
  /** Replaces a cue or appends at the current length. */
  set(index: number, cue: SbvSubtitleCue): SubtitleDocument {
    boundedInteger(index, 'cue index', this.data.length);
    const cues = this.cues; cues[index] = cue;
    return inheritFormatSource(this, new SubtitleDocument(cues, this.limits));
  }
  /** Removes an existing cue; a resulting empty document is invalid SBV. */
  remove(index: number): SubtitleDocument {
    boundedInteger(index, 'cue index', this.data.length - 1);
    const cues = this.cues; cues.splice(index, 1);
    return inheritFormatSource(this, new SubtitleDocument(cues, this.limits));
  }
  /** Shifts stored timestamps, rejecting negative results and safe-integer overflow. */
  shift(milliseconds: number): SubtitleDocument {
    if (!Number.isSafeInteger(milliseconds)) throw new DecodeError('E_RANGE', 'Subtitle offset must be a safe integer');
    return inheritFormatSource(this, new SubtitleDocument(this.data.map(cue => ({ ...cue,
      startMs: cue.startMs + milliseconds, endMs: cue.endMs + milliseconds })), this.limits));
  }
  /** Serializes cues and retains original bytes after a semantic edit/revert. */
  toBuffer(): Buffer { return formatOutput(this, Buffer.from(writeSbvSubtitles(this)), this.limits); }
  /** Detached JSON projection. */
  toJSON(): SbvSubtitleFile { return { cues: this.cues }; }
}
