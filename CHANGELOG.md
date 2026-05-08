# Changelog

## 1.0.0 — 2026-05-08

### Added
- Complete TypeScript SDK for reading and writing StarMade save files and blueprints
- Core Tag API: `readFrom`, `writeTo`, `Tags`, `StructBuilder`, `ListBuilder`, `toObject`, `toJSON`
- GZIP-transparent file detection
- All 19 StarMade tag types with typed accessors
- SERIALIZABLE factory registry with 7 known factories (ControlElementMapper, ElementCountMap, NPCFactionNewsEvent, LongSet, BlockBuffer, Long2Vector3fMap, Long2TransformMap)
- High-level domain objects: `Ship`, `SpaceStation`, `ShopSpaceStation`, `FloatingRock`, `PlayerCharacterEntity`, `PlayerStateEntity`
- Business objects: `Catalog`, `FactionManager`, `PlayerCharacter`, `PlayerState`, `ChatChannelManager`, `TradingManager`, `SimulationState`, `NPCFactionManager`, `FloatingItemsArchive`, `SegmentControllerObject`
- Components: `Inventory`, `ManagerContainer`, `PowerState`, `ThrustConfig`, `HpState`, `DockingState`, `TextBlocks`, `SpawnData`, `SlotAssignment`, `EntityTransform`, `SectorPosition`
- Config API: `SMToolConfig`, `ServerConfig`, `BlockConfig`, `BlockBehaviorConfig`, `FactionConfig`, `BlockRegistry`
- Blueprint parsers: `parseSmd3`, `parseSment`, `parseSmtpl`, `parseSmbpl`, `parseSmbpm`, `parseSmbmm`, `parseSim`, `parseBlueprintFolder`
- Blueprint writers: `writeSmd3`, `writeSmtpl`, `writeSmbpl`, `writeSmbph`
- Enriched views: `RichSegmentController`, `enrichControlLinks`, `enrichBlockCounts`, `enrichSmd3`, `enrichInventory`
- Retrocompatibility test sample (StarMadeDock, 2014-era smd2 blueprint)
- c8 coverage toolchain: `npm run coverage`, `npm run coverage:check`
- Full English documentation: `README.md`, `docs/API.md`, `docs/EXAMPLES.md`

### Coverage
- 99% statements/lines
- 93% functions
- 82% branches
- 525 tests passing
