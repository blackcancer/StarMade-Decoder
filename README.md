# StarMade-Decoder

TypeScript SDK for reading, inspecting, and rewriting **StarMade** save files and blueprint formats.

The SDK implements the Java `org.schema.schine.resource.tag.Tag` binary format and higher-level helpers for entities, blueprints and configuration files.

**Upgrading from 1.4.0:** read [Data integrity and migration](docs/INTEGRITY_AND_MIGRATION.md). Strict error handling, Java modified UTF-8 and v7 LZ4 serialization correct earlier incompatible behavior. Back up source files before migration.

## Features

- Read and write StarMade Tag files (`.ent`, `.fac`, `.cat`, `.tag`, `.sim`)
- Preserve binary round-trips for supported save files
- Parse StarMade blueprint formats (`.sment`, `.smd3`, `.smtpl`, `.smbpl`, `.smbpm`, `.smbmm`)
- Use typed domain objects for ships, stations, players, factions, catalogs, trading, inventories, and serializable payloads
- Load StarMade configuration files, inspect BlockConfig element information, and save custom overrides safely
- Fetch and test public retrocompatibility samples from StarMadeDock

## Installation

```bash
npm install
npm run build
npm test
```

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
  smd3/          blueprint and segment parsers/writers
test/            round-trip, parser, writer, config, and retrocompat tests
scripts/         sample fetch helpers
```

## Validation

```bash
npm run build
npm run docs:check
npm test
npm run coverage
npm run coverage:verify
npm run test:interop   # Requires JDK 21+
npm run test:package   # Installs the packed SDK in a fresh production consumer
```

Coverage is measured on each CI run rather than stated as a permanent percentage.
Installation-specific tests require `STARMADE_TEST_DIR`; missing optional fixtures
are reported as pending. CI qualifies Node.js 20, 22 and 24, with independent JDK
and LZ4 checks on Node.js 22. These checks do not launch the StarMade game/server.

See [Data integrity and migration](docs/INTEGRITY_AND_MIGRATION.md) for resource
budgets, recovery diagnostics, supported migrations and explicit limitations.

## Exact coverage acceptance

The correction branch requires 100% lines and branches across every production
source module, without coverage exclusions or ignore directives. Run
`npm run coverage:check`; see [the coverage contract](docs/TEST_COVERAGE.md) for
exact-counter gates, fixture scope and independent validation requirements.
