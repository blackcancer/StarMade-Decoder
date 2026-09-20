# Pre-PR audit — correction status

This report addresses `AUDIT_StarMade-Decoder.md` dated 14 September 2026,
which examined `e5f531463825315ada91a92f35b3ca776e2b7c7d` (SDK 1.4.0).
The follow-up starts from the merged audit branches at `a471900`.
The format reference remains StarMade-Open
`decf3a1990f29b9505041f122188bf19489bcf7e`; this is not a claim about later
upstream revisions.

## Findings and executable evidence

| Finding | Final behavior | Evidence |
| --- | --- | --- |
| A01 runtime dependencies | XML/ZIP libraries are runtime dependencies. The installed tarball parses real XML and ZIP fixtures and exercises Tags/SMD3 in a fresh production consumer. | `scripts/check-package-consumer.mjs` |
| A02 Java strings | Save and network fields use validated modified UTF, including NUL, supplementary characters and lone surrogates. | `test/core/binary-primitives.test.ts`, `test/index.integrity.test.ts`, `scripts/check-wire-interop.mjs` |
| A03 segment truncation | Writer checks record capacity before copying and rejects unrepresentable segments. | `test/index.integrity.test.ts`, `test/smd3/binary-model-contracts.test.ts` |
| A04 block editing | Empty/SINGLE blocks are independent, edits persist despite stale counters, and writers derive occupancy. Unsupported runtime versions are rejected explicitly. | `test/index.integrity.test.ts`, `test/smd3/Smd3Writer.source-versions.test.ts`, `test/smd3/writers.test.ts` |
| A05 SINGLE_SIDE_EDGE | Exact integer/float geometry is applied with supplied normals; missing context fails explicitly. | `scripts/check-geometry-interop.mjs`, `test/fixtures/geometry_oracle.py` |
| A06 attached entities | Exact direct-parent relationships, no sibling descendants, one bounded path index, explicit depth/entity failures. | `test/smd3/SmentParser.archive-index.test.ts`, `test/index.integrity.test.ts` |
| A07 resource budgets | Negative/unsafe lengths fail. Tag nodes include FINISH and SERIALIZABLE items. Blueprint-wide bytes include nested inflation; metadata nodes share an aggregate allowance. Command recursion/arguments and database inflation are bounded. | `test/core/TagParser.budgets.test.ts`, `test/smd3/metadata-budgets.test.ts`, `test/index.resource-isolation.test.ts`, `test/db/integrity.test.ts` |
| A08 partial results | Strict parsing rejects corrupt records and cells. Blueprint recovery reports omissions. Remotes recovery preserves detached raw bytes and diagnostics, and cannot be edited/serialized. Actual Java HashMap decoding replaces heuristic string/boolean scanning. Trade sizes/padding, system grids and sector item tails are validated. | `test/index.integrity.test.ts`, `test/smd3/legacy-segment-resources.test.ts`, `test/db/integrity.test.ts`, `scripts/check-database-interop.mjs` |
| A09 reserved bits | All six extra block bits survive decoding/encoding; complete block fields are compared. | `test/index.integrity.test.ts`, Python block-word and geometry oracles with captured JDK vectors |
| A10 zero capacity | Growth has a positive floor; invalid/max capacities fail. An isolated process checks termination. | `test/core/binary-primitives.test.ts`, `test/index.integrity.test.ts`, `test/index.resource-isolation.test.ts` |

The mismatched version documentation now describes canonical version **0**.
`writeTo` is a semantic/canonical serialization, while `TagDocument` preserves
unchanged original bytes and retains envelope/version/trailing data on edits.
Its parsing/validation limits are consistent, including the exact GZIP payload
boundary. See [INTEGRITY_AND_MIGRATION.md](INTEGRITY_AND_MIGRATION.md) for public
API changes, database format selection and explicit recovery semantics.

## Qualification

The required coverage inventory is all production `src/**/*.ts` modules,
including modules never imported by a functional test and type-only modules.
The exact counter gate requires 100% lines, statements and branches per file
and globally, rejects missing files/skipped entries/coverage-ignore directives,
and is exercised by negative tests. No exclusions or reduced thresholds were
introduced. Function coverage is reported separately.

Commands:

```sh
npm ci --ignore-scripts
npm run build
npm run docs:check
npm run coverage:check
node scripts/test-coverage-gate.mjs
npm run test:package
npm run test:interop
python scripts/check-lz4-interop.py
npm audit --omit=dev
```

The installation integration tests require an explicit path. On the development
host, `/srv/StarMade` is available; enable it for the complete local run:

```sh
STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check
```

On 19 September 2026, this run on Node 20.20.2 passed **1,096 tests**, with
**zero pending and zero failing tests**. The exact gate passed for all
**98 production modules**: **27,980/27,980 lines** and **6,288/6,288 branches**,
with zero skipped coverage entries. Installation files are only read; edits and
round trips occur in memory or temporary directories. Without the environment
variable, 26 installation tests are deliberately pending even when the default
path exists. They must be enabled for qualification on this host.

The original dated qualification used independent JDK harnesses. Those Java
sources have since been removed. `test:interop` now runs independent Python
implementations for modified UTF/Tags/block words, ObjectStream maps,
SINGLE_SIDE_EDGE regions and blueprint archives. Captured JDK output hashes and
binary vectors retain a fixed external reference; running Python checks does
not constitute a new JDK-runtime qualification.

The geometry harness compares every field of all 1,146,880 block positions across
35 independently generated regions, including integer overflow, float rounding,
oblique planes and subnormals. Its normal vectors are synthetic. The map harness
checks both directions, repeated Boolean references, punctuation, NUL,
supplementary/lone-surrogate keys and the 65,535-byte modified-UTF boundary.
External python-lz4 checks complement these fixtures. Game sources are local,
read-only references and must not be included in the project or publications.

Resource-failure regressions execute with a 128 MiB V8 heap, a 10-second process
timeout and bounded captured output. A timeout, signal, abnormal exit or missing
success assertion fails the parent test.

Coverage proves executed paths, not every historical format combination. In CI,
optional installation fixtures are unavailable; pending tests there are not
counted as passing. No game runtime/import was executed; game-version-specific
geometry assets and in-game re-import remain outside this SDK-level correction
qualification. Unsupported formats now fail explicitly instead of being silently
converted or omitted. No npm release is included.
