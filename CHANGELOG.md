# Changelog

## 2.0.5 — 2026-09-24

- Add `describeMetaObject(ItemStack)` for StarMade-Open's native inventory
  objects: nine weapon subtypes and blueprint, recipe, logbook, helmet,
  build-prohibiter, flashlight, virtual-blueprint and block-storage types.
- Expose stable typed properties, instance/subtype IDs and `meta-icons` indices;
  distinguish missing, unknown and invalid payloads while preserving the
  original Tag and complete inventory/entity bytes.
- Bound logbook text, summarize opaque binary payload sizes, and validate the
  installed player inventory plus every native subtype at 100% line/branch
  coverage.

## 2.0.4 — 2026-09-23

- Add bounded text-chatlog parsing, recent history and incremental polling for
  `chatlogs/*.txt`, including missing-file, partial-line and rotation handling.
- Preserve malformed lines and byte offsets, parse channel/direct messages in
  the local-time format written by StarMade-Open, and reject unsafe paths.

## 2.0.3 — 2026-09-23

- Synchronize `ServerConfig` with all 210 active settings in StarMade-Open
  `e5a3b49d8`: add 24 new keys, remove 10 obsolete keys from the current schema,
  and correct 31 previously divergent default values.
- Expose each setting's exact game kind, default, inclusive range or choices,
  category and effect description through the immutable `SERVER_CONFIG_SCHEMA`.
  Export `SERVER_CONFIG_SCHEMA_SOURCE` for consumers that pin a game revision.
- Reject out-of-range numeric edits and unsupported game-mode choices; preserve
  legacy file lines and existing out-of-range numeric values during reading.
- Validate the complete pinned 210-key schema, installed game config and isolated
  package consumer without adding game source files to the project.

## 2.0.2 — 2026-09-23

- Correct database fleet, sector and planet ordinals against Open `e5a3b49d8`;
  add explicit `current` and `legacy-sdk` profiles retained across immutable edits.
- Read/write current trade prices with the JDK-compatible zlib envelope, verified
  against an independent JDK capture and Python decompression.
- Accept native 16-byte resources, write 16 bytes by default, retain explicit
  19-byte output with loss rejection, correct resource labels and preserve absent
  resource cells across unrelated edits.

## 2.0.1 — 2026-09-23

- Correct SMTPL v4/v5 little-endian 24-bit block decoding against the updated
  StarMade-Open reference. Preserve legacy v1–v3 encoding and extended v6 support.
- Make template writes honor the requested version, with matching sections and
  validation of block ranges and boolean activation. Reject data that cannot be
  represented instead of truncating it or silently changing the version.
- Preserve all eight legacy HP bits and the six reserved v6 block bits. Reject
  unknown versions and negative, oversized or truncated collection counts.
- Verify all 84 real v5 templates byte-for-byte and add independent Python
  block-layout, creation and edit checks, plus installed-package contracts.

