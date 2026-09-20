/** @fileoverview Immutable, complete 32-bit block values and definition-aware hitpoints. */
import { boundedInteger, DecodeError } from '../core/DecodeError.js';
import type { BlockDefinition } from '../config/BlockConfig.js';
import type { BlockData } from './Smd3Parser.js';
import { encodeBlockWord } from './Smd3Writer.js';

/** Immutable block value; hp and active retain the raw storage semantics. */
export class BlockState implements Readonly<BlockData> {
  private readonly word: number;

  /** Copies and validates every persisted field, including reserved bits. */
  constructor(data: BlockData) {
    this.word = encodeBlockWord(data);
    Object.freeze(this);
  }

  /** Constructs a block with full health; callers choose game-specific activation policies. */
  static create(type: number, fields: Partial<Omit<BlockData, 'type'>> = {}): BlockState {
    return new BlockState({ hp: type === 0 ? 0 : 127, active: false, orientation: 0, ...fields, type });
  }

  /** Decodes an unsigned storage word without dropping any reserved bits. */
  static fromWord(word: number): BlockState {
    boundedInteger(word, 'block word', 0xffffffff);
    return new BlockState({ type: word & 8191, hp: (word >>> 13) & 127,
      active: !!(word & 0x100000), orientation: (word >>> 21) & 31, extra: word >>> 26 });
  }

  /** Block type; zero represents air. */
  get type(): number { return this.word & 8191; }
  /** Stored health fraction in [0,127], not the definition's full hitpoints. */
  get hp(): number { return (this.word >>> 13) & 127; }
  /** Raw activation bit, without interpreting doors or other block-specific behavior. */
  get active(): boolean { return !!(this.word & 0x100000); }
  /** Complete five-bit orientation, without substituting a renderer's rotation convention. */
  get orientation(): number { return (this.word >>> 21) & 31; }
  /** All six reserved storage bits. */
  get extra(): number { return this.word >>> 26; }
  /** Whether the type denotes air; other raw fields may still be nonzero. */
  get isAir(): boolean { return this.type === 0; }
  /** Exact unsigned 32-bit persisted value. */
  toWord(): number { return this.word; }
  /** Independent JSON-safe value, compatible with SegmentData and renderer adapters. */
  toJSON(): BlockData {
    return { type: this.type, hp: this.hp, active: this.active, orientation: this.orientation, extra: this.extra };
  }
  /** Returns a validated copy, retaining fields not supplied by the caller. */
  with(fields: Partial<BlockData>): BlockState { return new BlockState({ ...this.toJSON(), ...fields }); }
  /** Resolves integer full hitpoints using the reference format's truncation. */
  fullHitpoints(definition: Pick<BlockDefinition, 'id' | 'hp'>): number {
    this.checkDefinition(definition);
    return Math.trunc(this.hp * (definition.hp / 127));
  }
  /** Quantizes full hitpoints with the definition's nearest-byte conversion. */
  withFullHitpoints(hitpoints: number, definition: Pick<BlockDefinition, 'id' | 'hp'>): BlockState {
    this.checkDefinition(definition);
    boundedInteger(hitpoints, 'hitpoints', definition.hp);
    return this.with({ hp: Math.round(hitpoints * (127 / definition.hp)) });
  }
  /** Rejects mismatched definitions and invalid maximum health before conversion. */
  private checkDefinition(definition: Pick<BlockDefinition, 'id' | 'hp'>): void {
    if (definition.id !== this.type || !Number.isInteger(definition.hp) || definition.hp <= 0 || definition.hp > 0x7fffffff) {
      throw new DecodeError('E_RANGE', 'Hitpoint conversion needs the matching definition with positive int32 hp');
    }
  }
}
