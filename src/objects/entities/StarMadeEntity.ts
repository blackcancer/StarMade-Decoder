/**
 * @fileoverview Star Made Entity
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * StarMadeEntity — abstract base class for all StarMade entities.
 *
 * Defines the shared contract :
 *   - fromTag(root: Tag): T     — deserialization
 *   - toTag(): Tag              — serialization
 *   - entityType: string        — type discriminant
 */

import type { Tag } from '../../core/Tag.js';

/**
 * Represents the StarMadeEntity model used by high-level StarMade entity modelling.
 */
export abstract class StarMadeEntity {
  /** Entity discriminator type */
  abstract readonly entityType: string;

  /** Rebuilds the root Tag. */
  abstract toTag(): Tag;

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `${this.entityType}`; }
}