See [migration notes](docs/INTEGRITY_AND_MIGRATION.md#smtpl-compatibility-correction-201)
and the [SMTPL qualification report](docs/SMTPL_QUALIFICATION.md).

## 2.0.0 — 2026-09-20

### Complete format class layer

- Add `SkinDocument` for `.smskin` archives: four named diffuse/emissive textures,
  creation, immutable resource replacement, archive limits and exact unchanged or
  edit/revert ZIP bytes. Reuse the existing ZIP codec; PNG bytes remain opaque.
  Add an independent Python ZIP/PNG oracle and installed-package coverage.

- Add `WorldSeedDocument`, `PersistentObjectDocument`, `SubtitleDocument`,
  `SystemNamesDocument` and `BlueprintModMappings` for the five remaining auxiliary
  formats. Expose immutable edits, detached projections, strict validation,
  resource ceilings and unchanged/edit-revert source preservation.
- Add public `XmlConfigDocument`; preserve XML comments, attributes, repeated
  elements and extensions through the behavior/faction configuration wrappers.
- Apply validated snapshots and propagated limits to existing entities,
  components, faction/catalog/trading/chat/simulation collections, serializable
  payloads and database-column classes. Legacy entity DTO parsers delegate to
  the same validated models.
- Preserve named fields, wrappers, opaque extensions and file envelopes through
  modeled edits. Reject malformed present fields and unsafe integer inputs.
- Support real `.smbmm` namespaced text and historical zlib compression, signed
  short IDs, indexed lookup and explicit translation between namespace maps.
- Support all three stored controller Tag layouts without applying rendering
  transforms. Preserve all sixteen stored player transform values.

### Breaking corrections

- Use actual faction relation codes, BYTE member roles and explicit role masks;
  retain NPC route payloads, floating-item sectors/counters and simulation counters.
- Correct catalog permission/spawn fields and trade waypoint preservation.
- Separate manager PowerAddOn from the opaque reactor payload; retain current
  shield Tags. New inventory entries require explicit block positions.
- Correct HP field widths, version-zero thrust, legacy power and docking layouts;
  retain noncanonical boolean bytes on edit/revert.
- Expose suspended faction membership separately from the deprecated rank alias.
  Real player AI configuration has an explicit component accessor/editor.
- Previous SDK int32-pair SMBMM output requires explicit `legacyInt32Pairs`;
  unsupported or damaged game payloads are no longer accepted as empty data.

See [migration notes](docs/INTEGRITY_AND_MIGRATION.md#upgrading-to-200),
[format models](docs/FORMAT_MODELS.md) and the
[qualification report](docs/V2_QUALIFICATION.md). All production files remain
subject to exact 100% line and branch gates, without exclusions. GitHub delivery
is separate from npm publication and in-game import qualification.

## 1.7.0 — format-class candidate (2026-09-20)

The following changes describe the preceding **1.7.0 candidate**. This is a format SDK: validation, in-memory edits, explicit serialization
and adapters between formats. Rendering, administration workflows and database
engine operations belong to the consuming projects. No npm publication or game
runtime qualification is implied.

### Format classes

- Add immutable `BlockState` and `PlacedBlock`, validated `Segment`, indexed
  `BlockVolume` and bounded `BlueprintModel`/`BlueprintNode` classes. Expose native
  stored coordinates, packed words, sparse JSON and instance-scoped catalogue
  resolution; retain attachment identities without computing rendered transforms.
- Connect `BlueprintDocument.blocks()` and `.model()` to existing lossless archive
  and folder writers, including original identities of empty region files.
- Add `BlockDefinition.create()` and complete immutable edits; export catalogues
  with matching XML/properties mappings, preserving unknown XML attributes and
  subtrees. Reject conflicting IDs/type names and detach nested mutable inputs.
- Correct actual inventory Tags (`inv1`, stash/factory wrappers, typed slot/type
  lists, opaque metadata payloads and multislot groups). Preserve unknown fields
  and wrappers during edits; address manager inventories by block position.
- Add explicit slot and volume constraints, immutable add/split/merge/transfer
  operations and JSON projections. No game capacity or server policy is inferred.

### Compatibility

- `Inventory.fromTag()`/`.toTag()` now enforce actual wire layouts. Previous SDK
  anonymous tuple layouts require explicit `fromLegacyTag()`/`toLegacyTag()`.
- Inventory slot limits are caller-defined (unbounded by default); there is no
  hardcoded 36-slot assumption. Limits are not persisted as game capacities.
- Manager kind aliases are deprecated; ambiguous same-kind lookups fail instead
  of silently selecting an inventory. Use `inventoryEntries`, `getInventoryAt`,
  `withInventoryAt` and `withoutInventoryAt` for complete position-based access.
- Test directories now mirror `src`, with a blocking layout check. The exact
  all-source/per-file 100% line and branch coverage requirement is unchanged.

### Source publication boundary

- Remove Java test sources; current interoperability checks use independent Python
  binary oracles and captured JDK vectors. No JDK is required to run them.
- Reject Java sources/binaries in project files, nested archives and npm packages;
  CI evidence no longer archives the source tree. StarMade-Open remains external
  and read only. The published main history and affected CI artifacts were cleaned.

### Qualification — 2026-09-20

- 1,233 tests passed with zero pending/failing, including `/srv/StarMade` checks.
- All 110 production modules passed exact 100% lines (30,246/30,246) and branches
  (7,599/7,599), without exclusions or skipped entries.
- Build, JSDoc, source/test-layout guards, negative coverage checks, installed
  package runtime/types, Python binary/LZ4 interoperability and production audit
  passed. All 1,516 installed catalogue definitions survived export/reparse.

See [format classes](docs/FORMAT_MODELS.md) for ownership, examples, migration and
measured qualification; [coverage requirements](docs/TEST_COVERAGE.md) for gates.

## 1.6.0 — blueprint-writing candidate (2026-09-19)

The following completed changes and measurements describe the earlier candidate.
The JDK runs below predate removal of the local Java harness sources.

### Added — complete blueprint writing

- Add `BlueprintDocument`, `.sment` writers and complete folder snapshots/exports,
  including unknown resources, mod mappings, empty directories and attachments.
- Return exact source ZIP bytes for unchanged documents and semantic edit/revert;
  preserve unchanged local records, descriptors, compression and envelope metadata.
- Add `Smd3Document` for sector-preserving edits, retained allocations and v7 LZ4
  encoding of changed records. Recompute block counts/bounds and invalidate stale scores.
- Rebase attachment references on rename/folder publication; preserve opaque rail
  Tags and manager/thrust Tag envelopes and extensions.
- Stage folder writes with explicit overwrite, rollback and retained-backup errors;
  reject incomplete models, unsafe paths, unsupported formats and resource excesses.
- Add independent blueprint wire validation and production-package writer checks.

See [blueprint editing](docs/BLUEPRINT_EDITING.md) for guarantees and limits.

### Fixed

- Preserve faction field names, STRUCT terminators and HP-match metadata during edits.
- Reject malformed nonempty database cells instead of returning valid empty values;
  validate trade payload lengths, sector-item padding and system-grid sizes.
- Decode actual Java `HashMap<String, Boolean>` fleet-remotes streams instead of
  scanning heuristically; preserve the input format during edits. Explicit recovery
  retains raw bytes and diagnostics and prevents editing or serializing incomplete data.
- Share node and nested-inflation budgets across blueprint metadata, bound serialized
  collections and command recursion, and apply consistent `TagDocument` limits.
- Index archive paths once with exact parent relationships and explicit depth/entity
  limits; reject unsupported SMD3 source versions before writing.

### Validation

- The local 1.6.0 run on 2026-09-19 passed **1,186 tests, zero pending/failing**,
  **29,175/29,175 lines** and **6,905/6,905 branches** across **102 production
  modules**. Build, documentation, exact coverage gate, installed package and
  independent JDK/LZ4 checks passed. The earlier audit measurements below are
  retained as historical evidence.

- Require exact 100% line, statement and branch coverage for every production source file.
- Add portable configuration, domain-model, binary boundary and filesystem-race regressions.
- Report exact all-source counters and reject coverage ignores or missing modules.
- Simplify proven redundant internal branches without weakening public validation.
- Exercise real XML/ZIP parsing from the installed production package, independent JDK
  map and geometry oracles, and resource failures in a bounded child process.
- On 2026-09-19, `STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check` passed
  **1,096 tests, zero pending and zero failing**, with **27,980/27,980 lines** and
  **6,288/6,288 branches** covered across **98 production modules**. These are measured
  results for the earlier audit implementation, not permanent coverage claims.
- CI passed on Node.js 20, 22 and 24; the Node.js 22 job also passed JDK and LZ4 checks.

See [audit resolution](docs/AUDIT_RESOLUTION.md) for the A01–A10 evidence,
[coverage requirements](docs/TEST_COVERAGE.md) for the blocking gates, and
[migration notes](docs/INTEGRITY_AND_MIGRATION.md) for changed parsing behavior.

## 1.5.0 — integrity correction candidate (2026-09-18)

- Move ZIP/XML runtime dependencies into `dependencies` and update the locked toolchain.
- Fix Java modified UTF-8 in file Tags, reject malformed sequences and invalid lengths.
- Fix zero-capacity writer growth, detached output snapshots and integer validation.
- Add bounded Tag traversal and envelope-preserving `TagDocument` editing.
- Correct SMD3 v7 raw LZ4/little-endian serialization; retain an explicit old-SDK migration mode.
- Preserve all reserved block bits; remove shared mutable blocks and stale-count data loss.
- Reject sector overflow, incomplete recovery output, invalid coordinates and duplicate cells.
- Decode geometric side segments using caller-supplied game normals rather than invented cubes.
- Fix sibling attachment discovery; add bounded ZIP extraction, diagnostics and strict defaults.
- Correct blueprint manager typing and preserve present-empty metadata list flags.
- Parse legacy controller maps with the Java +8 coordinate migration.
- Add audit regressions, independent JDK/LZ4 tests, a real 43-file metadata round-trip check,
  package-consumer qualification and CI across Node.js 20/22/24.
- Remove stale fixed coverage claims; distinguish portable tests from installation-only checks.

See `docs/INTEGRITY_AND_MIGRATION.md` before upgrading. This candidate has not been
validated by launching the game and is not published to npm by the correction workflow.

## Earlier development included in the 1.5.0 candidate

### Added

#### Blueprint high-level API (`src/smd3/`)

**`.smbpm` — `BlueprintMeta`**
- `parseSmbpm()` now returns `BlueprintMeta` instead of raw `SmbpmFile`.
- Exposes `manager`, `aiConfig` (`AiConfig` / `AiConfigEntry`), `thrustConfig`, and `railChildren` (`RailChildEntry[]`).
- Adds `BlueprintChildOffset`, `BlueprintChildTransform`, `RailChildRequest`, and `RailPieceRef` types.
- Adds helpers: `childOffsetFor()`, `withAiValue()`, `withRailChildRequest()`, `withRailUID()`, `getRailChildOffsetFromTag()`, `parseAiConfigTag()`, and `aiConfigToTag()`.
- Keeps internal state in non-enumerable slots for exact binary round-trips.

**`.sment` / `.smbph` — `BlueprintArchive` / `BlueprintHeader` / `BlueprintEntity`**
- `parseSment()` returns `BlueprintArchive` with `entities`, `findEntity()`, `totalBlockCount`, local/world offsets, and `meta` per entity.
- `parseSmbph()` returns `BlueprintHeader` with `classificationOrdinal`, `classificationName`, `withEntityType()`, and `withClassification()`.
- Adds `BlueprintClassification`, `blueprintClassificationName()`, `blueprintTypeOrdinal()`, `BlueprintBlockCount`, `BlueprintIndexScore`, `BlueprintIndexScoreInput`, and `normalizeBlueprintHeader()`.

**`.smbpl` — `BlueprintLogic`**
- `parseSmbpl()` returns `BlueprintLogic` with access by controller, block type, and target.
- Adds `ControlController`, `ControlGroup`, `ControlLink`, `addLink()`, `removeLink()`, `moveController()`, and `clearController()`.
- `writeSmbpl()` remains binary-compatible.

**`.smbmm` / `.sim` — updated high-level wrappers**
- `SmbmmFile` exposes `SmbmmFormat` and `ModMapping[]`; `writeSmbmm()` encodes int32 BE mappings.
- `SimParser` / `SimWriter` expose `SimulationState` and `SimGroup` with typed `version`, `type`, `members`, `startTime`, `startSector`, and `programId`; deprecated fields are marked `@deprecated`.

#### Entity high-level API (`src/objects/entities/`)

**`.ent` deep modeling — all opaque slots now have object APIs**
- `SegmentController` slots: `npcData`, `railController`, `coreTimer`, `blueprintInfo`, `itemsToSpawnWith`, and `quarterManager` (`QuarterManagerState` / `QuarterState`).
- `PlayerStateEntity` slots: `hostHistory`, `scanHistory`, `inventoryBackup`, `savedCoordinates`, `ignoredPlayers`, and `cargoInventoryBlock`.
- `ManagerContainer` slots: `warpGateInfo`, `modules` (`ManagerModulesState`), `aiConfiguration`, `raceGateInfo`, `unloadedDummies`, `moduleExplosions` (`ModuleExplosionsState`), and `modData`.
- Adds immutable mutation helpers such as `with...`, `clear`, `add`, `remove`, `withSetting`, `withScanEntry`, and `withSavedCoord`.
- Adds `EntityFieldView`, a named/typed field view with `canSet`, `withValue(value)`, and `setValue(value)`.
- Keeps internal `Tag` storage private/non-enumerable to preserve exact round-trips.

**`GameEntity` / `Ships` / `PlayerCharacterEntity` / `PlayerStateEntity`**
- Adds `transformable` / `transformableFields` typed views.
- Expands the `fields` API with setters for identifiers, names, bounds, sector, faction, owner, seed, flags, credits, creative mode, health, stepHeight, and `pullPermission`.

#### BlockConfig / ElementInfo

- `BlockConfig` now parses and exposes StarMade-Open-inspired block metadata needed by renderers and editors:
  - render fields: texture IDs, transparency, raw animation flag, activation textures, light sources, LOD shape data, build-mode-only blocks, extended textures, resource injection, and LOD collision behavior
  - gameplay/logic fields: controller relationships, logic flags, door/beacon/enterable/sensor/system flags, factory data, source references, wildcard IDs, and effect armor values
  - recipe fields: consistence, cubatom consistence, recipe buy resources, inventory group, and block resource type
  - reactor chamber fields: root/parent/children/prerequisites/exclusions/upgrades, capacity, permissions, config groups, reactor HP, and reactor general icon index
- `BlockDefinition.metadata` stores the extended parsed XML fields while preserving the existing constructor-facing core fields.
- Adds StarMade-Open style helpers: `getBlockStyleDescriptor()`, `getResourceInjectionDescriptor()`, `BlockDefinition.style`, `BlockDefinition.resourceInjectionInfo`, `BlockDefinition.defaultOrientation`, `BlockDefinition.isNormalBlockStyle`, `BlockDefinition.isSolidBlockStyle`, `BlockDefinition.isBlendBlockStyle`, `BlockDefinition.isReactorChamberAny`, and `BlockDefinition.sourceReferenceId`.
- Adds the ElementInformation-inspired semantic block API: `BlockDefinition.toElementInfo(config?)`, `BlockConfig.elementInfo`, `BlockConfig.getElementInfoById(id)`, `BlockConfig.getElementInfoByName(name)`, `BlockConfig.getElementInfoByTypeName(typeName)`, `BlockConfig.resolveReference(typeNameOrId)`, and `BlockConfig.resolveIngredient(ingredient)`.
- Adds exported grouped view types: `BlockElementInfo`, `BlockIdentityView`, `BlockRenderView`, `BlockLogicView`, `BlockRecipeView`, `BlockFactoryView`, `BlockCollisionView`, `BlockChamberView`, `BlockClassificationView`, `BlockReference`, `BlockIngredientReference`, `BlockStyleDescriptor`, and `ResourceInjectionDescriptor`.

#### Auxiliary formats (`src/config/` / `src/db/`)

- `parseSystemNames()` / `writeSystemNames()` for `data/config/systemNames.syl`.
- `parseWorldSeed()` / `writeWorldSeed()` for `server-database/world0/.seed` (Java long BE).
- `parsePersistentObjects()` / `writePersistentObjects()` for `moddata/*/persistent/*.smdat`.
- `parseSbvSubtitles()` / `writeSbvSubtitles()` for StarMade `.sbv` subtitle files, matching StarMade-Open `SvbSubtitleManager` timing blocks.
- Live `/srv/StarMade/language/**/*.sbv` parse/write coverage for the new subtitle helpers.

#### Documentation tooling

- `npm run docs:check`, backed by `scripts/check-jsdoc-coverage.mjs`, verifies source-level documentation coverage.
- The documentation check enforces `@fileoverview` on every `src/*.ts` file and JSDoc on every top-level declaration, class constructor/method/accessor, and interface method signature.

### Changed

- `BlockConfig` XML parsing and serialization now preserve the newly parsed metadata through immutable `BlockDefinition.with()` updates and custom XML output.
- The earlier generic naming for the new semantic block view was replaced before release with StarMade-Open-aligned `ElementInfo` terminology.
- `README.md`, `docs/API.md`, and `docs/GUIDE.md` now document the `BlockElementInfo` API and the new documentation coverage command.

### Documentation

- Added JSDoc/fileoverview coverage across the complete `src` tree: internal helpers, public APIs, classes, constructors, methods, accessors, top-level constants, interfaces, and type aliases are documented.
- Manually refined `BlockConfig`/`BlockElementInfo` comments after the bulk pass so the central API uses StarMade domain terminology rather than generic generated wording.

### Coverage

- Historical validation at this development stage: **681 tests passing**, 0 pending.
  Current qualification is recorded in [the V2 report](docs/V2_QUALIFICATION.md).
- `npm run docs:check` passes

---

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
- 97 new unit tests across `test/core/modified-utf.test.ts`, `test/db/db.test.ts`,
  `test/db/db-objects.test.ts`, and additions to `test/smd3/writers.test.ts`

---

## 1.1.0 — 2026-05-12

### Added
- **`BufferReader.readJavaModifiedUTF()`** — decodes Java Modified UTF-8 (network protocol variant).
  Handles NUL → `C0 80` encoding and supplementary characters encoded as two independent
  3-byte surrogate sequences, matching `DataInputStream.readUTF()` on the wire.
- **`BufferWriter.writeJavaModifiedUTF()`** — encodes Java Modified UTF-8 (inverse of the above),
  matching `DataOutputStream.writeUTF()` used by the StarMade TCP admin protocol and fleet command serialization.
- **14 new unit tests** in `test/core/modified-utf.test.ts` covering round-trips (ASCII, NUL,
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
