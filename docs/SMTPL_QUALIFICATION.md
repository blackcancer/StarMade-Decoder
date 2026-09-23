# SMTPL compatibility qualification — 2.0.1 — 2026-09-23

The local correction was qualified on Node.js 20.20.2, starting from decoder
commit `4cb21bd72258c87eb8115f90449a8334c34658a6`. The reference is the updated,
read-only `/srv/dev/StarMade-Open` checkout at
`e5a3b49d86943c4d618cea6512e28fa0b95901df`.

## Format correction

The reference's `CopyArea` saves version 5. Its piece serializer emits three
little-endian bytes, with 11 type bits, 7 HP bits, 1 active bit and 5 orientation
bits. This differs from the legacy big-endian three-byte layout of versions 1–3.
The former SDK decoded both layouts using the legacy rules and always wrote v6.

The corrected reader distinguishes all three layouts. The writer honors versions
1–6, emits only their defined sections and rejects unrepresentable fields or
unavailable nonempty sections. The legacy HP field retains all eight stored bits;
extended v6 reserved bits are retained through the shared SMD3 word codec.
No game orientation migration, rendering calculation, Java source or Java binary
was added to the project.

## Validation

`STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check` passed with **1,517 tests,
zero pending and zero failures**. The installation was read only.

| Scope | Lines covered / total | Branches covered / total |
| --- | --- | --- |
| All 121 production modules | 28,333 / 28,333 (100%) | 8,848 / 8,848 (100%) |
| `src/smd3/SmtplParser.ts` | 894 / 894 (100%) | 158 / 158 (100%) |
| `src/smd3/SmtplWriter.ts` | 131 / 131 (100%) | 47 / 47 (100%) |

Every production file independently reaches 100% lines and branches. Statements
also reach 100%; functions are reported separately at 2,367 / 2,374 (99.7%).
No coverage exclusions, ignore directives or skipped counters were added.
The exact blocking gate and its four negative scenarios passed. There are
116 test suites, with directories mirroring `src`.

- Forty added tests assert independent binary vectors for all six versions,
  complete available sections, modified UTF text, signed positions and keys,
  empty records, activation flags, field limits, legacy HP and v6 reserved bits.
  Negative cases cover unsupported versions, nonrepresentable fields, unsupported
  sections, negative/impossible counts and truncated outer/nested collections.
- All **84 real v5 samples** reproduce their full original bytes after decoding
  and encoding. Existing sample assertions were strengthened, not removed.
- `node scripts/check-smtpl-interop.mjs` passed: an independent Python
  `struct`/integer-arithmetic oracle generates v4/v5/v6 walking-bit vectors,
  checks decoded fields, independently created SDK output, no-op output and
  edited activation flags. It also checks every decoded block in all 84 samples.
- The complete `npm run test:interop` suite passed, including existing Tag,
  ObjectStream, geometry, blueprint and skin compatibility recipes.
- `npm run build`, `npm run docs:check`, `npm run source:check` and
  `node scripts/test-coverage-gate.mjs` passed. The source guard and its negative
  checks reject Java sources/binaries, including nested archives.
- `npm run test:package` passed against `starmade-decoder-2.0.1.tgz` installed in
  an isolated production consumer. Public template imports, v5 binary output,
  decoding and TypeScript declarations work without SDK development dependencies
  supplying runtime imports.

## Compatibility limits

The updated reference accepts versions 1–5; SDK v6 support is retained for the
previous reference and earlier SDK exports. Use `version: 5` for new templates
targeting the updated reference. These checks qualify the wire format against
the source and independent oracles; they do not constitute an in-game import.

Legacy orientations are exposed as stored. Changing a version field is not a
game-dependent orientation migration. EOF between optional tail sections remains
accepted for compatibility; writing supplies all defined section counts. Exact
round-trips are verified for canonical complete files and the real corpus, not
for duplicate map keys, noncanonical UTF or unknown trailing bytes.

See the [format table](API.md#smtpl-template-files) and
[migration notes](INTEGRITY_AND_MIGRATION.md#smtpl-compatibility-correction-201).
