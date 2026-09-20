# Format classes

The 2.0.0 SDK provides models for stored StarMade data: decoding, explicit
validation, in-memory edits, indexed access and serialization. Each consumer
chooses its own workflow. StarMade-3D owns mesh generation, rendered coordinates,
rotations and projection; StarMade-BlockEditor owns its editing interface;
StarMade-DB owns database engine access. The decoder exposes the corresponding
stored fields and binary-column codecs without running those applications.

## Choose the appropriate layer

| Need | Classes / APIs | Ownership |
| --- | --- | --- |
| Preserve a Tag file's original bytes and envelope | `TagDocument` | Document owns original bytes; explicit serialization |
| Preserve SMD3 physical records | `Smd3Document` | Original sector layout and changed-record writer |
| Read/edit a complete archive or folder | `BlueprintDocument` | Original resources plus editable decoded models |
| Access every attached entity without ambiguous names | `BlueprintModel`, `BlueprintNode` | Full paths, separate native grids |
| Get/set cells without scanning every segment | `BlockVolume`, `Segment` | Explicit live view or detached copy |
| Work with complete immutable cell values | `BlockState`, `PlacedBlock` | Frozen state/position snapshots |
| Create/edit catalogue definitions | `BlockDefinition`, `BlockConfig` | Immutable definitions and collection updates |
| Edit real inventory payloads | `Inventory`, `ItemStack` | Immutable edits; preserved opaque Tags/wrappers |
| Find inventories by their stored block positions | `InventoryLocation`, `ManagerContainer` | Position index, kind and payload |

These classes complement the existing entity, metadata, logic, template, Tag and
configuration models listed in [the API reference](API.md). Constructing or editing
a model does not write a file. Use an explicit writer/save method to publish it.

## Coverage of supported formats

Every supported format family now has a dedicated model or document. This covers
the supported wire schemas, not every historical game version. The same contracts
apply throughout: validate represented fields, retain unrelated source data,
separate mutable projections from owned state, and serialize explicitly. Resource
options match each codec: `TagReadOptions` for Tag graphs, `FormatLimits` for
bounded auxiliary collections and codec-specific options for blueprints/database
columns. Fixed-size values also enforce their native wire widths.

| Format / data family | Model / document | Scope |
| --- | --- | --- |
| `.smskin` | `SkinDocument` | ZIP archives with four opaque PNG textures; immutable edits and exact source preservation |
| Generic Tag files | `Tag`, `TagDocument`, builders | Mutable low-level trees; document retains source envelope |
| `.ent` entities and components | `Ship`, `SpaceStation`, `ShopSpaceStation`, `FloatingRock`, player classes, `ManagerContainer`, `Inventory` | Typed immutable records and explicit component replacements |
| `.fac`, `.cat`, trading/chat/NPC `.tag`, `.sim` | `FactionManager`, `Catalog`, `TradingManager`, `ChatChannelManager`, `NPCFactionManager`, `SimulationState` | Validated collections and retained opaque fields |
| Floating items `.ent` | `FloatingItemsArchive` | Sector records, external metadata and next-ID counter |
| `.sment` and blueprint folders | `BlueprintDocument`, `BlueprintArchive`, `BlueprintEntity`, `BlueprintModel` | Editable hierarchy, original resources and bounded complete export |
| `.smd3` | `Smd3Document`, `Segment`, `BlockVolume`, `BlockState` | Editing versions 6/7; legacy SMD0/1/2 requires explicit migration |
| `.smbph`, `.smbpl`, `.smbpm`, `.smtpl` | `BlueprintHeader`, `BlueprintLogic`, `BlueprintMeta`, `BlueprintTemplate` | Format-specific validated models and writers |
| `.smbmm` | `BlueprintModMappings` | Namespaced text, legacy zlib, signed-short IDs and explicit translations |
| `server.cfg`, block/behavior/faction XML | `ServerConfig`, `BlockConfig`, `BlockDefinition`, `BlockBehaviorConfig`, `FactionConfig`, `XmlConfigDocument` | Immutable edits; arbitrary XML paths preserve unknown nodes |
| HSQLDB binary columns | `FleetCommandObject`, `FleetRemotesObject`, `SectorItemsObject`, `TradePricesObject`, `StarSystem` | Binary-column codecs; StarMade-DB owns the database engine |
| `.seed` | `WorldSeedDocument` | Exact signed-int64 seed; decimal JSON |
| `.smdat` | `PersistentObjectDocument` | Bounded per-class JSON data, with depth/node limits |
| `.sbv` | `SubtitleDocument` | Cue editing and half-open time lookup; no media rendering |
| `systemNames.syl` | `SystemNamesDocument` | Stored syllables/flags; no procedural name generation |

