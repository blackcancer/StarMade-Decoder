# StarMade-Decoder API Reference

This reference describes the current SDK source. See the [migration contract](INTEGRITY_AND_MIGRATION.md) for incompatible format corrections, strict parsing and file-preservation guarantees.

StarMade-Decoder is an ESM TypeScript SDK. After build, public symbols are exported from `starmade-decoder`. Examples below use the package entry point; internal helper modules are not part of the documented API.

```ts
import { readFrom, writeTo, Ship, BlockRegistry } from 'starmade-decoder';
```

> **Important:** call `registerAllFactories()` once at startup before parsing any `.ent` file that contains SERIALIZABLE payloads (ships, stations, players).
>
> ```ts
> import { registerAllFactories } from 'starmade-decoder';
> registerAllFactories();
> ```

---

## High-level `.ent` slot objects

Entity classes expose StarMade-Open slots through typed objects, not public raw `Tag` trees.
Use the object helpers, then pass the updated object back to the parent entity.

Main accessors:

| Entity | Accessors |
|--------|-----------|
| `Ship` / `SpaceStation` / `ShopSpaceStation` / `FloatingRock` | `railController`, `coreTimer`, `blueprintInfo`, `itemsToSpawnWith`, `quarterManager`, `npcData` |
| `ManagerContainer` | `modules`, `aiConfiguration`, `moduleExplosions`, `warpGateInfo`, `raceGateInfo`, `unloadedDummies`, `modData` |
| `PlayerStateEntity` | `hostHistory`, `scanHistory`, `inventoryBackup`, `savedCoordinates`, `ignoredPlayers`, `cargoInventoryBlock` |

Common update pattern:

```ts
const ship2 = ship
  .withCoreTimer(ship.coreTimer.withTimeLeftMs(5000n))
  .withBlueprintInfo(ship.blueprintInfo.withIdentifier('Explorer'));

const request = ship.railController.currentRequest;
const ship3 = request
  ? ship.withRailController(ship.railController.withCurrentRequest(
      request.withDidRotationInPlace(true)
    ))
  : ship;
```

These objects keep the original binary slot privately so unchanged data can still round-trip exactly.

---

## Core Tag API

### `readFrom(data: Buffer | Uint8Array, options?: TagReadOptions): Tag`

Parses a StarMade binary Tag file. Automatically detects GZIP compression (magic `0x1F 0x8B`) and decompresses before parsing. Non-GZIP files start with a `short version` prefix that is consumed silently.

```ts
const root = readFrom(fs.readFileSync('FACTIONS.fac'));
```

### `writeTo(tag: Tag, options?: TagReadOptions): Buffer`

Serializes a Tag tree to canonical non-GZIP bytes with the `short version = 0` prefix. This does not preserve an input file’s compression, version or trailing bytes. Use `readTagDocument(data)` and `document.toBuffer()` when those must be retained.

```ts
fs.writeFileSync('FACTIONS.fac', writeTo(root));
```

### `TagDocument` and explicit limits

`readTagDocument(data, options?)` returns a document with `root`, `version`,
`compressed` and `trailingData`. `document.toBuffer(root = document.root)`
returns detached bytes, retaining the source envelope and exact original bytes
when the semantic tree is unchanged or restored. Use a model's `fromBuffer`
and `toBuffer` methods when that model manages the envelope itself.

`TagReadOptions` supports `maxInputBytes`, `maxInflatedBytes`, `maxDepth`,
`maxNodes`, `maxListLength`, `allowTrailingBytes`, `sharedNodeBudget` and
`sharedInflationBudget`. The shared budget shapes are `{ remainingNodes }` and
`{ remainingBytes }`. Defaults are 256 MiB input/inflated bytes, depth 64 and
1,000,000 nodes/list entries. Invalid limits and exhausted budgets fail.

`FormatLimits` supplies `maxBytes` and `maxEntries` for format-specific
collections; defaults are 16 MiB and 100,000 entries. Where listed below,
models retain supplied limits across immutable edits. `DecodeError` exposes a
`code`; recovery-enabled parsers also return `DecodeDiagnostic` records.

---

### `Tag`

Low-level representation of one StarMade tag. Header properties are readonly, but nested arrays, vectors and payloads can be mutable. Every tag has a `type` (`TagType` enum), an optional `name`, and a typed `value`.

**Typed accessors** — each throws `TypeError` if the tag type does not match:

| Method | Returns | Tag type |
|--------|---------|----------|
| `getByte()` | `number` (-128..127) | `BYTE` |
| `getShort()` | `number` | `SHORT` |
| `getInt()` | `number` | `INT` |
| `getLong()` | `bigint` | `LONG` |
| `getFloat()` | `number` | `FLOAT` |
| `getDouble()` | `number` | `DOUBLE` |
| `getString()` | `string` | `STRING` |
| `getBoolean()` | `boolean` | `BYTE` (non-zero = true) |
| `getByteArray()` | `Uint8Array` | `BYTE_ARRAY` |
| `getVector3b()` | `Vector3b` | `VECTOR3b` |
| `getVector3i()` | `Vector3i` | `VECTOR3i` |
| `getVector3f()` | `Vector3f` | `VECTOR3f` |
| `getVector4f()` | `Vector4f` | `VECTOR4f` |
| `getMatrix3f()` | `Matrix3f` | `MATRIX3f` |
| `getMatrix4f()` | `Matrix4f` | `MATRIX4f` |
| `getStruct()` | `Tag[]` (includes `FINISH_TAG`) | `STRUCT` |
| `getList()` | `Tag[]` | `LIST` |
| `getSerializable()` | `SerializableTagElement` | `SERIALIZABLE` |

**Search:**

- `findByName(name: string): Tag | null` — recursive depth-first search for the first child named `name`. Returns `null` when not found.

**Debug:**

- `print(indent?: number): void` — prints an indented tree to stdout, matching Java `Tag.print()`.
- `toString(): string` — one-line summary: `TAG_Int("hp"): 100`.

**Properties:**

- `type: TagType` — tag type ordinal.
- `name: string | null` — tag name, or `null` for anonymous tags.
- `value: TagValue` — raw value (typed according to `type`).
- `listType: TagType | null` — element type for LIST tags.
- `size: bigint` — byte count read from the stream (diagnostic).

**Constants:**

- `FINISH_TAG` — sentinel tag (`TagType.FINISH`, `name=null`, `value=null`). Every STRUCT ends with this tag; filter it with `.filter(t => t.type !== TagType.FINISH)`.
- `NULL_STRING = "null"` — string used when a String tag has no value.

---

### `Tags` — factory namespace

Concise static factories for creating tags. Factories return `Tag` values. They do not provide a deep immutable snapshot.

**Primitives:**

```ts
Tags.byte(name, value)         // TAG_Byte — int8, accepts -128..255
Tags.bool(name, value)         // TAG_Byte from boolean (1 or 0)
Tags.short(name, value)        // TAG_Short — int16
Tags.int(name, value)          // TAG_Int — int32
Tags.long(name, value)         // TAG_Long — int64 (bigint or number)
Tags.float(name, value)        // TAG_Float — float32
Tags.double(name, value)       // TAG_Double — float64
Tags.string(name, value)       // TAG_String
Tags.byteArray(name, value)    // TAG_Byte_Array (Uint8Array or number[])
Tags.nothing(name)             // TAG_Nothing — no payload
```

**Vectors and matrices:**

```ts
Tags.vector3b(name, x, y, z)
Tags.vector3i(name, x, y, z)
Tags.vector3f(name, x, y, z)
Tags.vector4f(name, x, y, z, w)
Tags.matrix3f(name, matrix3f)
Tags.matrix4f(name, matrix4f)
```

**Containers:**

```ts
Tags.struct(name, children)          // TAG_Compound — FINISH_TAG appended automatically
Tags.list(name, items)               // TAG_List — all items must share the same type
Tags.listOfStructs(name, items)      // convenience alias for list() with STRUCT items
```

**Structural updates** — return a new Tag wrapper; unchanged nested values may be shared:

```ts
Tags.setField(struct, fieldName, newTag)
// Replaces the first child named fieldName, or appends it when absent.

Tags.removeField(struct, fieldName)
// Removes the first child named fieldName.

Tags.mergeFields(struct, fields)
// Equivalent to multiple setField calls. Replaces existing fields; appends new ones.

Tags.rename(tag, newName)
// Returns a copy of the tag with a new name.

Tags.withValue(tag, newValue)
// Returns a copy of the tag with a new value.
```

**Safe typed reads from a STRUCT** (return a default when the field is absent):

```ts
Tags.getInt(struct, name, def?)
Tags.getLong(struct, name, def?)
Tags.getString(struct, name, def?)
Tags.getByte(struct, name, def?)
Tags.getFloat(struct, name, def?)
Tags.getBool(struct, name, def?)
```

---

### `StructBuilder`

Fluent builder for constructing a STRUCT step by step.

```ts
const tag = new StructBuilder('PlayerCharacter')
  .add(Tags.int('id', 142))
  .addIf(condition, Tags.string('owner', 'Bob'))   // appends only when condition is true
  .addAll([Tags.float('speed', 4.0), Tags.bool('noAI', false)])
  .build();  // appends FINISH_TAG automatically
```

- `add(tag)` — appends a child tag.
- `addIf(condition, tag)` — appends conditionally.
- `addAll(tags)` — appends multiple tags.
- `build()` — returns the final STRUCT Tag with an appended `FINISH_TAG`.

### `ListBuilder`

Fluent builder for constructing a homogeneous LIST.

```ts
const list = new ListBuilder('items')
  .add(Tags.int(null, 1))
  .addAll([Tags.int(null, 2), Tags.int(null, 3)])
  .build();
```

---

### `toObject(tag: Tag): TagObject`

Converts a Tag tree to a plain JSON-safe object. `BigInt` values are serialized as `"50000n"` strings. Byte arrays are truncated to 32 hex bytes followed by `…`. `FINISH` children are omitted.

### `toJSON(tag: Tag, indent?: number): string`

Convenience wrapper around `JSON.stringify(toObject(tag), null, indent)`. Default indent is 2.

---

## Types

### Vectors

| Class | Fields |
|-------|--------|
| `Vector3b` | `x, y, z: number` (int8) |
| `Vector3i` | `x, y, z: number` (int32) |
| `Vector3f` | `x, y, z: number` (float32) |
| `Vector4f` | `x, y, z, w: number` (float32) |

All vectors have a `toString()` method returning e.g. `"Vector3i(4, 4, 4)"`.

### Matrices

| Class | Fields |
|-------|--------|
| `Matrix3f` | `m00..m22: number` (9 floats, row-major) |
| `Matrix4f` | `m00..m33: number` (16 floats, row-major) |

Both have a `toString()` method printing a formatted grid.

