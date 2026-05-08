/**
 * @fileoverview Entities  Module  Exports
 *
 * Defines high-level StarMade entity classes with typed fields and immutable update helpers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Public exports for StarMade entities.
 */
export { StarMadeEntity }          from './StarMadeEntity.js';
export { GameEntity }              from './GameEntity.js';
export { SegmentController }       from './SegmentController.js';
export type { BlockBounds }        from './SegmentController.js';
export { Ship, SpaceStation, ShopSpaceStation, FloatingRock,
         parseSegmentControllerEntity } from './Ships.js';
export { PlayerCharacterEntity }   from './PlayerCharacterEntity.js';
export { PlayerStateEntity, FactionMembership } from './PlayerStateEntity.js';
