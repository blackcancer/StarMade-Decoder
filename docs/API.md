# StarMade-Decoder API Reference

StarMade-Decoder is an ESM TypeScript SDK. After build, public symbols are exported from `starmade-decoder`. During development and tests, import directly from `./src/index.js` via `tsx`.

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

## Core Tag API

### `readFrom(data: Buffer | Uint8Array): Tag`

Parses a StarMade binary Tag file. Automatically detects GZIP compression (magic `0x1F 0x8B`) and decompresses before parsing. Non-GZIP files start with a `short version` prefix that is consumed silently.

```ts
const root = readFrom(fs.readFileSync('FACTIONS.fac'));
```

### `writeTo(tag: Tag): Buffer`

Serializes a Tag tree back to a binary `Buffer` in the non-GZIP format (with the `short version = 1` prefix). Use the result directly with `fs.writeFileSync`.

```ts
fs.writeFileSync('FACTIONS.fac', writeTo(root));
```

---

### `Tag`

Immutable representation of one StarMade tag. Every tag has a `type` (`TagType` enum), an optional `name`, and a typed `value`.

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

Concise static factories for creating tags. All methods return a new immutable `Tag`.

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

**Structural updates** — all return a new immutable Tag:

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
- `build()` — returns the final immutable STRUCT Tag with an appended `FINISH_TAG`.

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

SERIALIZABLE tags carry a 1-byte `factoryId` and a binary payload. Known factories are decoded automatically; unknown ones are stored as raw bytes.

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

Default implementation of `SerializableTagElement` for unknown or unregistered factory IDs. Stores the raw bytes intact for round-trip serialization.

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

All functions throw `TypeError` when the root tag type is not `STRUCT`.

---

## High-level objects

High-level objects combine typed field access, immutable updates, and full Tag round-trip support.

### Catalog

Represents `CATALOG.cat`. Contains player entries and NPC/system entries.

```ts
const catalog = Catalog.fromTag(root);
```

**Read:**
- `catalog.all` — all entries (player + system).
- `catalog.entries` — player-owned entries only.
- `catalog.systemEntries` — NPC/system entries only.
- `catalog.find(uid)` — returns `CatalogEntry | undefined`.
- `catalog.byOwner(ownerUID)` — filters by owner UID.
- `catalog.byType(type)` — filters by blueprint type string (`'SHIP'`, `'SPACE_STATION'`, etc.).

**Mutate (returns new `Catalog`):**
- `catalog.addEntry(entry)` — appends to player entries.
- `catalog.removeEntry(uid)` — removes by UID.
- `catalog.updateEntry(uid, entry)` — replaces an existing entry.

**Serialize:**
- `catalog.toTag()` — rebuilds the root Tag.

**`CatalogEntry` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `uid` | `string` | Blueprint name and unique identifier |
| `ownerUID` | `string` | Owner player UID |
| `price` | `bigint` | Price in credits |
| `description` | `string` | Free-text description |
| `mass` | `number` | Total blueprint mass |
| `blueprintType` | `string` | `'SHIP'`, `'SPACE_STATION'`, `'ASTEROID'`, etc. |
| `dateCreated` | `bigint` | Creation timestamp (ms) |
| `timeSpawned` | `bigint` | Last spawn timestamp (ms) |
| `classification` | `number` | `BlueprintClassification` ordinal |

---

### FactionManager

Represents `FACTIONS.fac`. Manages all factions and inter-faction relations.

```ts
const manager = FactionManager.fromTag(root);
```

**Read:**
- `manager.all` — all `Faction[]`.
- `manager.get(id)` — returns `Faction | undefined`.
- `manager.playerFactions` — non-NPC factions.
- `manager.npcFactions` — NPC factions (id < 0).
- `manager.getRelation(a, b)` — returns `FactionRelation | undefined` between faction `a` and `b`.
- `manager.getRelationsOf(id)` — all relations involving faction `id`.

**Mutate (returns new `FactionManager`):**
- `manager.setFaction(faction)` — adds or replaces a faction.
- `manager.removeFaction(id)` — removes a faction by id.
- `manager.addMember(factionId, playerUID)` — adds a member to a faction.
- `manager.setRelation(a, b, relation)` — sets relation using `RELATION_WAR`, `RELATION_NEUTRAL`, or `RELATION_ALLY`.

