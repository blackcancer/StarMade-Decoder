# Changelog

## 1.4.0 — 2026-05-20

### Added

#### `BlockConfig` — render metadata aligned with `BlockConfig.xml`

`BlockDefinition` now preserves the render-facing fields needed by downstream tools such as
`StarMade-3D`, instead of dropping them during XML normalization:

- `textureId`
- `slab`
- `individualSides`
- `sideTexturesPointToOrientation`
- `hasActivationTexture`
- `animated`
- `transparency`
- `lightSource`
- `lightSourceColor`
- `extendedTexture4x4`
- `lodShape`
- `lodShapeActive`
- `lodShapeFromFar`
- `lodActivationAnimationStyle`
- `lodCollisionPhysical`
- derived getter `hasLod`

These fields are now also threaded through `BlockDefinition.with(...)` and emitted again by
`BlockConfig.toXml()`.

### Fixed

#### `.smd3` version 6 block decoding

The pre-v7 3-byte block path now decodes `SegmentDataIntArray` using the correct packed bit layout:

- `type` from bits `0-10`
- `hp` from bits `11-17`
- `active` from bit `18`
- `orientation` from bits `19-23`

This replaces the previous `Chunk16`-style interpretation, which produced incorrect block state
for version 6 segment data.

### Coverage
- Existing `BlockConfig` tests extended to assert the newly preserved render/Lod fields
- Decoder behavior covered by the existing test suite before release

---

## 1.3.0 — 2026-05-14

### Added

#### `SegmentController` — immutable mutation methods

Nine new `with*` methods on `SegmentController` (and its subclasses via `cloneWith()` in `Ships.ts`),
following the same immutable-object pattern used throughout the SDK:

| Method | Field | Description |
|---|---|---|
| `withRealName(realName: string)` | tag field `[5]` | Displayed name of the entity in-game |
| `withVulnerable(value: boolean)` | `VULNERABLE` | Whether the entity can take damage |
| `withMinable(value: boolean)` | `MINABLE` | Whether the entity can be mined |
| `withScrap(value: boolean)` | `SCRAP` | Whether the entity is a debris/scrap object |
| `withFactionRights(value: number)` | `FACTION_RIGHTS` | Faction rights bit-flags |
| `withSeed(value: bigint)` | `SEED` | Procedural generation seed (long) |
| `withSpawner(uid: string)` | `SPAWNER` | UID of the originating spawner entity |
| `withLastModifier(name: string)` | `LAST_MODIFIER` | Name of the last player to modify the entity |
| `withCreatorId(value: number)` | `CREATOR_ID` | Database ID of the creator player |

Implementation: `_clone()` signature widened in `SegmentController` to accept the new field
overrides; `cloneWith()` in `Ships.ts` threads them through all concrete subclasses.
All new fields are covered by round-trip tests in `starmade-gamemaster`.

### Coverage
- **640 tests passing**, 4 pending (conditional integration tests — unchanged from v1.2.0)

---

## 1.2.0 — 2026-05-12

### Added

#### DB VARBINARY readers/writers (`src/db/`)
New reader/writer module covering the HSQLDB tables that store custom binary-serialized data:

| Table.Column | Format | API |
|---|---|---|
| `FLEETS.COMMAND` | `FleetCommand` DataOutput | `decodeFleetCommand` / `encodeFleetCommand` |
| `FLEETS.SAVED_REMOTES` | Network DataOutput **or** Java ObjectOutputStream | `decodeFleetRemotes` / `encodeFleetRemotes` |
| `SECTORS_ITEMS.ITEMS` | FreeItem 22-byte records | `decodeSectorItems` / `encodeSectorItems` |
| `TRADE_NODES.ITEMS` | TradePrices zlib raw-DEFLATE | `decodeTradeNodeItems` / `encodeTradeNodeItems` |
| `SYSTEMS.INFOS` | `byte[16³×2]` sector grid | `decodeSystemInfos` / `encodeSystemInfos` |
| `SYSTEMS.RESOURCES` | `byte[19]` resource densities | `decodeSystemResources` / `encodeSystemResources` |

- `FLEET_COMMAND_TYPES` enum (22 ordinals from `FleetCommandTypes.java`)
- `CMD_TYPES` constants shared with the StarMade network protocol (`NetUtil`)
- `RESOURCE_ITEM_IDS` mapping (index → item ID + name, from `ElementKeyMap.java`)
- `SECTOR_TYPES` / `PLANET_TYPES` enums from `SectorInformation.java` / `StellarSystem.java`
- Helper functions `systemIndexToCoords` / `systemCoordsToIndex`

#### DB Business objects (`src/db/`)
Five immutable business objects mirroring the file-level pattern (`Catalog`, `FactionManager`, etc.):

| Class | Source | Key API |
|---|---|---|
| `FleetCommandObject` | `FLEETS.COMMAND` | `create()`, `fromBytes()`, `toBytes()`, `withCommand()`, `withArgs()` |
| `FleetRemotesObject` | `FLEETS.SAVED_REMOTES` | `from()`, `fromBytes()`, `toBytes()`, `withRemote()`, `withToggle()` |
| `SectorItemsObject` | `SECTORS_ITEMS.ITEMS` | `from()`, `fromBytes()`, `toBytes()`, `withItem()`, `withMerged()` |
| `TradePricesObject` | `TRADE_NODES.ITEMS` | `empty()`, `fromBytes()`, `toBytes()`, `withBuyOrder()`, `withSellOrder()` |
| `StarSystem` | `SYSTEMS.INFOS` + `SYSTEMS.RESOURCES` | `empty()`, `fromBytes()`, `infosToBytes()`, `resourcesToBytes()`, `withSectorType()`, `withResourceDensity*()` |

#### New blueprint writers (completing round-trip coverage)
- **`writeSmbpm()`** — encoder for `.smbpm` (blueprint meta), inverse of `BlueprintEntry.writeMeta()`
- **`writeSmbmm()`** + `emptyModMappings()` — encoder for `.smbmm` (mod mappings)
- **`writeSim()`** — encoder for `.sim` (simulation state)

#### `toBuffer()` on Tag-based business objects
All Tag-based objects now expose `toBuffer()` for direct file serialization:
`FactionManager`, `Catalog`, `TradingManager`, `FloatingItemsArchive`,
`ChatChannelManager`, `NPCFactionManager`, `SimulationState`.

Also added `FactionManager.fromBuffer()` and `Catalog.fromBuffer()` which were missing.

### Fixed
- **`SmbpmParser`**: `WirelessMarker` interface and parsing corrected to match the actual
  `BBWirelessLogicMarker` Java format (`UTF marking + long markerLocation + long fromLocation`),
  replacing the previously incorrect format (`3×int + 2×long + byte`).
  `wirelessMarkers[]` is now a first-class field on `SmbpmFile`.

### Coverage
- **640 tests passing**, 4 pending (conditional integration tests)
- 97 new unit tests across `test/javaModifiedUtf.test.ts`, `test/db.test.ts`,
  `test/db-objects.test.ts`, and additions to `test/writers.test.ts`

---

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
