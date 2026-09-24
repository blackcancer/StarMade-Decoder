/**
 * @fileoverview Components  Module  Exports
 *
 * Defines reusable domain components used by StarMade entity object models.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Public exports for StarMade entity components.
 */

export { SectorPosition, EntityTransform }    from './Transform.js';
export { SpawnPoint, PlayerSpawnData, SpawnMarker, SpawnController } from './SpawnData.js';
export { DockingState }                       from './DockingState.js';
export { HpState }                            from './HpState.js';
export { TextBlocks }                         from './TextBlocks.js';
export { SlotAssignment }                     from './SlotAssignment.js';
export { Inventory, ItemStack }               from './Inventory.js';
export type { ItemMeta, ItemGroup, InventoryCapacity, InventoryReadOptions, ItemStackJSON } from './Inventory.js';
export { describeMetaObject }                  from './MetaObjectDetails.js';
export type { MetaObjectCategory, MetaObjectStatus, MetaObjectProperties, MetaObjectDetails } from './MetaObjectDetails.js';
export { InventoryLocation }                  from './InventoryLocation.js';
export { PowerState, ThrustConfig }           from './PowerAndThrust.js';
export { ManagerContainer, PullPermission }   from './ManagerContainer.js';

export type { SlotAssignmentOptions } from './SlotAssignment.js';
export type { HpStateOptions, HpStateFields } from './HpState.js';
export type { DockingQuaternion, DockingStateOptions, DockingStateFields } from './DockingState.js';
export type { PowerStateOptions, PowerStateFields, ThrustConfigOptions, ThrustConfigFields } from './PowerAndThrust.js';
export type { SpawnPointChanges, PlayerSpawnDataChanges, SpawnMarkerChanges } from './SpawnData.js';
export type { EntityTransformChanges } from './Transform.js';