**Serialize:**
- `manager.toTag()` — rebuilds the root Tag.

**`Faction` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Faction ID (negative = NPC) |
| `name` | `string` | Faction display name |
| `description` | `string` | Faction lore/description |
| `members` | `FactionMember[]` | List of member players |
| `isNPC` | `boolean` | True when NPC-controlled |
| `factionPoints` | `number` | Current faction points |
| `openToJoin` | `boolean` | Whether players can join freely |
| `homebaseUID` | `string` | Home base entity UID |

**`FactionRelation` fields:**
- `factionA`, `factionB: number` — the two faction IDs.
- `relation: number` — `-1` (WAR), `0` (NEUTRAL), `1` (ALLY).
- `relationName: string` — human-readable string.
- `isWar`, `isNeutral`, `isAlly: boolean` — convenience booleans.

**Relation constants:** `RELATION_WAR = -1`, `RELATION_NEUTRAL = 0`, `RELATION_ALLY = 1`, `RELATION_NAMES`.

---

### Entity classes

Entity classes parse complete `.ent` files and expose typed fields and immutable update methods.

#### `parseSegmentControllerEntity(root, filename?): Ship | SpaceStation | ShopSpaceStation | FloatingRock`

Auto-detects the entity type from the file name prefix or Tag content.

#### `Ship`, `SpaceStation`, `ShopSpaceStation`, `FloatingRock`

All extend `SegmentController` which extends `GameEntity`.

**Parse:**
- `Ship.fromBuffer(data)` — reads from a binary Buffer.
- `Ship.fromTag(root)` — parses from a root Tag.

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

**`GameEntity` updates (return `this`):**
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

**Parse:** `PlayerStateEntity.fromBuffer(data)` or `fromTag(root)`.

**Fields:**

| Property | Type | Description |
|----------|------|-------------|
| `credits` | `bigint` | Credit balance |
| `faction` | `FactionMembership` | Faction ID and rank |
| `currentSector` | `SectorPosition \| null` | Current sector |
| `logoutSector` | `SectorPosition \| null` | Sector at last logout |
| `logoutLocalPos` | `Vector3f \| null` | Local position at logout |
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
- `withFaction(id, rank?)` — changes faction membership.
- `withInventory(inventory)` — replaces the main inventory.

#### `PlayerCharacterEntity`

Represents `ENTITY_PLAYERCHARACTER_*.ent` (character position and movement data).

**Parse:** `PlayerCharacterEntity.fromBuffer(data)` or `fromTag(root)`.

**Fields:** `id`, `speed`, `stepHeight`, `factionId`, `owner`, `sectorPosition`, `noAI`, `spawnController`.

**Immutable updates:** `withId()`, `withSpeed()`, `withStepHeight()`, `withFactionId()`, `withOwner()`.

---

### Other domain objects

#### `PlayerCharacter` (legacy business object)

- `fromTag(root)`, `fromBuffer(data)`
- Fields: `id`, `speed`, `stepHeight`, `sectorPosition`, `factionId`, `owner`
- Updates: `withId()`, `withSpeed()`, `withStepHeight()`, `withFactionId()`, `withOwner()`

#### `PlayerState` (legacy business object)

- `fromTag(root)`, `fromBuffer(data)`
- Fields: `credits`, `currentSector`, `logoutSector`, `hasCreativeMode`, `lastEnteredEntity`, `factionId`, `factionRank`
- Updates: `withCredits()`, `withCreativeMode()`, `withFaction(id, rank?)`

#### `SegmentControllerObject` (legacy)

Lighter alternative to the entity class hierarchy when only Tag-level access is needed.

- `fromTag(root)`, `fromBuffer(data)`
- Fields: `uniqueId`, `realName`, `factionCode`, `owner`, `sectorPosition`, `creatorId`, `seed`, `nonEmptySegments`
- Computed accessors: `controlElementMapper`, `elementCountMap`, `long2Vector3fMaps`, `long2TransformMaps`
- Updates: `withName()`, `withRealName()`, `withFactionCode()`

#### `ChatChannelManager`

Represents `chatchannels.tag`.

