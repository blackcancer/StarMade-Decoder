/**
 * @fileoverview Structured binary-format errors and bounded parsing utilities.
 *
 * Errors retain their original cause and the source path/byte offset when known.
 * Recovery is explicit: callers must inspect diagnostics before using partial data.
 *
 * @author InitSysRev
 * @version 1.5.0
 */

/** Stable error categories for callers; message text is diagnostic only. */
export type DecodeErrorCode = 'E_FORMAT' | 'E_TRUNCATED' | 'E_RANGE' | 'E_LIMIT' |
  'E_UNSUPPORTED' | 'E_INCOMPLETE' | 'E_IO';

/** Location of a rejected or skipped binary record. */
export interface DecodeDiagnostic {
  code: DecodeErrorCode;
  message: string;
  offset?: number;
  path?: string;
}

/** A deterministic format failure, optionally carrying an underlying I/O error. */
export class DecodeError extends Error implements DecodeDiagnostic {
  readonly code: DecodeErrorCode;
  readonly offset?: number;
  readonly path?: string;

  /**
   * Creates a structured decoder error.
   * @param code - Stable error category.
   * @param message - Human-readable description.
   * @param details - Optional source location and original cause.
   */
  constructor(code: DecodeErrorCode, message: string,
    details: { offset?: number; path?: string; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = 'DecodeError';
    this.code = code;
    this.offset = details.offset;
    this.path = details.path;
  }
}

/**
 * Validates a non-negative safe integer without silently clamping it.
 * @param value - Integer to validate.
 * @param label - Field name in the diagnostic.
 * @param maximum - Largest allowed value.
 * @returns The unchanged integer.
 * @throws {DecodeError} If the value is invalid or outside the range.
 */
export function boundedInteger(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new DecodeError('E_RANGE', `${label} must be an integer in [0, ${maximum}], got ${value}`);
  }
  return value;
}

/**
 * Applies strict/recovery policy to one failed record.
 * @param error - Original error.
 * @param mode - Strict throws; recover appends an explicit diagnostic.
 * @param diagnostics - Destination for recovery diagnostics.
 * @param location - Source path and byte offset when known.
 * @throws {DecodeError} In strict mode. Resource limits always abort parsing.
 */
export function reportDecodeFailure(error: unknown, mode: 'strict' | 'recover',
  diagnostics: DecodeDiagnostic[], location: { path?: string; offset?: number } = {}): void {
  const decoded = error instanceof DecodeError
    ? new DecodeError(error.code, error.message, {
        ...location, offset: error.offset ?? location.offset, path: error.path ?? location.path, cause: error,
      })
    : new DecodeError('E_FORMAT', error instanceof Error ? error.message : String(error), { ...location, cause: error });
  if (mode === 'strict' || decoded.code === 'E_LIMIT') throw decoded;
  diagnostics.push({ code: decoded.code, message: decoded.message, offset: decoded.offset, path: decoded.path });
}
