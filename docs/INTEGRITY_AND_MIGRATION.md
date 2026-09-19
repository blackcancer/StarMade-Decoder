# Data integrity and migration — 1.5.0

## Scope and reference

The September 2026 correction series is based on decoder commit
`e5f531463825315ada91a92f35b3ca776e2b7c7d` and the accessible
`blackcancer/StarMade-Open` fork at
`decf3a1990f29b9505041f122188bf19489bcf7e` (2025-08-07).
The Schine upstream repository was not directly accessible through the connection.
This is not a compatibility certification for later upstream revisions.

Relevant reference classes: `Tag`, `RemoteSegment`, `SegmentHeader`,
`SegmentSerializationBuffers`, `SegmentData4Byte`, `SegmentDataBitMap`,
`SegmentDataSingleSideEdge`, `IcosahedronHelper`, and `ControlElementMapper`.
No game assets or proprietary reference-source files are distributed here.

## Important behavior changes

- File strings and network strings both use Java **modified UTF-8**, including
  NUL and surrogate code units. Malformed continuation bytes are rejected.
- SMD3, blueprint archives and blueprint folders use **strict parsing** by
  default. Invalid records are not silently dropped. Optional missing metadata
  and logic files remain allowed, but invalid present files are errors.
- Legacy `DATA/*.smd0`, `*.smd1` and `*.smd2` resources require an explicit
  migration. Archives and folders reject them with `E_UNSUPPORTED` in strict
  mode; recovery reports their paths and returns `complete: false`, retaining
  any successfully decoded SMD3 resources, including attached entities.
- `parseSmbph`, `parseSmbpl` and `parseSmbpm` reject invalid required payloads.
  Unversioned legacy controller maps use the Java +8 coordinate-origin migration.
- New SMD3 output uses v7 **raw LZ4**, with native **little-endian** 32-bit words
  for the x86/ARM game builds covered by this implementation. Segment headers,
  SINGLE payloads and BITMAP words remain big-endian.
- Java's v7 serializer puts the preceding header length (22) in the int field
  before the LZ4 payload. The region-table size bounds the compressed block;
  this field is not interpreted as a zlib length.
- `BlockData.extra` preserves all six reserved bits (26..31); absent means zero.
  Writers validate field ranges rather than silently masking invalid values.
- Writers inspect block contents, not a potentially stale `blockCount`.
  Empty and SINGLE segments contain independent mutable block objects.
- Oversized records, duplicate cells, mixed regions, unaligned coordinates and
  incomplete recovery results cannot be written. A record that does not fit a
  48 KiB sector is rejected before any truncated output is returned.
- Blueprint `manager` is now parsed as `ManagerContainer`, not an unrelated
  complete `SegmentControllerObject`. The latter is retained in the input union
  only for source compatibility with callers supplying existing writer models.
- Metadata presence flags distinguish a present empty list from an absent
  payload. The committed 43-file warehouse metadata corpus is tested byte-exact
  when unchanged; this does not imply every historical metadata encoding is
  byte-exact after editing or normalization.

Review these behavior changes before upgrading existing applications.

## Safe block edits

```ts
import { parseSmd3, setBlock, writeSmd3 } from 'starmade-decoder';

const region = parseSmd3(inputBytes);
setBlock(region.segments[0], 1, 2, 3, {
  type: 5, hp: 127, orientation: 0, active: false,
});
const outputBytes = writeSmd3(region);
```

`setBlock` copies the value and updates the count. Direct array edits remain
supported; the writer recomputes content independently and does not mutate
caller-owned metadata. Coordinates in `SegmentData` are entity **block**
coordinates aligned to 32, not segment-grid indices. Timestamps remain under
caller control.

## Explicit migration of old SDK v7 files

SDK versions up to 1.4.0 wrote zlib-compressed, big-endian v7 arrays. Those bytes
must not be guessed from arbitrary game input. For files whose provenance is
known to be that SDK:

```ts
const legacy = parseSmd3(oldSdkBytes, { legacyV7ZlibBigEndian: true });
const correctedGameBytes = writeSmd3(legacy);
```

Archive readers forward this option through `segmentOptions`. Keep the original
file: legacy encoders may already have truncated records or discarded reserved
bits; information that was never saved cannot be reconstructed by this fix.

## Geometric segments

`SINGLE_SIDE_EDGE` is not a filled cube. It requires the three normals from the
caller's installation, in `data/IcoVectors.bin`:

```ts
import fs from 'node:fs';
import { readIcoSideNormals, parseSmd3 } from 'starmade-decoder';

const sideNormals = readIcoSideNormals(fs.readFileSync('data/IcoVectors.bin'));
const region = parseSmd3(inputBytes, { sideNormals });
```

The test applies Java-style float rounding and strict positive half-space
comparisons. Without the normals, strict decoding fails explicitly; it does
not invent geometry. Only the first nine big-endian float values are needed.

## Recovery and budgets

`parseSmd3`, `parseSment` and `parseBlueprintFolder` accept `mode: 'recover'`.
Their `complete` flag and `diagnostics` must be examined. `writeSmd3` refuses an
incomplete recovered region. Recovery is intended for inspection, not automatic
repair or overwrite. Removing diagnostics manually does not repair missing data.

Region defaults: 256 MiB input and 16,777,216 block positions. Archive/folder
budgets are aggregate: 256 MiB ZIP input, 128 MiB per entry, 512 MiB total entry
bytes, 10,000 entries/files, 1,024 entities, depth 64, and 16,777,216 block
positions. Limits can be reduced or deliberately raised for trusted corpora.
Budget exhaustion must not be treated as successful partial loading.