- `fromTag(root)`, `fromBuffer(data)`
- `manager.channels: ChatChannel[]`
- `manager.find(uid)` — `ChatChannel | undefined`
- `manager.permanentChannels`, `manager.publicChannels` — filtered arrays
- `manager.addChannel(ch)`, `manager.removeChannel(uid)`, `manager.updateChannel(uid, ch)` — return new manager

**`ChatChannel` fields:** `uid`, `password`, `isPermanent`, `isPublic`, `moderators`, `banned`, `muted`.

#### `TradingManager`

Represents `TRADING.tag`.

- `fromTag(root)`, `fromBuffer(data)`
- `manager.routes: TradeRoute[]`
- `manager.routesBetween(fromId, toId)` — `TradeRoute[]`
- `manager.routesFrom(fromId)`, `manager.routesTo(toId)`
- `manager.addRoute(route)`, `manager.removeRoute(idx)`, `manager.updateRoute(idx, route)` — return new manager

**`TradeRoute` key fields:** `blocks` (ElementCountMap), `blockPrice`, `deliveryPrice`, `startTime`, `fromId`, `toId`, `fromPlayer`, `toPlayer`, `fromStation`, `toStation`.

#### `SimulationState`

Represents `SIMULATION_STATE.sim`.

- `fromTag(root)`, `fromBuffer(data)`
- `state.groups: SimulationGroup[]`, `state.lastUpdate: bigint`
- `state.addGroup(group)`, `state.removeGroup(idx)` — return new state
- `state.toTag()`

**`SimulationGroup` fields:** `version`, `type`, `members: string[]`, `startTime`, `startSector`, `programId`.

#### `NPCFactionManager`

Represents `NPCFACTIONS_*.tag`. Parsed and re-serialized as a raw Tag.

- `fromTag(root)`, `fromBuffer(data)`, `toTag()`

#### `FloatingItemsArchive`

Represents `FLOATING_ITEMS_ARCHIVE.ent`.

- `fromTag(root)`, `fromBuffer(data)`
- `archive.totalCount: number`
- `archive.byType(type)` — `FloatingItem | undefined`
- `archive.toTag()`

---

## Components

Reusable components shared between entity classes.

### `SectorPosition`

Absolute position in the universe grid.

- `new SectorPosition(x, y, z)` or `SectorPosition.fromValues(x, y, z)`
- `SectorPosition.ZERO` — `(0, 0, 0)`
- `SectorPosition.fromTag(tag)` — parses from a `VECTOR3i` Tag.
- `pos.toTag(name?)` — builds a `VECTOR3i` Tag.
- `pos.equals(other)` — positional equality.

### `EntityTransform`

Local position and orientation within a sector.

- `EntityTransform.IDENTITY` — zero position, identity rotation.
- `EntityTransform.fromMatrix4fList(tag)` — parses from a `LIST` of 16 `float32` values.
- `EntityTransform.fromMatrix4fTag(tag)` — parses from a `TAG_MATRIX4f`.
- `transform.toMatrix4fList(name?)` — rebuilds the 16-float LIST.
- `transform.with(overrides)` — immutable partial update: `{ originX?, originY?, originZ?, m00?, ... }`.
- Fields: `originX`, `originY`, `originZ` (position), `m00..m22` (3×3 rotation matrix).

### `DockingState`

- `DockingState.UNDOCKED` — singleton for undocked state.
- `state.isDocked` — `true` when `dockedTo !== 'NONE'`.
- `state.undock()` — returns a new undocked state.
- `state.toTag()` / `DockingState.fromTag(tag)`.
- Fields: `dockedTo` (host UID), `posX/Y/Z` (docking block position), `sizeX/Y/Z` (area), `orientation`.

### `HpState`

Hit point state for ships and stations.

- `HpState.EMPTY` — zero HP singleton.
- `HpState.CLASS_INT = 0`, `HpState.CLASS_LONG = 1` — encoding format.
- `state.isAlive` — `hp > 0n`.
- `state.hpPercent` — `Number(hp * 100n / maxHp)`, or `100` when maxHp is 0.
- `state.isRebooting` — `rebootStarted > 0n`.
- `state.withHp(hp)`, `state.withMaxHp(maxHp)` — immutable updates.
- `HpState.fromTag(tag)` / `state.toTag()`.
- Fields: `classId`, `hp`, `maxHp`, `armorHp`, `maxArmorHp`, `rebootStarted`, `rebootTime` (all `bigint`).

