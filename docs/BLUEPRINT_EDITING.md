# Complete blueprint editing

`BlueprintDocument` retains the complete source inventory independently of the
editable `BlueprintArchive`: header, metadata, logic, SMD3 regions, attached
entities, unknown files and empty directories. This API is additive; the existing
`parseSment` and `parseBlueprintFolder` return model views without the original
ZIP envelope or a complete ancillary-file inventory.

## Read, edit and export

```ts
import fs from 'node:fs';
import {
  readBlueprintDocument, readBlueprintFolderDocument,
  writeSment, writeBlueprintFolder, setBlock,
} from 'starmade-decoder';

const original = fs.readFileSync('Ship.sment');
const document = readBlueprintDocument(original);
console.assert(document.toBuffer().equals(original));

const segment = document.root.segments[0].segments[0];
setBlock(segment, 17, 18, 19, {
  type: 5, hp: 127, active: false, orientation: 0, extra: 0,
});
document.setFile('notes.txt', Buffer.from('Edited with StarMade-Decoder\n'));
fs.writeFileSync('Ship.edited.sment', writeSment(document));

// The destination is the actual blueprint root, and its parent must exist.
// Attached-entity references are rebased to this destination's basename.
writeBlueprintFolder(document, '/tmp/Ship-edited');
const folderDocument = readBlueprintFolderDocument('/tmp/Ship-edited');
fs.writeFileSync('Ship.from-folder.sment', folderDocument.toBuffer());
```

`document.archive` exposes the tree and `document.root` its editable root.
`document.files` and `toFiles(options?)` return detached maps: keys include the
root name, file values are `Buffer`, and directory values are `null` with a
trailing slash. Changing this map does not change the document. Use
`setFile(relativePath, bytes)` and `removeFile(relativePath)` for ancillary files;
edit modelled resources through the tree. Input buffers and output maps are
independently owned.

Metadata helpers such as `withAiValue`, `withManager`, `withThrustConfig`, and
logic helpers such as `withLinks` remain available. Direct nested block edits
are detected without dirty flags. Aggregate counters, offsets and metadata
presentation fields are derived views; use the underlying docking/rail requests,
block arrays and logic helpers to change persisted data. Re-read an export for
its updated header and aggregate views; writing does not mutate the input model.

## Preservation guarantees

| Operation | Guarantee |
| --- | --- |
| Read `.sment`, export unchanged | Exact original archive bytes, including compression streams, local/central entry ordering, comments, extra fields, timestamps, data descriptors and retained prefix/gaps |
| Edit, then restore the original model and ancillary bytes | Exact original archive bytes again |
| Read folder, export unchanged folder with the same root name | Same relative file paths, file bytes and empty directories; filesystem permissions/timestamps are not reproduced |
| Change a resource | Unchanged ZIP records and file payloads are reused; changed CRCs, sizes and directory offsets are rebuilt |
| Change a block in an existing SMD3 region | Unchanged records, allocation holes, unused sectors and trailing bytes remain in place; a changed record can grow into its own sector padding |
| Folder to new `.sment` | A deterministic new ZIP; a folder cannot reconstruct a discarded source ZIP envelope |

SMD3 documents preserve original region filenames and physical sectors. Removed
segments retain their allocation but have their table size cleared, matching
`SegmentHeader.writeEmptyDirectly`. New segments reuse a reserved empty slot or
append after the original physical data. Changed records use the canonical v7
LZ4 writer. Existing unaffected v6/optimized records retain their original bytes.
`new Smd3Document(bytes, options).file` and `.toBuffer(replacementFile?)` expose
this behavior for individual regions.

A geometry-resource change recomputes header type counts and bounding boxes.
Java uses occupied block centers `segment position + local position − 16`, then
adds margins of `−1` to the minimum and `+2` to the maximum. The old index score
is cleared because the SDK cannot recalculate the game's statistics. Timestamps
remain caller-controlled. Other modified header/logic resources use their
existing canonical writers; their historical encoding need not be retained.

Renaming/removing attached entities updates their parent's docking and rail
references. New attachments require explicit docking or rail metadata. Opaque
rail Tags survive reference renaming. Changed manager/thrust components retain
the original Tag envelope and trailing opaque extensions. Removing a component
with such extensions is rejected instead of discarding bytes. A manager and a
standalone thrust Tag cannot both occupy the terminal metadata section.

