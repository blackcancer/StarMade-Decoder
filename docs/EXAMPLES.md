# StarMade-Decoder Examples

These examples use the current public package API. See the [migration contract](INTEGRITY_AND_MIGRATION.md) for changed schemas and the [API reference](API.md) for limits and preservation semantics.

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
import { readTagDocument } from 'starmade-decoder';

const input = fs.readFileSync('server-database/world0/ENTITY_PLAYERSTATE_Player.ent');
const document = readTagDocument(input);
const output = document.toBuffer();

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

## Edit a named field in a custom Tag document

`Tags.setField` edits by name. Game records often use anonymous positional
slots; use their typed models, such as `PlayerStateEntity.withCredits`, for
those fields.

```ts
import fs from 'node:fs';
import { readTagDocument, Tags } from 'starmade-decoder';

const document = readTagDocument(fs.readFileSync('example.tag'));
const updated = Tags.setField(document.root, 'name', Tags.string('name', 'Explorer II'));
fs.writeFileSync('example.edited.tag', document.toBuffer(updated));
```

## Update player credits through the real positional schema

```ts
import fs from 'node:fs';
import { PlayerStateEntity } from 'starmade-decoder';

const player = PlayerStateEntity.fromBuffer(
  fs.readFileSync('ENTITY_PLAYERSTATE_Player.ent'),
  { maxInputBytes: 16 * 1024 * 1024, maxNodes: 100_000 },
);
const updated = player.withCredits(1_000_000n);
console.log(updated.faction.factionId, updated.faction.suspended);
fs.writeFileSync('ENTITY_PLAYERSTATE_Player.edited.ent', updated.toBuffer());
```

## Parse and update a ship entity

```ts
import fs from 'node:fs';
import { Ship } from 'starmade-decoder';

const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));

console.log(ship.uniqueId);
console.log(ship.realName);
console.log(ship.sectorPosition.toString()); // SectorPosition(x, y, z)

const renamed = ship.withRealName('Explorer');
fs.writeFileSync('ENTITY_SHIP_MyShip.renamed.ent', renamed.toBuffer());
```

## Edit typed entity components while retaining surrounding data

These methods edit stored fields. They do not calculate a rendered transform
or execute a game action.

```ts
import fs from 'node:fs';
import { Ship } from 'starmade-decoder';

const ship = Ship.fromBuffer(fs.readFileSync('ENTITY_SHIP_MyShip.ent'));
const retimed = ship.withCoreTimer(ship.coreTimer.withTimeLeftMs(5000n));
const renamed = retimed.withBlueprintInfo(
  retimed.blueprintInfo.withIdentifier('Explorer Blueprint'),
);
console.log(renamed.managerContainer?.inventoryEntries.map(entry => entry.position));
fs.writeFileSync('ENTITY_SHIP_MyShip.edited.ent', renamed.toBuffer());
```

## Edit complete matrix values and inventory contents

```ts
import { EntityTransform, Inventory, ItemStack, Tags } from 'starmade-decoder';

const stored = [1, 0, 0, 7, 0, 1, 0, 8, 0, 0, 1, 9, 10, 20, 30, 1];
const transform = EntityTransform.fromMatrix4fList(
  Tags.list('transform', stored.map(value => Tags.float(null, value))),
);
const moved = transform.with({ originX: 12 });
console.log(moved.m03, moved.m13, moved.m23); // 7, 8, 9 remain stored
const matrixTag = moved.toTag(); // same LIST variant and name

const inventory = new Inventory(new Map([[0, new ItemStack(0, 5, 20)]]));
const split = inventory.split(0, 1, 7);
console.log(split.get(0)?.count, split.get(1)?.count); // 13, 7
const inventoryTag = split.toTag(); // actual inv1 encoding
console.log(matrixTag.name, inventoryTag.name);
```

## Read factions and change a relation

```ts
import fs from 'node:fs';
import { FactionManager, RELATION_ALLY } from 'starmade-decoder';

const factions = FactionManager.fromBuffer(fs.readFileSync('FACTIONS.fac'));
const [first, second] = factions.all;
if (!first || !second) throw new Error('Two existing factions are required');

const updated = factions.setRelation(first.id, second.id, RELATION_ALLY);
console.log(updated.getRelation(first.id, second.id)?.relation); // 2 = ALLY
fs.writeFileSync('FACTIONS.updated.fac', updated.toBuffer());
```

To edit one member, retain the parsed faction and member snapshots. Role
numbers below are stored values; role permissions remain those in the source.