Block arrays contain JavaScript objects, so heap usage substantially exceeds
four bytes per position. Do not raise limits on an untrusted upload endpoint.
Move synchronous parsing off an HTTP event loop and isolate it in a worker with
process-level memory/time limits. The SDK does not supply an asynchronous parser.

ZIP entries are bounded before inflation and checked for actual size and CRC32.
Unsafe or duplicate paths, encryption, unsupported methods, ZIP64 and multi-disk
archives are rejected. No files are extracted to disk. Folder readers reject
symlinks at visited inputs and check file identity and size during bounded reads;
they are not a sandbox against a hostile process replacing ancestor directories.

## Tag envelope preservation

`writeTo(tag)` is a canonical root serializer: uncompressed, version 0, no
legacy trailing bytes. It must not be described as a byte-exact file writer.

```ts
import { readTagDocument, registerAllFactories, Tags } from 'starmade-decoder';

registerAllFactories();
const document = readTagDocument(originalBytes);
const unchanged = document.toBuffer(); // Exact original bytes, including GZIP.
const editedRoot = Tags.setField(document.root, 'credits', Tags.long('credits', 999n));
const edited = document.toBuffer(editedRoot); // Keeps compression/version/tail.
```

Modified documents preserve the envelope and trailing bytes but reserialize the
root and recompress GZIP. Byte-for-byte preservation of every encoding choice
inside an edited tree is not guaranteed. Unknown SERIALIZABLE factories without
a known payload boundary are rejected, not guessed or skipped.

## Validation and outstanding qualification

```bash
npm ci
npm run build
npm run docs:check
npm test
npm run coverage
npm run coverage:verify
npm run test:interop
npm run test:package
python -m pip install lz4==4.4.5
python scripts/check-lz4-interop.py
```

The JDK check requires Java 21+ and verifies both directions for modified UTF,
plain/GZIP Tags and all 32,768 independently produced raw block words. The LZ4
check exchanges 36 SDK-encoded blocks and 72 independently compressed blocks with
python-lz4. Package qualification installs the npm tarball in a fresh production
consumer and checks root imports, runtime behavior and declaration resolution.

Normal tests use committed or synthetic fixtures. Installation-only configuration
checks require `STARMADE_TEST_DIR`; some older optional tests also require a
specific blueprint in that installation. Missing fixtures are reported as pending,
not counted as passed. Real-installation tests must be run separately with the
user's supported game version.

Dense pre-v7 fixtures are decoded using their wire layout. Pre-v6 writing and
pre-v6 optimized-segment migration are deliberately refused: historical
orientation/block migrations require game-specific context. SMD3 writing is
semantic migration, not preservation of original sector layout/compression.

The game/server has **not** been launched by these checks. Final acceptance of
modified saves and v7 blueprints inside StarMade remains an integration gate.
Production dependency audits are performed in CI; a low-severity advisory in the
optional development-server path of transitive `esbuild` remained in the audited
development toolchain snapshot. It is not shipped as a production dependency.

## Completion of the pre-PR audit

The follow-up corrections and their evidence are mapped to A01–A10 in
[AUDIT_RESOLUTION.md](AUDIT_RESOLUTION.md).

Traversal budgets now include STRUCT terminators and items inside registered
SERIALIZABLE collections. `maxListLength` includes the final FINISH child of a
STRUCT. `sharedNodeBudget: { remainingNodes }` and
`sharedInflationBudget: { remainingBytes }` let multiple Tag reads share an
explicit allowance. These are mutable counters for a single operation, not
configuration objects to reuse across unrelated reads.

For blueprints, `maxTotalBytes` covers entry bytes plus decompressed nested GZIP
Tag bytes; plain Tags are already included in the entry bytes. `maxEntryBytes`
also bounds each nested inflation. `maxTagNodes` defaults to 1,000,000 nodes,
FINISH markers and SERIALIZABLE items across all metadata sections and entities.
An exceeded resource budget aborts even in recovery mode. ZIP paths are indexed
once, with entity/depth limits enforced before building an oversized index.

### Database cells

Absent/empty input remains distinct from malformed nonempty input. Fleet
commands, fixed system grids, sector item tails and trade payloads now reject
invalid lengths or content instead of returning apparently valid empty values.
Only zero trailing padding is accepted where a database format permits padding.
Sector writes reject excess capacity instead of truncating items. Database cells
and inflated trade payloads have a hard 16 MiB bound; command nesting is limited
to 64 and total command arguments to 65,536. No partial command or trade result
is returned as a valid object.

The fleet remotes codec parses actual JDK `HashMap<String, Boolean>` streams,
including shared object/class handles and Java modified UTF keys. It does not
scan for string-like bytes or invent boolean values. Only the standard HashMap
and Boolean descriptors, non-null keys/values, at most 32,767 entries and keys
encodable in 65,535 modified-UTF bytes are supported. Other schemas, unsupported
tokens, invalid handles, duplicate keys and truncated streams fail explicitly.
This codec never loads or instantiates arbitrary Java classes.

`encodeFleetRemotes(states)` retains its network-format default. Use
`encodeFleetRemotes(states, 'java')` for the database stream consumed by
`Fleet.deserializeRemotes`; the network format is **not** a substitute for that
stream. `FleetRemotesObject.fromBytes()` preserves its input format when edited
and serialized. New values created with `.from()` or `.empty()` use Java format.

To inspect a corrupt remotes cell, explicitly use
`FleetRemotesObject.fromBytes(bytes, { mode: 'recover' })`. It returns
`complete: false`, diagnostics with the column/offset, and detached original
`raw` bytes. Such an object cannot be edited or serialized; a failed decode can
no longer silently replace existing remote states with an empty map. Budget
exhaustion remains an exception in recovery mode.
