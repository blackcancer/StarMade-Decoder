# StarMade-Decoder API Reference

StarMade-Decoder is an ESM TypeScript SDK. Public symbols are exported from `starmade-decoder` after build, or from `./src/index.js` while running tests with `tsx`.

```ts
import { readFrom, writeTo, Ship, parseSmd3 } from 'starmade-decoder';
```

## Core Tag API

### `readFrom(data)`

Parses a StarMade Tag file from a `Buffer` or `Uint8Array`.

```ts
const root = readFrom(fs.readFileSync('FACTIONS.fac'));
```

### `writeTo(tag)`

Serializes a `Tag` tree back to a `Buffer`.

```ts
fs.writeFileSync('FACTIONS.fac', writeTo(root));
```

### `Tag`

Low-level immutable representation of one StarMade tag.

Common methods:

- `getByte()`, `getShort()`, `getInt()`, `getLong()`
- `getFloat()`, `getDouble()`, `getString()`
- `getByteArray()`
- `getVector3b()`, `getVector3i()`, `getVector3f()`, `getVector4f()`
- `getMatrix3f()`, `getMatrix4f()`
- `getStruct()`, `getList()`
- `getSerializable()`
- `findByName(name)`
- `print()`

### `Tags`, `StructBuilder`, `ListBuilder`

Factory helpers for creating and editing Tag trees.

```ts
const ship = Tags.struct('Ship', [
  Tags.string('name', 'Explorer'),
  Tags.int('factionId', 0),
  Tags.vector3i('sector', 4, 4, 4),
]);

const updated = Tags.setField(ship, 'factionId', Tags.int('factionId', 42));
```

### `toObject(tag)` and `toJSON(tag, indent?)`

Convert a Tag tree to a readable JSON-safe representation. `BigInt` and byte arrays are preserved in printable form.

## Types

Vector and matrix primitives:

- `Vector3b`, `Vector3i`, `Vector3f`, `Vector4f`
- `Matrix3f`, `Matrix4f`

## Serializable payloads

The SDK preserves unknown `SERIALIZABLE` payloads as raw bytes and decodes known StarMade factories when possible.

Exports:

- `SerializableTagRegister`
- `SerializableTagElement`
- `FACTORY_IDS`
- `registerAllFactories()`
- `RawElement`
- `ControlElementMapper`
- `ElementCountMap`
- `NPCFactionNewsEvent`
- `LongSet`
- `BlockBuffer`
- `Long2Vector3fMap`
- `Long2TransformMap`
- `decodeSerializable()`

## Entity parsers

Legacy parser functions extract semantic fields from root Tags:

- `parsePlayerCharacter(root)`
- `parsePlayerState(root)`
- `parseSegmentController(root)`
- `parseFactions(root)`
- `parseCatalog(root)`
- `parseFloatingItems(root)`

Use these for lightweight data extraction without object editing helpers.

## High-level objects

High-level objects support typed access, immutable updates, and Tag round-trips.

### Catalog

- `Catalog.fromTag(root)`
- `catalog.all`
- `catalog.find(uid)`
- `catalog.byOwner(ownerUID)`
- `catalog.byType(type)`
- `catalog.addEntry(entry)`
- `catalog.removeEntry(uid)`
- `catalog.updateEntry(uid, entry)`
- `catalog.toTag()`

### Factions

Exports:

- `FactionManager`, `Faction`, `FactionMember`, `FactionRelation`
- `RELATION_WAR`, `RELATION_NEUTRAL`, `RELATION_ALLY`, `RELATION_NAMES`

Common methods:

- `FactionManager.fromTag(root)`
- `manager.get(id)` — returns `Faction | undefined`
- `manager.all` — all factions
- `manager.playerFactions`, `manager.npcFactions`
- `manager.getRelation(a, b)`
- `manager.getRelationsOf(id)` — all relations involving a faction
- `manager.setFaction(faction)`
- `manager.removeFaction(id)`
- `manager.addMember(factionId, playerUID)`
- `manager.setRelation(a, b, relation)`
- `manager.toTag()`

### Entities

Entity classes parse complete `.ent` files and expose immutable update helpers.

Exports:

- `Ship`
- `SpaceStation`
- `ShopSpaceStation`
- `FloatingRock`
- `PlayerCharacterEntity`
- `PlayerStateEntity`
- `parseSegmentControllerEntity(root, filename?)`

Typical pattern:

```ts
const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));
const renamed = ship.withRealName('Explorer');
fs.writeFileSync('ENTITY_SHIP_MyShip.ent', writeTo(renamed.toTag()));
```

### Other domain objects