---

## Serializable payloads

SERIALIZABLE tags carry a 1-byte `factoryId` and a binary payload. A registered factory is required to determine the payload length. Unknown or unregistered IDs fail; the format has no general length prefix allowing an unknown factory to be skipped safely.

### `registerAllFactories(): void`

Registers all 7 known StarMade factories. **Must be called once before parsing any file with SERIALIZABLE payloads.**

| Factory ID | Type |
|-----------|------|
| 0 | `ControlElementMapper` — block control links |
| 1 | `ElementCountMap` — block type counts |
| 2 | `NPCFactionNewsEvent` — NPC faction event |
| 3 | `LongSet` — set of int64 values |
| 4 | `BlockBuffer` — block data buffer |
| 5 | `Long2Vector3fMap` — rail positions (long → Vector3f) |
| 6 | `Long2TransformMap` — rail orientations (long → Transform) |

### `RawElement`

Implementation of `SerializableTagElement` retaining the bytes consumed by a known registered factory. It can also wrap caller-supplied bytes; this does not make an unknown factory decodable.

- `factoryId: number`
- `raw: Uint8Array`

### `decodeSerializable(elem): ControlElementMapper | ElementCountMap | ... | RawElement`

Decodes a `RawElement` into a typed object. Returns the `RawElement` unchanged when the factory ID is not recognized.

### `ControlElementMapper`

Parsed block control links (factory 0).

- `links: ControlLink[]` — array of `{ fromX, fromY, fromZ, type, targets }`.

### `ElementCountMap`

Block type count map (factory 1).

- `counts: BlockCount[]` — array of `{ type: number, count: number }`.

### `SerializableTagRegister`

Low-level factory registry.

- `SerializableTagRegister.register[id]` — access a registered factory.
- `SerializableTagRegister.set(id, factory)` — register a custom factory.

---

## Entity parsers (legacy)

Lightweight parser functions that extract semantic fields from a root Tag without building full business objects. Useful for read-only data extraction.

| Function | Input file | Returns |
|----------|-----------|---------|
| `parsePlayerCharacter(root)` | `ENTITY_PLAYERCHARACTER_*.ent` | `PlayerCharacterData` |
| `parsePlayerState(root)` | `ENTITY_PLAYERSTATE_*.ent` | `PlayerStateData` |
| `parseSegmentController(root)` | `ENTITY_SHIP_*.ent`, `ENTITY_SPACESTATION_*.ent` | `SegmentControllerData` |
| `parseFactions(root)` | `FACTIONS.fac` | `FactionsData` |
| `parseCatalog(root)` | `CATALOG.cat` | `CatalogData` |
| `parseFloatingItems(root)` | `FLOATING_ITEMS_ARCHIVE.ent` | `FloatingItemsData` |

These projections validate their recognized schemas. They do not retain a complete editable file envelope; use the corresponding object/document model for edits.

---

## High-level objects

High-level objects combine typed field access, immutable updates, and full Tag round-trip support.

### Catalog

`Catalog.fromTag(root, options?)` and `Catalog.fromBuffer(bytes, options?)`
read `cv0` catalogs. `CatalogOptions` combines `TagReadOptions` and
`FormatLimits`. The `pv0` section holds permission entries; `r0` contains
independent per-blueprint, per-user ratings.

- `new Catalog(entries?, ratings?, options?)` accepts immutable entries and nested rating maps.
- `entries` / `all`: all permission entries. There is no separate `systemEntries` collection.
- `ratings`: detached `ReadonlyMap<string, ReadonlyMap<string, number>>`.
- `find(uid)`, `byOwner(ownerUID)`, `byType(type)` query entries.
- `addEntry(entry)`, `removeEntry(uid)`, `updateEntry(uid, entry)` return new catalogs; duplicate UIDs and missing update targets fail.
- `withRating(uid, user, rating)` changes one signed-byte vote. Removing an entry retains its ratings.
- `toTag()`, `toBuffer()`, `toJSON()` export the complete model. Parsed file envelopes and unrelated sections are retained.

Prefer `CatalogEntry.create(fields, options?)` and `entry.with(changes)` over
positional construction. Its fields are:

| Field | Type / wire meaning |
| --- | --- |
| `uid`, `ownerUID`, `description` | Strings |
| `price`, `dateCreated` | `bigint`, signed LONG; legacy INT prices remain unchanged until edited |
| `permission` | Signed INT flags supplied by the caller |
| `timesSpawned` | Signed INT spawn counter |
| `mass` | Finite float32 |
| `blueprintType` | A `BLUEPRINT_TYPE` name, or retained `UNKNOWN(ordinal)` |
| `classification` | Signed BYTE ordinal |
| `wavePermissions` | Detached complete `Tag[]` payloads |

`timeSpawned` is a deprecated bigint alias for the spawn counter, not a date.
`CatalogEntry.fromTag(tag, options?)`, `toTag()` and `toJSON()` preserve entry
extensions, field names and unedited historical representations.

### FactionManager

`FactionManager.fromTag(root, options?)` / `fromBuffer(bytes, options?)`
accept `TagReadOptions`. Supported source roots are `factions-v0`,
`factions-v1` and `factions-v2`; they retain their respective layouts.

- `factions`, `all`, `relations`: detached collections of immutable models.
- `get(id)`, `getRelation(a, b)`, `getRelationsOf(id)` query identities and undirected relations.
- `playerFactions`, `npcFactions`: filters using the actual NPC interval `-10000000 <= id < -10000`.
- `setFaction(faction)`, `removeFaction(id)`, `setRelation(a, b, code)`, `withLastUpdate(bigint)` return new managers.
- `removeFaction` removes modeled relations involving that faction; unrelated opaque policy sections remain preserved.
- `toTag()` / `toBuffer()` retain invitations, roles, policy sections, extensions and the parsed file envelope.

Relation constants are **`RELATION_NEUTRAL = 0`, `RELATION_WAR = 1`,
`RELATION_ALLY = 2`**. `FactionRelation` exposes `factionA`, `factionB`,
`relation`, `relationName`, `isWar`, `isNeutral`, `isAlly`, `with(changes)` and
`toTag()`; unknown signed-byte codes remain explicit.

`Faction.create(fields, options?)` requires the full `FactionFields`,
including explicit `roles: Tag` and `code: string`. Other fields are `id`,
`name`, `description`, `dateCreated: bigint`, `members`, `openToJoin`,
`homebaseUID`, `password`, `allyNeutral`, `attackNeutral`, `factionPoints`,
`factionMode` and `showInHub`. `faction.with(changes)` preserves the source;
`members` and `roles` are defensive projections. `Faction.fromTag(tag, id,
options?)` reads a single saved faction record.

`new FactionMember(playerUID, role, options?)` stores the actual BYTE role.
Update members through `faction.with({ members: [...] })`, then
`manager.setFaction(faction)`. `member.with({ role })` retains activity and
last-seen extensions. There is no manager-level `addMember` method.

---

### Entity classes

Entity classes parse complete `.ent` files and expose typed fields and immutable update methods.

#### `parseSegmentControllerEntity(root, filename?, options?): Ship | SpaceStation | ShopSpaceStation | FloatingRock`

Selects the entity class from the filename, falling back to `Ship` when no recognized filename is supplied. Options are `TagReadOptions`.

#### `Ship`, `SpaceStation`, `ShopSpaceStation`, `FloatingRock`

All extend `SegmentController` which extends `GameEntity`.

**Parse:**
- `Ship.fromBuffer(data, options?)` — reads from a binary Buffer.
- `Ship.fromTag(root, options?)` — parses from a root Tag.

**`GameEntity` fields (all entity types):**

| Property | Type | Description |
|----------|------|-------------|
| `factionId` | `number` | Faction ID (negative = NPC) |
| `owner` | `string` | Owner player UID |
| `mass` | `number` | Total entity mass |
| `sectorPosition` | `SectorPosition` | Absolute sector in the universe |
| `transform` | `EntityTransform` | Local position and rotation |
| `isNPC` | `boolean` | True when factionId < 0 |
| `entityType` | `string` | `'SHIP'`, `'SPACE_STATION'`, etc. |

`GameEntity.isNPC` retains the legacy negative-ID category; `Faction.isNPC` uses the narrower NPC interval documented above.

**`GameEntity` updates (return a new instance of the same subtype):**
- `withFactionId(fid)` — changes the faction.
- `withOwner(uid)` — changes the owner.
- `withSector(pos)` — moves to a new sector.
- `withMass(mass)` — overrides the mass.

**`SegmentController` additional fields:**

| Property | Type | Description |
|----------|------|-------------|
| `uniqueId` | `string` | Game-assigned entity ID (e.g. `ENTITY_SHIP_...`) |
| `realName` | `string` | Display name shown to players |
| `bounds` | `BlockBounds` | Bounding box in block coordinates |
| `dockingState` | `DockingState` | Docking status |
| `hpState` | `HpState` | Hit points and rebooting state |
| `managerContainer` | `ManagerContainer \| null` | Power, shields, inventories |
| `textBlocks` | `TextBlocks` | Text panel content |
| `creatorId` | `number` | Creator player account ID |
| `seed` | `bigint` | Procedural generation seed |
| `nonEmptySegments` | `number` | Count of non-empty smd3 segments |
| `controlElementMap` | `ControlElementMapper` | Control link data |
| `controlLinks` | `number` | Count of control links |

**`SegmentController` serialize:**
- `toTag()` — rebuilds the root Tag with all updated fields.
- `toBuffer()` — serializes directly to `Buffer`.

#### `PlayerStateEntity`

Represents `ENTITY_PLAYERSTATE_*.ent`.

**Parse:** `PlayerStateEntity.fromBuffer(data, options?)` or `fromTag(root, options?)`, with `TagReadOptions`.

**Fields:**

| Property | Type | Description |
|----------|------|-------------|
| `credits` | `bigint` | Credit balance |
| `faction` | `FactionMembership` | Faction ID and persisted suspension state |
| `currentSector` | `SectorPosition \| null` | Current sector |
| `logoutSector` | `SectorPosition \| null` | Sector at last logout |
| `logoutLocalX/Y/Z` | `number` | Local position at logout |
| `lastLogin` | `bigint` | Login timestamp (ms) |
| `lastLogout` | `bigint` | Logout timestamp (ms) |
| `hasCreativeMode` | `boolean` | Creative mode flag |
| `lastEnteredEntity` | `string` | Last entered entity UID |
| `health` | `number` | Player health |
| `inventory` | `Inventory` | Main inventory |
| `spawnData` | `PlayerSpawnData` | Death and logout spawn points |