### `Inventory`

Slot-indexed block inventory.

- `Inventory.EMPTY` — empty inventory singleton.
- `Inventory.fromTag(tag)` / `inventory.toTag()`.
- `inventory.get(slot)` — `ItemStack | undefined`.
- `inventory.set(item)` — immutable update: adds or replaces a slot.
- `inventory.remove(slot)` — immutable remove.
- `inventory.clear()` — returns an empty inventory.
- `inventory.items` — all `ItemStack[]`.
- `inventory.size`, `inventory.maxSlots`, `inventory.isFull`.
- `inventory.byType(blockType)` — `ItemStack[]` of a given type.
- `inventory.countOf(blockType)` — total quantity of a block type.

**`ItemStack` fields:** `slot`, `type` (block ID), `count`, `meta?: ItemMeta`.  
**`ItemMeta` fields:** `id`, `type`, `orientation`, `subId`.

### `PowerState`

Reactor power state.

- `PowerState.EMPTY` — zero power.
- `PowerState.fromTag(tag)` — parses from a STRUCT with two DOUBLE fields.
- `PowerState.fromTagOld(tag)` — backward-compatible: accepts a DOUBLE directly or falls back to `fromTag`.
- `state.withPower(power)`, `state.withBattery(battery)` — immutable updates.
- Fields: `initialPower: number`, `initialBatteryPower: number`.

### `ThrustConfig`

Thrust and dampener configuration for ships.

- `ThrustConfig.DEFAULT` — default settings (dampeners on, no sharing, balanced).
- `ThrustConfig.fromTag(tag)` / `config.toTag()`.
- `config.withDampeners(enabled)`, `config.withThrustSharing(enabled)`, `config.withRepulsorBalance(v)`.
- Fields: `version`, `automaticDampeners`, `automaticReactivateDampeners`, `thrustBalanceX/Y/Z`, `rotationBalance`, `automaticDampenersOnExit`, `thrustSharing`, `repulsorBalance`.

### `ManagerContainer`

Container for all module state (power, shields, inventories, texts, slot assignments).

- `ManagerContainer.EMPTY` — empty singleton.
- `ManagerContainer.fromTag(tag)` / `mc.toTag(name?)`.
- `mc.mainInventory`, `mc.capsuleInventory`, `mc.microInventory`, `mc.macroInventory` — convenience inventory accessors.
- `mc.getInventory(type)` — inventory by type index (0–3).
- `mc.relevantElementCountMap` — block count ECM from index [7], or `null`.
- **Immutable updates (return new `ManagerContainer`):**
  - `withInventory(type, inventory)` — replaces an inventory by type.
  - `withPower(powerState)` — updates the reactor power state.
  - `withTexts(texts)` — replaces text blocks.
  - `withSlotAssignment(sa)` — replaces slot assignments.
  - `withPullPermission(perm)` — changes pull permission.
- **Fields:** `inventories: ReadonlyMap<number, Inventory>`, `initialShields: number`, `powerState: PowerState`, `texts: TextBlocks`, `slotAssignment: SlotAssignment`, `pullPermission: PullPermission`.
- **`PullPermission` enum:** `ALL = 0`, `SELF = 1`, `NONE = 2`.

### `SpawnPoint`

A single spawn location (entity UID + sector + local position + gravity).

- `SpawnPoint.ZERO` — empty spawn point.
- `SpawnPoint.fromTag(tag)` / `sp.toTag()`.
- `sp.with(overrides)` — immutable partial update: `{ entityUID?, sector?, localX/Y/Z?, gravX/Y/Z? }`.
- Fields: `entityUID`, `sector: SectorPosition`, `localX/Y/Z: number`, `gravX/Y/Z: number`.

### `PlayerSpawnData`

Death and logout spawn points for a player.

- `PlayerSpawnData.EMPTY` — empty spawn data.
- `PlayerSpawnData.fromTag(tag)` / `psd.toTag()`.
- `psd.withDeathSpawn(spawn)`, `psd.withLogoutSpawn(spawn)` — immutable updates.
- Fields: `version`, `deathSpawn: SpawnPoint`, `logoutSpawn: SpawnPoint`, `preSpecialSector?: SectorPosition`, `preSpecialOriginX/Y/Z: number`.

