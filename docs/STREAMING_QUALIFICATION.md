# StarMade-3D streaming contract

`streamSmd3(source, options?)`, `streamBlueprintFolder(path, options?)` and
`streamSment(path, options?)` are public `AsyncIterable` generators. They leave
the existing eager parsers and lossless editing documents unchanged. Register
serializable factories before reading blueprint Tag metadata:

```ts
import { registerAllFactories, streamSment } from 'starmade-decoder';

registerAllFactories();
const controller = new AbortController();
let finalStatus: string | undefined;
for await (const event of streamSment('Ship.sment', { signal: controller.signal })) {
  if (event.kind === 'entity') {
    // event.path is stable; event.parentPath links the docking hierarchy.
    // Retain metadata or text here if needed; the stream retains no entity tree.
  } else if (event.kind === 'segment') {
    // event.words is a Uint32Array of 32,768 canonical block words.
    // event.entityPath links it to the preceding entity event.
    // Transfer/process this array before requesting another segment.
  } else {
    finalStatus = event.status;
    if (event.status !== 'complete') console.error(event.diagnostics);
  }
}
if (finalStatus !== 'complete') throw new Error(`Incomplete blueprint: ${finalStatus ?? 'iterator closed'}`);
```

The generator does not prefetch: advancing the iterator requests the next
metadata resource or segment. A plain `.smd3` file reads its fixed header and
then one record at a time. A folder walks entity directories and opens one
region at a time. A `.sment` archive indexes the ZIP32 central directory, then
inflates one requested ZIP entry at a time. The central index is bounded by
`maxCentralDirectoryBytes` (8 MiB default) and `maxEntries` (10,000 default).
Each inflated entry is bounded by `maxEntryBytes` (32 MiB default); a larger
SMD3 ZIP entry fails rather than silently loading the whole archive. Geometry
entries above `maxBufferedEntryBytes` (4 MiB default) are decompressed in
chunks to a private temporary file with incremental size/CRC validation. The
file is removed on completion, cancellation or error. Set that option to zero
to force this path, or to 32 MiB to keep allowed entries in memory. The archive
has entry-level demand granularity, while a loose SMD3 file has record-level
granularity. Encrypted, ZIP64, multi-disk and symlink entries are
unsupported. Migrate `.smd0`–`.smd2` geometry before streaming it.

`maxInputBytes` defaults to 256 MiB per file/archive, `maxMetadataBytes` to
8 MiB per resource, and `maxBlocks` to 16,777,216. Folder/ZIP traversal also
honors the existing `BlueprintParseOptions` aggregate limits; use
`segmentOptions.maxSegments` for a per-region slot limit. One segment
owns a 128 KiB `Uint32Array` plus transient compressed-data allocations. Consumers
should release or transfer each array before advancing if they need bounded
end-to-end memory. SMD3 decodes directly into the typed array, without one
intermediate object per block. The stream never performs camera, mesh, orientation or
world-space 3D calculations. `offset` and `worldOffset` are the stored and
summed docking translations in block coordinates.

The final `end` event distinguishes `complete`, `partial`, `error` and
`cancelled`, with segment/entity counts and diagnostics. `partial` occurs only
in `mode: 'recover'` when malformed SMD3 records or unsupported old regions
were skipped. Strict mode reports `error`. `AbortSignal` is checked between
I/O/decode boundaries and returns `cancelled`. An iterator closed early with
`break` does not yield an `end` event; its descriptor is still released. Callers
must not treat absence of an `end` event as complete.

## Baseline and measured result

Measured with `node scripts/benchmark-streaming.mjs` on 2026-09-24 in isolated
fresh Node.js 20.20.2 processes on an 8-vCPU x86-64 Haswell host. The eager
baseline reads the complete file/archive and builds all segment objects before the first segment can be consumed. The
streaming measurement advances through every event. `peak RSS delta` is the
process high-water mark minus its starting high-water mark. Times and RSS are
single-run observations, not throughput guarantees.

| Sample | Approach | Segments | First segment | Total | Peak RSS | Peak RSS delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `BASE_Warehouse_Station` SMD3 region | Eager | 47 | 341 ms | 341 ms | 194 MiB | 136 MiB |
| Same SMD3 region | Stream | 47 | 12 ms | 94 ms | 75 MiB | 16 MiB |
| `BASE_Warehouse_Station` folder | Eager | 91 | 889 ms | 889 ms | 294 MiB | 235 MiB |
| Same folder | Stream | 91 | 90 ms | 482 ms | 92 MiB | 33 MiB |
| `firestorm class battlecruiser.sment` | Eager | 221 | 1,859 ms | 1,859 ms | 588 MiB | 529 MiB |
| Same `.sment` | Stream | 221 | 151 ms | 935 ms | 129 MiB | 70 MiB |
| Same `.sment`, forced disk extraction | Stream | 221 | 159 ms | 1,187 ms | 130 MiB | 70 MiB |

The direct typed-array decoder also reduced full streaming traversal relative
to the first object-based implementation: 319 to 94 ms for the SMD3 region,
963 to 482 ms for the folder and 1,683 to 935 ms for the archive in separate
runs on the same host. The checked-in `.sment` has no entry above 4 MiB, so
forcing disk extraction adds overhead without reducing its peak RSS. The
benchmark script exits on failed child measurements and can be rerun against
the checked-in samples.

To exercise a large entry, run `node scripts/benchmark-streaming.mjs --large`.
It assembles a temporary `.sment` from the same 47-segment SMD3 record set
plus 20 MiB of unused trailing bytes (about 21.2 MiB ZIP), then removes it.
Both runs parse the same geometry and verify the ZIP CRC:

| Large-entry mode | First segment | Total | Peak RSS |
| --- | ---: | ---: | ---: |
| Buffer entire allowed entry | 622 ms | 690 ms | 130 MiB |
| Default progressive extraction | 389 ms | 475 ms | 94 MiB |

The generated archive is a measurement fixture, not a project sample or a
redistributed game file. The gap depends on entry size and compression; small
entries stay in memory by default.

`npm run coverage:check` enforces exact per-file line, statement and branch
counts with zero exclusions. The final qualification covered all 29,745
source lines and 9,545 branches across 128 modules; the independent binary
interoperability suite also passed.

## `.smtpl` reading

The 84 checked-in v5 templates are small (largest 117,819 bytes). Their
piece records precede connections, text and filters in a single sequential
file. `parseSmtpl` now adopts the fresh collections built by the decoder
instead of cloning every piece into a second object before returning its
`BlueprintTemplate`; public construction from caller-owned data still makes
its defensive copies. On the largest template (7,599 pieces), a 500-parse
warm run measured 1.61 ms before and 1.30 ms after per parse. All 84 real
templates still round-trip byte for byte. A separate file-level stream would
add little first-item benefit at this size, so this change keeps the existing
simple API for templates.