**Immutable updates (return new `PlayerStateEntity`):**
- `withCredits(credits)` — sets the credit balance.
- `withCreativeMode(enabled)` — toggles creative mode.
- `withHealth(health)` — sets health.
- `withFaction(id, suspended?)` — changes membership and suspension. The implementation retains the historical parameter name `rank`; it does not represent a faction role.
- `withInventory(inventory)` — replaces contents while retaining the original inventory envelope.

`FactionMembership.suspended` is the real field; `rank` is its deprecated alias.
`toTag()` returns a detached tree, and `toBuffer()` preserves the original file
envelope. Present corrupt fields fail; historical absent fields are retained,
and edits requiring an absent slot fail explicitly.

#### `PlayerCharacterEntity`

Represents `ENTITY_PLAYERCHARACTER_*.ent` (character position and movement data).

**Parse:** `PlayerCharacterEntity.fromBuffer(data, options?)` or `fromTag(root, options?)`, with `TagReadOptions`.

**Fields:** `id`, `speed`, `stepHeight`, `factionId`, `owner`, `sectorPosition`, `noAI`, `spawnController`.

**Immutable updates:** `withId()`, `withSpeed()`, `withStepHeight()`, `withFactionId()`, `withOwner()`.

---

### Other domain objects

#### `PlayerCharacter` (legacy business object)

- `fromTag(root, options?)`, `fromBuffer(data, options?)` (options: `TagReadOptions`)
- Fields: `id`, `speed`, `stepHeight`, `sectorPosition`, `factionId`, `owner`
- Updates: `withId()`, `withSpeed()`, `withStepHeight()`, `withFactionId()`, `withOwner()`

#### `PlayerState` (legacy business object)

- `fromTag(root, options?)`, `fromBuffer(data, options?)` (options: `TagReadOptions`)
- Fields: `credits`, `currentSector`, `logoutSector`, `hasCreativeMode`, `lastEnteredEntity`, `factionId`, `factionSuspended` (`factionRank` is a deprecated alias)
- Updates: `withCredits()`, `withCreativeMode()`, `withFaction(id, suspended?)`

#### `SegmentControllerObject` (legacy)

Lighter alternative to the entity class hierarchy when only Tag-level access is needed.

- `fromTag(root, options?)`, `fromBuffer(data, options?)` (options: `TagReadOptions`)
- Fields: `uniqueId`, `realName`, `factionCode`, `owner`, `sectorPosition`, `creatorId`, `seed`, `nonEmptySegments`
- Computed accessors: `controlElementMapper`, `elementCountMap`, `long2Vector3fMaps`, `long2TransformMaps`
- Updates: `withName()`, `withRealName()`, `withFactionCode()`

#### `ChatChannelManager`

Represents `chatchannels.tag`.

- `fromTag(root, options?)`, `fromBuffer(data, options?)` (options: `TagReadOptions`)
- `manager.channels: ChatChannel[]`
- `manager.find(uid)` — `ChatChannel | undefined`
- `manager.permanentChannels`, `manager.publicChannels` — filtered arrays
- `manager.addChannel(ch)`, `manager.removeChannel(uid)`, `manager.updateChannel(uid, ch)` — return new manager

**`ChatChannel` fields:** `uid`, `password`, `isPermanent`, `isPublic`, `moderators`, `banned`, `muted`.

#### Plain-text chatlogs

`ChatLogReader` reads the separate `chatlogs/*.txt` files written by StarMade-Open
`ChannelRouter`; `ChatChannelManager` handles the Tag archive instead. The source
revision `e5a3b49d8` writes local-time lines as
`yyyy/MM/dd - HH:mm:ss [sender]: message`, or `[sender -> recipient]: message`
for direct messages. No timezone is stored, so `calendar` contains the literal
year, month, day, hour, minute and second without converting to a UTC `Date`.

```ts
import { ChatLogReader } from 'starmade-decoder';

const log = new ChatLogReader('/srv/StarMade', 'all.txt', {
  maxBytes: 1024 * 1024, maxLines: 1000, maxLineBytes: 64 * 1024,
});
let batch = log.readRecent();
// Persist batch.cursor for the next request; render batch.records.
batch = log.poll(batch.cursor);
```

`readRecent()` returns the newest **complete** lines from a bounded tail window;
`truncated` reports skipped older history. `poll(cursor)` returns only subsequent
complete lines. Repeat polling while `hasMore` is true to drain a backlog. A
rotation, file replacement, or shrink sets `reset` and restarts at the beginning.
If the directory or file is absent, both methods return an empty history; a
previous cursor is reset. An unfinished last line stays at the cursor until its
newline arrives. Each record includes its original `raw` text and byte offset;
malformed lines are returned as `kind: 'unparsed'` with a reason rather than
discarded. `parseChatLogLine(raw)` parses one complete line independently.

The reader accepts a single `.txt` basename under `chatlogs/`, rejects symlinked
paths, decodes UTF-8 strictly and caps bytes, lines and line length per call.
Defaults are 1 MiB, 1,000 lines and 64 KiB per line; maximum configurable caps
are 64 MiB, 1,000,000 lines and 1 MiB per line. `maxBytes` must exceed
`maxLineBytes`. A `ChatLogCursor` contains `{ offset, fileId }`; keep both fields.
An empty read caused by a missing file is distinct from I/O or limit errors.
See the [chatlog qualification](CHATLOG_QUALIFICATION.md) for the game-source
reference and validation evidence.

#### `TradingManager`

`TradingManager.fromTag(root, options?)` / `fromBuffer(data, options?)` accept
`TagReadOptions`. `new TradingManager(0, routes, options?)` creates a version-zero
manager. `routes`, `routesFrom(factionId)`, `routesTo(factionId)` and
`routesBetween(a, b)` query the saved routes; the filters use faction IDs.
`addRoute`, `removeRoute(index)` and `updateRoute(index, route)` return new
managers. `toTag`, `toBuffer` and `toJSON` export the result.

`TradeRoute.create(fields, options?)`, `fromTag(tag, options?)` and
`with(changes)` use the complete `TradeRouteFields`:

- `blocks: ElementCountMap`, preserving every row, including duplicate IDs and zero/negative quantities.
- `blockPrice`, `deliveryPrice`, `startTime`, `fromId`, `toId`, `fleetId`: signed LONG `bigint` values.
- `volume`: finite DOUBLE; `fromFactionId`, `toFactionId`: signed INT.
- `startSystem`, `targetSystem`, `currentSector`, `startSector`: integer `{ x, y, z }` coordinates.
- `fromPlayer`, `toPlayer`, `fromStation`, `toStation`: strings.
- `sectorWayPoints`: ordered integer coordinates.

The wire record is `[BYTE version, STRUCT payload]`; its payload has nineteen
required slots. Edits retain the enclosing names, waypoint names, unknown
fields and file envelope. No price, routing or administrative policy is inferred.

#### `SimulationState`

`SimulationState.fromTag(root, options?)` / `fromBuffer(data, options?)` accept
`TagReadOptions`; `new SimulationState(0, groups, uniqueGroups, options?)`
constructs a version-zero state. `uniqueGroups: bigint` is the group-ID
counter. Deprecated `lastUpdate` / `withLastUpdate` aliases refer to that
counter, never to a timestamp.

Use `with({ groups, uniqueGroups })`, `addGroup(group)`, `removeGroup(index)`
and `withUniqueGroups(bigint)`. `toTag()` / `toBuffer()` retain source fields
and the file envelope.

`SimulationGroup` stores the actual sequence `[BYTE version, INT type,
STRUCT STRING-members, LONG startTime, VECTOR3i startSector, INT programId,
metadata]`. Its constructor takes these seven semantic arguments followed by
optional `TagReadOptions`; `fromTag(tag, options?)` and `with(changes)` provide
source-preserving reads and edits. Versions 0/1 and types 0/1/2 are supported.
The required `startSector` is independent of subtype metadata:

| Group type | Metadata |
| --- | --- |
| 0 | `VECTOR3i` target sector |
| 1 | Opaque Tag; the constructor default is BYTE zero |
| 2 | STRUCT beginning with `VECTOR3i` and `STRING`, with extensions retained |

Negative program IDs denote no program; nonnegative supported IDs are 0/1.

#### `NPCFactionManager`

`fromTag(root, options?)`, `fromBuffer(data, options?)`, `with({ version })`,
`toTag()` and `toBuffer()` expose the supported version-zero wrapper while
retaining its unmodeled fields. Options are `TagReadOptions`.

#### `FloatingItemsArchive`

This is the metadata-object archive, distinct from the database's sector-item
stacks. A modern `moi` root holds a BYTE version, an INT `nextId` counter and
sector records. `totalCount` counts objects; it is independent of `nextId`.

- `FloatingItemsArchive.fromTag(root)` / `fromBuffer(bytes)` read modern or genuine historical sector-root layouts.
- `FloatingItemsArchive.create(nextId?)` creates an empty modern archive.
- `sectors`, `items`, `item(id)`, `sector({x,y,z})`, `itemsOfType(blockType)` expose complete records. `byType` returns only the first match.
- `addItem(position, item)`, `updateItem(item)`, `removeItem(id)`, `removeSector(position)` return new archives.
- `withNextId(value)` edits a modern counter; `toModern(nextId?)` explicitly migrates a historical archive.
- `toTag()` / `toBuffer()` preserve source records and file envelopes.

`new FloatingItem(id, blockType, payload, subObjectId?)` requires the complete
opaque metadata `Tag`; it has no quantity field. Methods are `withId`,
`withBlockType`, `withPayload`, `withSubObjectId` and `toTag`.
`FloatingItemSector` exposes `position`, `items`, `withPosition` and
`withItems`. IDs are unique across sectors, and a modern counter must exceed
every saved ID.

---

## Components

Reusable components shared between entity classes.

### `SectorPosition`

Immutable signed-int32 coordinates: `new SectorPosition(x, y, z, options?)`,
`fromValues(x, y, z, options?)`, `fromTag(tag, options?)`, `with({x,y,z})`,
`equals(other)`, `toTag(name?)`. Options are `TagReadOptions`; omitted output
names retain the source name. `ZERO` is the immutable zero coordinate.

### `EntityTransform`

Stores all sixteen float32 components of a matrix without geometric
calculations. `fromMatrix4fList(tag, options?)` requires exactly sixteen FLOATs;
`fromMatrix4fTag(tag, options?)` reads the MATRIX4f variant. Both accept
`TagReadOptions` and retain names and all four formerly omitted components.

- Projection fields: `originX/Y/Z`, `m00/m01/m02`, `m10/m11/m12`, `m20/m21/m22`.
- Additional retained fields: `m03`, `m13`, `m23`, `m33`.
- `with(changes)` preserves unspecified values and the source variant.
- `toTag(name?)` emits that variant; `toMatrix4fList(name?)` / `toMatrix4fTag(name?)` explicitly select an encoding.
- `IDENTITY` and the historical twelve-number constructor use remaining components `0, 0, 0, 1`.

