# Exact line and branch coverage

## Required gates

`npm run coverage:check` requires **100% lines, statements and branches** for
all production TypeScript files under `src/`, both globally and per file.
The configuration uses `all: true`, includes `src/**/*.ts` and excludes no
production files. Type-only modules are included in the source inventory.

`scripts/check-coverage.mjs` independently checks exact integer counters for
each file, rejects missing/unexpected report entries and coverage-ignore
directives, and keeps the existing global 70% function floor. Rounding a value
such as 99.999% to 100% is not sufficient. Function coverage is reported
separately and is not claimed to be 100%.

The CI matrix runs the same gates on Node 20, 22 and 24. Reports include HTML,
JSON, a JSON summary and LCOV. Registry-backed package tests and independent
Java/LZ4 checks remain separate requirements. The publication preflight also
runs the exact coverage gate.

## Added contracts

The tests use committed samples, synthetic wire records and temporary local
installations. They cover configuration precedence and every server schema
value; domain views and immutable edits; database arguments and padding;
legacy and current binary layouts; optional metadata; malformed/truncated
records; ZIP CRC and directory bounds; and explicit resource limits.

Fault injection is limited to boundaries that deliberately support failures:
filesystem identity/size changes, failed high-level simulation decoders and
mutable SERIALIZABLE callbacks. Global replacements are restored in `finally`.
No game installation, downloaded assets or network access is needed for the
regular test suite. Configuration and auxiliary-format installation tests require
an explicit `STARMADE_TEST_DIR`; the existence of `/srv/StarMade` alone does not
enable them. Without that variable, these tests are pending and are not counted
as passes. Once enabled, missing required files fail the tests.

On the development host, run the complete suite against the available installation:

```sh
STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check
```

The installation files are read only. See [the dated qualification
results](AUDIT_RESOLUTION.md#qualification) for test counts and exact coverage.

## Bugs exposed by the additional tests

- Player faction edits now retain the name of the original faction field.
- Legacy segment-controller faction edits keep the required STRUCT terminator.
- HP writes preserve the ElementCountMap at position six and the reboot-recovery
  byte at position seven. HP/max-HP edits preserve that map. This positional
  layout was checked against `SegmentControllerHpController` in the pinned
  StarMade-Open `decf3a1990f29b9505041f122188bf19489bcf7e` reference.

## Removal of redundant internal branches

No public validation checks were removed. The following internal alternatives
were provably unreachable after their callers' existing validation and were
simplified instead of suppressing their coverage:

- `_readPayload` is an exhaustive switch over the already-validated Tag enum.
  Unknown root and LIST type ordinals are still rejected before dispatch. The
  writer retains its runtime invalid-type guard for mutable callback attacks.
- The planetary descriptor index is clamped into a fixed non-empty table; its
  null fallback was redundant. Existing clamping behavior is unchanged.
- Entity container rebuilding receives a non-empty LIST or STRUCT from its two
  checked callers. Its initial child and container type cannot be absent.
  Duplicate `EntSlotObject` handling after an unconditional earlier return was
  removed. A type-checked vector conversion no longer has a null fallback.
- Blueprint entity paths have already passed ZIP path/root validation; splitting
  a string always yields at least one component. Direct basename extraction
  replaces unreachable fallbacks without relaxing ZIP validation.
- Metadata finalization copies a dense child array without changing its length.
  Parsed SMD3 diagnostics are always supplied and carry their segment path.
- Bitwise OR already converts an unavailable `O_NOFOLLOW` value to zero, so the
  preceding nullish-coalescing operation did not affect the open flags.

## Interpretation

Coverage shows which source lines and branches were executed, not that every
format combination or game behavior is correct. The independent wire oracles,
value assertions, corruption regressions and in-game integration checks remain
necessary. No StarMade game runtime was launched by this coverage work.
