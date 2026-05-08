/**
 * @fileoverview Entity  Module  Exports
 *
 * Provides legacy typed parsers for StarMade entity files and related domain structures.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * entity/index.ts — typed parsers by StarMade file type.
 *
 * Each parser takes the root Tag produced by readFrom() and returns
 * a TypeScript object with extracted semantic fields.
 *
 * Java reference source:
 *   - PlayerCharacter.java
 *   - PlayerState.java
 *   - SegmentController.java (Ship, SpaceStation, Shop)
 *   - FactionManager.java
 *   - SimulationManager.java
 */

export { parsePlayerCharacter, type PlayerCharacterData } from './PlayerCharacter.js';
export { parsePlayerState, type PlayerStateData } from './PlayerState.js';
export { parseSegmentController, type SegmentControllerData } from './SegmentController.js';
export { parseFactions, type FactionsData } from './Factions.js';
export { parseCatalog, type CatalogData } from './Catalog.js';
export { parseFloatingItems, type FloatingItemsData } from './FloatingItems.js';
