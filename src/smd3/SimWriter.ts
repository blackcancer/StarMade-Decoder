/** @fileoverview Strict simulation writer retaining the source envelope and all unedited metadata. */
import type { TagReadOptions } from '../core/TagParser.js';
import { readTagDocument } from '../core/TagParser.js';
import { simulationFromFields, type SimFile } from './SimParser.js';

/**
 * Writes a parsed DTO or explicit immutable simulation snapshot; bare DTOs use their semantic fields.
 * Parsed DTO edits and its live simulation accessor share one state, so nested edits are never ignored.
 * An optional explicit output budget validates the entire result, including the original envelope.
 */
export function writeSim(file: SimFile, options?: TagReadOptions): Buffer {
  const state = file.simulation ?? simulationFromFields(file, undefined, options);
  const result = state.toBuffer();
  return options ? readTagDocument(result, options).toBuffer() : result;
}
