# Server configuration schema qualification — 2.0.3 — 2026-09-23

Reference: the read-only StarMade-Open checkout at
`e5a3b49d86943c4d618cea6512e28fa0b95901df`. The public
`SERVER_CONFIG_SCHEMA_SOURCE` constant pins that revision for consumers.

The game enum has **210 active keys**. The previous SDK had 196: 24 current keys
were absent and 10 keys were obsolete. All 210 keys are now in the active SDK
schema, with their game initial values, exact kind, effect description, group,
and numeric range or choices. Thirty-one defaults differed from the reference;
all were corrected, including `SECTOR_SIZE` from 10000 to 5000.

| Kind | Keys | Constraint metadata |
| --- | ---: | --- |
| Integer | 67 | Inclusive `min` and `max` |
| Long integer | 1 | Inclusive `min` and `max`; represented as a safe JS number |
| Float | 41 | Inclusive `min` and `max` |
| Boolean | 88 | `choices` for false and true |
| Enum | 1 | `choices` for `SURVIVAL` and `CREATIVE` |
| Free text | 12 | No game range or fixed choices |

`ServerConfig.fromString` retains comments, unknown historical keys and the
original spelling of numeric lines. It accepts a preexisting out-of-range numeric
value for inspection without rewriting the file. `set` and `setMany` enforce the
current game range and enum choices for new edits. Enum spelling is
case-insensitive, matching the game reader. The 10 obsolete keys remain intact
in original file text, while `isKnown` is false and new edits to them are rejected.

## Evidence

- A separate source extraction enumerated all 210 entries and compared their
  keys, kinds, initial values, state ranges/choices, categories and descriptions.
  The pinned, source-derived [reference data](../test/fixtures/server-config-reference.json)
  is checked against the public schema by the tests.
- The active `/srv/StarMade/server.cfg` was read without modification: all **210
  stored keys were recognized**, with zero unknown and zero missing. Its configured
  sector size of 16000 is distinct from the game's initial default of 5000.
- `STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check` passed: **1,552 tests,
  zero pending, zero failures**. All **122 production modules** have 100% lines
  (28,472 / 28,472) and branches (8,881 / 8,881) individually, with no skipped
  counters or coverage exclusions. `ServerConfig.ts` reached 548 / 548 lines and
  105 / 105 branches. Four negative coverage-gate checks passed.
- `npm run build`, `npm run docs:check`, `npm run source:check`,
  `npm run test:interop` and `npm run test:package` passed. The installed 2.0.3
  package exposes the runtime schema, source pin, range checks and public
  TypeScript metadata types to an isolated consumer.
- The source boundary and negative checks passed. No game Java source or binary
  was copied into the SDK; the committed reference fixture contains only
  derived setting data.

See the [public API contract](API.md#serverconfig).