### `DockingState`

`fromTag(tag, options?)`, `toTag()`, `with(changes)`, `dockTo(uid, x, y, z,
orientation?)` and `undock()` retain opaque fields. Names are `dockPosX/Y/Z`,
`sizeX/Y/Z`, `localOrientation`, `dockedTo`, `quaternion`,
`legacyLandedTo` and `legacyLandedPosition`. `isDocked` excludes both `NONE`
and the empty host string. `DockingStateOptions` extends `TagReadOptions`
with the quaternion and two historical Tags; no orientation conversion is applied.

### `HpState`

`fromTag(tag, options?)`, `with(changes)`, `withHp`, `withMaxHp` and `toTag()`
retain source names, the complete `currentHPMatch` SERIALIZABLE and
`rebootRecover`. HP, maximum HP, armor HP, maximum armor HP, reboot start and
reboot time are exposed as `bigint`; `isAlive`, `hpPercent` and `isRebooting`
are computed getters.

The saved class byte is **1**. `CLASS_INT = 0` / `CLASS_LONG = 1` are legacy
constructor width selectors, not alternative class IDs. `HpStateOptions`
extends `TagReadOptions` with independent `hpType` and `armorType`
(`TagType.INT` or `TagType.LONG`). Existing source widths are retained.

### `Inventory`

Slot-indexed inventory with immutable edits. `fromTag` reads the game's `inv1`
lists and supported stash/factory envelopes; `toTag` retains the original
envelope, wrapper fields and opaque item metadata when editing its contents.

- `Inventory.EMPTY` — empty inventory with no caller-supplied slot limit.
- `new Inventory(slots, maxSlots?)` — constructs from a `ReadonlyMap<number, ItemStack>`; each map key must equal its item's slot.
- `Inventory.fromTag(tag, options?: InventoryReadOptions)` / `inventory.toTag()` — reads and writes the game representation.
- `Inventory.fromLegacyTag(tag, options?)` / `inventory.toLegacyTag()` — explicit compatibility with obsolete anonymous SDK tuples. These tuples are not the current game representation; the legacy reader retains its historical fallbacks, and the writer rejects grouped items and opaque metadata payloads.
- `inventory.get(slot)` — `ItemStack | undefined`.
- `inventory.has(slot)` — whether the slot is occupied.
- `inventory.set(item)` — adds or replaces a slot; a zero-count stack removes it.
- `inventory.remove(slot)` — immutable remove.
- `inventory.clear()` — empties contents while retaining the envelope and slot policy.
- `inventory.withContents(other)` — replaces contents while retaining this inventory's envelope and slot policy.
- `inventory.items` — all `ItemStack[]`.
- `inventory.size`, `inventory.maxSlots`, `inventory.isFull` — occupied-slot count and caller policy.
- `inventory.byType(blockType)` — matching stacks, including grouped slots containing that type.
- `inventory.countOf(blockType)` — total quantity, counting the matching members of grouped slots.
- `inventory.add(type, count, slot?)` — adds regular items to a compatible stack or, without a slot, the first unused slot when no compatible stack has room.
- `inventory.split(sourceSlot, destinationSlot, count)` — splits a regular stack into an empty slot.
- `inventory.merge(sourceSlot, destinationSlot)` — merges distinct regular stacks of the same type.
- `inventory.transferTo(target, sourceSlot, destinationSlot, amount?, capacity?)` — returns `{ source, target }` as new inventories; omitting `amount` moves the entire stack. Metadata and grouped stacks must move whole into an empty slot. Within one inventory, use `split` or `merge`.
- `inventory.usedVolume(volumeOf)` — computes volume from an explicit `(type: number) => number` policy, including grouped constituents.
- `inventory.assertCapacity({ maximum, volumeOf })` — checks a caller-supplied volume limit and returns the same inventory; `transferTo` can apply this policy to its resulting target.
- `inventory.toJSON()` — `{ items: ItemStackJSON[], maxSlots: number | null }`; `null` denotes the absence of a caller-supplied slot limit.

`InventoryReadOptions` combines `TagReadOptions` with `maxSlots`.
`maxSlots` defaults to `Infinity` and limits the **number of occupied slots**,
not the largest slot index or the game's storage volume. Inventory edits retain
an explicit limit; this caller policy is not serialized and must be supplied
again when reading. The SDK does not infer universal game/server
capacity rules; provide `InventoryCapacity` when a volume limit is required.
Invalid quantities, incompatible destinations and signed-int overflow fail
without changing either original inventory.

### `ItemStack`

- `new ItemStack(slot, type, count, meta?, group?)` — creates an immutable stack. Slots and counts are nonnegative signed-int32 values; `type` is a signed short.
- `ItemStack.special(slot, { id, type, subId, payload })` — creates one special metadata item. Its negative type excludes the multislot marker `-32768`; quantity is always one. The opaque `payload: Tag` is not a count, and `orientation` is a compatibility field initialized to zero.
- `ItemStack.grouped(slot, name, items)` — creates a multislot from `{ type, count }[]` with distinct positive types and counts. A single member is returned as a regular stack.
- `item.withSlot(slot)`, `item.withCount(count)`, `item.withType(type)` — immutable edits. Group type/count cannot be changed independently of its members; special-item constraints remain enforced.
- `item.toJSON()` — detached `ItemStackJSON`; opaque metadata is represented by a complete encoded Tag in `meta.payloadTagBase64`.

**Fields:** `slot`, `type`, `count`, `meta?: ItemMeta`, `group?: ItemGroup`.
`ItemMeta` contains `id`, `type`, `orientation`, `subId`, and optional `payload`.
`ItemGroup` contains `name` and `items: Array<{ type, count }>`; its container
uses type `-32768`. Metadata, grouped members and their Tag payloads are copied
defensively on input and access.

### `InventoryLocation`

`new InventoryLocation(kind, position, inventory)` identifies storage by its
entity-local block position. Fields are `kind: number`, a detached immutable
`position: Readonly<BlockPosition>`, `inventory: Inventory`, and `key: string`.
Coordinates are signed-int32 values; the stable position key does not include
the kind. Multiple inventories may share the same kind.

### `PowerState`

`fromTag(tag, options?)` reads the two-DOUBLE STRUCT; `fromTagOld(tag,
options?)` also accepts the historical scalar DOUBLE. `toTag()` retains that
variant until an edit needs the full record. Fields are `initialPower` and
`initialBatteryPower`; edits use `with(changes)`, `withPower` and `withBattery`.
`PowerStateOptions` extends `TagReadOptions` with `legacy?: boolean`.

### `ThrustConfig`

`fromTag(tag, options?)` reads the current version-zero tuple;
`fromTagOld(tag, options?)` explicitly reads the historical timer-based
variant. `ThrustConfigOptions` combines `TagReadOptions` with `legacy` and
`legacyTimer`. `toTag()` retains the original variant, names and extensions.

Fields are `version`, `automaticDampeners`, `automaticReactivateDampeners`,
`thrustBalanceX/Y/Z`, `rotationBalance`, `automaticDampenersOnExit`,
`thrustSharing` and `repulsorBalance`. Use `with(changes)`,
`withDampeners(enabled)` or `withThrustSharing(enabled)`; change repulsor
balance with `with({ repulsorBalance })`.

### `ManagerContainer`

Container for all module state (power, shields, inventories, texts, slot assignments).

- `ManagerContainer.EMPTY` — empty singleton.
- `ManagerContainer.fromTag(tag, options?: TagReadOptions)` / `mc.toTag()`.
- `mc.inventoryEntries` — the complete position-indexed collection as `readonly InventoryLocation[]`; malformed entries and duplicate positions fail explicitly.
- `mc.getInventoryAt(position)` — the inventory at one block position, or `undefined`.
- `mc.withInventoryAt(position, inventory, kind?)` — inserts or replaces one location, retaining existing wrapper metadata. Omitted `kind` preserves the existing kind or defaults a new entry to stash kind `3`.
- `mc.withoutInventoryAt(position)` — removes exactly one location.
- `mc.getInventory(kind = 0)` — compatibility lookup by kind; returns `Inventory.EMPTY` when absent and throws when several locations share that kind.
- `mc.mainInventory`, `mc.capsuleInventory`, `mc.microInventory`, `mc.macroInventory` — legacy aliases for kinds `0`, `1`, `2`, `3`, with the same ambiguity checks. Their names do not define game storage semantics: kind `1` is a credits converter and kind `3` is a stash.
- `mc.inventories` — detached legacy `ReadonlyMap<number, Inventory>` keyed by kind; it cannot represent every location when kinds repeat. Use `inventoryEntries` for complete enumeration.
- `mc.relevantElementCountMap` — block count ECM from index [7], or `null`.
- `mc.withInventory(kind, inventory)` — compatibility update by kind; rejects ambiguous kinds. If the kind is absent, creates an entry at the origin only when that position is free; otherwise use `withInventoryAt` with an explicit position.
- `mc.withPower(powerState)`, `mc.withInitialShields(value)`, `mc.withTexts(texts)`, `mc.withSlotAssignment(sa)`, `mc.withPullPermission(perm)` — immutable field updates.
- `mc.powerReactor` / `withPowerReactor(value)` retain the separate PowerInterface tree at slot 15; `mc.shieldAddOn` / `withShieldAddOn(value)` expose slot 3. `powerState` is the separate slot-2 value; `initialShields` is the legacy scalar projection of slot 3.
- **Other fields:** `initialShields: number`, `powerState: PowerState`, `texts: TextBlocks`, `slotAssignment: SlotAssignment`, `pullPermission: PullPermission`.
- **`PullPermission` enum:** `ALL = 0`, `SELF = 1`, `NONE = 2`.

Manager updates are immutable. Replacing an existing inventory changes
its contents while retaining that location's stash/factory envelope and other
manager fields.

### `SpawnPoint`

`fromTag(tag, options?)`, `toTag()` and `with(changes)` retain the source
point, including `absolutePosBackup: Vector3f | null` and unknown suffix
fields. Other fields are `entityUID`, `sector: SectorPosition`,
`localX/Y/Z` and `gravX/Y/Z`. `SpawnPointChanges` supports all these values,
including an explicit backup vector. Options are `TagReadOptions`.

### `PlayerSpawnData`

`fromTag(tag, options?)` reads death/logout `SpawnPoint` records, retains the
version BYTE and validates the optional pre-special vectors or BYTE-zero
absence markers. The reader uses their types, not a version-based guess.
`preSpecialSector` and `preSpecialOrigin` are nullable; compatibility scalar
origin getters return zero when no origin is stored.