### Ownership, limits and source bytes

Format records and components snapshot inputs and return immutable revisions or
detached projections. Low-level `Tag` trees, blueprint document models and grid
editors deliberately support mutation; their contracts are explicit. Copying a
Tag returned by a record is unnecessary before editing it: the returned tree is
already detached from that record.

Limits are retained through immutable updates. Shared read counters are charged
for external data once, without charging the model's internal snapshots again.
`FormatLimits` defaults to 16 MiB and 100,000 entries. Additional JSON node/depth
limits apply to `.smdat`; Tag/blueprint readers retain their documented budgets.
Input/output byte limits concern encoded files; collection validation also applies
to caller-created models. Some auxiliary models check aggregate output bytes at
`toBuffer()`. No limit implies a game capacity, permission or server policy.

Use a source-aware document/model when exact bytes matter. Unchanged data and
supported semantic edit/revert return the retained original representation;
changed data use the relevant writer. Compression, whitespace or ZIP layout after
a real edit need not match an independently generated file. `toTag()` is a detached
logical tree; use the originating model's `toBuffer()` to retain its file envelope.
Bare constructors have no source envelope to preserve. XML edits retain unknown
nodes but may normalize textual formatting. See [blueprint editing](BLUEPRINT_EDITING.md)
for per-resource guarantees and restrictions.

```ts
import {
  WorldSeedDocument, BlueprintModMappings, PersistentObjectDocument,
} from 'starmade-decoder';

const seed = new WorldSeedDocument(-9223372036854775808n);
const mappings = new BlueprintModMappings([
  { modName: 'Example', blockName: 'Hull', id: 2000 },
], { maxEntries: 1000, maxBytes: 65536 });
const localId = mappings.idOf('Example', 'Hull');
const saved = new PersistentObjectDocument([], { maxNodes: 1000, maxDepth: 16 })
  .withClass('Example', [{ id: localId }]);
const bytes = saved.toBuffer();
```

## Blocks and blueprints

```ts
import fs from 'node:fs';
import {
  BlueprintDocument, BlockConfig, BlockDefinition, BlockState,
} from 'starmade-decoder';

const catalogue = BlockConfig.fromBlocks([
  BlockDefinition.create({ id: 2000, name: 'Custom hull', hp: 500 }),
]);
const document = BlueprintDocument.fromSment(fs.readFileSync('Ship.sment'), {
  maxBlocks: 64 * 32768,
  maxEntities: 32,
  maxDepth: 8,
});
const model = document.model(catalogue);
const root = model.nodes()[0];
root.blocks.set({ x: -33, y: 0, z: 1 }, BlockState.create(2000));
for (const placed of root.blocks.entries()) {
  console.log(placed.position, placed.state.type, placed.definition?.name);
}
fs.writeFileSync('Ship-edited.sment', document.toBuffer());
```

`document.blocks(entity?, catalogue?)` binds one entity. `model.nodes()` returns
fresh views in hierarchy order; `find('Ship/ATTACHED_0/ATTACHED_0')` resolves the
full path. Attachments keep separate grids and decoded metadata. An attachment's
stored offset alone does not describe a full rail transform. The SDK does not
flatten this hierarchy into rendered coordinates.

`BlockState` retains every storage field: type, seven-bit health, raw activation
bit, five-bit orientation and all six reserved bits. `fromWord()`/`toWord()` round
trip all 32 bits. `with()` creates a validated copy. `fullHitpoints(definition)` and
`withFullHitpoints()` convert health using the matching catalogue definition.
`create()` defaults non-air health to 127, orientation to 0 and the activation bit
to false; callers choose block-specific game policies.

`Segment.get(x,y,z)` and `.set(x,y,z,state)` use local integer coordinates 0–31.
`BlockVolume.get(position)` and `.set(position,state)` use native entity-grid
coordinates, including negatives. Addressing helpers expose native segment,
local-cell and shifted region coordinates. Missing cells read as air; setting a
nonzero storage word allocates its segment/region. Removing a cell retains the
allocation. Editing a cell does not implicitly change its timestamp.

