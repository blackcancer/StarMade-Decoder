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
import { SimulationGroup as SimulationGroupObject, SimulationState } from '../objects/Simulation.js';
import type { SimFile } from './SimParser.js';

/**
 * Encodes a .sim file back to binary.
 * Prefers the high-level SimulationState / SimGroup data and keeps rootTag only
 * as a lossless fallback for unknown or untouched payloads.
 */
export function writeSim(file: SimFile): Buffer {
  if (file.simulation) {
    return writeTo(file.simulation.toTag());
  }

  if (file.groups.length > 0 || file.lastUpdate !== undefined) {
    const groups = file.groups.map(group => new SimulationGroupObject(
      group.version,
      group.type,
      [...group.members],
      group.startTime,
      group.startSector,
      group.programId,
    ));
    return writeTo(new SimulationState(file.version, groups, file.lastUpdate ?? 0n).toTag());
  }

  return writeTo(file.rootTag);
}
