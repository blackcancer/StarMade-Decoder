/**
 * @fileoverview Objects  Module  Exports
 *
 * Defines high-level StarMade domain objects with typed accessors, mutation helpers, and round-trip serialization support.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Entry point for StarMade business objects.
 */
export { Catalog, CatalogEntry } from './Catalog.js';
export { FactionManager, Faction, FactionMember, FactionRelation,
         RELATION_WAR, RELATION_NEUTRAL, RELATION_ALLY, RELATION_NAMES } from './Factions.js';
export { PlayerCharacter, PlayerTransformable, type PlayerTransformableFields } from './PlayerCharacter.js';
export { PlayerState } from './PlayerState.js';
export { SegmentControllerObject } from './SegmentController.js';
export { ChatChannelManager, ChatChannel } from './ChatChannels.js';
export { ChatLogReader, parseChatLogLine } from './ChatLogs.js';
export type { ChatLogCalendar, ChatLogMessage, ChatLogUnparsed, ChatLogRecord,
  ChatLogFileRecord, ChatLogCursor, ChatLogBatch, ChatLogReadOptions } from './ChatLogs.js';
export { TradingManager, TradeRoute } from './Trading.js';
export { NPCFactionManager, SimulationState, SimulationGroup } from './Simulation.js';
export { FloatingItemsArchive, FloatingItem, FloatingItemSector, type FloatingItemPosition } from './FloatingItems.js';
export {
  ControlElementMapper, ElementCountMap, NPCFactionNewsEvent,
  LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap,
  decodeSerializable,
} from './Serializables.js';
export type {
  ControlLink as SerializableControlLink,
  BlockCount, NPCEventType, BufferedBlock,
  Vec3fEntry, TransformEntry, Transform,
} from './Serializables.js';
export type { BlockPosition } from './ElementPosition.js';
export {
  buildEntityFieldViews,
  buildEditableEntityFields,
  toEntityFieldView,
  tagValueToFieldValue,
  EntityField,
  fieldValueAsBigInt,
  fieldValueAsBoolean,
  fieldValueAsInteger,
  fieldValueAsNumber,
  fieldValueAsString,
  TRANSFORMABLE_FIELD_SCHEMA,
  PLAYER_CHARACTER_FIELD_SCHEMA,
  PLAYER_STATE_FIELD_SCHEMA,
  SEGMENT_CONTROLLER_FIELD_SCHEMA,
  MANAGER_CONTAINER_FIELD_SCHEMA,
} from './EntityFieldView.js';
export type {
  EntityFieldSchema,
  EntityFieldSchemaEntry,
  EntityFieldSetter,
  EntityFieldSetterMap,
  EntityFieldValue,
  EntityFieldView,
  SerializableFieldValue,
  ByteArrayFieldValue,
} from './EntityFieldView.js';
export {
  AiConfigurationState,
  BlueprintInfo,
  CargoInventoryBlock,
  CoreTimerState,
  EntSlotObject,
  IgnoredPlayers,
  InventoryBackupState,
  ItemsToSpawnWith,
  ManagerModulesState,
  ManagerModuleState,
  ManagerModuleEntryState,
  ModDataState,
  ModuleExplosionState,
  ModuleExplosionsState,
  NpcDataState,
  PlayerInfoHistoryEntry,
  PlayerInfoHistoryList,
  QuarterManagerState,
  QuarterState,
  RaceGateInfo,
  RailControllerState,
  RailRequestState,
  SavedCoordinateEntry,
  SavedCoordinates,
  ScanDataRecord,
  ScanHistory,
  UnloadedDummiesState,
  UniqueSegmentPieceState,
  WarpGateInfo,
} from './EntitySlotObjects.js';
export type {
  CargoInventoryBlockValue,
  EntMatrix4f,
  EntVector3f,
  EntVector3i,
  EntVector4f,
  ModuleExplosionSummary,
  QuarterSummary,
  RailRequestSummary,
  ScanEntityData,
  ScanResourceData,
  UniqueSegmentPieceValue,
} from './EntitySlotObjects.js';
// Components
export * from './components/index.js';
// Entities
export * from './entities/index.js';
// Enriched views (Phase 4)
export * from './enriched/index.js';

export type { CatalogEntryFields, CatalogOptions } from './Catalog.js';
export type { FactionFields, FactionMemberFields, FactionRelationFields } from './Factions.js';
export type { ChatChannelFields } from './ChatChannels.js';
export type { TradeRouteFields } from './Trading.js';
export type { SimulationGroupFields, SimulationStateFields } from './Simulation.js';
export type { NPCRoute } from './Serializables.js';

export type { ControlElementMapperOptions } from './Serializables.js';