A volume uses an index for constant-time segment lookup; iteration streams
occupied cells by default. `countsByType()` derives counts from cells.
`Segment.toData()` supplies detached plain arrays compatible with consumer
adapters; `.toPackedWords()` returns a detached `Uint32Array`. Sparse model JSON
retains entity paths and stored positions. No meshes or render transforms are
computed.

### Ownership and limits

- `Segment.fromData()` and `BlockVolume.fromFiles()` copy their input. `toData()`
  and `toFiles()` return detached snapshots.
- `Segment.attach()`, `new BlockVolume(files)` and document methods bind live
  data. Retain one active editing view. After changing raw data **or editing it
  through another view**, call `volume.refresh()` or obtain a new segment/model
  view: indices and cached counts belong to their originating view.
- `BlockVolumeOptions.maxSegments` defaults to 512. Standalone
  `BlueprintModelOptions` defaults to 1024 entities, depth 64 (maximum 256) and
  512 aggregate segments. Document views derive their limits from the document.
  A segment has 32,768 cells. Set smaller budgets for the application's workload.
- Cycles, duplicate paths/origins, ambiguous regions, incomplete recovery output,
  invalid fields and exceeded budgets fail explicitly. Current cell edits support
  segment versions 6/7. Lower-level parsers retain their documented legacy support.
- Empty standalone regions without filename hints belong to region `(0,0,0)`.
  Documents retain original region filenames; an external caller can supply
  `BlockVolumeOptions.regionCoordinates` for other empty regions.

Unchanged archives, including semantic edit/revert, retain original ZIP bytes.
Editing changes the relevant records; it does not promise that a newly encoded
compressed record has the same bytes as another encoder. Detached plain models
cannot recover lost original envelopes. See [blueprint writing](BLUEPRINT_EDITING.md).

## Catalogue creation and editing

```ts
import { BlockConfig, BlockDefinition } from 'starmade-decoder';

const hull = BlockDefinition.create({
  id: 2000, name: 'Custom hull', hp: 500, mass: 0.2,
  textureIds: [12, 12, 12, 12, 12, 12],
  metadata: { fullName: 'Custom reinforced hull', effectArmor: { heat: 2 } },
});
const variant = hull.with({ id: 2001, name: 'Variant', xmlTypeName: 'CUSTOM_VARIANT' });
const catalogue = BlockConfig.fromBlocks([hull, variant]);
const xml = catalogue.toXml();
const properties = catalogue.toBlockTypesProperties();
// Explicitly save these strings, or pass the mapping with XML to another consumer.
```

Definitions snapshot and freeze nested metadata, texture/variant arrays and
unknown XML fields. Updates return new definitions. `fromBlocks()` and exports
reject invalid IDs (valid new catalogue IDs are 1–4094), duplicate IDs/type names
and conflicting numeric aliases. Block-word type capacity is a separate binary
format limit.

The XML/type map pair preserves symbolic names. XML exports preserve unknown
attributes/subtrees and lexical extension values, including when a known field
is edited. This is semantic XML preservation: whitespace, original category
layout and the original XML document bytes are not guaranteed. Existing
`saveCustom()`/`saveAll()` remain explicit filesystem operations.

## Inventory payloads and caller constraints

```ts
import { Inventory, ManagerContainer } from 'starmade-decoder';

const inventory = new Inventory(new Map(), 12).add(2000, 20);
const split = inventory.split(0, 1, 5); // returns a new inventory
split.assertCapacity({ maximum: 100, volumeOf: type => type === 2000 ? 0.2 : 1 });
const position = { x: 16, y: 16, z: 16 };
const manager = ManagerContainer.EMPTY.withInventoryAt(position, split, 3);
const restored = ManagerContainer.fromTag(manager.toTag());
console.log(restored.getInventoryAt(position)?.countOf(2000)); // 20
```

`Inventory.fromTag(tag, { maxSlots })` validates actual `inv1`/compatible named
layouts and stash/factory wrappers, including typed slot/type LISTs. It preserves
wrapper metadata, unknown fields, item order and opaque payloads during edits.
Special metadata objects have quantity one; `ItemStack.special()` retains their
complete payload Tag. `ItemStack.grouped()` supports multislot groups and validates
member types/counts. JSON represents opaque Tags as `payloadTagBase64`, preserving
64-bit and binary values without lossy numeric conversion.

