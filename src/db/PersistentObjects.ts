/**
 * @fileoverview StarLoader persistent object file parser
 *
 * Handles moddata/<mod>/persistent/<context>.smdat. The format is documented
 * by PersistentObjectUtil.java as repeated class-name blocks followed by JSON
 * object lines and terminated by "_end_".
 */

/**
 * One persistent-object class block and the JSON objects recorded for it.
 */
export interface PersistentObjectEntry {
  className: string;
  objects: unknown[];
}

/**
 * Describes the PersistentObjectFile data shape used by StarMade database object parsing.
 */
export interface PersistentObjectFile {
  entries: PersistentObjectEntry[];
}

/**
 * Parses PersistentObjects for StarMade database object parsing.
 *
 * @param data - Input value for the parsePersistentObjects operation.
 * @returns The computed StarMade-Decoder value.
 */
export function parsePersistentObjects(data: Buffer | Uint8Array | string): PersistentObjectFile {
  const text = typeof data === 'string'
    ? data
    : Buffer.from(data).toString('utf8');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  const entries: PersistentObjectEntry[] = [];

  for (let i = 0; i < lines.length;) {
    const className = lines[i++];
    const objects: unknown[] = [];

    while (i < lines.length && lines[i] !== '_end_') {
      objects.push(JSON.parse(lines[i++]));
    }

    if (i >= lines.length || lines[i] !== '_end_') {
      throw new Error(`Unterminated persistent object block for ${className}`);
    }
    i++;
    entries.push({ className, objects });
  }

  return { entries };
}

/**
 * Writes PersistentObjects to the StarMade binary representation.
 *
 * @param file - Input value for the writePersistentObjects operation.
 * @returns The computed StarMade-Decoder value.
 */
export function writePersistentObjects(file: PersistentObjectFile): Buffer {
  const lines: string[] = [];
  for (const entry of file.entries) {
    lines.push(entry.className);
    for (const object of entry.objects) {
      lines.push(JSON.stringify(object));
    }
    lines.push('_end_');
  }
  return Buffer.from(lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}
