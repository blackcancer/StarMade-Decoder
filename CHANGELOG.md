# Changelog

## 1.1.0 — 2026-05-12

### Added
- **`BufferReader.readJavaModifiedUTF()`** — decodes Java Modified UTF-8 (network protocol variant).
  Handles NUL → `C0 80` encoding and supplementary characters encoded as two independent
  3-byte surrogate sequences, matching `DataInputStream.readUTF()` on the wire.
- **`BufferWriter.writeJavaModifiedUTF()`** — encodes Java Modified UTF-8 (inverse of the above),
  matching `DataOutputStream.writeUTF()` used by the StarMade TCP admin protocol and fleet command serialization.
- **14 new unit tests** in `test/javaModifiedUtf.test.ts` covering round-trips (ASCII, NUL,
  accents, emoji/surrogate pairs), error paths (truncated sequences, invalid leading bytes,
  size limit), and consistency with the standard `readJavaUTF` / `writeJavaUTF` on ASCII input.

### Context
`readJavaUTF()` / `writeJavaUTF()` (unchanged) use standard UTF-8 — the format used by StarMade
save-file Tag serialization. The new `Modified` variants match the network wire format and are
shared with `starmade-gamemaster` to avoid duplication.

### Consumers
- `starmade-gamemaster@0.1.0+` now depends on `starmade-decoder` and uses `BufferReader` /
  `BufferWriter` directly instead of the previously duplicated `BinaryReader` + `javaUtf.ts`.

---

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