```ts
import fs from 'node:fs';
import { FactionManager } from 'starmade-decoder';

const manager = FactionManager.fromBuffer(fs.readFileSync('FACTIONS.fac'));
const faction = manager.all.find(value => value.members.length > 0);
if (!faction) throw new Error('A faction with a member is required');
const members = faction.members;
members[0] = members[0].with({ role: 0 });
const updated = manager.setFaction(faction.with({ members }));
fs.writeFileSync('FACTIONS.member-edited.fac', updated.toBuffer());
```

## Inspect and edit catalog permissions and ratings

```ts
import fs from 'node:fs';
import { Catalog } from 'starmade-decoder';

const catalog = Catalog.fromBuffer(fs.readFileSync('CATALOG.cat'));
for (const entry of catalog.entries) {
  console.log(entry.uid, entry.permission, entry.timesSpawned, entry.price.toString());
}
const first = catalog.entries[0];
if (!first) throw new Error('The catalog has no permission entries');
const updated = catalog
  .updateEntry(first.uid, first.with({ description: 'Updated description' }))
  .withRating(first.uid, 'Player', 3);
fs.writeFileSync('CATALOG.updated.cat', updated.toBuffer());
```

`timesSpawned` is an INT counter. Ratings are separate per-blueprint/per-user
records, and `permission` is the saved INT mask.

## Edit a complete trading route

```ts
import fs from 'node:fs';
import { TradingManager } from 'starmade-decoder';

const trades = TradingManager.fromBuffer(fs.readFileSync('TRADING.tag'));
const first = trades.routes[0];
if (!first) throw new Error('There are no saved trade routes');
console.log(first.fleetId, first.startSector, first.sectorWayPoints);
const updated = trades.updateRoute(0, first.with({ blockPrice: 5000n }));
fs.writeFileSync('TRADING.updated.tag', updated.toBuffer());
```

The remaining nineteen-slot payload, complete block-count rows, waypoint
names and opaque fields are retained. This changes saved data only.

## Edit simulation groups without discarding subtype metadata

```ts
import fs from 'node:fs';
import { SimulationState } from 'starmade-decoder';

const state = SimulationState.fromBuffer(fs.readFileSync('SIMULATION_STATE.sim'));
console.log(state.uniqueGroups); // group-ID counter, not a timestamp
const groups = state.groups;
if (groups[0]) groups[0] = groups[0].with({ programId: -1 });
const updated = state.with({ groups });
fs.writeFileSync('SIMULATION_STATE.updated.sim', updated.toBuffer());
```

## Inspect and update archived metadata objects

```ts
import fs from 'node:fs';
import { FloatingItemsArchive } from 'starmade-decoder';

const archive = FloatingItemsArchive.fromBuffer(
  fs.readFileSync('FLOATING_ITEMS_ARCHIVE.ent'),
);
console.log(archive.format, archive.nextId, archive.totalCount);
for (const sector of archive.sectors) {
  console.log(sector.position, sector.items.map(item => item.id));
}
const first = archive.items[0];
const updated = first ? archive.updateItem(first.withSubObjectId(-1)) : archive;
fs.writeFileSync('FLOATING_ITEMS_ARCHIVE.updated.ent', updated.toBuffer());
```

Each object's `payload` is a complete metadata Tag. It is not an item quantity;
`nextId` and `totalCount` are separate values.

## Parse a `.smd3` segment file

```ts
import fs from 'node:fs';
import { parseSmd3, getBlock } from 'starmade-decoder';

const smd3 = parseSmd3(fs.readFileSync('DATA_0_0_0.smd3'));
const firstSegment = smd3.segments[0];
if (!firstSegment) throw new Error('The region contains no segments');

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
import { parseSmtpl, normalizeBlueprintTemplate, writeSmtpl } from 'starmade-decoder';

const template = normalizeBlueprintTemplate(parseSmtpl(fs.readFileSync('room.smtpl')));
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

## Read and replace an exact world seed

```ts
import fs from 'node:fs';
import { WorldSeedDocument } from 'starmade-decoder';

const seed = WorldSeedDocument.fromBuffer(fs.readFileSync('server-database/world0/.seed'));
console.log(seed.toJSON()); // decimal string, including full int64 precision
fs.writeFileSync('world.seed.copy', seed.toBuffer());
const replacement = seed.withSeed(1234567890123456789n);
fs.writeFileSync('world.seed.updated', replacement.toBuffer());
```

## Edit class-grouped persistent JSON

```ts
import fs from 'node:fs';
import { PersistentObjectDocument } from 'starmade-decoder';

