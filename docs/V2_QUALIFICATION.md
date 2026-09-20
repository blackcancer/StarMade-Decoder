# V2.0.0 qualification — 2026-09-20

The complete local release suite passed on Node.js 20.20.2 with
`STARMADE_TEST_DIR=/srv/StarMade`: **1,477 tests passed, zero pending, zero failing**.
The installation was read only. This report describes the 2.0.0 source delivered
with this document; CI independently checks the pushed commit on Node.js 20/22/24.

## Exact coverage

| Scope | Covered / total | Result |
| --- | --- | --- |
| Production modules | 121 / 121 | All `src/**/*.ts`, including barrels |
| Lines | 28,347 / 28,347 | 100%, global and every file |
| Branches | 8,808 / 8,808 | 100%, global and every file |
| Statements | 28,347 / 28,347 | 100%, global and every file |
| Functions (reported separately) | 2,368 / 2,375 | 99.7% |

No exclusions, ignore directives or skipped counters were added. The existing
exact-counter gate rejects missing modules, rounded percentages and skipped
entries; all four negative gate checks passed. The 114 test suites mirror source
directories; cross-module contracts remain in the root index suites.

Coverage reports are generated in `coverage/` and preserved by CI. Coverage is
execution evidence, not a substitute for assertions or compatibility checks.

## Validation performed

- TypeScript build and JSDoc declaration checks passed; all 32 documentation
  TypeScript examples compiled against public exports. Every supported format
  family has a model/document in the [format matrix](FORMAT_MODELS.md).
- Contracts cover snapshots and detached results, immutable edit/revert, names,
  wrappers, opaque fields, historical layouts, malformed data and caller limits.
  Legacy player/entity DTO parsers use the same validated classes.
- The packed **starmade-decoder-2.0.0.tgz** passed an isolated production consumer:
  runtime imports, public TypeScript declarations, all five new auxiliary models,
  XML editing, skins, real faction/catalog/trading files, controllers, position-indexed
  inventories, blocks and complete ZIP/folder writes.
- Twelve real files reproduced byte-for-byte through public classes: faction,
  catalog, trading, simulation, NPC, floating-item, ship, station, shop and player
  fixtures, plus the installed FACTIONS.fac. The installed catalogue's **1,516
  complete definitions** survived XML/type-map export and reparse unchanged.
- Independent Python wire checks passed: eight UTF boundary vectors, six malformed
  vectors, plain/GZIP Tags and 32,768 packed words matched pinned JDK captures.
  ObjectStream map checks covered UTF, descriptors and shared handles.
- Python geometry checks matched **35 regions / 1,146,880 positions** against
  pinned JDK binary captures. Blueprint checks independently read **three archives
  / 163,840 words**, including records, CRCs, bounds/counts and ancillary files.
- The new Python SMBMM oracle independently generated UTF-8 text and legacy zlib
  vectors with Unicode namespaces and signed-short boundaries. Four unchanged
  exports were byte exact; four edited SDK exports were independently decoded.
- The Python SMSKIN oracle independently checked two archives and eight RGBA
  textures, including every decoded pixel, PNG CRC/zlib stream, ZIP descriptor,
  comment and extra field. SDK no-op and edit/revert preserved the exact source;
  a texture replacement retained the other entries. The SDK itself treats PNG
  payloads as opaque bytes and checks their signatures, without decoding images.
- `python-lz4==4.4.5` decoded 36 SDK blocks; the SDK decoded 72 external blocks.
- Source/archive guards and their negative checks passed. No Java sources or
  binaries are included in this source tree or package. Production dependency
  audit reported **zero vulnerabilities** at qualification time.

## Reproduce

```bash
npm ci --ignore-scripts
npm run build
npm run docs:check
npm run source:check
STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check
node scripts/test-coverage-gate.mjs
npm run test:interop
npm run test:package
# In an environment containing lz4==4.4.5:
python scripts/check-lz4-interop.py
npm audit --omit=dev
```

The package check requires registry access or populated npm caches. Python 3 is
required for independent oracles; no JDK or proprietary game sources are needed.
On CI hosts without a game installation, 26 installation-specific tests are
reported as pending, not passed; portable coverage still must meet the same exact
all-source gates. Missing required files fail once installation tests are enabled.

## Qualification limits

The reference is the external, read-only StarMade-Open revision
`decf3a1990f29b9505041f122188bf19489bcf7e`. The checks do not launch the game or
certify an in-game import, a later game version, or every historical encoding.
Supported writer/recovery limits remain in [blueprint editing](BLUEPRINT_EDITING.md)
and [migration notes](INTEGRITY_AND_MIGRATION.md). Rendering, administration policy
and database engine execution remain with consuming projects.

GitHub delivery does not publish to npm. The earlier cleanup of main history and
81 affected CI archives is separate from GitHub's old PR/cache references; removal
of those retained references still requires GitHub assistance. The current source
boundary must not be read as a claim that those external caches were purged.
