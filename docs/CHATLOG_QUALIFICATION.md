# Text chatlog qualification — 2.0.4

The implementation is checked against the read-only StarMade-Open revision
`e5a3b49d86943c4d618cea6512e28fa0b95901df`, specifically
`org/schema/game/common/data/chat/ChannelRouter.java`. That writer appends
channel records as `yyyy/MM/dd - HH:mm:ss [sender]: text` and direct records as
`yyyy/MM/dd - HH:mm:ss [sender -> recipient]: text` to `chatlogs/*.txt`.
Its date has no timezone. The installed `/srv/StarMade/chatlogs/all.txt`
provides an independent live-format sample.

`ChatLogReader` reads a bounded window and returns only complete lines. It
returns malformed lines explicitly and tracks byte offsets, file identity,
rotation and truncation. An absent log is an empty history. It rejects unsafe
filenames, symlinked paths, invalid UTF-8 and lines over the configured limit.
The game uses Java `FileWriter`, whose charset follows the server platform;
this SDK requires UTF-8 and reports other encodings as a format error.

The mirrored `test/objects/ChatLogs.test.ts` suite covers channel and direct
records, leap dates and invalid calendar fields, malformed authors and text,
partial writes, CRLF, large histories, paged polling, missing and replaced
files, filesystem races, path safety and the installed sample. The per-source
`coverage:check` gate requires 100% lines and branches; the 2.0.4 release
verification passes that gate for `src/objects/ChatLogs.ts`. `source:check`
confirms no Java source or binary enters the repository/package, and
`test:package` verifies the installed production export.
