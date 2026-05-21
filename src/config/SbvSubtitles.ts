/**
 * @fileoverview config/SbvSubtitles
 *
 * Parser/writer for StarMade .sbv subtitle files.
 *
 * StarMade reads these files through SvbSubtitleManager: a cue starts with
 * "HH:MM:SS.mmm,HH:MM:SS.mmm", followed by one or more non-empty text lines.
 * Empty lines separate cues.
 */

/**
 * One timed subtitle cue from a StarMade SBV file.
 */
export interface SbvSubtitleCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly lines: readonly string[];
}

/**
 * Describes the SbvSubtitleFile data shape used by StarMade configuration loading, editing, and metadata enrichment.
 */
export interface SbvSubtitleFile {
  readonly cues: readonly SbvSubtitleCue[];
}

/**
 * Defines TIME_CODE_RE for StarMade configuration loading, editing, and metadata enrichment.
 */
const TIME_CODE_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/;

/**
 * Parses SbvTimeCode for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param input - Input value for the parseSbvTimeCode operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSbvTimeCode(input: string): number {
  const match = TIME_CODE_RE.exec(input.trim());
  if (!match) throw new Error(`Invalid SBV time code: ${input}`);

  const [, h, m, s, ms] = match;
  const hours = Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  const millis = Number(ms.padEnd(3, '0'));

  if (minutes > 59 || seconds > 59) throw new Error(`Invalid SBV time code: ${input}`);
  return ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + millis;
}

/**
 * Handles the formatSbvTimeCode operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param ms - Input value for the formatSbvTimeCode operation.
 * @returns The computed StarMade-Decoder value.
 */
export function formatSbvTimeCode(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error(`Invalid SBV timestamp: ${ms}`);

  const millis = ms % 1000;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/**
 * Parses SbvSubtitles for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param input - Input value for the parseSbvSubtitles operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parseSbvSubtitles(input: string | Uint8Array): SbvSubtitleFile {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues: SbvSubtitleCue[] = [];

  for (let i = 0; i < lines.length;) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    const timeLine = lines[i++].trim();
    const [start, end, extra] = timeLine.split(',');
    if (!start || !end || extra !== undefined) throw new Error(`Invalid SBV cue timing: ${timeLine}`);

    const cueLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') cueLines.push(lines[i++].trim());

    if (cueLines.length === 0) throw new Error(`SBV cue has no text at ${timeLine}`);
    const startMs = parseSbvTimeCode(start);
    const endMs = parseSbvTimeCode(end);
    if (endMs < startMs) throw new Error(`SBV cue ends before it starts: ${timeLine}`);

    cues.push({ startMs, endMs, lines: cueLines });
  }

  if (cues.length === 0) throw new Error('No SBV subtitles parsed');
  return { cues };
}

/**
 * Writes SbvSubtitles to the StarMade binary representation.
 *
 * @param file - Input value for the writeSbvSubtitles operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writeSbvSubtitles(file: SbvSubtitleFile): string {
  if (file.cues.length === 0) throw new Error('Cannot write an empty SBV subtitle file');

  return file.cues.map(cue => {
    if (cue.lines.length === 0) throw new Error('Cannot write an SBV cue without text');
    if (cue.endMs < cue.startMs) throw new Error('Cannot write an SBV cue ending before it starts');

    const timing = `${formatSbvTimeCode(cue.startMs)},${formatSbvTimeCode(cue.endMs)}`;
    return [timing, ...cue.lines].join('\n');
  }).join('\n\n') + '\n';
}
