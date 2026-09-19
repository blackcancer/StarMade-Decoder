# StarMade-Decoder

TypeScript SDK for reading, inspecting, and rewriting **StarMade** save files and blueprint formats.

The SDK implements the Java `org.schema.schine.resource.tag.Tag` binary format and higher-level helpers for entities, blueprints and configuration files.

`main` contains the **1.6.0 blueprint-writing candidate**, including complete `.sment` and
blueprint-folder writers, the completed audit corrections and exact coverage checks. [Unreleased in the changelog](CHANGELOG.md#unreleased)
records implemented changes awaiting a versioned release. Pushing these changes to
GitHub does not publish an npm package.

**Upgrading from 1.4.0:** read [Data integrity and migration](docs/INTEGRITY_AND_MIGRATION.md). Strict error handling, Java modified UTF-8 and v7 LZ4 serialization correct earlier incompatible behavior. Back up source files before migration.

## Features

- Read and write StarMade Tag files (`.ent`, `.fac`, `.cat`, `.tag`, `.sim`)
- Preserve unchanged Tag files byte-for-byte with `TagDocument`, and retain their
  compression, version and trailing data when editing
- Read, edit and write complete `.sment` archives and blueprint folders with
  `BlueprintDocument`, preserving unchanged archives byte-for-byte
- Preserve SMD3 sector layouts with `Smd3Document`; update only changed records
- Parse StarMade blueprint formats (`.sment`, `.smd3`, `.smtpl`, `.smbph`, `.smbpl`, `.smbpm`, `.smbmm`)
- Use typed domain objects for ships, stations, players, factions, catalogs, trading, inventories, and serializable payloads
- Load StarMade configuration files, inspect BlockConfig element information, and save custom overrides safely
- Read and write HSQLDB binary columns for fleet commands/remotes, sector items,
  trade prices and system data, including Java fleet-remotes object streams
- Read and write auxiliary `.seed`, `.smdat`, `.sbv` and `systemNames.syl` files
- Use strict blueprint/database decoding, bounded Tag traversal and explicit
  diagnostics for opted-in blueprint and fleet-remotes recovery
- Fetch and test public retrocompatibility samples from StarMadeDock

## Build from source

Requires **Node.js 20.19.0 or newer**. From a checkout of this repository:

```bash
npm ci --ignore-scripts
npm run build
npm test
```

The build creates the JavaScript and TypeScript declarations in `dist/`.
Python 3 is required for source-publication checks and independent binary oracles;
the separate LZ4 qualification additionally uses `lz4==4.4.5`. No JDK is required.
Game sources remain external, read-only references: this repository and its
published package must not contain Java source files or Java binaries.

## Basic usage

```ts
import fs from 'node:fs';
import { readTagDocument, registerAllFactories, toJSON } from 'starmade-decoder';

const data = fs.readFileSync('server-database/world0/FACTIONS.fac');
registerAllFactories();
const document = readTagDocument(data);
const root = document.root;

console.log(toJSON(root, 2));

const out = document.toBuffer(root);
fs.writeFileSync('FACTIONS.edited.fac', out);
```

## Lossless blueprint editing

```ts
import fs from 'node:fs';
import { readBlueprintDocument, writeBlueprintFolder } from 'starmade-decoder';

const bytes = fs.readFileSync('Ship.sment');
const document = readBlueprintDocument(bytes);
console.assert(document.toBuffer().equals(bytes));

document.root.header = document.root.header.withClassification(7);
fs.writeFileSync('Ship.edited.sment', document.toBuffer());
writeBlueprintFolder(document, '/tmp/Ship-edited');
```

See [complete blueprint editing](docs/BLUEPRINT_EDITING.md) for folder snapshots,
new models, attachment updates, byte-preservation guarantees and supported limits.
Unknown resources and mod mappings are retained. Existing destinations require
explicit `overwrite: true`; new ZIPs from plain folders have a new envelope.

## BlockConfig element information

`BlockConfig` keeps the raw StarMade XML fields available, and also exposes
StarMade-Open-inspired element information for common tooling needs.

```ts
import { BlockConfig, SMToolConfig } from 'starmade-decoder';

const cfg = SMToolConfig.fromData({ starmadeDir: '/srv/StarMade' });
const blocks = BlockConfig.load(cfg);
const greyHull = blocks.getElementInfoByName('Grey Basic Armor');

console.log(greyHull?.render.style.key);                 // NORMAL
console.log(greyHull?.recipe.consistence[0].name);       // Metal Mesh
console.log(blocks.getElementInfoByTypeName('CARGO_SPACE')?.render.defaultOrientation);
```

## Documentation

- [Getting started guide](docs/GUIDE.md) — file system overview, first steps, common pitfalls
- [API reference](docs/API.md) — complete method and field documentation
- [Examples](docs/EXAMPLES.md) — ready-to-run code snippets
- [Changelog](CHANGELOG.md) — implemented changes and earlier versions
- [Data integrity and migration](docs/INTEGRITY_AND_MIGRATION.md) — strict parsing, recovery, budgets and format changes
- [Audit resolution](docs/AUDIT_RESOLUTION.md) — completed corrections and independent validation evidence
- [Coverage requirements](docs/TEST_COVERAGE.md) — exact counters, fixture scope and blocking gates

## Binary tag format

StarMade files use an NBT-style tag system:

| Type | Ordinal | Description |
|------|---------|-------------|
| FINISH | 0 | STRUCT end marker |
| BYTE | 1 | int8 |
| SHORT | 2 | int16 BE |
| INT | 3 | int32 BE |
| LONG | 4 | int64 BE |
| FLOAT | 5 | float32 BE |
| DOUBLE | 6 | float64 BE |
| BYTE_ARRAY | 7 | int32 length + bytes |
| STRING | 8 | Java modified UTF-8 (uint16 encoded byte length) |
| VECTOR3f | 9 | 3× float32 |
| VECTOR3i | 10 | 3× int32 |
| VECTOR3b | 11 | 3× int8 |
| LIST | 12 | 1 byte element type + int32 count + elements |
| STRUCT | 13 | child tags until FINISH |
| SERIALIZABLE | 14 | 1 byte factoryId + payload |
| VECTOR4f | 15 | 4× float32 |
| MATRIX4f | 16 | 16× float32 row-major |
| NOTHING | 17 | no payload |
| MATRIX3f | 18 | 9× float32 row-major |

Non-GZIP files start with:

```text
short version (new uncompressed output = 0)
byte prType  (> 0 = named, < 0 = anonymous, 0 = FINISH)
[if named] uint16 byte length + modified UTF-8 (Java readUTF)
payload by type
```

GZIP files start with `0x1F 0x8B` and do not include the `short version` prefix.

## Project structure

```text
src/
  core/          low-level Tag, parser, writer, serializer, builders
  types/         vector and matrix primitives
  serializable/  StarMade SERIALIZABLE factory registry and raw elements
  entity/        legacy typed parsers by file type
  objects/       high-level business objects and entity classes
  config/        StarMade config loaders and immutable editors
  db/            HSQLDB binary codecs, business objects and auxiliary save files
  smd3/          blueprint and segment parsers/writers
test/            round-trip, parser, writer, config, and retrocompat tests
scripts/         coverage gates, package checks, Python/LZ4 oracles and sample helpers
```

## Validation

```bash
npm run build
npm run source:check
npm run docs:check
npm run coverage:check
node scripts/test-coverage-gate.mjs
npm run test:interop   # Requires Python 3
npm run test:package   # Installs the packed SDK in a fresh production consumer
# With Python's lz4==4.4.5 installed:
python scripts/check-lz4-interop.py
```

Coverage is measured on each CI run rather than stated as a permanent percentage.
CI qualifies Node.js 20, 22 and 24, with independent Python binary oracles and LZ4
checks on Node.js 22. It rejects Java sources/binaries, including nested archives,
before producing evidence. Validation artifacts no longer embed source archives.
Installation-specific tests are pending when not enabled or when optional fixtures
are absent; they are not counted as passes. These checks do not launch the StarMade
game/server.

On a development host with the game installed, enable the installation tests
explicitly; finding the default directory alone does not enable them:

```bash
STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check
```

Once these installation tests are enabled, missing required configuration or
auxiliary files fail the run. Installation files are read only.

The local 1.6.0 qualification on **2026-09-19** passed **1,186 tests with zero
pending and zero failing**. All **102 production modules** reached
**29,175/29,175 lines** and **6,905/6,905 branches**, with the exact blocking gate
and no coverage exclusions. The installed-package check and independent Java/LZ4
oracles also passed. See [blueprint qualification](docs/BLUEPRINT_EDITING.md#reference-and-qualification)
for tested contracts and limitations. The earlier audit evidence remains in
[the dated audit report](docs/AUDIT_RESOLUTION.md#qualification).

## Exact coverage acceptance

The project requires 100% lines, statements and branches across every production
source module, without coverage exclusions or ignore directives. Run
`npm run coverage:check`; see [the coverage contract](docs/TEST_COVERAGE.md) for
exact-counter gates, fixture scope and independent validation requirements.