Use `with({ deathSpawn, logoutSpawn, preSpecialSector, preSpecialOrigin })`,
`withDeathSpawn`, `withLogoutSpawn` and `toTag`. Source layouts, names and
extensions survive edits; null writes/restores an absent pre-special value.

### `SpawnMarker` and `SpawnController`

`SpawnMarker.fromTag(tag, options?)` retains `[STRUCT spawner, LONG
lastSpawned, VECTOR3i position]` and extensions. The `spawner` getter returns
a detached complete payload. `new SpawnMarker(time, x, y, z, spawner?,
options?)` uses the real empty DefaultSpawner when no payload is supplied.
`with(changes)` edits `lastSpawned`, `sectorX/Y/Z` or `spawner`.

`SpawnController.fromTag(tag, options?)`, `markers`, `withMarkers(markers)`,
`addMarker(marker)` and `toTag()` retain the container and marker-list names.
Corrupt records fail instead of being skipped. Options are `TagReadOptions`.

### `TextBlocks`

`TextBlocks.EMPTY`, `fromTag(tag, options?)`, `size`, `has(position)`,
`get(position)`, `entries()`, `positions()`, `set(position, text)`,
`delete(position)`, `toTag()` and `toJSON()` expose immutable panel text.
Position keys are signed-int64 `bigint`; `positions()` also returns decoded
integer block coordinates. Options are `TagReadOptions`.

### `SlotAssignment`

`new SlotAssignment(version, slots, options?)`, `fromTag(tag, options?)`,
`slots`, `assign(slot, position)`, `unassign(slot)`, `toTag()` and `toJSON()`
retain stored BYTE slot IDs and LONG packed positions. `SlotAssignmentOptions`
extends `TagReadOptions` with `minSlot` / `maxSlot`: these constrain new
assignments, defaulting to 0..9. Decoding retains all valid signed-byte keys.

---

## Config API

### `SMToolConfig`

Entry point for all StarMade installation paths.

**Parse:**
- `SMToolConfig.fromData({ starmadeDir, worldDir? })` — constructs directly from values.
- `SMToolConfig.load(projectRoot?)` — reads `SMToolConfig.json` from the given directory (or `cwd`). Creates the file with defaults and **throws** when `starmadeDir` is missing.

**Properties:**
- `starmadeDir: string` — StarMade root directory.
- `worldDir: string` — world name under `server-database/` (default `world0`).
- `paths: StarMadePaths` — computed paths object with `root`, `dataConfig`, `serverCfg`, `worldDatabase`, `custom.*`.

**Methods:**
- `validate(): void` — throws if `starmadeDir`, `data/config/`, or `worldDatabase` are missing.
- `isValid(): boolean` — returns `false` instead of throwing.
- `save(projectRoot?)` — writes `SMToolConfig.json`.
- `withStarmadeDir(dir)`, `withWorldDir(world)` — immutable updates.
- `toString()` — human-readable summary.

### `ServerConfig`

`load(config, options?)` and `fromString(text, options?)` accept
`FormatLimits`. The model retains comments, blank lines and unknown keys.

- `get(key)`, `getString(key)`, `getNumber(key)`, `getBoolean(key)`, `getFloat(key)` read values using the accessor's conversion; `get` falls back to the schema default or an empty string.
- `entries()` returns a detached map; `keys()` lists keys; `isKnown(key)` tests schema membership.
- `set(key, value)` / `setMany(values)` return immutable edits, validating known-key types and rejecting writes to unknown schema keys. Unknown text read from a file remains retained.
- `toString()` exports the file in memory; `save(config)` writes `server.cfg`.
- `SERVER_CONFIG_SCHEMA` exposes the **210 active settings** from StarMade-Open
  `e5a3b49d86943c4d618cea6512e28fa0b95901df`. Use
  `SERVER_CONFIG_SCHEMA_SOURCE` to identify the pinned game revision.
- Each `ConfigEntryMeta` has `type` (`string`, `boolean`, `number`, `float`),
  `kind` (`string`, `boolean`, `int`, `long`, `float`, `enum`), `default`,
  `category` and `description`. Numeric settings have inclusive `min` and `max`;
  booleans and enums have `choices`. Free text has neither range nor choices.
  Metadata and choice lists are immutable.
- `set` and `setMany` reject numbers outside the game range and enum values
  outside its choices. Integer and long values must be safe JavaScript integers.
  Enum spelling is accepted case-insensitively, matching the game reader.
  Existing out-of-range numeric lines remain readable and unchanged until edited;
  this lets tools inspect older files without silently rewriting them.
- The ten keys removed from the current game schema are treated like other
  unknown lines: they remain in the original file text, but `isKnown` is false
  and `set` rejects them. Existing values never acquire a guessed current default.

For example, `SERVER_CONFIG_SCHEMA.SECTOR_SIZE` has default `5000`, inclusive
range `2000`–`1000000` and a warning about shrinking an existing universe.
`DEFAULT_GAME_MODE` offers `SURVIVAL` and `CREATIVE`.

### `BlockConfig`

Loads and edits `BlockConfig.xml`. Provides typed access to raw block definitions
and StarMade-Open-inspired `BlockElementInfo` views.

**Parse:**

- `BlockConfig.load(config)` — reads the vanilla file from `data/config/` and merges any custom override from `customBlockConfig/BlockConfigImport.xml` when present.
- `BlockConfig.fromXml(xmlString, blockTypes?)` — parses directly from XML string.
- `BlockConfig.fromBlocks(iterable)` — constructs from `BlockDefinition` values without I/O. Rejects invalid IDs, duplicate IDs, duplicate normalized type names, and numeric XML type names that disagree with their IDs. Type-name comparisons trim whitespace and ignore case.

**Read:**

- `bc.getById(id)` — `BlockDefinition | undefined`.
- `bc.getByName(name)` — case-insensitive, `BlockDefinition | undefined`.
- `bc.getByTypeName(typeName)` — BlockTypes XML key lookup, `BlockDefinition | undefined`.
- `bc.all` — all `BlockDefinition[]`.
- `bc.elementInfo` — all `BlockElementInfo[]` views.
- `bc.size` — total count.
- `bc[Symbol.iterator]()` — iterates `BlockDefinition` values.

**Element information:**

- `definition.toElementInfo(config?)` — returns one domain-grouped `BlockElementInfo`.
- `bc.getElementInfoById(id)` — element information by numeric block ID.
- `bc.getElementInfoByName(name)` — element information by display name.
- `bc.getElementInfoByTypeName(typeName)` — element information by BlockTypes key.
- `bc.resolveReference(typeNameOrId)` — stable block reference with unresolved fallback.
- `bc.resolveIngredient(ingredient)` — recipe ingredient plus resolved block reference.

`BlockElementInfo` groups data into `identity`, `render`, `logic`, `recipe`,
`factory`, `collision`, `chamber`, and `classification` sections. This mirrors
the shape of StarMade-Open `ElementInformation` while keeping the raw
`BlockDefinition` available as `info.block`.

**Mutate (return new `BlockConfig`):**

- `bc.set(definition)` — adds or replaces a block definition.
- `bc.delete(id)` — removes a block definition.

**Serialize:**

- `bc.toXml()` — returns XML in memory, retaining each `xmlTypeName` and extension data. Symbolic names require the corresponding BlockTypes mapping when reading.
- `bc.toBlockTypesProperties()` — returns a deterministic Java Properties mapping from every XML type name to its numeric ID, with escaped keys where necessary. Export it alongside `toXml()` for newly introduced types.
- `bc.saveCustom(config, vanilla)` — writes **only changed or added** definitions to `customBlockConfig/BlockConfigImport.xml`. Never modifies `data/config/BlockConfig.xml`.
- `bc.saveAll(config)` — writes all definitions to the same custom import path. These filesystem helpers retain the numeric-ID import format.

### `BlockDefinition`

`BlockDefinition.create(options: BlockDefinitionOptions)` requires `id` and
`name`; all other persisted fields are optional. Creation accepts IDs `1..4094`
and a nonempty name. Defaults include `xmlTypeName: CUSTOM_BLOCK_<id>`, icon `0`,
100 HP, mass and volume `0.1`, price `100`, and six zero texture IDs. Partial
`metadata` merges with defaults, including partial `effectArmor` values.

`definition.with(overrides: BlockDefinitionUpdate)` returns an independent copy
and accepts every persisted field, including `id`, `icon`, `xmlTypeName`,
`textureIds`, `slabIds`, `styleIds`, `computerReference`, and `extraProperties`.
Partial metadata merges with existing metadata; unmodified fields remain intact.
Input arrays and objects are detached and frozen.

```ts
const original = BlockDefinition.create({ id: 2000, name: 'Custom hull' });
const clone = original.with({
  id: 2001, name: 'Custom light hull', xmlTypeName: 'CUSTOM_LIGHT_HULL',
  icon: 12, textureIds: [1, 2, 3, 4, 5, 6], mass: 0.05,
  metadata: { effectArmor: { heat: 2 } },
});
const blocks = BlockConfig.fromBlocks([original, clone]);
const xml = blocks.toXml();
const properties = blocks.toBlockTypesProperties();
```

`extraProperties` exposes unknown block XML elements and attributes using
`@_attributeName` keys. Nested extension values retain their original strings,
including numeric-looking text and whitespace. Reading, editing and exporting
also preserves unknown attributes and children on known fields. This preserves
extension data semantically; XML formatting is not a byte-for-byte contract.

**`BlockDefinition` key fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Numeric block ID |
| `name` | `string` | Display name |
| `xmlTypeName` | `string` | XML/BlockTypes identity |
| `icon` | `number` | Build icon index |
| `hp` | `number` | Hit points |
| `mass` | `number` | Mass in tonnes |
| `volume` | `number` | Volume in m³ |
| `price` | `number` | Shop price in credits |
| `armor` | `number` | Armor value (0 = none) |
| `isPlacable` | `boolean` | Can be placed by players |
| `inShop` | `boolean` | Available in shops |
| `hasOrientation` | `boolean` | Supports rotation |
| `canActivate` | `boolean` | Can be toggled |
| `isDeprecated` | `boolean` | Should not be used |
| `textureIds` | `readonly number[]` | Texture IDs in StarMade face order |
| `animated` | `boolean` | Raw XML animation flag |
| `blockStyle` | `number` | StarMade block style ID |
| `slabIds`, `styleIds` | `readonly number[]` | Variant block IDs |
| `computerReference` | `number` | Controller block ID; `0` means none |
| `metadata` | `BlockDefinitionMetadata` | Less common parsed BlockConfig tags |
| `extraProperties` | `Readonly<Record<string, unknown>>` | Preserved unknown XML fields |

- `definition.style` — resolved `BlockStyleDescriptor`.
- `definition.resourceInjectionInfo` — resolved `ResourceInjectionDescriptor`.
- `definition.defaultOrientation` — StarMade-Open default orientation rule.
- `definition.render`, `definition.collision`, `definition.factory` — focused views without reference resolution.

