/**
 * @fileoverview Bounded raw LZ4 block codec for StarMade v7 segments.
 *
 * Implements raw blocks, not LZ4 frames. The decoder knows the exact output
 * length, matching LZ4FastDecompressor in SegmentSerializationBuffers.java.
 * Encoder output leaves at least five trailing literals and starts its final
 * match at least twelve bytes before the end, as required by the block format.
 * No input-dependent unbounded allocations or external native addon is used.
 *
 * @author InitSysRev
 * @version 1.5.0
 */
import { DecodeError, boundedInteger } from '../core/DecodeError.js';

/**
 * Decodes one raw LZ4 block to an exact, prevalidated output size.
 * @param input - Complete compressed block, with no frame header or padding.
 * @param expectedSize - Exact output size, at most 131,072 bytes.
 * @returns A new decompressed buffer.
 * @throws {DecodeError} For invalid lengths, offsets, truncation or trailing data.
 */
export function decodeLz4Block(input: Buffer, expectedSize: number): Buffer {
  boundedInteger(expectedSize, 'LZ4 output size', 131072);
  const out = Buffer.alloc(expectedSize);
  let ip = 0, op = 0;
  const length = (initial: number): number => {
    let value = initial;
    if (initial === 15) {
      let part: number;
      do {
        if (ip >= input.length) throw new DecodeError('E_TRUNCATED', 'Truncated LZ4 length');
        part = input[ip++]; value += part;
        if (value > expectedSize) throw new DecodeError('E_FORMAT', 'LZ4 length exceeds output bounds');
      } while (part === 255);
    }
    return value;
  };
  while (ip < input.length) {
    const token = input[ip++];
    const literalLength = length(token >>> 4);
    if (ip + literalLength > input.length || op + literalLength > expectedSize) {
      throw new DecodeError('E_TRUNCATED', 'Invalid LZ4 literal length');
    }
    input.copy(out, op, ip, ip + literalLength);
    ip += literalLength; op += literalLength;
    if (ip === input.length) {
      if (op !== expectedSize) throw new DecodeError('E_FORMAT', `LZ4 output length ${op}, expected ${expectedSize}`);
      return out;
    }
    if (ip + 2 > input.length || op === expectedSize) throw new DecodeError('E_FORMAT', 'Trailing or truncated LZ4 match');
    const offset = input.readUInt16LE(ip); ip += 2;
    if (offset === 0 || offset > op) throw new DecodeError('E_FORMAT', 'Invalid LZ4 match offset');
    const matchLength = length(token & 15) + 4;
    if (op + matchLength > expectedSize) throw new DecodeError('E_FORMAT', 'LZ4 match exceeds output bounds');
    // Forward copying is essential for overlapping LZ4 matches.
    for (let j = 0; j < matchLength; j++) out[op + j] = out[op + j - offset];
    op += matchLength;
  }
  throw new DecodeError('E_TRUNCATED', 'Missing final LZ4 literal sequence');
}

/**
 * Compresses a segment-sized buffer into a portable raw LZ4 block.
 * @param input - Uncompressed block data, at most 131,072 bytes.
 * @returns A new compressed block. Compression may increase size.
 * @throws {DecodeError} If the input exceeds the codec's fixed budget.
 * @remarks The enclosing SMD3 writer must enforce its separate sector capacity.
 */
export function encodeLz4Block(input: Buffer): Buffer {
  boundedInteger(input.length, 'LZ4 input size', 131072);
  const output = Buffer.alloc(input.length + Math.ceil(input.length / 255) + 32);
  const table = new Int32Array(65536).fill(-1);
  let op = 0, position = 0, anchor = 0;
  const extraLength = (length: number): void => {
    while (length >= 255) { output[op++] = 255; length -= 255; }
    output[op++] = length;
  };
  const hash = (position: number): number => (Math.imul(input.readUInt32LE(position), 0x9e3779b1) >>> 16);
  while (position <= input.length - 12) {
    const key = hash(position);
    const reference = table[key];
    table[key] = position;
    if (reference < 0 || position - reference > 65535 || input.readUInt32LE(reference) !== input.readUInt32LE(position)) {
      position++; continue;
    }
    let end = position + 4;
    while (end < input.length - 5 && input[end] === input[reference + end - position]) end++;
    const literals = position - anchor;
    const match = end - position - 4;
    output[op++] = (Math.min(literals, 15) << 4) | Math.min(match, 15);
    if (literals >= 15) extraLength(literals - 15);
    input.copy(output, op, anchor, position); op += literals;
    output.writeUInt16LE(position - reference, op); op += 2;
    if (match >= 15) extraLength(match - 15);
    position = end; anchor = end;
    if (position >= 2 && position <= input.length - 4) table[hash(position - 2)] = position - 2;
  }
  const remaining = input.length - anchor;
  output[op++] = Math.min(remaining, 15) << 4;
  if (remaining >= 15) extraLength(remaining - 15);
  input.copy(output, op, anchor); op += remaining;
  return Buffer.from(output.subarray(0, op));
}