- `PlayerCharacter` — `withId()`, `withSpeed()`, `withStepHeight()`, `withOwner()`, `withFactionId()`
- `PlayerState` — `withCredits()`, `withCreativeMode()`, `withFaction()`
- `SegmentControllerObject` — `withName()`, `withRealName()`, `withFactionCode()`
- `ChatChannelManager` — `find()`, `addChannel()`, `removeChannel()`, `updateChannel()`, `permanentChannels`, `publicChannels`
- `TradingManager` — `routes`, `routesBetween()`, `routesFrom()`, `routesTo()`, `addRoute()`, `removeRoute()`, `updateRoute()`
- `NPCFactionManager` — `fromTag()`, `toTag()`
- `SimulationState` — `groups`, `addGroup()`, `removeGroup()`, `toTag()`
- `SimulationGroup` — `fromTag()`, `toTag()`
- `FloatingItemsArchive` — `totalCount`, `byType()`
- `FloatingItem`

## Components

Reusable entity components:

- `SectorPosition`, `EntityTransform`
  - `EntityTransform.fromMatrix4fList(tag)` — parses from LIST of 16 floats
  - `EntityTransform.fromMatrix4fTag(tag)` — parses from TAG_MATRIX4f
  - `EntityTransform.with(overrides)` — immutable partial update
- `SpawnPoint`, `PlayerSpawnData`, `SpawnMarker`, `SpawnController`
  - `SpawnPoint.with(overrides)` — immutable partial update
  - `PlayerSpawnData.withDeathSpawn()`, `PlayerSpawnData.withLogoutSpawn()`
  - `SpawnController.addMarker()`
- `DockingState` — `isDocked`, `undock()`
- `HpState` — `isRebooting`, `hpPercent`, `withHp()`, `withMaxHp()`
- `TextBlocks`
- `SlotAssignment`
- `Inventory` — `set()`, `remove()`, `clear()`, `get()`, `byType()`, `countOf()`, `toTag()`
- `ItemStack`
- `PowerState` — `withPower()`, `withBattery()`, `fromTagOld()`
- `ThrustConfig` — `withDampeners()`, `withThrustSharing()`, `withRepulsorBalance()`
- `ManagerContainer` — `withInventory()`, `withPower()`, `withTexts()`, `withSlotAssignment()`, `withPullPermission()`
- `PullPermission` enum

## Config API

### `SMToolConfig`

Represents paths for a StarMade installation.

```ts
const config = SMToolConfig.fromData({
  starmadeDir: '/path/to/StarMade',
  worldDir: 'world0',
});
config.validate();
```

### `ServerConfig`

Reads and writes `server.cfg` while preserving comments and line order.

```ts
const server = ServerConfig.load(config);
const updated = server.set('SUPER_ADMIN_PASSWORD_USE', true);
updated.save(config);
```

### `BlockConfig`

Loads `BlockConfig.xml` and optional custom overrides.

```ts
const blocks = BlockConfig.load(config);
const core = blocks.getByName('Ship Core');
```

`saveCustom(config, vanilla)` writes only to `customBlockConfig/BlockConfigImport.xml`.

### Other config exports

- `BlockDefinition`
- `BlockBehaviorConfig`
- `FactionConfig`
- `BlockRegistry`
- `SERVER_CONFIG_SCHEMA`

## Blueprint and segment API

### `.smd3` segment files

Exports:

- `parseSmd3(data)`
- `writeSmd3(file, segVersion?)`
- `emptySegment(x?, y?, z?)`
- `emptySmd3File()`
- `getBlock(segment, x, y, z)`
- `indexToPos(index)`, `posToIndex(x, y, z)`
- `CHUNK_DIM`, `BLOCK_COUNT`

### `.sment` blueprint archives

Exports:

- `parseSment(data)`
- `parseBlueprintFolder(folderPath)`
- `BLUEPRINT_TYPE`

### Template, logic, metadata, and simulation files

- `parseSmtpl(data)`, `writeSmtpl(file)`
- `parseSmbpl(data)`, `writeSmbpl(file)`
- `parseSmbpm(data)`
- `parseSmbmm(data)`
- `writeSmbph(header, gameVersion?)`
- `parseSim(data)`

## Enriched views

Enriched views resolve block IDs through `BlockRegistry` and `BlockConfig`.

Exports:

- `enrichControlLinks(mapper)`
- `enrichBlockCounts(ecm)`
- `getBlockCountStats(ecm)`
- `enrichSegment(segment)`
- `enrichSmd3(smd3)`
- `getSegmentStats(segment)`
- `enrichInventory(inventory)`
- `RichSegmentController`

Initialize the registry before using name resolution:

```ts
BlockRegistry.init(BlockConfig.load(config));
```

`BlockRegistry` also exposes:

- `BlockRegistry.get(id)` — full `BlockDefinition` or null
- `BlockRegistry.getName(id)` — display name or `"block#id"` when unknown
- `BlockRegistry.getMass(id)`, `BlockRegistry.getPrice(id)`, `BlockRegistry.getHp(id)`
- `BlockRegistry.isInitialized` — true after `init()`
- `BlockRegistry.reset()` — clears the registry
