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
| A02 Java strings | Save and network fields use validated modified UTF, including NUL, supplementary characters and lone surrogates. | `test/audit-core.test.ts`, `test/audit-integrity.test.ts`, `scripts/check-java-interop.mjs` |
| A03 segment truncation | Writer checks record capacity before copying and rejects unrepresentable segments. | `test/audit-integrity.test.ts`, `test/coverage-binary-models.test.ts` |
| A04 block editing | Empty/SINGLE blocks are independent, edits persist despite stale counters, and writers derive occupancy. Unsupported runtime versions are rejected explicitly. | `test/audit-integrity.test.ts`, `test/audit-smd3-version.test.ts`, `test/writers.test.ts` |
| A05 SINGLE_SIDE_EDGE | Exact integer/float geometry is applied with supplied normals; missing context fails explicitly. | `scripts/check-geometry-interop.mjs`, `test/fixtures/GeometryOracle.java` |
| A06 attached entities | Exact direct-parent relationships, no sibling descendants, one bounded path index, explicit depth/entity failures. | `test/audit-archive-index.test.ts`, `test/audit-integrity.test.ts` |
| A07 resource budgets | Negative/unsafe lengths fail. Tag nodes include FINISH and SERIALIZABLE items. Blueprint-wide bytes include nested inflation; metadata nodes share an aggregate allowance. Command recursion/arguments and database inflation are bounded. | `test/audit-tag-budget.test.ts`, `test/audit-metadata-budget.test.ts`, `test/audit-resource-process.test.ts`, `test/audit-database-integrity.test.ts` |
| A08 partial results | Strict parsing rejects corrupt records and cells. Blueprint recovery reports omissions. Remotes recovery preserves detached raw bytes and diagnostics, and cannot be edited/serialized. Actual Java HashMap decoding replaces heuristic string/boolean scanning. Trade sizes/padding, system grids and sector item tails are validated. | `test/audit-integrity.test.ts`, `test/legacy-segment-resources.test.ts`, `test/audit-database-integrity.test.ts`, `scripts/check-database-interop.mjs` |
| A09 reserved bits | All six extra block bits survive decoding/encoding; complete block fields are compared. | `test/audit-integrity.test.ts`, Java block-word and geometry oracles |
| A10 zero capacity | Growth has a positive floor; invalid/max capacities fail. An isolated process checks termination. | `test/audit-core.test.ts`, `test/audit-integrity.test.ts`, `test/audit-resource-process.test.ts` |

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

`test:interop` invokes three independent JDK harnesses: modified UTF/Tags/block
words, actual ObjectOutputStream/ObjectInputStream maps, and SINGLE_SIDE_EDGE
regions. The geometry harness compares every field of all 1,146,880 block
positions across 35 independently generated regions, including integer overflow,
float rounding, oblique planes and subnormals. Its normal vectors are synthetic;
no game assets or complete proprietary Java source are distributed. The map
harness checks both directions, repeated Boolean references, punctuation, NUL,
supplementary/lone-surrogate keys and the 65,535-byte modified-UTF boundary.
External python-lz4 checks complement the Java and SDK fixtures.

Resource-failure regressions execute with a 128 MiB V8 heap, a 10-second process
timeout and bounded captured output. A timeout, signal, abnormal exit or missing
success assertion fails the parent test.

Coverage proves executed paths, not every historical format combination. Tests
requiring unavailable optional installation fixtures remain pending and are not
counted as passing. No game runtime/import was executed; game-version-specific
geometry assets and in-game re-import remain outside this SDK-level correction
qualification. Unsupported formats now fail explicitly instead of being silently
converted or omitted. No npm release is included.