`maxSlots` limits the **number of occupied slots**, not the maximum slot index.
Its default is `Infinity`. `usedVolume(volumeOf)` and `assertCapacity()` use the
caller's resolver and maximum. These constraints describe the consuming
application's policy; they are not inferred from game settings or persisted in
inventory wire data. Supply read limits again after parsing. Tag parser node/byte
budgets apply before interpreting an inventory.

`set`, `remove`, `clear`, `add`, `split`, `merge` and `transferTo` return immutable
results. Transfer returns `{ source, target }`; failure leaves both inputs intact.
Special/grouped items move only in full. `withContents()` replaces contents while
retaining the destination's wrapper. These are collection operations: no server
commands, permissions system or administration workflow is implemented.

Manager entries contain **kind + block position + inventory**, and multiple
inventories commonly share a kind. Use `inventoryEntries`, `getInventoryAt()`,
`withInventoryAt()` and `withoutInventoryAt()`. Repeated position lookup is indexed.
Kind 3 is stash; it is not a unique "macro inventory". The legacy kind map and
named aliases are incomplete compatibility views; ambiguous kind lookups/updates
fail instead of silently choosing one entry. Position APIs reject malformed or
duplicate entries and retain unknown manager fields.

To persist a manager in blueprint metadata, use
`entity.meta = entity.meta.withManager(updatedManager)` followed by the document
writer. A regression edits one of two same-kind inventories, rereads the archive,
checks the other inventory and all unrelated files, then verifies edit/revert
restores the original ZIP bytes.

### Inventory migration

Older SDK releases emitted anonymous tuples which were not the actual `inv1`
layout. Reading or writing those explicitly uses `Inventory.fromLegacyTag()` and
`.toLegacyTag()`. These compatibility methods retain their earlier interpretation
and cannot represent grouped or opaque-payload items. The default `fromTag()` and
`toTag()` enforce the real wire layout and fail on unsupported data. Previous
hardcoded 36-slot assumptions must become an explicit caller limit if needed.

## Reference and qualification

Format behavior was checked against the external read-only StarMade-Open revision
`decf3a1990f29b9505041f122188bf19489bcf7e`. No Java sources or binaries are included
in this project, its npm package or new CI artifacts. Binary cross-checks use
independent Python implementations and captured JDK vectors.

The [V2 qualification report](V2_QUALIFICATION.md) records exact measured counters
and checks. Tests exercise edit/revert bytes, opaque XML/Tag fields, manager
positions, historical payloads, corruption, resource limits, detached ownership
and public consumer contracts. Coverage measures execution and does not replace
these assertions. See [coverage requirements](TEST_COVERAGE.md) for blocking gates.
The checks do not launch the game or establish in-game import qualification.

## Skin archives

`.smskin` is a ZIP containing four textures. `SkinDocument` uses the same validated
ZIP carrier as blueprint documents. `create()` writes `skin_main_diff.png`,
`skin_main_em.png`, `skin_helmet_diff.png` and `skin_helmet_em.png`. Reading also
accepts custom root-level prefixes with those four suffixes, as the client does;
ambiguous or missing roles fail. Unknown resources and directory entries survive.

```ts
import fs from 'node:fs';
import { SkinDocument } from 'starmade-decoder';

const skin = SkinDocument.fromBuffer(fs.readFileSync('Player.smskin'), {
  maxInputBytes: 16 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024,
});
const diffuse = skin.texture('mainDiffuse'); // detached PNG bytes
const edited = skin.withTexture('mainDiffuse', fs.readFileSync('replacement.png'));
fs.writeFileSync('Player-edited.smskin', edited.toBuffer());
```

`textureInfo(role)` exposes the stored name and byte length; `files` is a detached
map. `withFile`/`withoutFile` edit ancillary resources while requiring a complete,
unambiguous skin. Limits apply to input/output archive bytes, individual and total
uncompressed bytes, and entry count. Defaults: 16 MiB input/output/total, 4 MiB per
entry and 64 entries. Limits survive edits; invalid updates leave their source
unchanged. ZIP32 stored/deflated entries are supported; encrypted/ZIP64 archives
are rejected by the shared codec.

Validation covers ZIP structure, paths, sizes, decompression and CRCs, required
texture roles and PNG signatures. The SDK does not decode pixels, validate a
complete PNG image, resize textures, or apply upload/rendering policies. Use an
image codec in the consumer for those image operations. New archives use canonical
filenames; preserving a custom/extended source does not certify server acceptance.
