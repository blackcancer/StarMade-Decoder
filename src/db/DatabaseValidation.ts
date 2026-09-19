/** @fileoverview Strict size and trailing-padding validation shared by database wire codecs. */
import { BufferReader } from '../core/BufferReader.js';
import { DecodeError } from '../core/DecodeError.js';

/** Conservative hard bound on one database cell and any inflated payload. */
export const MAX_DATABASE_BYTES = 16 * 1024 * 1024;

/**
 * Runs a bounded database decoder and attaches column/offset context to failures.
 * @param data Nonempty cell bytes.
 * @param column Stable database column name.
 * @param operation Complete decoding operation.
 * @returns The decoded value; malformed data never becomes an empty fallback.
 */
export function readDatabase<T>(data: Buffer | Uint8Array, column: string, operation: (reader: BufferReader) => T): T {
  if (data.length > MAX_DATABASE_BYTES) throw new DecodeError('E_LIMIT', 'Database input byte budget exceeded', { path: column, offset: 0 });
  const reader = BufferReader.from(data);
  try { return operation(reader); }
  catch (cause) {
    throw new DecodeError(cause instanceof DecodeError ? cause.code : 'E_FORMAT', String(cause), { path: column, offset: reader.offset, cause });
  }
}

/**
 * Accepts only zero padding after a complete database value.
 * @param reader Reader positioned at the end of the actual payload.
 */
export function readZeroPadding(reader: BufferReader): void {
  while (!reader.isEOF()) {
    if (reader.readUInt8() !== 0) throw new DecodeError('E_FORMAT', 'Nonzero database padding');
  }
}
