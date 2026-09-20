/** @fileoverview Validated segment access, streaming occupied cells and explicit live editing. */
import { DecodeError, boundedInteger } from '../core/DecodeError.js';
import type { BlockConfig } from '../config/BlockConfig.js';
import type { BlockPosition } from '../objects/ElementPosition.js';
import { BLOCK_COUNT, posToIndex, indexToPos } from './Smd3Parser.js';
import type { BlockData, SegmentData } from './Smd3Parser.js';
import { emptySegment, encodeBlockWord } from './Smd3Writer.js';
import { BlockState } from './BlockState.js';
import { PlacedBlock } from './PlacedBlock.js';
import { validateBlockPosition } from './BlockCoordinates.js';

/** Segment model; fromData copies, while attach explicitly edits an existing decoder model. */
export class Segment {
  private data: SegmentData;
  private count: number;
  /** Creates an independent empty segment at an aligned entity-grid origin. */
  constructor(origin: BlockPosition = { x: 0, y: 0, z: 0 }) {
    Segment.checkOrigin(origin);
    this.data = emptySegment(origin.x, origin.y, origin.z);
    this.count = 0;
  }
  /** Copies input blocks; changes never mutate the caller's original segment. */
  static fromData(data: SegmentData): Segment {
    return Segment.attach({ ...data, blocks: data.blocks.map(block => ({ ...block })) });
  }
  /** Creates a live editor; recreate it after raw edits or edits through another view of the same data. */
  static attach(data: SegmentData): Segment {
    Segment.checkOrigin(data);
    boundedInteger(data.version, 'segment version', 255);
    Segment.checkTimestamp(data.lastChanged);
    if (data.blocks.length !== BLOCK_COUNT) throw new DecodeError('E_RANGE', 'Segment requires exactly 32768 blocks');
    let count = 0;
    for (const block of data.blocks) { encodeBlockWord(block); count += Number(block.type !== 0); }
    const result = Object.create(Segment.prototype) as Segment;
    result.data = data;
    result.count = count;
    return result;
  }
  /** Origin x in entity-grid coordinates. */
  get x(): number { return this.data.x; }
  /** Origin y in entity-grid coordinates. */
  get y(): number { return this.data.y; }
  /** Origin z in entity-grid coordinates. */
  get z(): number { return this.data.z; }
  /** Content-derived non-air count, maintained by this editor; external edits require a new view. */
  get blockCount(): number { return this.count; }
  /** Source segment version; writers control format migration. */
  get version(): number { return this.data.version; }
  /** Exact signed 64-bit timestamp. */
  get lastChanged(): bigint { return this.data.lastChanged; }
  /** Sets an explicit edit timestamp; reading and editing cells never changes time implicitly. */
  setTimestamp(timestamp: bigint): this { Segment.checkTimestamp(timestamp); this.data.lastChanged = timestamp; return this; }
  /** Reads an immutable cell snapshot using local coordinates. */
  get(x: number, y: number, z: number): BlockState { return new BlockState(this.data.blocks[posToIndex(x, y, z)]); }
  /** Copies a complete block into a local cell and updates the derived count. */
  set(x: number, y: number, z: number, block: BlockData): this {
    const index = posToIndex(x, y, z), state = new BlockState(block);
    this.count += Number(state.type !== 0) - Number(this.data.blocks[index].type !== 0);
    this.data.blocks[index] = state.toJSON();
    this.data.blockCount = this.count;
    return this;
  }
  /** Streams occupied cells by default; catalogue resolution is explicit and instance-scoped. */
  *entries(config?: Pick<BlockConfig, 'getById'>, includeAir = false): IterableIterator<PlacedBlock> {
    for (let index = 0; index < BLOCK_COUNT; index++) {
      const block = this.data.blocks[index];
      if (!includeAir && block.type === 0) continue;
      const local = indexToPos(index);
      yield new PlacedBlock({ x: this.x + local.x, y: this.y + local.y, z: this.z + local.z },
        new BlockState(block), config?.getById(block.type));
    }
  }
  /** Detached packed words suitable for typed-array consumers and worker transfers. */
  toPackedWords(): Uint32Array { return Uint32Array.from(this.data.blocks, encodeBlockWord); }
  /** Detached plain decoder/renderer model, including a refreshed block count. */
  toData(): SegmentData { return { ...this.data, blockCount: this.blockCount, blocks: this.data.blocks.map(block => ({ ...block })) }; }
  /** JSON-safe packed cell data; timestamps remain exact decimal strings. */
  toJSON(): { x: number; y: number; z: number; version: number; lastChanged: string; words: number[] } {
    return { x: this.x, y: this.y, z: this.z, version: this.version, lastChanged: this.lastChanged.toString(), words: [...this.toPackedWords()] };
  }
  /** Validates aligned origins independently from serialization. */
  private static checkOrigin(origin: BlockPosition): void {
    validateBlockPosition(origin);
    if (origin.x % 32 || origin.y % 32 || origin.z % 32) throw new DecodeError('E_RANGE', 'Segment origin must be aligned to 32');
  }
  /** Validates a real bigint, avoiding coercion and truncation. */
  private static checkTimestamp(timestamp: bigint): void {
    if (typeof timestamp !== 'bigint' || timestamp < -0x8000000000000000n || timestamp > 0x7fffffffffffffffn) {
      throw new DecodeError('E_RANGE', 'Segment timestamp must be a signed int64 bigint');
    }
  }
}
