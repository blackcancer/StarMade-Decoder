/** @fileoverview Live sparse entity grids, region allocation and structured block iteration. */
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import type { BlockConfig } from '../config/BlockConfig.js';
import type { BlockPosition } from '../objects/ElementPosition.js';
import type { BlockData, Smd3File } from './Smd3Parser.js';
import { emptySegment, emptySmd3File } from './Smd3Writer.js';
import { BlockState } from './BlockState.js';
import { Segment } from './Segment.js';
import { PlacedBlock } from './PlacedBlock.js';
import { blockPositionKey, localPositionOf, regionCoordinatesOf, segmentOriginOf } from './BlockCoordinates.js';

/** Policies for one live grid; empty region coordinates can come from original filenames. */
export interface BlockVolumeOptions {
  config?: Pick<BlockConfig, 'getById'>;
  maxSegments?: number;
  regionCoordinates?: ReadonlyMap<Smd3File, BlockPosition>;
}

/** Live editor of an entity's region array; use fromFiles for detached ownership. */
export class BlockVolume {
  private cells = new Map<string, Segment>();
  private regions = new Map<string, Smd3File>();
  private readonly config?: Pick<BlockConfig, 'getById'>;
  private readonly maximum: number;
  private readonly regionHints: ReadonlyMap<Smd3File, BlockPosition>;

  /** Binds existing regions; call refresh after raw edits or edits through another live view. */
  constructor(private readonly files: Smd3File[] = [], options: BlockVolumeOptions = {}) {
    this.config = options.config;
    this.maximum = boundedInteger(options.maxSegments ?? 512, 'maxSegments');
    this.regionHints = new Map([...options.regionCoordinates ?? []].map(([file, position]) => [file, { ...position }]));
    this.refresh();
  }

  /** Creates an independent mutable grid; edits never affect the supplied files. */
  static fromFiles(files: readonly Smd3File[], options: Omit<BlockVolumeOptions, 'regionCoordinates'> = {}): BlockVolume {
    return new BlockVolume(structuredClone([...files]), options);
  }

  /** Atomically validates/rebuilds the spatial index; failed refresh leaves the previous index intact. */
  refresh(): this {
    const cells = new Map<string, Segment>(), regions = new Map<string, Smd3File>();
    for (const file of this.files) {
      if (file.complete === false || file.diagnostics?.length) throw new DecodeError('E_INCOMPLETE', 'Block grids require complete regions');
      // Plain Smd3File has no filename. Unlocated empty files use the canonical
      // origin region; document-provided hints retain original named regions.
      let region: string | undefined = file.segments.length ? undefined : '0,0,0';
      const hint = this.regionHints.get(file);
      if (hint) {
        for (const coordinate of [hint.x, hint.y, hint.z]) {
          if (!Number.isInteger(coordinate) || coordinate < -4194304 || coordinate > 4194304) {
            throw new DecodeError('E_RANGE', 'Invalid SMD3 region coordinates');
          }
        }
        region = blockPositionKey(hint);
      }
      for (const raw of file.segments) {
        if (cells.size >= this.maximum) throw new DecodeError('E_LIMIT', 'Block grid segment budget exceeded');
        const segment = Segment.attach(raw), key = blockPositionKey(segment);
        if (cells.has(key)) throw new DecodeError('E_FORMAT', 'Duplicate segment origin');
        const nextRegion = blockPositionKey(regionCoordinatesOf(segment));
        if (region !== undefined && region !== nextRegion) throw new DecodeError('E_FORMAT', 'Segments do not match their region');
        region = nextRegion;
        cells.set(key, segment);
      }
      if (region !== undefined) {
        if (regions.has(region)) throw new DecodeError('E_FORMAT', 'Ambiguous duplicate region');
        regions.set(region, file);
      }
    }
    this.cells = cells; this.regions = regions;
    return this;
  }

  /** Current allocated segment views; the returned array itself is detached. */
  get segments(): readonly Segment[] { return [...this.cells.values()]; }
  /** Number of allocated 32-cube segments, including empty allocations. */
  get segmentCount(): number { return this.cells.size; }
  /** Live non-air count derived from current cells. */
  get blockCount(): number { return this.segments.reduce((sum, segment) => sum + segment.blockCount, 0); }
  /** Finds the allocated segment containing a validated entity-grid position. */
  segmentAt(position: BlockPosition): Segment | undefined { return this.cells.get(blockPositionKey(segmentOriginOf(position))); }
  /** Reads a detached cell value; unallocated positions are canonical air. */
  get(position: BlockPosition): BlockState {
    const segment = this.segmentAt(position), local = localPositionOf(position);
    return segment ? segment.get(local.x, local.y, local.z) : BlockState.create(0);
  }
  /** Resolves a positioned snapshot and optional block catalogue entry. */
  blockAt(position: BlockPosition): PlacedBlock {
    const state = this.get(position);
    return new PlacedBlock(position, state, this.config?.getById(state.type));
  }
  /** Sets a complete value, allocating the correct shifted SMD3 region when necessary. */
  set(position: BlockPosition, value: BlockData): this {
    const origin = segmentOriginOf(position), local = localPositionOf(position), state = new BlockState(value);
    let segment = this.cells.get(blockPositionKey(origin));
    if (!segment) {
      if (state.toWord() === 0) return this;
      if (this.cells.size >= this.maximum) throw new DecodeError('E_LIMIT', 'Block grid segment budget exceeded');
      const region = blockPositionKey(regionCoordinatesOf(origin));
      let file = this.regions.get(region);
      if (!file) { file = emptySmd3File(); this.files.push(file); this.regions.set(region, file); }
      const raw = emptySegment(origin.x, origin.y, origin.z);
      segment = Segment.attach(raw);
      file.segments.push(raw); file.usedSlots = file.segments.length;
      this.cells.set(blockPositionKey(origin), segment);
    }
    if (segment.version !== 6 && segment.version !== 7) throw new DecodeError('E_UNSUPPORTED', 'Editing requires segment version 6 or 7');
    segment.set(local.x, local.y, local.z, state);
    return this;
  }
  /** Erases a cell while retaining original segment allocations and timestamps. */
  remove(position: BlockPosition): this { return this.set(position, BlockState.create(0)); }
  /** Streams occupied positional snapshots without allocating one model per air cell. */
  *entries(includeAir = false): IterableIterator<PlacedBlock> {
    for (const segment of this.cells.values()) yield* segment.entries(this.config, includeAir);
  }
  /** Counts each non-air type from content, independently of stale header statistics. */
  countsByType(): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const block of this.entries()) counts.set(block.state.type, (counts.get(block.state.type) ?? 0) + 1);
    return counts;
  }
  /** Detached region snapshots for existing writers; original physical layouts belong to the document. */
  toFiles(): Smd3File[] {
    return this.files.map(file => ({ ...structuredClone(file), usedSlots: file.segments.length,
      segments: file.segments.map(segment => Segment.attach(segment).toData()) }));
  }
}
