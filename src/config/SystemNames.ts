/**
 * @fileoverview StarMade systemNames.syl parser
 *
 * The file is a compact text resource consumed by NameGenerator. Each non-empty
 * line contains a syllable token followed by optional flags such as "+c".
 * This parser keeps the data editable without attempting to reproduce the name
 * generation algorithm.
 */

/**
 * One syllable entry and its optional generation flags from systemNames.syl.
 */
export interface SystemNameSyllable {
  value: string;
  flags: string[];
}

/**
 * Describes the SystemNamesFile data shape used by StarMade configuration loading, editing, and metadata enrichment.
 */
export interface SystemNamesFile {
  syllables: SystemNameSyllable[];
}

/**
 * Parses SystemNames for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param data - Input value for the parseSystemNames operation.
 * @returns The computed StarMade-Decoder value.
 */
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

/**
 * Writes SystemNames to the StarMade binary representation.
 *
 * @param file - Input value for the writeSystemNames operation.
 * @param newline - Input value for the writeSystemNames operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writeSystemNames(file: SystemNamesFile, newline = '\n'): Buffer {
  const lines = file.syllables.map(syllable =>
    [syllable.value, ...syllable.flags].join(' ')
  );
  return Buffer.from(lines.length > 0 ? `${lines.join(newline)}${newline}` : '', 'utf8');
}