`modmappings.smbmm` is preserved as an opaque resource. The pinned Java fork
writes text mappings; this document API does not reinterpret them through the
older SDK mapping heuristic. New models start with an empty mapping file unless
an ancillary edit supplies one.

## New blueprints and publication

`BlueprintDocument.fromArchive(archive)`, `writeSment(archive)` and
`writeBlueprintFolder(archive, destination, options?)` accept complete
caller-created models. New entities receive canonical empty metadata and logic
if those fields are null. Region names use Java's shifted region coordinates,
including negative coordinates. Files absent from a model cannot be recovered;
use a document when preserving existing resources matters.

Folder publication stages a sibling directory before renaming it into place.
An existing destination is rejected unless `{ overwrite: true }` is supplied.
Replacement preserves the old directory until installation succeeds and attempts
rollback on failure. If rollback itself fails, the thrown `DecodeError.path`
identifies the retained backup. Parents must already exist; symlinks and special
files are rejected. This is a synchronous local operation, not an interprocess
transaction or a sandbox against concurrent ancestor replacement.

## Supported boundaries and resource limits

Editable documents require strict, complete parsing. They reject recovery
results, corrupt/ambiguous ZIP records, duplicate paths, path traversal, duplicate
segment coordinates, mixed SMD3 regions, cycles, missing attachment headers and
exceeded budgets. ZIP32 stored/deflated records and Java data descriptors are
supported. ZIP64, encryption, unsupported codecs and edits to opaque ZIP central
trailers fail explicitly.

Legacy DATA resources `.smd0`, `.smd1` and `.smd2` require explicit migration;
pre-v6 edited SMD3 records require game-specific migration. Geometric SMD3 input
requires `segmentOptions.sideNormals` from the supported game installation.
A changed segment must fit the game's fixed 48 KiB sector; oversized output is
rejected, never truncated.

The existing `BlueprintParseOptions` budgets apply to reads and exports; export
methods can receive overrides. They bound input ZIP size, each entry, aggregate
bytes, entries, entities, depth, block positions and metadata Tag nodes. Folder
entry counts include directories and the root. Metadata inflation is charged in
addition to the raw file bytes. Individual region documents also retain the
limits under which they were opened. The API is synchronous and holds a full
inventory and decoded block objects in memory.

## Reference and qualification

The contracts were checked against local `StarMade-Open` commit
`decf3a1990f29b9505041f122188bf19489bcf7e`, particularly `BlueprintEntry`,
`FolderZipper`, `SegmentDataFileUtils`, `SegmentBufferManager`, `SegmentHeader`,
`SegmentData.updateBBAdd` and `SegmentBuffer.updateBB`.

`test/smd3/BlueprintDocument.test.ts` checks complete Sobek and Firestorm archive
identity, every Warehouse folder resource, edit/revert behavior, attachment
updates, component envelopes, limits and invalid edits. The ZIP, folder and SMD3
modules have additional byte-layout and injected-filesystem-failure regressions.

`npm run test:interop` includes an independent Python blueprint oracle. It creates
an archive with data descriptors; the SDK preserves and edits it, and creates a
new archive from models. Independent checks inspect local and central ZIP records,
CRC values and decoded contents for all three outputs. The oracle compares
163,840 complete block words, region tables, timestamps, padding, headers, counts,
bounds, metadata and logic vectors. No Java source is distributed in this project.
This qualifies the tested binary contracts; it does not launch StarMade or claim
an in-game import test.

Local 1.6.0 qualification on 2026-09-19 used Node.js 20.20.2 and OpenJDK 24.0.2.
`STARMADE_TEST_DIR=/srv/StarMade npm run coverage:check` passed 1,186 tests with
zero pending/failing: 29,175/29,175 lines and 6,905/6,905 branches over all 102
production modules. The per-file and global exact-counter gates passed with no
exclusions or skips; negative gate tests rejected missing, rounded and skipped
coverage. Build, JSDoc checks, installed production-package runtime/declarations,
all JDK oracles and python-lz4 4.4.5 interoperability passed. The mapping-presence
regression was additionally rerun with the fast document integration suite.