### `SpawnMarker` and `SpawnController`

NPC spawn marker list attached to an entity.

- `SpawnController.EMPTY`, `SpawnController.fromTag(tag)`, `sc.toTag(name?)`.
- `sc.addMarker(marker)` — immutable append.
- `SpawnMarker.fromTag(tag)` / `marker.toTag()`.
- **`SpawnMarker` fields:** `lastSpawned: bigint`, `sectorX/Y/Z: number`.

### `TextBlocks`

Text panel content from screens and info blocks.

- `TextBlocks.EMPTY`
- `TextBlocks.fromTag(tag)` / `tb.toTag()`.

### `SlotAssignment`

Logic slot-to-block assignments.

- `SlotAssignment.EMPTY`
- `SlotAssignment.fromTag(tag)` / `sa.toTag()`.

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

Reads and writes `server.cfg` while preserving all comments and blank lines.

**Parse:**
- `ServerConfig.load(config: SMToolConfig)` — reads the live `server.cfg` or falls back to the default template in `data/config/defaultSettings/`.
- `ServerConfig.fromString(content)` — parses directly from a string, useful for mocks.

**Read:**
- `sc.getString(key, def?)` — typed string value.
- `sc.getNumber(key, def?)` — typed numeric value (integer or float per schema).
- `sc.getBoolean(key, def?)` — typed boolean value.
- `sc.getDefault(key)` — schema default value.
- `sc.values` — all key/value pairs as a plain object.
- `sc.keys` — array of all present keys.
- `sc.has(key)` — whether the key is in the schema.

**Mutate (return new `ServerConfig`):**
- `sc.set(key, value)` — replaces one key. Throws `TypeError` for unknown keys.
- `sc.setMany(entries)` — replaces multiple keys at once. Throws on first unknown key.

**Serialize:**
- `sc.save(config)` — writes back to `server.cfg` with all comments preserved.
- `sc.toString()` — full file content as a string.

**`SERVER_CONFIG_SCHEMA`** — exported `Record<string, ConfigEntryMeta>` with 196 known server keys, each with `type` (`'string' | 'boolean' | 'number' | 'float'`) and `default`.

### `BlockConfig`

Loads and edits `BlockConfig.xml`. Provides typed access to all block definitions.

**Parse:**
- `BlockConfig.load(config)` — reads the vanilla file from `data/config/` and merges any custom override from `customBlockConfig/BlockConfigImport.xml` when present.
- `BlockConfig.fromXml(xmlString, blockTypes?)` — parses directly from XML string.

**Read:**
- `bc.getById(id)` — `BlockDefinition | undefined`.
- `bc.getByName(name)` — case-insensitive, `BlockDefinition | undefined`.
- `bc.getAll()` — all `BlockDefinition[]`.
- `bc.size` — total count.

**Mutate (return new `BlockConfig`):**
- `bc.set(definition)` — adds or replaces a block definition.
- `bc.delete(id)` — removes a block definition.

**Serialize:**
- `bc.saveCustom(config, vanilla)` — writes **only changed or added** definitions to `customBlockConfig/BlockConfigImport.xml`. Never modifies `data/config/BlockConfig.xml`.

**`BlockDefinition` key fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Numeric block ID |
| `name` | `string` | Display name |
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

- `definition.with(overrides)` — returns an immutable copy with modified fields.

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

- `BlockBehaviorConfig.load(config)` — loads from the StarMade installation.
- `BlockBehaviorConfig.fromXml(xml)` — parses from XML string.
- `bc.getNumber(key, def?)`, `bc.getBoolean(key, def?)`, `bc.getString(key, def?)` — dot-notation key access (e.g. `'BlockBehaviorConfig.General.BasicValues.ShieldCapacityInitial'`).
- `bc.set(key, value)` — immutable update.
- `bc.saveCustom(config, vanilla)` — writes only diffs to `customBlockBehaviorConfig/customBlockBehaviorConfig.xml`.

### `FactionConfig`

Reads `FactionConfig.xml` (faction activity and scoring parameters).

