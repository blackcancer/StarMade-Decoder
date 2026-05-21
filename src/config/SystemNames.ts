/**
 * @fileoverview StarMade systemNames.syl parser
 *
 * The file is a compact text resource consumed by NameGenerator. Each non-empty
 * line contains a syllable token followed by optional flags such as "+c".
 * This parser keeps the data editable without attempting to reproduce the name
 * generation algorithm.
 */

export interface SystemNameSyllable {
  value: string;
  flags: string[];
}

export interface SystemNamesFile {
  syllables: SystemNameSyllable[];
}

export function parseSystemNames(data: Buffer | Uint8Array | string): SystemNamesFile {
  const text = typeof data === 'string'
    ? data
    : Buffer.from(data).toString('utf8');
  const syllables = text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => {
      const [value, ...flags] = line.split(/\s+/);
      return { value, flags };
    });
  return { syllables };
}

export function writeSystemNames(file: SystemNamesFile, newline = '\n'): Buffer {
  const lines = file.syllables.map(syllable =>
    [syllable.value, ...syllable.flags].join(' ')
  );
  return Buffer.from(lines.length > 0 ? `${lines.join(newline)}${newline}` : '', 'utf8');
}
