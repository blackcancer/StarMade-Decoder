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
console.log(ship.sectorPosition.toString()); // SectorPosition(x, y, z)

const renamed = ship.withRealName('Explorer');
fs.writeFileSync('ENTITY_SHIP_MyShip.renamed.ent', writeTo(renamed.toTag()));
```

## Work with high-level `.ent` slot objects

The entity API exposes StarMade-Open slot objects instead of raw `Tag` trees.
Every helper returns a new immutable object, so the original parsed entity stays unchanged.

```ts
import fs from 'node:fs';
import {
  ModuleExplosionState,
  PlayerStateEntity,
  ScanDataRecord,
  Ship,
  writeTo,
} from 'starmade-decoder';

const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));

const retimed = ship.withCoreTimer(ship.coreTimer.withTimeLeftMs(5000n));
const renamedBlueprint = retimed.withBlueprintInfo(
  retimed.blueprintInfo.withIdentifier('Explorer Blueprint')
);

const railRequest = renamedBlueprint.railController.currentRequest;
const rotated = railRequest
  ? renamedBlueprint.withRailController(
      renamedBlueprint.railController.withCurrentRequest(
        railRequest.withDidRotationInPlace(true)
      )
    )
  : renamedBlueprint;

const module = rotated.managerContainer?.modules.getModule('JAO');
const shiftedModule = module?.entries[0]
  ? module.withEntry(0, module.entries[0].withPosition({ x: 1, y: 2, z: 3 }))
  : module;

const withModule = shiftedModule && rotated.managerContainer
  ? rotated.withManagerContainer(
      rotated.managerContainer.withModules(
        rotated.managerContainer.modules.withModule('JAO', shiftedModule)
      )
    )
  : rotated;

const explosion = ModuleExplosionState.create({
  radius: 4,
  damage: 250,
  explosionPositions: [1n, 2n, 3n],
});

const withExplosion = withModule.managerContainer
  ? withModule.withManagerContainer(
      withModule.managerContainer.withModuleExplosions(
        withModule.managerContainer.moduleExplosions.addExplosion(explosion)
      )
    )
  : withModule;

fs.writeFileSync('ENTITY_SHIP_MyShip.edited.ent', writeTo(withExplosion.toTag()));

const player = PlayerStateEntity.fromBuffer(fs.readFileSync('ENTITY_PLAYERSTATE_Player.ent'));
const withScan = player.withScanHistory(
  player.scanHistory.addScan(ScanDataRecord.create({
    origin: { x: 4, y: 4, z: 4 },
    time: BigInt(Date.now()),
    range: 1000,
    entityData: [{
      name: 'Explorer',
      sector: { x: 4, y: 4, z: 4 },
      factionId: 0,
      controllerInfo: '',
    }],
  }))
);
fs.writeFileSync('ENTITY_PLAYERSTATE_Player.edited.ent', writeTo(withScan.toTag()));
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
console.log(blueprint.root.entityType);
console.log(blueprint.root.declaredBlockCount);
console.log(blueprint.root.directBlockCount);
console.log(blueprint.totalEntities);
console.log(blueprint.totalSegments);

const turret = blueprint.findEntity('ATTACHED_0');
console.log(turret?.worldOffset);
console.log(blueprint.root.meta?.childOffsetFor('ATTACHED_0'));
console.log(blueprint.root.logic?.connectionCount);
```

## Parse an extracted blueprint folder

```ts
import { parseBlueprintFolder } from 'starmade-decoder';

const blueprint = parseBlueprintFolder('/path/to/extracted/blueprint');
console.log(blueprint.root.header.boundingBox);
console.log(blueprint.root.meta?.railChildren.length);
```

## Update blueprint header counts and score

```ts
import fs from 'node:fs';
import { parseSmbph, writeSmbph } from 'starmade-decoder';

const header = parseSmbph(fs.readFileSync('header.smbph'));
const mainBlock = header.topBlockTypes(1)[0];

const updated = (mainBlock
  ? header.withBlockCount(mainBlock.type, mainBlock.count + 12)
  : header
)
  .withClassification(4)
  .withScore(header.score?.withValue('miningIndex', header.score.miningIndex + 1) ?? null);

console.log(updated.classificationName);
console.log(mainBlock ? updated.blockCountOf(mainBlock.type) : 0);

fs.writeFileSync('header.updated.smbph', writeSmbph(updated));
```

## Update a template without raw maps

```ts
import fs from 'node:fs';
import { parseSmtpl, writeSmtpl } from 'starmade-decoder';

const template = parseSmtpl(fs.readFileSync('room.smtpl'));
const first = template.pieces[0];
const pos = first ? { x: first.x, y: first.y, z: first.z } : { x: 0, y: 0, z: 0 };

const updated = template
  .withText(pos, 'Cargo')
  .withInventoryFilter(pos, [{ type: 1, count: 5 }])
  .withProduction(pos, 1)
  .withProductionLimit(pos, 100);

console.log(updated.topBlockTypes(5));
console.log(updated.getText(pos));

fs.writeFileSync('room.updated.smtpl', writeSmtpl(updated));
```

## Update blueprint metadata without raw tags

```ts
import fs from 'node:fs';
import { parseSmbpm, writeSmbpm } from 'starmade-decoder';

const meta = parseSmbpm(fs.readFileSync('meta.smbpm'));
const updated = meta
  .withAiValue(19, 'false')
  .withRailUID('my-rail-root');

const childOffset = updated.childOffsetFor('ATTACHED_0');
console.log(childOffset);

fs.writeFileSync('meta.updated.smbpm', writeSmbpm(updated));
```

## Update blueprint logic without binary plumbing

```ts
import fs from 'node:fs';
import { parseSmbpl, writeSmbpl } from 'starmade-decoder';

const logic = parseSmbpl(fs.readFileSync('logic.smbpl'));
const controller = { x: 16, y: 16, z: 16 };
const target = { x: 20, y: 16, z: 16 };

const updated = logic
  .addLink(controller, 6, target)
  .moveController(controller, { x: 17, y: 16, z: 16 });

console.log(updated.targetsOf({ x: 17, y: 16, z: 16 }, 6));
fs.writeFileSync('logic.updated.smbpl', writeSmbpl(updated));
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
BlockRegistry.init(blockConfig);

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