### `BlockRegistry`

Process-wide singleton for fast block name and property lookups. Must be initialized before using enriched views.

- `BlockRegistry.init(config)` — initializes from a loaded `BlockConfig`.
- `BlockRegistry.isInitialized` — `true` after `init()`.
- `BlockRegistry.get(id)` — `BlockDefinition | null`.
- `BlockRegistry.getName(id)` — display name, or `"block#id"` when unknown.
- `BlockRegistry.getHp(id)` — `number | null`.
- `BlockRegistry.getMass(id)` — `number | null`.
- `BlockRegistry.getPrice(id)` — `number | null`.
- `BlockRegistry.reset()` — clears the registry (used in tests).

### `BlockBehaviorConfig`

Reads `blockBehaviorConfig.xml` (engine, shield, and gameplay multipliers).

- `BlockBehaviorConfig.load(config, options?: FormatLimits)` — loads from the StarMade installation.
- `BlockBehaviorConfig.fromXml(xml, options?: FormatLimits)` — parses from XML string.
- `bc.getNumber(key, def?)`, `bc.getBoolean(key, def?)`, `bc.getString(key, def?)` — dot-notation key access (e.g. `'BlockBehaviorConfig.General.BasicValues.ShieldCapacityInitial'`).
- `bc.set(key, value)` — immutable update.
- `bc.saveCustom(config, vanilla)` — writes only diffs to `customBlockBehaviorConfig/customBlockBehaviorConfig.xml`.

### `FactionConfig`

Reads `FactionConfig.xml` (faction activity and scoring parameters).

- `FactionConfig.load(config, options?: FormatLimits)` — loads vanilla + custom override.
- `FactionConfig.fromXml(xml, options?: FormatLimits)` — parses from XML string.
- `fc.getNumber(key, def?)`, `fc.getBoolean(key, def?)`, `fc.getString(key, def?)`.
- `fc.set(key, value)` — immutable update.
- `fc.saveCustom(config, vanilla)` — writes only diffs to `customFactionConfig/FactionConfig.xml`.

---

## Additional file documents

These models own snapshots of caller data. Collection getters and exported
buffers are detached; edits return new models. `fromBuffer` retains exact
source bytes for unchanged semantic data and for edits that restore the full
original semantic state. Text formats may use canonical formatting after an
edit. All examples use exports from `starmade-decoder`.

### `WorldSeedDocument`

Models the world's `.seed` file: exactly eight bytes containing one signed
big-endian int64.

- `new WorldSeedDocument(seed: bigint, options?: FormatLimits)`.
- `WorldSeedDocument.fromBuffer(bytes, options?)`.
- `seed`, `withSeed(bigint)`, `toBuffer()`, `toJSON(): { seed: string }`.

Use bigint literals or decimal strings converted with `BigInt`; the document
does not accept imprecise JavaScript number seeds. Lower-level
`parseWorldSeed` / `writeWorldSeed` are also exported.

### `PersistentObjectDocument`

Models StarLoader `.smdat` class-grouped JSON without instantiating application
classes. `PersistentObjectEntry` is `{ className: string, objects: unknown[] }`.

- `new PersistentObjectDocument(entries?, options?: PersistentObjectLimits)`.
- `fromBuffer(textOrBytes, options?)`, `entries`, `objectsFor(className)`.
- `withClass(className, objects)` replaces all blocks of that class at its first occurrence; `withoutClass(className)` removes them.
- `toBuffer()`, `toJSON()`.

Repeated class blocks are retained on read. `PersistentObjectLimits` adds
aggregate `maxNodes` (default 100,000) and `maxDepth` (default 64) to
`FormatLimits`. Values must be JSON-compatible: unsafe integer numbers,
non-finite values, sparse arrays and non-JSON objects are rejected. Lower-level
`parsePersistentObjects` / `writePersistentObjects` remain available.

### `SystemNamesDocument`

Models `systemNames.syl` tokens and flags without implementing the game's name
generation algorithm. Each `SystemNameSyllable` is `{ value, flags: string[] }`.

- `new SystemNamesDocument(syllables?, options?: FormatLimits)`.
- `fromBuffer(textOrBytes, options?)`, `syllables`, `withFlag(flag)`.
- `set(index, syllable)` replaces an entry or appends at the current length; `remove(index)` removes one existing entry.
- `toBuffer()`, `toJSON()`.

`withFlag` is a filter returning syllables, not an editing method. Unchanged
input retains comments and original line endings; edited output is canonical.
The lower-level helpers are `parseSystemNames` / `writeSystemNames`.

### `SubtitleDocument`

Models SBV cues `{ startMs, endMs, lines }` in source order. Timestamps are
nonnegative safe integer milliseconds; each cue requires text and an end no
earlier than its start. At least one cue is required.

- `new SubtitleDocument(cues, options?: FormatLimits)`.
- `fromBuffer(textOrBytes, options?)`, `cues`, `at(timeMs)`.
- `set(index, cue)`, `remove(index)`, `shift(milliseconds)` return new documents; removing the final cue fails.
- `toBuffer()`, `toJSON()`.

`at` returns all overlapping cues in source order with half-open intervals
`[startMs, endMs)`. `parseSbvSubtitles`, `writeSbvSubtitles`,
`parseSbvTimeCode` and `formatSbvTimeCode` provide lower-level conversions.

### `XmlConfigDocument`

`XmlConfigDocument.fromXml(xml, options?: FormatLimits)` parses an ordered XML
document while preserving attributes, comments, repeated elements, CDATA and
unknown extension nodes. DTDs are unsupported. `XmlConfigValue` is
`string | number | boolean`.

- `get(path)` returns a scalar or `undefined`; requesting a container fails.
- `entries()` returns a detached map of scalar paths and values.
- `set(path, value)` returns an edited document; `merge(custom)` overlays another document with the same root.
- `toXml()` exports the complete document; `difference(vanilla)` exports changed subtrees for an overlay.

Paths use dots and explicit zero-based sibling indices, for example
`Config.Item[1].Enabled`. Escape a literal dot as `\.` in the path
(`'Config.Some\\.Name'` in a JavaScript string). An unindexed repeated name is
ambiguous and fails. Scalar edits retain leaf attributes and sibling nodes;
repeated groups in an overlay are replaced as groups. This is the public
primitive also used by `BlockBehaviorConfig` and `FactionConfig`.

## Database binary values

The SDK exposes codecs and immutable value models for individual VARBINARY
columns; it does not open a database connection or apply changes to a server.

| Model | Read/create | Main edits and output |
| --- | --- | --- |
| `FleetCommandObject` | `fromBytes(bytes, profile?)`, `create(fleetDbId, commandType, args?, profile?)` | `withFleetDbId`, `withCommand`, `withArgs`, `toBytes(padTo?)`, `toJSON` |
| `FleetRemotesObject` | `fromBytes(bytes, options?)`, `empty()` | `withRemote`, `withToggle`, `withoutRemote`, `toBytes()`, `toJSON` |
| `SectorItemsObject` | `fromBytes(bytes)`, `from(items)`, `empty()` | `withItem`, `withoutType`, `withMerged`, `toBytes`, `toJSON` |
| `TradePricesObject` | `fromBytes(bytes, profile?)`, `empty(entDbId, profile?)` | `withBuyOrder`, `withSellOrder`, `withoutBuyOrder`, `withoutSellOrder`, `toBytes`, `toJSON` |
| `StarSystem` | `fromBytes(infos, resources, { includeVoid, profile }?)`, `empty(profile?)` | `withSector`, `withSectorType`, `withResourceDensity`, `infosToBytes`, `resourcesToBytes(size?)`, `toJSON` |

Corresponding raw helpers are `decodeFleetCommand` / `encodeFleetCommand`,
`decodeFleetRemotes` / `encodeFleetRemotes`, `decodeSectorItems` /
`encodeSectorItems`, `decodeTradeNodeItems` / `encodeTradeNodeItems`,
`decodeSystemInfos` / `encodeSystemInfos`, and `decodeSystemResources` /
`encodeSystemResources`. Nullable command/price input may produce `null`;
consult the model's declared return type before editing.

`DatabaseProfile` is `current` (default, Open `e5a3b49d8`) or `legacy-sdk`
(the SDK 2.0.1 interpretation, not a game-version guarantee). Each business object
exposes a readonly `profile` retained by its immutable edits. Select it explicitly
when reading historical data; neither ordinals nor the JSON projections carry an
automatic version discriminator.

The current contract has 24 fleet commands, sector `VOID = 6`, planet types
`MARS/EARTH/DESERT/PURPLE/ICE`, and standard **zlib-wrapped** trade payloads.
The legacy contract keeps 22 commands, `VOID = 7`, historical planet labels and
raw DEFLATE. Malformed zlib never silently falls back to raw DEFLATE.

Raw profile arguments: `decodeFleetCommand(bytes, profile?)`,
`decodeTradeNodeItems(bytes, profile?)`, `encodeTradeNodeItems(prices, profile?)`,
`decodeSystemInfos(bytes, {includeVoid, profile}?)`, `encodeSystemInfos(entries, profile?)`.
`encodeFleetCommand` writes the raw ordinal supplied by its caller; named construction
through `FleetCommandObject.create` resolves it using the selected contract.

Resource cells accept 16 or 19 bytes. `encodeSystemResources(resources, size = 16)`
and current-profile `StarSystem.resourcesToBytes()` write 16 bytes; a legacy system
defaults to 19. Pass `19` explicitly for an extended target. Nonzero densities that
would be lost are rejected. The SDK keeps a canonical 19-slot internal resource
view; only the first 16 exist in the current game. Absent resource cells expose
`resources = []`, preserved by sector-only edits; setting a density creates a
complete resource view. Resource labels for the first 16 IDs now match the game.

```ts
const attack = FleetCommandObject.create(42n, 'FLEET_ATTACK'); // ordinal 6
const historical = FleetCommandObject.fromBytes(oldBytes, 'legacy-sdk');
const current = StarSystem.empty().withSectorType(0, 0, 0, 'SUN');
const resources = current.resourcesToBytes(); // 16 bytes
```

---

## Blueprint and segment API

### Block and hierarchy classes

See [format classes](FORMAT_MODELS.md) for examples, ownership, limits and migration.

