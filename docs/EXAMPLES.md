# StarMade-Decoder Examples

All examples use ESM syntax. Replace paths with files from your StarMade installation.

> **Note:** before parsing `.ent` files containing SERIALIZABLE payloads, call `registerAllFactories()` once at startup.

```ts
import { registerAllFactories } from 'starmade-decoder';
registerAllFactories();
```

## Read a Tag file and print JSON

```ts
import fs from 'node:fs';
import { readFrom, toJSON } from 'starmade-decoder';

const root = readFrom(fs.readFileSync('server-database/world0/FACTIONS.fac'));
console.log(toJSON(root, 2));
```

## Exact Tag round-trip

```ts
import fs from 'node:fs';
import { readFrom, writeTo } from 'starmade-decoder';

const input = fs.readFileSync('server-database/world0/ENTITY_PLAYERSTATE_Player.ent');
const root = readFrom(input);
const output = writeTo(root);

fs.writeFileSync('ENTITY_PLAYERSTATE_Player.copy.ent', output);
```

## Create a small Tag structure

```ts
import { Tags, writeTo } from 'starmade-decoder';
import fs from 'node:fs';

const tag = Tags.struct('Example', [
  Tags.string('name', 'Explorer'),
  Tags.int('factionId', 42),
  Tags.vector3i('sector', 1, 2, 3),
]);

fs.writeFileSync('example.tag', writeTo(tag));
```

## Edit one field in a Tag tree

```ts
import fs from 'node:fs';
import { readFrom, writeTo, Tags } from 'starmade-decoder';

const root = readFrom(fs.readFileSync('server-database/world0/ENTITY_PLAYERSTATE_Player.ent'));
const updated = Tags.setField(root, 'credits', Tags.long('credits', 1_000_000n));

fs.writeFileSync('ENTITY_PLAYERSTATE_Player.edited.ent', writeTo(updated));
```

## Parse and update a ship entity

```ts
import fs from 'node:fs';
import { Ship, writeTo } from 'starmade-decoder';

const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));

console.log(ship.uniqueId);
console.log(ship.realName);
console.log(ship.sector.toString());

const renamed = ship.withRealName('Explorer');
fs.writeFileSync('ENTITY_SHIP_MyShip.renamed.ent', writeTo(renamed.toTag()));
```

## Read factions and change a relation

```ts
import fs from 'node:fs';
import {
  readFrom,
  writeTo,
  FactionManager,
  RELATION_ALLY,
} from 'starmade-decoder';

const root = readFrom(fs.readFileSync('server-database/world0/FACTIONS.fac'));
const factions = FactionManager.fromTag(root);

const ids = factions.all.map(f => f.id);
const updated = factions.setRelation(ids[0], ids[1], RELATION_ALLY);

fs.writeFileSync('FACTIONS.updated.fac', writeTo(updated.toTag()));
```

## Inspect the catalog

```ts
import fs from 'node:fs';
import { readFrom, Catalog } from 'starmade-decoder';

const root = readFrom(fs.readFileSync('server-database/world0/CATALOG.cat'));
const catalog = Catalog.fromTag(root);

for (const entry of catalog.all) {
  console.log(entry.uid, entry.blueprintType, entry.price.toString());
}
```

## Parse a `.smd3` segment file

```ts
import fs from 'node:fs';
import { parseSmd3, getBlock } from 'starmade-decoder';

const smd3 = parseSmd3(fs.readFileSync('DATA_0_0_0.smd3'));
const firstSegment = smd3.segments[0];

console.log(firstSegment.version);
console.log(firstSegment.blockCount);
console.log(getBlock(firstSegment, 16, 16, 16));
```

## Parse an `.sment` blueprint archive

```ts
import fs from 'node:fs';
import { parseSment } from 'starmade-decoder';

const blueprint = parseSment(fs.readFileSync('MyBlueprint.sment'));

console.log(blueprint.root.name);
console.log(blueprint.root.header.entityType);
console.log(blueprint.root.header.totalBlockCount);
console.log(blueprint.totalEntities);
console.log(blueprint.totalSegments);
```

## Parse an extracted blueprint folder

```ts
import { parseBlueprintFolder } from 'starmade-decoder';

const blueprint = parseBlueprintFolder('/path/to/extracted/blueprint');
console.log(blueprint.root.header.boundingBox);
```

## Load BlockConfig and enrich block counts

```ts
import {
  SMToolConfig,
  BlockConfig,
  BlockRegistry,
  ElementCountMap,
  getBlockCountStats,
} from 'starmade-decoder';

const config = SMToolConfig.fromData({
  starmadeDir: '/path/to/StarMade',
  worldDir: 'world0',
});

const blockConfig = BlockConfig.load(config);
BlockRegistry.initialize(blockConfig);

const counts = new ElementCountMap([
  { type: 1, count: 1 },
  { type: 598, count: 250 },
]);

const stats = getBlockCountStats(counts);
console.log(stats.totalBlocks);
console.log(stats.byType.map(row => `${row.blockName}: ${row.count.count}`).join('\n'));
```

## Read and update `server.cfg`

```ts
import { SMToolConfig, ServerConfig } from 'starmade-decoder';

const config = SMToolConfig.fromData({
  starmadeDir: '/path/to/StarMade',
  worldDir: 'world0',
});

const server = ServerConfig.load(config);
const updated = server.set('AUTO_KICK_MODIFIED_BLUEPRINT_USE', false);
updated.save(config);
```

## Save a custom block override safely

`saveCustom` writes to `customBlockConfig/BlockConfigImport.xml` and does not overwrite `data/config/BlockConfig.xml`.

```ts
import { SMToolConfig, BlockConfig } from 'starmade-decoder';

const config = SMToolConfig.fromData({ starmadeDir: '/path/to/StarMade' });
const vanilla = BlockConfig.load(config);

const core = vanilla.getByName('Ship Core');
if (!core) throw new Error('Ship Core not found');

const custom = vanilla.set(core.with({ hp: core.hp + 100 }));
custom.saveCustom(config, vanilla);
```

## Fetch retrocompatibility samples

```bash
npm run samples:fetch-starmadedock
npm test -- test/retrocompat.test.ts
```

The fetcher honors `STARMADEDOCK_MAX_BYTES` to cap downloaded files.