- `FactionConfig.load(config)` — loads vanilla + custom override.
- `FactionConfig.fromXml(xml)` — parses from XML string.
- `fc.getNumber(key, def?)`, `fc.getBoolean(key, def?)`, `fc.getString(key, def?)`.
- `fc.set(key, value)` — immutable update.
- `fc.saveCustom(config, vanilla)` — writes only diffs to `customFactionConfig/FactionConfig.xml`.

---

## Blueprint and segment API

### `.smd3` segment files

```ts
import { parseSmd3, writeSmd3, emptySegment, emptySmd3File, getBlock, posToIndex, indexToPos } from 'starmade-decoder';
```

- `parseSmd3(data)` — parses a `.smd3` file into `Smd3File`.
- `writeSmd3(file, segVersion?)` — encodes to `Buffer`. Default format: version 7 (4-byte blocks). Accepts any `Smd3File` including files originally in version 6.
- `emptySegment(x?, y?, z?)` — creates an empty `SegmentData` at the given coordinates.
- `emptySmd3File()` — creates an empty `Smd3File` with no segments.
- `getBlock(segment, x, y, z)` — `BlockData` at local coordinates within a segment.
- `posToIndex(x, y, z)` — converts local `(x, y, z)` to a flat block array index.
- `indexToPos(index)` — inverse of `posToIndex`.

**`Smd3File` fields:** `version`, `segments: SegmentData[]`.  
**`SegmentData` fields:** `version`, `x, y, z` (absolute segment coords), `lastChanged: bigint`, `blockCount`, `blocks: BlockData[]` (length `BLOCK_COUNT = 32768`).  
**`BlockData` fields:** `type: number`, `hp: number`, `active: boolean`, `orientation: number`.

**Constants:** `CHUNK_DIM = 32`, `BLOCK_COUNT = 32768`, `VERSION_4BYTE = 7`, `DATA_AVAILABLE`, `DATA_EMPTY`, `DATA_SINGLE`, `DATA_BITMAP`, `DATA_SINGLE_SIDE_EDGE`.

### `.sment` blueprint archives

- `parseSment(data)` — parses a `.sment` ZIP archive into `SmentFile`.
- `parseBlueprintFolder(folderPath)` — parses an extracted blueprint directory.
- `BLUEPRINT_TYPE` — array of valid blueprint type strings in ordinal order.

**`SmentFile` fields:** `root: SmentEntity`, `totalEntities: number`, `totalSegments: number`.  
**`SmentEntity` fields:** `name`, `header: BlueprintHeader`, `segments: Smd3File[]`, `children: SmentEntity[]`.  
**`BlueprintHeader` fields:** `entityType`, `gameVersion`, `boundingBox: BoundingBox`, `totalBlockCount`, `blockCountByType`, `classification`.

### `.smtpl` template files

- `parseSmtpl(data)` — parses a `.smtpl` file into `SmtplFile`.
- `writeSmtpl(file)` — encodes to `Buffer`.

**`SmtplFile` fields:** `version`, `pieces: TemplatePiece[]`, `connections: TemplateConnection[]`, `texts: Map<bigint, string>`.

### `.smbpl` logic files

- `parseSmbpl(data)` — `SmbplFile` with `links: ControlLink[]`.
- `writeSmbpl(file)` — encodes to `Buffer`.

**`ControlLink` fields:** `fromX/Y/Z`, `type`, `targets: Array<{x, y, z}>`.

### `.smbpm` metadata files

- `parseSmbpm(data)` — `SmbpmFile` with `dockingEntries`, `railChildren`, `railUID`, `cargoPoints`, `railDockerPieces`, `aiTag`, `thrustTag`.

### `.smbmm` mod-mapping files

- `parseSmbmm(data)` — `SmbmmFile` with `isEmpty: boolean`, `size: number`, `raw: Uint8Array`.

### `.smbph` header writer

- `writeSmbph(header, gameVersion?)` — encodes a `BlueprintHeader` to a `.smbph` `Buffer`. The `gameVersion` argument overrides `header.gameVersion`.

### Simulation files

- `parseSim(data)` — `SimFile` with `version`, `groups: SimGroup[]`, `lastUpdate?: bigint`.

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