| Class | Main API |
| --- | --- |
| `BlockState` | `new BlockState(data)`, `create(type, fields?)`, `fromWord(word)`, `with(fields)`, `toWord()`, `toJSON()`, `fullHitpoints(definition)`, `withFullHitpoints(value, definition)` |
| `PlacedBlock` | Immutable `position`, `state`, optional `definition`; native `localPosition`, `segmentOrigin`, `toJSON()` |
| `Segment` | `new Segment(origin?)`, detached `fromData(data)`, live `attach(data)`, `get(x,y,z)`, `set(x,y,z,data)`, `setTimestamp(bigint)`, `entries(config?, includeAir?)`, `toData()`, `toPackedWords()`, `toJSON()` |
| `BlockVolume` | Live `new BlockVolume(files?, options?)`, detached `fromFiles(files, options?)`, `refresh()`, `segmentAt(position)`, `get(position)`, `blockAt(position)`, `set(position, data)`, `remove(position)`, `entries(includeAir?)`, `countsByType()`, `toFiles()` |
| `BlueprintModel` | `new BlueprintModel(archive, options?)`, `nodes()`, `find(fullPath)`, `blockCount`, `toJSON()` |
| `BlueprintNode` | `path`, `parentPath`, `entity`, `blocks`, `toJSON()`; each entity retains its own grid |

`Segment` exposes `x/y/z`, `version`, `lastChanged` and content-derived `blockCount`.
`BlockVolume` exposes `segments`, `segmentCount` and `blockCount`. State/position
snapshots are immutable; live editors retain cached counts and indices. Refresh
or recreate them after raw edits or edits through another view of the same data.

`BlockVolumeOptions` accepts `config`, `maxSegments` and `regionCoordinates` for
empty source files. `BlueprintModelOptions` accepts `config`, `maxEntities`,
`maxDepth` and aggregate `maxSegments`. Native addressing helpers are
`validateBlockPosition`, `segmentOriginOf`, `localPositionOf`,
`regionCoordinatesOf` and `blockPositionKey`; no rendered transforms are computed.

`BlueprintDocument.blocks(entity?, config?)` creates a live entity grid retaining
original empty-region filenames. `.model(config?)` exposes a bounded hierarchy
using the document's limits. Edits flow into the existing document writers.

### `.smd3` segment files

```ts
import { parseSmd3, writeSmd3, emptySegment, emptySmd3File, getBlock, posToIndex, indexToPos } from 'starmade-decoder';
```

- `parseSmd3(data, options?: Smd3ParseOptions)` — parses a `.smd3` file into `Smd3File`.
- `writeSmd3(file, segVersion?)` — encodes a validated, complete region to `Buffer`; defaults to version 7 with four-byte block words and raw LZ4. Version 6 data can be migrated; incomplete recovery results and unsupported historical migrations are rejected.
- `emptySegment(x?, y?, z?)` — creates an empty `SegmentData` at the given coordinates.
- `emptySmd3File()` — creates an empty `Smd3File` with no segments.
- `getBlock(segment, x, y, z)` — `BlockData` at local coordinates within a segment.
- `posToIndex(x, y, z)` — converts local `(x, y, z)` to a flat block array index.
- `indexToPos(index)` — inverse of `posToIndex`.

**`Smd3File` fields:** `headerVersion: number`, `segments: SegmentData[]`, `usedSlots: number`, optional `complete: boolean` and `diagnostics: DecodeDiagnostic[]`. Parsed files include completeness and diagnostics; the region header version is distinct from each segment's version.
**`SegmentData` fields:** `version`, `x, y, z` (entity block coordinates aligned to 32), `lastChanged: bigint`, `blockCount`, `blocks: BlockData[]` (length `BLOCK_COUNT = 32768`). Writers recalculate derived block counts.
**`BlockData` fields:** `type: number` (`0` is air; v7 supports `0..8191`), `hp: number` (stored `0..127`), `active: boolean`, `orientation: number` (`0..31`), and optional `extra: number` (`0..63`, reserved bits 26–31). Missing `extra` means zero; decoding and writing preserve these bits.

`Smd3ParseOptions` selects `mode: 'strict' | 'recover'`, `maxInputBytes`,
`maxBlocks` and explicit `sideNormals` for geometry-dependent records.
`legacyV7ZlibBigEndian` is an explicit compatibility flag for old SDK output.
Recovery returns diagnostics and may set `complete: false`; writers reject
incomplete recovered data instead of silently publishing omitted records.

**Constants:** `CHUNK_DIM = 32`, `BLOCK_COUNT = 32768`, `VERSION_4BYTE = 7`, `DATA_AVAILABLE`, `DATA_EMPTY`, `DATA_SINGLE`, `DATA_BITMAP`, `DATA_SINGLE_SIDE_EDGE`.

### `.sment` blueprint archives

- `parseSment(data, options?: BlueprintParseOptions)` — parses a `.sment` ZIP archive into a `BlueprintArchive`.
- `parseBlueprintFolder(folderPath, options?: BlueprintParseOptions)` — parses an extracted blueprint directory into the same `BlueprintArchive` view.
- `BLUEPRINT_TYPE` — array of valid blueprint type strings in ordinal order.
- `BLUEPRINT_CLASSIFICATION` — array of valid `BlueprintClassification` names in ordinal order.

**`BlueprintArchive` fields:** `root: BlueprintEntity`, `totalEntities: number`, `totalSegments: number`, `entities`, `totalBlockCount`.
**`BlueprintArchive` helpers:** `findEntity(name)`.
**`BlueprintEntity` fields:** `name`, `header: BlueprintHeader`, `meta: BlueprintMeta | null`, `logic: BlueprintLogic | null`, `offset`, `worldOffset`, `segments: Smd3File[]`, `children: SmentEntity[]`.
**`BlueprintEntity` helpers:** `entityType`, `directBlockCount`, `declaredBlockCount`, `segmentFileCount`, `attachmentCount`, `child(name)`, `findEntity(name)`, `allEntities()`, `withHeader(header)`, `withMeta(meta)`, `withLogic(logic)`, `withChildren(children)`.

### Complete blueprint documents and writers

- `readBlueprintDocument(data, options?)` / `BlueprintDocument.fromSment(...)` — strict complete `.sment` document with retained original bytes.
- `readBlueprintFolderDocument(path, options?)` / `BlueprintDocument.fromFolder(...)` — complete file snapshot.
- `BlueprintDocument.fromArchive(archive, options?)` — canonical document from a new complete model.
- `writeSment(documentOrArchive, options?)` — `.sment` `Buffer`.
- `writeBlueprintFolder(documentOrArchive, destination, options?)` — staged folder publication; destination is the root itself.
- `document.root`, `document.archive` — editable models; `document.files` / `toFiles(options?)` — detached `Map<string, Buffer | null>` inventory.
- `document.setFile(relativePath, bytes)`, `removeFile(relativePath)` — ancillary resource edits.
- `document.toBuffer(options?)`, `writeFolder(destination, options?)` — exports.
- `new Smd3Document(bytes, segmentOptions?)` — `file` and `toBuffer(replacementFile?)` preserve original region allocation and unchanged records.

`BlueprintParseOptions` includes `mode`, `maxInputBytes`, `maxEntryBytes`,
`maxTotalBytes`, `maxEntries`, `maxEntities`, `maxDepth`, `maxBlocks`,
`maxTagNodes` and `segmentOptions`. Document writers require a complete model.
`BlueprintWriteOptions` extends these options with `overwrite?: boolean`.
See [guarantees, model updates, Java reference and qualification](BLUEPRINT_EDITING.md).

### `.smbph` header files

- `parseSmbph(data)` — parses a `.smbph` file into `BlueprintHeader`.
- `writeSmbph(header, gameVersion?)` — encodes a `BlueprintHeader` or compatible high-level object to a `.smbph` `Buffer`. The `gameVersion` argument overrides `header.gameVersion`.

**`BlueprintHeader` fields:** `headerVersion`, `gameVersion`, `entityType`, `classification`, `classificationName`, `boundingBox: BoundingBox`, `blockCountByType`, `totalBlockCount`, `score: BlueprintIndexScore | null`.
**`BlueprintHeader` helpers:** `entityTypeOrdinal`, `classificationOrdinal`, `hasScore`, `blockTypeCount`, `isEmpty`, `boundsSize`, `boundsCenter`, `boundsVolume`, `blockCountOf(type)`, `hasBlockType(type)`, `blockShare(type)`, `topBlockTypes(limit?)`, `withHeaderVersion(version)`, `withGameVersion(version)`, `withEntityType(type, classification?)`, `withClassification(classification)`, `withBoundingBox(box)`, `withBlockCounts(entries)`, `withBlockCount(type, count)`, `withoutBlockType(type)`, `withScore(score)`.
**`BlueprintIndexScore` fields:** `version`, `offensiveIndex`, `defensiveIndex`, `powerIndex`, `mobilityIndex`, `dangerIndex`, `survivabilityIndex`, `supportIndex`, `miningIndex`.
**`BlueprintIndexScore` helpers:** `hasMiningIndex`, `totalIndex`, `strongestField`, `getValue(field)`, `withVersion(version)`, `withValue(field, value)`, `withValues(values)`.

### `.smtpl` template files

- `parseSmtpl(data)` — parses a `.smtpl` file into `SmtplFile`.
- `normalizeBlueprintTemplate(file)` or `new BlueprintTemplate(file)` — supplies the typed editing helpers below.
- `writeSmtpl(template)` — encodes a `BlueprintTemplate` or compatible high-level object to `Buffer`, honoring `template.version` (1–6).
- `templatePositionKey(position)` / `templatePositionFromKey(key)` — convert StarMade template position keys to `{ x, y, z }`.

**`BlueprintTemplate` fields:** `version`, `minX/minY/minZ`, `maxX/maxY/maxZ`, `sizeX/sizeY/sizeZ`, `pieces`, `connections`, `texts`, `filters`, `production`, `productionLimits`, `fillUpFilters`, `totalBlocks`.
**`BlueprintTemplate` helpers:** `bounds`, `pieceCount`, `connectionCount`, `textCount`, `filterCount`, `productionCount`, `productionLimitCount`, `fillUpFilterCount`, `isEmpty`, `pieceAt(position)`, `piecesOfType(type)`, `blockCountOf(type)`, `topBlockTypes(limit?)`, `getText(positionOrKey)`, `filterAt(positionOrKey)`, `fillUpFilterAt(positionOrKey)`, `productionAt(positionOrKey)`, `productionLimitAt(positionOrKey)`, `controllersFor(target)`, `controlledBy(controller)`, `isConnected(controller, target)`, `withPieces(pieces)`, `withPiece(piece)`, `removePieceAt(position)`, `withConnections(connections)`, `addConnection(controller, target)`, `removeConnection(controller, target?)`, `withText(position, text)`, `withoutText(position)`, `withInventoryFilter(position, entries)`, `withFillUpFilter(position, entries)`, `withProduction(position, typeOrNull)`, `withProductionLimit(position, limitOrNull)`.
**`TemplatePiece` fields:** `x`, `y`, `z`, `type`, `hp`, `active`, `orientation`, optional `extra` (reserved v6 bits; absent means zero).
**`TemplateInventoryFilter` fields:** `position`, `entries: Array<{ type, count }>`.

