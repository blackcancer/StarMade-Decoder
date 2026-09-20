# Format classes

The 1.7.0 SDK provides models for stored StarMade data: decoding, explicit
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

On **2026-09-20**, Node.js 20.20.2 with `STARMADE_TEST_DIR=/srv/StarMade` passed
**1,233 tests, zero pending and zero failing**. Exact global and per-file gates
passed for **110 production modules**: **30,246/30,246 lines**, **7,599/7,599
branches**, zero exclusions/skips. Function coverage is **1,934/1,972 (98.07%)**
and is reported separately from the required line/branch gates.

Additional checks passed:

- TypeScript build, declaration JSDoc, source/archive publication guard and test
  layout gate (66 suites), plus negative source/coverage-gate regressions.
- Installed npm tarball in an isolated production consumer: public exports,
  runtime classes, catalogue round-trip, position-indexed inventories, negative
  grid edits, complete ZIP/folder writing and TypeScript consumer declarations.
- Independent Python binary checks: eight UTF vectors and six malformed vectors,
  32,768 packed words, ObjectStream maps, 35 regions / 1,146,880 positions matching
  captured JDK hashes, and three blueprint archives / 163,840 words.
- Independent `python-lz4==4.4.5`: 36 SDK blocks decoded externally and 72 external
  blocks decoded by the SDK. Production dependency audit: zero vulnerabilities.
- Read-only installed catalogue: all **1,516 definitions** preserved after
  in-memory XML/type-map export/reparse. Game files were not modified.

The suite exercises exact edit/revert bytes, opaque XML/Tag fields, manager
positions, binary corruption, resource limits, detached ownership and consumer
contracts. Coverage measures execution and does not replace these assertions.
See [coverage requirements](TEST_COVERAGE.md) for blocking gates. These checks do
not launch the game or establish in-game import qualification.