const document = PersistentObjectDocument.fromBuffer(fs.readFileSync('objects.smdat'), {
  maxBytes: 4 * 1024 * 1024,
  maxEntries: 1000,
  maxNodes: 50_000,
  maxDepth: 32,
});
const updated = document.withClass('example.Settings', [{ enabled: true, label: 'Explorer' }]);
console.log(updated.objectsFor('example.Settings'));
fs.writeFileSync('objects.updated.smdat', updated.toBuffer());
```

The class name is a stored identifier; the SDK does not instantiate that class.

## Edit system-name tokens and subtitle cues

```ts
import fs from 'node:fs';
import { SystemNamesDocument, SubtitleDocument } from 'starmade-decoder';

const names = SystemNamesDocument.fromBuffer(fs.readFileSync('systemNames.syl'));
const changedNames = names.set(names.syllables.length, { value: 'sol', flags: ['+c'] });
console.log(changedNames.withFlag('+c'));
fs.writeFileSync('systemNames.updated.syl', changedNames.toBuffer());

const subtitles = SubtitleDocument.fromBuffer(fs.readFileSync('intro.sbv'));
console.log(subtitles.at(1500)); // start <= 1500 < end
const delayed = subtitles.shift(250);
fs.writeFileSync('intro.delayed.sbv', delayed.toBuffer());
```

## Translate explicit mod namespaces

```ts
import fs from 'node:fs';
import { BlueprintModMappings } from 'starmade-decoder';

const source = BlueprintModMappings.fromBuffer(Buffer.from('ExampleMod~Hull~2000\n'));
const target = new BlueprintModMappings([
  { modName: 'ExampleMod', blockName: 'Hull', id: 3000 },
]);
// Every namespace in source must exist in target; missing entries fail.
const idTranslation = source.translationTo(target);
console.log([...idTranslation]);
fs.writeFileSync('modMappings.target.smbmm', target.toBuffer());
```

The mapping is explicit data. This operation does not rewrite block placement
or choose missing IDs automatically.

## Edit indexed XML while preserving unrelated content

```ts
import { XmlConfigDocument } from 'starmade-decoder';

const original = XmlConfigDocument.fromXml(
  '<Config><!--retain--><Item id="a"><Enabled>true</Enabled></Item>' +
  '<Item id="b"><Enabled>false</Enabled></Item></Config>',
  { maxBytes: 1_000_000, maxEntries: 1000 },
);
const updated = original.set('Config.Item[1].Enabled', true);
console.log(updated.get('Config.Item[1].Enabled'));
console.log(updated.toXml()); // attributes, first Item and comment retained
console.log(updated.difference(original)); // changed subtree overlay
console.log(original.toXml()); // original string remains unchanged
```

## Edit a complete blueprint document

```ts
import fs from 'node:fs';
import { readBlueprintDocument } from 'starmade-decoder';

const document = readBlueprintDocument(fs.readFileSync('MyBlueprint.sment'));
const blocks = document.blocks();
blocks.set({ x: 0, y: 0, z: 0 }, { type: 1, hp: 127, active: false, orientation: 0 });
fs.writeFileSync('MyBlueprint.updated.sment', document.toBuffer());
```

Coordinates are the entity's native block grid. The document writer updates
header counts for geometry edits and retains unrelated archive resources.
Incomplete recovery results cannot be published by these writers.

## Fetch retrocompatibility samples

```bash
npm run samples:fetch-starmadedock
npm test -- test/smd3/retrocompat.test.ts
```

The fetcher honors `STARMADEDOCK_MAX_BYTES` to cap downloaded files.

## Edit a skin archive

```ts
import fs from 'node:fs';
import { SkinDocument } from 'starmade-decoder';

const source = fs.readFileSync('Player.smskin');
const skin = SkinDocument.fromBuffer(source);
console.assert(skin.toBuffer().equals(source));
console.log(skin.textureInfo('mainDiffuse'));
const png = fs.readFileSync('replacement.png');
const edited = skin.withTexture('mainDiffuse', png);
fs.writeFileSync('Player-edited.smskin', edited.toBuffer());
console.assert(edited.withTexture('mainDiffuse', skin.texture('mainDiffuse'))
  .toBuffer().equals(source));
```

The texture bytes are passed through unchanged. Image decoding and rendering
remain with the consumer; no textures or meshes are generated by this operation.