Choose **`version: 5`** for new templates targeting the updated StarMade-Open
reference `e5a3b49d86943c4d618cea6512e28fa0b95901df`. That reference accepts versions
1–5; the SDK additionally retains version 6 from the previous reference.
An existing parsed template keeps its version when written. The writer no longer
silently converts every input to version 6.

| Version | Block word | Type | HP | Orientation | Available sections |
| --- | --- | --- | --- | --- | --- |
| 1 | 3 bytes, legacy big-endian, inverted active flag | 0–2047 | 0–255 | 0–15 | Connections |
| 2 | Same legacy layout | 0–2047 | 0–255 | 0–15 | Connections, texts |
| 3 | Same legacy layout | 0–2047 | 0–255 | 0–15 | Above + filters, production |
| 4 | 3 bytes, little-endian, positive active flag | 0–2047 | 0–127 | 0–31 | Same sections as v3 |
| 5 | Same little-endian layout | 0–2047 | 0–127 | 0–31 | Above + production limits, fill-up filters |
| 6 | 4 bytes, big-endian, positive active flag | 0–8191 | 0–127 | 0–31 | Same sections as v5; `extra` 0–63 |

Bounds and piece coordinates remain signed big-endian int32 values in every
version. Block fields must be representable in the selected layout, and `active`
must be a boolean. Unsupported versions, overflowing block fields, nonzero
`extra` outside v6, and sections unavailable in a selected version fail explicitly.
Negative, oversized or truncated collection counts also fail when reading.

Legacy v1–v3 orientation values are exposed as stored; the SDK does not apply
the game's block-style-dependent orientation migration or HP clamping. Changing
`version` is an explicit caller operation, not a migration helper. In particular,
do not convert legacy orientations merely by changing the version field.

The parser retains its historical tolerance for EOF between optional tail
sections. The writer emits all sections defined by the selected version, so
abbreviated inputs are normalized. Complete canonical files, including all 84
checked-in v5 samples, round-trip byte-for-byte; this is not a promise to preserve
duplicate map keys, noncanonical UTF encodings or trailing extension bytes.

### `.smbpl` logic files

- `parseSmbpl(data)` — `BlueprintLogic` control network.
- `writeSmbpl(logic)` — encodes a `BlueprintLogic` or compatible object to `Buffer`.

**`BlueprintLogic` fields:** `structureVersion`, `controllers`, `links`, `controllerCount`, `isEmpty`, `groupCount`, `connectionCount`.
**`BlueprintLogic` helpers:** `controllerAt(position)`, `groupsForType(type)`, `controllersForType(type)`, `linksFrom(position)`, `targetsOf(position, type?)`, `typesFrom(position)`, `isLinked(from, target, type?)`, `withStructureVersion(version)`, `withControllers(controllers)`, `withLinks(links)`, `addLink(from, type, targetOrTargets)`, `removeLink(from, type?, target?)`, `clearController(position)`, `moveController(from, to)`.
**`ControlLink` fields:** `fromX/Y/Z`, `type`, `targets: Array<{x, y, z}>`.

### `.smbpm` metadata files

- `parseSmbpm(data)` — `BlueprintMeta` with `manager`, `dockingEntries`, `railChildren`, `railUID`, `wirelessMarkers`, `cargoPoints`, `lockBoxPoints`, `railDockerPieces`, `aiConfig`, `thrustConfig`.
- `writeSmbpm(meta)` — encodes a `BlueprintMeta` or compatible high-level object to a `.smbpm` `Buffer`.

**`BlueprintMeta` helpers:** `hasManager`, `hasRails`, `attachmentCount`, `childTransformFor(name)`, `childOffsetFor(name)`, `withMetaVersion(version)`, `withManager(manager)`, `withDockingEntries(entries)`, `withRailBounds(min, max)`, `withRailUID(uid)`, `withWirelessMarkers(markers)`, `withRailChildren(children)`, `withRailChildRequest(nameOrIndex, request)`, `withAiConfig(config)`, `withAiValue(id, value)`, `withRailDockerPieces(pieces)`, `withCargoPoints(points)`, `withLockBoxPoints(points)`, `withThrustConfig(config)`.

The parser preserves binary fallback data internally for unchanged round-trips, but the high-level object surface exposes decoded domain fields rather than raw tags.

### `.smbmm` mod-mapping files

`BlueprintModMappings` models the actual `modName~blockName~shortId` text,
including legacy zlib compression and empty vanilla files.

- `new BlueprintModMappings(mappings?, options?: ModMappingOptions)`; each mapping is `{ modName, blockName, id }` with a signed-short ID.
- `fromBuffer(bytes, options?: FormatLimits)`, `mappings`, `size`, `compression`, `get(id)`, `idOf(modName, blockName)`.
- `withMapping(record)`, `withoutId(id)` return immutable edits; conflicting IDs or namespaces fail.
- `translationTo(target)` returns an explicit source-ID to target-ID map; missing target namespaces fail.
- `toBuffer()` retains original bytes/compression after no-op or semantic revert; `toJSON()` returns detached records.

`ModMappingOptions` adds `compression: 'none' | 'zlib'` to `FormatLimits`.
The lower-level `parseSmbmm(data, options?)` / `writeSmbmm(file, options?)`
use `SmbmmFile`, including `namespacedMappings`, `format`, `raw`, `size` and
`isEmpty`. `SmbmmParseOptions` explicitly selects `legacyInt32Pairs` for the
obsolete SDK pair layout, or `mode: 'preserve'` for opaque unsupported data;
strict namespace parsing is the default.

### Simulation files

`parseSim(data, options?: TagReadOptions)` returns a mutable `SimFile` DTO
with `version`, `groups`, `uniqueGroups` and the deprecated `lastUpdate`
counter alias. Each group carries `metadata` and a source `raw` Tag to retain
extensions. Its `simulation` accessor produces an immutable `SimulationState`
from current DTO edits; assigning a state replaces that projection.
`rootTag` is a detached view. `writeSim(file, options?)` emits the current
state and retains the parsed envelope. Conflicting counter aliases fail.

---

## Enriched views

Enriched views resolve block IDs and names through `BlockRegistry`. Initialize the registry before use:

```ts
BlockRegistry.init(BlockConfig.load(config));
```

### `enrichControlLinks(mapper: ControlElementMapper): ControlLinkRich[]`

Resolves each control link's block type to a name and `BlockDefinition`.

**`ControlLinkRich` fields:** `link: ControlLink`, `blockName: string`, `blockDef: BlockDefinition | null`.

### `enrichBlockCounts(ecm: ElementCountMap): BlockCountRich[]`

Computes per-type totals of blocks with resolved names, mass, price, and HP.

**`BlockCountRich` fields:** `count: BlockCount`, `blockName`, `totalMass`, `totalPrice`, `totalHp`, `blockDef`.

### `getBlockCountStats(ecm: ElementCountMap): BlockCountStats`

Aggregates all block counts into a summary.

**`BlockCountStats` fields:** `totalBlocks`, `totalMass`, `totalPrice`, `totalHp`, `byType: BlockCountRich[]`.

### `enrichSegment(seg: SegmentData): BlockDataRich[]`

Returns all non-empty blocks in a segment with resolved names.

**`BlockDataRich` fields:** `position: BlockPosition`, `block: BlockData`, `blockName`, `blockDef`.

### `enrichSmd3(smd3: Smd3File): Array<{ segment: SegmentData; blocks: BlockDataRich[] }>`

Applies `enrichSegment` to every segment.

### `getSegmentStats(seg: SegmentData): SegmentStats`

Computes summary statistics for a segment.

**`SegmentStats` fields:** `totalBlocks`, `uniqueTypes`, `totalMass`, `topTypes: Array<{type, name, count, mass}>`.

### `enrichInventory(inventory: Inventory): ItemStackRich[]`

Resolves each item's block name, mass, and price.

**`ItemStackRich` fields:** `item: ItemStack`, `blockName`, `totalMass`, `totalPrice`, `blockDef`.

### `RichSegmentController`

Combines a `SegmentController` entity with enriched view helpers.

```ts
const rich = new RichSegmentController(ship);
```

- `rich.controlLinks` — `ControlLinkRich[]` from the entity's `ControlElementMapper`.
- `rich.blockStats` — `BlockCountStats | null` from the entity's `ElementCountMap`.
- `rich.analyzeSmd3(smd3File)` — `SegmentStats[]` for each segment of the given file.
- `rich.summary()` — compact object with `{ uniqueId, realName, entityType, sector, factionId, controlLinks, topControlTypes }`.

## SkinDocument (`.smskin`)

`SkinDocument` is a source-preserving ZIP document, with four indexed opaque PNG
resources. Import all symbols from `starmade-decoder`.

```ts
SkinDocument.fromBuffer(input: Uint8Array, options?: SkinOptions): SkinDocument
SkinDocument.create(textures: SkinTextures, options?: SkinOptions): SkinDocument
```

`SkinTexture` is `'mainDiffuse' | 'mainEmission' | 'helmetDiffuse' | 'helmetEmission'`.
`SkinTextures` maps all four roles to `Uint8Array`. `SKIN_TEXTURE_FILES` maps the
roles to the canonical `skin_main_diff.png`, `skin_main_em.png`,
`skin_helmet_diff.png`, and `skin_helmet_em.png` names.

| Member | Contract |
| --- | --- |
| `texture(role)` | Detached `Buffer` containing the original PNG bytes |
| `textureInfo(role)` | `SkinTextureInfo`: actual stored `name` and `byteLength` |
| `files` | Detached `Map<string, Buffer \| null>`; null means an explicit directory |
| `withTexture(role, png)` | Immutable replacement, retaining its stored filename |
| `withFile(name, bytesOrNull)` | Immutable resource add/replace, preserving other entries |
| `withoutFile(name)` | Remove an ancillary resource; required textures cannot be removed |
| `toBuffer()` | Exact source bytes for unchanged/reverted data; retained untouched ZIP records on edits |
| `toJSON()` | Texture descriptions and sorted filenames, without embedded image data |

`SkinOptions` has `maxInputBytes`, `maxOutputBytes`, `maxEntryBytes`, `maxTotalBytes`
and `maxEntries`. Defaults are 16 MiB input/output/total, 4 MiB per entry and 64
entries. Archive limits propagate to every revision. Four unambiguous root-level
texture suffixes and PNG signatures are required. ZIP structure, paths, CRCs and
resource budgets are validated through the existing ZIP codec. PNG pixels and
image dimensions are not decoded or validated. Unknown resources are retained;
custom prefixes follow client lookup, without implying server upload acceptance.
