/** @fileoverview Strict simulation DTOs backed by the immutable, envelope-preserving domain model. */
import type { Tag } from '../core/Tag.js';
import type { TagReadOptions } from '../core/TagParser.js';
import type { Vector3i } from '../types/Vectors.js';
import { DecodeError } from '../core/DecodeError.js';
import { tagModelOptions } from '../core/TagModel.js';
import { SimulationGroup, SimulationState } from '../objects/Simulation.js';

/** Editable group projection; raw preserves source-only fields when semantic fields are changed. */
export interface SimGroup {
  version: number; type: number; members: string[]; startTime: bigint;
  startSector: Vector3i; programId: number;
  metadata?: Tag;
  /** Original group tree, including metadata and extensions. */
  raw?: Tag;
}

/** Simulation projection; parsed DTO fields and the simulation accessor always describe one state. */
export interface SimFile {
  version: number; groups: SimGroup[];
  uniqueGroups?: bigint;
  /** @deprecated Alias for uniqueGroups, the group-ID generator; not a timestamp. */
  lastUpdate?: bigint;
  /** Parsed files expose a live immutable snapshot of current DTO edits; assigning a model resets that projection. */
  simulation?: SimulationState | null;
  /** Detached source-preserving tree; use typed fields or simulation.with(...) to edit parsed files. */
  rootTag?: Tag;
}

/** Takes a detached DTO snapshot of every modeled group field, including raw extensions. */
function project(group: SimulationGroup): SimGroup {
  return { version: group.version, type: group.type, members: group.members, startTime: group.startTime,
    startSector: group.startSector, programId: group.programId, metadata: group.metadata, raw: group.toTag() };
}

/** Builds a strict domain state from DTO edits, preserving raw group fields and an optional source envelope. */
export function simulationFromFields(file: SimFile, source?: SimulationState, options: TagReadOptions = {}): SimulationState {
  if (file.uniqueGroups !== undefined && file.lastUpdate !== undefined && file.uniqueGroups !== file.lastUpdate) {
    throw new DecodeError('E_FORMAT', 'Conflicting uniqueGroups and legacy lastUpdate values');
  }
  const groups = file.groups.map(group => {
    const original = group.raw ? SimulationGroup.fromTag(group.raw, options)
      : new SimulationGroup(group.version, group.type, group.members, group.startTime, group.startSector, group.programId, group.metadata, options);
    return original.with({ version: group.version, type: group.type, members: group.members, startTime: group.startTime,
      startSector: group.startSector, programId: group.programId, metadata: group.metadata ?? original.metadata });
  });
  const baseline = source ?? (file.rootTag ? SimulationState.fromTag(file.rootTag, options) : new SimulationState(0, [], 0n, options));
  return baseline.with({ version: file.version, groups, uniqueGroups: file.uniqueGroups ?? file.lastUpdate ?? 0n });
}

/** Parses strictly with caller-selected limits, retaining compression/version/trailing bytes and detached DTO data. */
export function parseSim(data: Buffer | Uint8Array, options: TagReadOptions = {}): SimFile {
  let source = SimulationState.fromBuffer(data, options);
  const local = tagModelOptions(options);
  const result: SimFile = { version: source.version, groups: source.groups.map(project), uniqueGroups: source.uniqueGroups };
  Object.defineProperties(result, {
    lastUpdate: { enumerable: true, get: () => result.uniqueGroups, set: (value: bigint) => { result.uniqueGroups = value; } },
    simulation: {
      enumerable: true,
      get: () => simulationFromFields(result, source, local),
      set: (value: SimulationState) => {
        if (!(value instanceof SimulationState)) throw new DecodeError('E_FORMAT', 'Simulation snapshot must be a SimulationState');
        source = value; result.version = value.version; result.groups = value.groups.map(project); result.uniqueGroups = value.uniqueGroups;
      },
    },
    rootTag: { enumerable: true, get: () => simulationFromFields(result, source, local).toTag() },
  });
  return result;
}
