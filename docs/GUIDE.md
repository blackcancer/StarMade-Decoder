# Getting Started with StarMade-Decoder

This guide walks you through everything you need to read, edit, and write StarMade save files — no prior knowledge of the file formats required.

---

## Table of Contents

1. [What is StarMade-Decoder?](#1-what-is-starmade-decoder)
2. [Installation](#2-installation)
3. [StarMade file system overview](#3-starmade-file-system-overview)
4. [Which parser for which file?](#4-which-parser-for-which-file)
5. [The Tag format in one minute](#5-the-tag-format-in-one-minute)
6. [First steps: read any file](#6-first-steps-read-any-file)
7. [Reading world data](#7-reading-world-data)
8. [Editing and writing back](#8-editing-and-writing-back)
9. [Working with blueprints](#9-working-with-blueprints)
10. [Working with StarMade configuration](#10-working-with-starmade-configuration)
11. [Block enrichment](#11-block-enrichment)
12. [Legacy parsers vs high-level objects](#12-legacy-parsers-vs-high-level-objects)
13. [Common pitfalls](#13-common-pitfalls)

---

## 1. What is StarMade-Decoder?

StarMade-Decoder is a TypeScript SDK that reads, edits, and writes every binary file format used by the StarMade game server. It is a faithful port of the Java `org.schema.schine.resource.tag.Tag` format used internally by the game engine.

With this SDK you can:
- Read player data, ships, stations, factions, catalog, and trading routes from a live or archived server world.
- Build tools, editors, or migration scripts over StarMade save data.
- Parse blueprint archives (`.sment`) and individual segment files (`.smd3`).
- Load, inspect, and safely override StarMade XML configuration files.

---

## 2. Installation

```bash
git clone <repository>
cd StarMade-Decoder
npm install
npm run build      # compile TypeScript → dist/
npm run docs:check # verify source-level JSDoc/fileoverview coverage
npm test           # run all 681 tests
```

**Node.js ≥ 20 required.**

Use from TypeScript or JavaScript with ESM imports:

```ts
import { readFrom, writeTo, Ship, FactionManager } from 'starmade-decoder';
```

> **Call `registerAllFactories()` before parsing any `.ent` file.** This registers the 7 SERIALIZABLE decoders (ship control links, block counts, etc.). Without it, those payloads remain as raw bytes and some fields will be unavailable.
>
> ```ts
> import { registerAllFactories } from 'starmade-decoder';
> registerAllFactories(); // call once at startup
> ```

---

## 3. StarMade file system overview

A StarMade server installation looks like this:

```
StarMade/                              ← starmadeDir in SMToolConfig
│
├── server.cfg                         ← server configuration
├── data/config/
│   ├── BlockConfig.xml                ← block definitions (1500+ blocks)
│   ├── blockBehaviorConfig.xml        ← gameplay multipliers
│   ├── FactionConfig.xml              ← faction mechanics
│   └── defaultSettings/server.cfg    ← default server.cfg template
│
├── blueprints/                        ← player blueprints (folders or .sment)
│   └── MyShip/
│       ├── header.smbph               ← blueprint header
│       ├── logic.smbpl                ← control links
│       ├── meta.smbpm                 ← rail/docking/cargo metadata
│       ├── modmappings.smbmm          ← block ID remapping (vanilla = empty)
│       └── DATA/
│           └── MyShip.0.0.0.smd3      ← segment block data
│
├── blueprints-stations/               ← station blueprints
├── customBlockConfig/
│   └── BlockConfigImport.xml          ← your custom block overrides (safe to write)
│
└── server-database/
    └── world0/                        ← worldDir in SMToolConfig
        │
        ├── CATALOG.cat                ← blueprint catalog (all player blueprints)
        ├── FACTIONS.fac               ← all factions and relations
        ├── TRADING.tag                ← active trade routes
        ├── SIMULATION_STATE.sim       ← NPC simulation groups
        ├── NPCFACTIONS_x_y_z.tag      ← NPC faction data per sector
        ├── chatchannels.tag           ← chat channel configuration
        ├── FLOATING_ITEMS_ARCHIVE.ent ← floating items in the world
        │
        ├── ENTITY_SHIP_<id>.ent               ← ship entity data
        ├── ENTITY_SPACESTATION_<id>.ent       ← space station entity data
        ├── ENTITY_SHOP_<id>.ent               ← shop/trader entity data
        ├── ENTITY_FLOATINGROCK_<id>.ent       ← asteroid/planet entity data
        ├── ENTITY_PLAYERCHARACTER_<name>.ent  ← player character (position)
        ├── ENTITY_PLAYERSTATE_<name>.ent      ← player state (credits, inventory)
        │
        └── DATA/
            └── ENTITY_SHIP_<id>.x.y.z.smd3   ← segment block data for entities
```

**Key facts:**
- Every `.ent`, `.fac`, `.cat`, `.tag`, `.sim` file uses the same binary Tag format. `readFrom()` parses all of them.
- `.smd3` files are binary segment files — use `parseSmd3()`, not `readFrom()`.
- Blueprint `.sment` files are ZIP archives containing the same folder structure as shown above.
- GZIP compression is handled **automatically** by `readFrom()` — you do not need to decompress files manually.

---

## 4. Which parser for which file?

| File pattern | Format | Parser / class |
|---|---|---|
| `FACTIONS.fac` | Tag | `FactionManager.fromBuffer(data)` |
| `CATALOG.cat` | Tag | `Catalog.fromBuffer(data)` |
| `TRADING.tag` | Tag | `TradingManager.fromBuffer(data)` |
| `SIMULATION_STATE.sim` | Tag | `SimulationState.fromBuffer(data)` |
| `NPCFACTIONS_*.tag` | Tag | `NPCFactionManager.fromBuffer(data)` |
| `chatchannels.tag` | Tag | `ChatChannelManager.fromBuffer(data)` |
| `FLOATING_ITEMS_ARCHIVE.ent` | Tag | `FloatingItemsArchive.fromBuffer(data)` |
| `ENTITY_SHIP_*.ent` | Tag | `Ship.fromBuffer(data)` |
| `ENTITY_SPACESTATION_*.ent` | Tag | `SpaceStation.fromBuffer(data)` |
| `ENTITY_SHOP_*.ent` | Tag | `ShopSpaceStation.fromBuffer(data)` |
| `ENTITY_FLOATINGROCK_*.ent` | Tag | `FloatingRock.fromBuffer(data)` |
| `ENTITY_PLAYERCHARACTER_*.ent` | Tag | `PlayerCharacterEntity.fromBuffer(data)` |
| `ENTITY_PLAYERSTATE_*.ent` | Tag | `PlayerStateEntity.fromBuffer(data)` |
| `*.smd3` | Binary segment | `parseSmd3(data)` |
| `*.sment` | ZIP archive | `parseSment(data)` |
| `*.smtpl` | Binary template | `parseSmtpl(data)` |
| `*.smbpl` | Binary logic | `parseSmbpl(data)` |
| `*.smbpm` | Binary metadata | `parseSmbpm(data)` |
| `*.smbmm` | Binary mod mapping | `parseSmbmm(data)` |
| `*.smbph` | Binary header | `parseBlueprintFolder(path)` writes this |
| `server.cfg` | Text | `ServerConfig.load(config)` |
| `BlockConfig.xml` | XML | `BlockConfig.load(config)` |
| `blockBehaviorConfig.xml` | XML | `BlockBehaviorConfig.load(config)` |
| `FactionConfig.xml` | XML | `FactionConfig.load(config)` |

> **Auto-detect from filename:** `parseSegmentControllerEntity(root, filename)` reads the file name and returns the right subclass (`Ship`, `SpaceStation`, `ShopSpaceStation`, or `FloatingRock`) automatically.

---

## 5. The Tag format in one minute

Every StarMade save file (except `.smd3` and `.sment`) is a tree of **Tags**. A Tag is simply:
- a **type** (INT, STRING, STRUCT, LIST, LONG, …)
- an optional **name**
- a **value**

A `STRUCT` is a named container of child tags, terminated by a special `FINISH` tag. A `LIST` contains multiple values of the same type.

The SDK mirrors this exactly:

```ts
const root = readFrom(fs.readFileSync('FACTIONS.fac'));
// root is a Tag of type STRUCT

const children = root.getStruct(); // Tag[] including the FINISH sentinel
const fields = children.filter(t => t.type !== TagType.FINISH); // remove the sentinel

const version = fields[0].getByte(); // first child is a BYTE
```

In practice you rarely need to do this manually — the high-level classes handle all field extraction. But it is useful for exploring unknown files with `toJSON()`:

```ts
console.log(toJSON(root, 2));
```

---

## 6. First steps: read any file

```ts
import fs from 'node:fs';
import { readFrom, toJSON, registerAllFactories } from 'starmade-decoder';

registerAllFactories(); // always call this first

const root = readFrom(fs.readFileSync('server-database/world0/FACTIONS.fac'));
console.log(toJSON(root, 2)); // print the entire tag tree as JSON
```

`readFrom` handles both compressed (GZIP) and uncompressed files transparently. You never need to check the file extension or decompress manually.

To serialize back to disk without any changes:

```ts
import { writeTo } from 'starmade-decoder';
fs.writeFileSync('FACTIONS.copy.fac', writeTo(root));
```

The output is **byte-for-byte identical** to the input for all supported formats.

---

## 7. Reading world data

### Player state (credits, inventory, spawn)

```ts
import fs from 'node:fs';
import { registerAllFactories, PlayerStateEntity } from 'starmade-decoder';

registerAllFactories();

const data = fs.readFileSync('server-database/world0/ENTITY_PLAYERSTATE_InitSysRev.ent');
const player = PlayerStateEntity.fromBuffer(data);

console.log('Credits:', player.credits);
console.log('Creative mode:', player.hasCreativeMode);
console.log('Last entity:', player.lastEnteredEntity);
console.log('Faction:', player.faction.id, 'rank', player.faction.rank);
console.log('Sector:', player.currentSector?.toString());
```

### Player character (position, speed)

```ts
import { PlayerCharacterEntity } from 'starmade-decoder';

const pc = PlayerCharacterEntity.fromBuffer(
  fs.readFileSync('server-database/world0/ENTITY_PLAYERCHARACTER_InitSysRev.ent')
);
console.log('Sector:', pc.sectorPosition.toString());
console.log('Speed:', pc.speed);
```

### Ship entity

```ts
import { registerAllFactories, Ship } from 'starmade-decoder';

registerAllFactories();

const ship = Ship.fromBuffer(
  fs.readFileSync('server-database/world0/ENTITY_SHIP_MyShip.ent')
);
console.log('ID:', ship.uniqueId);
console.log('Name:', ship.realName);
console.log('Sector:', ship.sectorPosition.toString()); // SectorPosition(x, y, z)
console.log('Faction:', ship.factionId);
console.log('HP:', ship.hpPercent + '%');
console.log('Docked:', ship.isDocked);
```

### Factions

```ts
import { readFrom, FactionManager } from 'starmade-decoder';

const manager = FactionManager.fromBuffer(
  fs.readFileSync('server-database/world0/FACTIONS.fac')
);

console.log('Total factions:', manager.all.length);
console.log('Player factions:', manager.playerFactions.length);
console.log('NPC factions:', manager.npcFactions.length);

for (const faction of manager.playerFactions) {
  console.log(`  [${faction.id}] ${faction.name} — ${faction.memberCount} members`);
}

// Check relation between two factions
const rel = manager.getRelation(-1, -2);
console.log('Relation:', rel?.relationName); // 'ALLY', 'NEUTRAL', or 'WAR'
```

### Catalog

```ts
import { readFrom, Catalog } from 'starmade-decoder';

const catalog = Catalog.fromBuffer(
  fs.readFileSync('server-database/world0/CATALOG.cat')
);
console.log('Blueprints:', catalog.all.length);

// Find ships only
const ships = catalog.byType('SHIP');
for (const entry of ships) {
  console.log(`  ${entry.uid} (mass: ${entry.mass}, price: ${entry.price})`);
}
```

### All entities in a world directory

```ts
import fs from 'node:fs';
import path from 'node:path';
import { registerAllFactories, parseSegmentControllerEntity, readFrom } from 'starmade-decoder';

registerAllFactories();

const worldDir = 'server-database/world0';

for (const filename of fs.readdirSync(worldDir)) {
  if (!filename.endsWith('.ent')) continue;
  if (!filename.startsWith('ENTITY_SHIP_') && !filename.startsWith('ENTITY_SPACESTATION_')) continue;

  const root = readFrom(fs.readFileSync(path.join(worldDir, filename)));
  const entity = parseSegmentControllerEntity(root, filename);

  console.log(`${entity.entityType} | ${entity.uniqueId} | ${entity.realName} | sector: ${entity.sectorPosition}`);
}
```

---

## 8. Editing and writing back

All high-level objects are **immutable**. Mutation methods return a new object; the original is unchanged.

### Give a player 1 million credits

```ts
import fs from 'node:fs';
import { registerAllFactories, PlayerStateEntity, writeTo } from 'starmade-decoder';

registerAllFactories();

const filePath = 'server-database/world0/ENTITY_PLAYERSTATE_InitSysRev.ent';
const player = PlayerStateEntity.fromBuffer(fs.readFileSync(filePath));

const updated = player.withCredits(1_000_000n);
fs.writeFileSync(filePath, writeTo(updated.toTag()));
```

### Rename a ship

```ts
import { registerAllFactories, Ship, writeTo } from 'starmade-decoder';
import fs from 'node:fs';

registerAllFactories();

const filePath = 'server-database/world0/ENTITY_SHIP_MyShip.ent';
const ship = Ship.fromBuffer(fs.readFileSync(filePath));

const renamed = ship.withRealName('Explorer MkII');
fs.writeFileSync(filePath, writeTo(renamed.toTag()));
```

### Set two factions as allies

```ts
import { registerAllFactories, FactionManager, RELATION_ALLY, writeTo } from 'starmade-decoder';
import fs from 'node:fs';

registerAllFactories();

const filePath = 'server-database/world0/FACTIONS.fac';
const manager = FactionManager.fromBuffer(fs.readFileSync(filePath));

// Find a player faction and an NPC faction
const player = manager.playerFactions[0];
const npc    = manager.npcFactions[0];

const updated = manager.setRelation(player.id, npc.id, RELATION_ALLY);
fs.writeFileSync(filePath, writeTo(updated.toTag()));
```

### Edit a single Tag field directly (low-level)

For fields not exposed by the high-level API, edit the raw Tag tree:

```ts
import { readFrom, writeTo, Tags } from 'starmade-decoder';
import fs from 'node:fs';

const filePath = 'server-database/world0/ENTITY_PLAYERSTATE_InitSysRev.ent';
const root = readFrom(fs.readFileSync(filePath));

// Set the 'credits' field to 999999 using the raw Tag API
const updated = Tags.setField(root, 'credits', Tags.long('credits', 999999n));
fs.writeFileSync(filePath, writeTo(updated));
```

---

## 9. Working with blueprints

### Parse a `.sment` archive

A `.sment` is a ZIP containing the same folder structure as a blueprint directory. The root entity may have child entities (`ATTACHED_0`, `ATTACHED_1`, etc.) for docked ships or sub-entities.

```ts
import fs from 'node:fs';
import { parseSment, registerAllFactories } from 'starmade-decoder';

registerAllFactories();

const blueprint = parseSment(fs.readFileSync('blueprints/MyShip.sment'));

console.log('Entity type:', blueprint.root.header.entityType);    // 'SHIP', 'SPACE_STATION', etc.
console.log('Game version:', blueprint.root.header.gameVersion);
console.log('Total blocks:', blueprint.root.header.totalBlockCount);
console.log('Entities:', blueprint.totalEntities);   // root + all children
console.log('Segments:', blueprint.totalSegments);

// Bounding box
const bb = blueprint.root.header.boundingBox;
console.log(`BBox: (${bb.minX},${bb.minY},${bb.minZ}) → (${bb.maxX},${bb.maxY},${bb.maxZ})`);

// Iterate child entities (docked ships, etc.)
for (const child of blueprint.root.children) {
  console.log('  Child:', child.name, '—', child.segments.length, 'segment(s)');
}
```

### Parse an extracted blueprint folder

```ts
import { parseBlueprintFolder } from 'starmade-decoder';

// Same result as parseSment but from a directory on disk
const blueprint = parseBlueprintFolder('blueprints/MyShip');
console.log(blueprint.root.header.entityType);
```

### Read block data from a segment

Each entity has one or more `.smd3` segment files. A segment is a 32×32×32 block grid (32 768 blocks).

```ts
import fs from 'node:fs';
import { parseSmd3, getBlock, posToIndex } from 'starmade-decoder';

const smd3 = parseSmd3(
  fs.readFileSync('server-database/world0/DATA/ENTITY_SHIP_MyShip.0.0.0.smd3')
);

console.log('Segments:', smd3.segments.length);

for (const segment of smd3.segments) {
  console.log(`  Segment (${segment.x},${segment.y},${segment.z}): ${segment.blockCount} blocks`);
}

// Read a specific block at local position (16, 16, 16) in the first segment
if (smd3.segments.length > 0) {
  const block = getBlock(smd3.segments[0], 16, 16, 16);
  console.log('Block at center:', block.type, 'hp:', block.hp, 'active:', block.active);
}
```

### Enumerate block types in a blueprint

```ts
import { parseSment, registerAllFactories, BlockRegistry, BlockConfig, SMToolConfig, enrichSmd3 } from 'starmade-decoder';
import fs from 'node:fs';

registerAllFactories();

// Initialize block name lookup (requires StarMade installation)
const config = SMToolConfig.fromData({ starmadeDir: '/path/to/StarMade' });
BlockRegistry.init(BlockConfig.load(config));

const blueprint = parseSment(fs.readFileSync('blueprints/MyShip.sment'));

const blockCounts = new Map<number, number>();
for (const entity of [blueprint.root, ...blueprint.root.children]) {
  for (const smd3 of entity.segments) {
    for (const { blocks } of enrichSmd3(smd3)) {
      for (const b of blocks) {
        blockCounts.set(b.block.type, (blockCounts.get(b.block.type) ?? 0) + 1);
      }
    }
  }
}

// Print sorted by count
for (const [type, count] of [...blockCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${BlockRegistry.getName(type).padEnd(30)} × ${count}`);
}
```

---

## 10. Working with StarMade configuration

The config API requires a valid StarMade installation path.

### Setup

```ts
import { SMToolConfig } from 'starmade-decoder';

const config = SMToolConfig.fromData({
  starmadeDir: '/path/to/StarMade',  // StarMade root directory
  worldDir: 'world0',                // optional, defaults to 'world0'
});

// Validate paths (throws if installation is not found)
config.validate();
```

### Read server.cfg

```ts
import { SMToolConfig, ServerConfig } from 'starmade-decoder';

const config = SMToolConfig.fromData({ starmadeDir: '/path/to/StarMade' });
const server = ServerConfig.load(config);

console.log('World name:', server.getString('WORLD'));
console.log('Max clients:', server.getNumber('MAX_CLIENTS'));
console.log('Enemy spawning:', server.getBoolean('ENEMY_SPAWNING'));
```

### Edit server.cfg

```ts
const updated = server
  .set('MAX_CLIENTS', 32)
  .set('ENEMY_SPAWNING', false)
  .set('SUPER_ADMIN_PASSWORD_USE', true);

updated.save(config); // writes back to server.cfg, comments preserved
```

### Load block definitions

```ts
import { SMToolConfig, BlockConfig, BlockRegistry } from 'starmade-decoder';

const config = SMToolConfig.fromData({ starmadeDir: '/path/to/StarMade' });
const blockConfig = BlockConfig.load(config);

const core = blockConfig.getByName('Ship Core');
console.log('Ship Core id:', core?.id, 'hp:', core?.hp, 'mass:', core?.mass);

// Initialize the global registry for name lookups in enriched views
BlockRegistry.init(blockConfig);
console.log(BlockRegistry.getName(1));     // 'Ship Core'
console.log(BlockRegistry.getMass(598));   // mass of Grey Basic Armor
```

### Override a block definition safely

`saveCustom` **never touches** `data/config/BlockConfig.xml`. It writes only changed blocks to `customBlockConfig/BlockConfigImport.xml`, which StarMade loads as a layer on top of the vanilla file.

```ts
const vanilla = BlockConfig.load(config);
const core = vanilla.getByName('Ship Core')!;

// Double the Ship Core's HP
const modified = vanilla.set(core.with({ hp: core.hp * 2 }));
modified.saveCustom(config, vanilla); // writes only the diff
```

---

## 11. Block enrichment

Block enrichment resolves numeric block type IDs to human-readable names, mass, price, and HP using `BlockRegistry`. Always call `BlockRegistry.init()` first.

```ts
import {
  SMToolConfig, BlockConfig, BlockRegistry,
  ElementCountMap, getBlockCountStats,
} from 'starmade-decoder';

const config = SMToolConfig.fromData({ starmadeDir: '/path/to/StarMade' });
BlockRegistry.init(BlockConfig.load(config));

// Build a block count map from raw data
const ecm = new ElementCountMap([
  { type: 1,   count: 1   },  // Ship Core
  { type: 598, count: 250 },  // Grey Basic Armor
  { type: 263, count: 100 },  // Grey Standard Armor
]);

const stats = getBlockCountStats(ecm);
console.log('Total blocks:', stats.totalBlocks);    // 351
console.log('Total mass:', stats.totalMass.toFixed(1));
console.log('Total price:', stats.totalPrice);

for (const row of stats.byType) {
  console.log(`  ${row.blockName.padEnd(30)} × ${row.count.count} — mass: ${row.totalMass.toFixed(1)}`);
}
```

### Enrich a ship entity

```ts
import { registerAllFactories, Ship, RichSegmentController } from 'starmade-decoder';
import fs from 'node:fs';

registerAllFactories();

const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));
const rich = new RichSegmentController(ship);

// Block statistics from ManagerContainer
const stats = rich.blockStats;
if (stats) {
  console.log('Top block types:');
  for (const row of stats.byType.slice(0, 5)) {
    console.log(`  ${row.blockName}: ${row.count.count}`);
  }
}

// Compact summary
const summary = rich.summary();
console.log(summary.entityType, summary.realName, summary.sector);
```

---

## 12. Legacy parsers vs high-level objects

The SDK provides two layers:

| Layer | Example | Use when |
|---|---|---|
| **High-level objects** | `Ship.fromBuffer(data)` | You need typed fields, immutable updates, and round-trip serialization |
| **Legacy parsers** | `parseSegmentController(root)` | You only need a quick read of a few fields and don't need to write back |

The high-level objects are the recommended approach for most use cases. The legacy parsers are kept for lightweight scripts where you parse many files and only need one or two fields.

```ts
// High-level — full object, immutable updates, toTag()
import { Ship } from 'starmade-decoder';
const ship = Ship.fromBuffer(data);
const newShip = ship.withRealName('Explorer').withFactionId(42);
fs.writeFileSync(path, writeTo(newShip.toTag()));

// Legacy — lightweight, read-only
import { parseSegmentController, readFrom } from 'starmade-decoder';
const data = parseSegmentController(readFrom(buf));
console.log(data.uniqueId, data.realName, data.factionCode);
```

There is also a `SegmentControllerObject` business object that sits between the two: it wraps the raw Tag tree and exposes `uniqueId`, `realName`, `factionCode`, and accessors for `ControlElementMapper` and `ElementCountMap` — but it does not inherit from `GameEntity` and has fewer update methods.

---

## 13. Common pitfalls

### ❌ Forgetting `registerAllFactories()`

```ts
// Wrong — SERIALIZABLE fields will remain as raw bytes
const ship = Ship.fromBuffer(data);
ship.controlElementMap.links; // → [] (empty, not decoded)

// Correct
import { registerAllFactories } from 'starmade-decoder';
registerAllFactories(); // call once at program start
const ship = Ship.fromBuffer(data);
ship.controlElementMap.links; // → ControlLink[]
```

### ❌ Using `.sector` instead of `.sectorPosition`

The property is `sectorPosition` on all entity classes:

```ts
// Wrong
console.log(ship.sector); // undefined

// Correct
console.log(ship.sectorPosition.toString()); // SectorPosition(4, 4, 4)
```

### ❌ Writing back without calling `.toTag()`

```ts
// Wrong — writes the raw root Tag, not the updated object
fs.writeFileSync(path, writeTo(root));

// Correct — get the updated Tag from the high-level object
const updated = ship.withRealName('Explorer');
fs.writeFileSync(path, writeTo(updated.toTag()));
```

### ❌ Treating `credits` as a `number`

Credits are `bigint` because they can exceed 2^53:

```ts
// Wrong — TypeScript will reject this
const c: number = player.credits;

// Correct
const c: bigint = player.credits; // bigint
console.log(c.toString());        // '50000'
const doubled = player.withCredits(c * 2n);
```

### ❌ `BlockRegistry.initialize()` — the method is `init()`

```ts
// Wrong
BlockRegistry.initialize(blockConfig);

// Correct
BlockRegistry.init(blockConfig);
```

### ❌ Assuming all world files exist

Not every world has all file types. Use `fs.existsSync()` before reading:

```ts
const tradingPath = path.join(worldDir, 'TRADING.tag');
if (fs.existsSync(tradingPath)) {
  const manager = TradingManager.fromBuffer(fs.readFileSync(tradingPath));
  // ...
}
```

### ⚠️ GZIP files and `writeTo()`

`readFrom()` decompresses GZIP files transparently, but `writeTo()` **always writes uncompressed**. This is correct for `.ent` files (the game reads both), but you should be aware that the output file will be larger than the original when the original was compressed.

### ⚠️ The `FINISH_TAG` sentinel in STRUCT children

Every `STRUCT` tag ends with a `FINISH_TAG`. Always filter it when iterating children:

```ts
const fields = root.getStruct().filter(t => t.type !== TagType.FINISH);
//                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                     This filter is mandatory
```

---

## What next?

- See [docs/API.md](API.md) for the complete API reference with all method signatures and field descriptions.
- See [docs/EXAMPLES.md](EXAMPLES.md) for ready-to-run code snippets.
- The test files in `test/` are the most complete usage examples — each test file covers one module area.
