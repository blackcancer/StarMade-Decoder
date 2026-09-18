/**
 * @fileoverview
 * Bounded raw LZ4 block codec for StarMade RemoteSegment version 7.
 * This is a raw block, not an LZ4 frame or a zlib stream. The decoded size
 * is supplied by the segment format. No external runtime dependency is used.
 *
 * @author InitSysRev
 * @version 1.5.0
 */

/** Decoded bytes and the number of compressed bytes consumed. */
export interface Lz4BlockResult { data: Buffer; bytesRead: number; }

/**
 * Decodes a raw LZ4 block into an exactly sized, bounded output buffer.
 * @param input Compressed block, optionally followed by sector padding.
 * @param outputLength Required decoded byte count (at most 128 KiB).
 * @returns Output and compressed bytes consumed.
 * @throws {RangeError} On invalid lengths, truncated sequences or bad offsets.
 */
export function decodeLz4Block(input: Buffer, outputLength: number): Lz4BlockResult {
  if (!Number.isSafeInteger(outputLength) || outputLength < 1 || outputLength > 131072) {
    throw new RangeError(`Invalid LZ4 output length: ${outputLength}`);
  }
  const output = Buffer.alloc(outputLength);
  let source = 0;
  let target = 0;
  /** @returns The next input byte. @throws {RangeError} At the input boundary. */
  const byte = (): number => {
    if (source >= input.length) throw new RangeError('Truncated LZ4 block');
    return input[source++];
  };
  /** @param initial Token length. @returns Extended length, bounded by output. */
  const length = (initial: number): number => {
    let result = initial;
    if (initial === 15) {
      let extension: number;
      do {
        extension = byte();
        result += extension;
        if (result > outputLength) throw new RangeError('LZ4 length exceeds output');
      } while (extension === 255);
    }
    return result;
  };
  while (target < outputLength) {
    const token = byte();
    const literals = length(token >>> 4);
    if (literals > input.length - source || literals > outputLength - target) {
      throw new RangeError('LZ4 literal range exceeds input or output');
    }
    input.copy(output, target, source, source + literals);
    source += literals;
    target += literals;
    if (target === outputLength) {
      if ((token & 15) !== 0) throw new RangeError('Invalid terminal LZ4 token');
      return { data: output, bytesRead: source };
    }
    const distance = byte() | (byte() << 8);
    if (distance === 0 || distance > target) throw new RangeError('Invalid LZ4 match distance');
    const matchLength = length(token & 15) + 4;
    if (matchLength > outputLength - target) throw new RangeError('LZ4 match exceeds output');
    // Forward copying is required for overlapping matches (including distance=1).
    for (let n = 0; n < matchLength; n++) {
      output[target] = output[target - distance];
      target++;
    }
    if (target === outputLength) throw new RangeError('LZ4 block must end with literals');
  }
  throw new RangeError('Invalid LZ4 block');
}

/**
 * Encodes one raw LZ4 block using a deterministic bounded hash-table matcher.
 * @param input Nonempty input of at most 128 KiB.
 * @returns A raw LZ4 block interoperable with LZ4 fast/safe decoders.
 * @throws {RangeError} For an invalid input length.
 * @remarks Keeps five final literals and starts the last match at least
 * twelve bytes before the end, as required by the LZ4 block specification.
 */
export function encodeLz4Block(input: Buffer): Buffer {
  if (input.length < 1 || input.length > 131072) throw new RangeError('Invalid LZ4 input length');
  const output = Buffer.alloc(input.length + Math.ceil(input.length / 255) + 32);
  const table = new Int32Array(65536).fill(-1);
  let out = 0;
  let anchor = 0;
  let position = 0;
  /** @param value Remaining length. Emits extension bytes including the final zero. */
  const extension = (value: number): void => {
    while (value >= 255) { output[out++] = 255; value -= 255; }
    output[out++] = value;
  };
  /** @param index Input offset. @returns Four-byte sequence hash. */
  const hash = (index: number): number => (Math.imul(input.readUInt32LE(index), 0x9e3779b1) >>> 16);
  while (position <= input.length - 12) {
    const key = hash(position);
    const previous = table[key];
    table[key] = position;
    if (previous < 0 || position - previous > 65535 ||
        input.readUInt32LE(previous) !== input.readUInt32LE(position)) {
      position++;
      continue;
    }
    let matchLength = 4;
    while (position + matchLength < input.length - 5 &&
           input[previous + matchLength] === input[position + matchLength]) matchLength++;
    const literals = position - anchor;
    const matchCode = matchLength - 4;
    output[out++] = (Math.min(15, literals) << 4) | Math.min(15, matchCode);
    if (literals >= 15) extension(literals - 15);
    input.copy(output, out, anchor, position);
    out += literals;
    output.writeUInt16LE(position - previous, out);
    out += 2;
    if (matchCode >= 15) extension(matchCode - 15);
    position += matchLength;
    anchor = position;
  }
  const literals = input.length - anchor;
  output[out++] = Math.min(15, literals) << 4;
  if (literals >= 15) extension(literals - 15);
  input.copy(output, out, anchor);
  out += literals;
  return Buffer.from(output.subarray(0, out));
}
