/**
 * @fileoverview SimWriter
 *
 * Encoder for .sim files (simulation state).
 * A .sim is a standard binary Tag file — writeTo() is sufficient.
 *
 * Java source: SimulationManager.toTagStructure()
 *
 * @author InitSysRev
 * @version 1.1.0
 */

import { writeTo } from '../core/TagParser.js';
import type { SimFile } from './SimParser.js';

/**
 * Encodes a .sim file back to binary.
 * Uses the raw rootTag preserved during parsing.
 * For mutated sim files, rebuild rootTag via the SimulationState business object
 * (src/objects/Simulation.ts) before calling this.
 */
export function writeSim(file: SimFile): Buffer {
  return writeTo(file.rootTag);
}
