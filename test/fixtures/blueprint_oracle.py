"""Independent blueprint qualification using Python's ZIP and binary primitives.

This is a test-specific wire implementation, not copied game code. The source
inventory is locked to binary vectors captured outside this repository with
OpenJDK 24.0.2 on 2026-09-19. StarMade-Open reference revision:
decf3a1990f29b9505041f122188bf19489bcf7e (BlueprintEntry, region/segment framing).
Python zipfile and a separate local-record/descriptor/CRC reader both validate
all archives; an independent LZ4 decoder and explicit expected words validate
all segments. This is not a running JDK or an in-game import qualification.
"""
from collections import Counter
import hashlib
import io
from pathlib import Path
import struct
import sys
import zipfile
import zlib
from oracle_binary import Reader, block_index, block_word, check, mutf_encode, region_cell

HEADER, SECTOR, BLOCKS = 4 + 4096 * 4, 49152, 32768
TIME = 123456789
FILLED = block_word(37, 93, True, 17, 42)
NOTES = bytes((0, 255, 7, 0, 127))
REFERENCE_VERSION, SDK_VERSION = 'java\0\U0001f680', 'sdk\0\U0001f680'


def header():
    return (struct.pack('>i', 5) + mutf_encode(REFERENCE_VERSION)
            + struct.pack('>ii6fiHiB', 0, 2, -17, -17, -17, 17, 17, 17, 1, 37, BLOCKS, 0))


def meta(uid):
    return (struct.pack('>iBi', 5, 3, 0) + bytes((6, 0, 7, 0, 4)) + bytes(24)
            + mutf_encode(uid) + bytes(8) + b'\x01')


def logic(link):
    data = struct.pack('>iii', 0, -1026, int(link))
    if link:
        data += struct.pack('>hhhihi3h', -17, 16, -64, 1, 8191, 1, 16, 15, 15)
    return data


def region():
    result = bytearray(HEADER) + bytearray([0x5A]) * (SECTOR + 7)
    result[:2] = bytes((7, 0x12))
    struct.pack_into('>hH', result, 4 + region_cell(0, 0, 0) * 4, 1, 26)
    result[HEADER:HEADER + 26] = struct.pack('>BqiiiBI', 7, TIME, 0, 0, 0, 3, FILLED)
    return bytes(result)


def source_entries():
    entries = {
        'JavaShip/header.smbph': header(), 'JavaShip/meta.smbpm': meta('java-rail'),
        'JavaShip/logic.smbpl': logic(False), 'JavaShip/DATA/original.0.0.0.smd3': region(),
        'JavaShip/modmappings.smbmm': b'', 'JavaShip/notes/\u00e9toile.bin': NOTES,
        'JavaShip/delete.me': bytes((11, 12)), 'JavaShip/empty/': b'',
    }
    digest = hashlib.sha256()
    for name in sorted(entries):
        key, value = name.encode('utf8'), entries[name]
        digest.update(struct.pack('>I', len(key)) + key + struct.pack('>I', len(value)) + value)
    check(digest.hexdigest() == '4a4970df322422aa3769a1bcd325a119539a2540b69ed4156addbb7c3b4eeb62', 'JDK blueprint content capture mismatch')
    return entries


class DescriptorOutput(io.BytesIO):
    """Make zipfile emit streaming data descriptors, as a nonseekable output does."""
    def seek(self, *args):
        raise io.UnsupportedOperation('streaming output')


def generate(directory):
    output = DescriptorOutput()
    with zipfile.ZipFile(output, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.comment = b'Independent descriptor fixture'
        for name, content in source_entries().items():
            entry = zipfile.ZipInfo(name, date_time=(2023, 11, 14, 22, 13, 20))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.comment = b'oracle entry comment'
            archive.writestr(entry, content)
    data = output.getvalue()
    check(struct.unpack_from('<H', data, 6)[0] & 8, 'fixture must have data descriptors')
    (directory / 'reference.sment').write_bytes(data)
    verify(directory / 'reference.sment', 0)


def read_local_zip(data):
    """Walk local records independently of central sizes or zipfile's reader."""
    offset, result = 0, {}
    while data[offset:offset + 4] == b'PK\x03\x04':
        check(offset + 30 <= len(data), 'local ZIP header truncated')
        _, version, flags, method, _, _, crc, compressed_size, size, name_size, extra_size = struct.unpack_from('<I5H3I2H', data, offset)
        check(version <= 20 and not flags & 1 and method in (0, 8), 'unsupported local ZIP entry')
        name_start = offset + 30
        start = name_start + name_size + extra_size
        check(start <= len(data), 'local ZIP variable fields')
        name = data[name_start:name_start + name_size].decode('utf8' if flags & 0x800 else 'cp437')
        check(name not in result, 'duplicate local ZIP name')
        if method == 8:
            inflater = zlib.decompressobj(-15)
            content = inflater.decompress(data[start:])
            check(inflater.eof, 'local ZIP deflate termination')
            consumed = len(data) - start - len(inflater.unused_data)
        else:
            check(not flags & 8, 'stored descriptor entry requires a known payload boundary')
            content = data[start:start + compressed_size]
            consumed = compressed_size
        offset = start + consumed
        actual_crc = zlib.crc32(content) & 0xFFFFFFFF
        if flags & 8:
            if data[offset:offset + 4] == b'PK\x07\x08':
                offset += 4
            check(offset + 12 <= len(data), 'truncated ZIP descriptor')
            descriptor_crc, descriptor_compressed, descriptor_size = struct.unpack_from('<III', data, offset)
            offset += 12
            check((descriptor_crc, descriptor_compressed, descriptor_size) == (actual_crc, consumed, len(content)), 'ZIP descriptor CRC/sizes')
            check(crc in (0, actual_crc) and compressed_size in (0, consumed) and size in (0, len(content)), 'local descriptor placeholders')
        else:
            check((crc, compressed_size, size) == (actual_crc, consumed, len(content)), 'ZIP local CRC/sizes')
        result[name] = content
    check(data[offset:offset + 4] in (b'PK\x01\x02', b'PK\x05\x06'), 'unexpected data between local and central ZIP records')
    return result


def read_zip(filename):
    raw = filename.read_bytes()
    local = read_local_zip(raw)
    central = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            check(entry.filename not in central, 'duplicate central ZIP entry')
            content = archive.read(entry)
            check(entry.CRC == zlib.crc32(content) & 0xFFFFFFFF and entry.file_size == len(content), 'ZIP central CRC/size')
            central[entry.filename] = content
        check(archive.testzip() is None, 'zipfile CRC qualification')
    check(local == central, 'local/central ZIP inventories or contents differ')
    return central


def lz4(source):
    """Decode a bounded raw block using overlapping history copies."""
    source = Reader(source)
    output = bytearray()
    while source.remaining():
        token = source.number('B')
        literal = token >> 4
        if literal == 15:
            while True:
                extension = source.number('B')
                literal += extension
                if extension != 255:
                    break
        check(len(output) + literal <= BLOCKS * 4, 'LZ4 literal output bound')
        output.extend(source.take(literal))
        if not source.remaining():
            break
        distance = struct.unpack('<H', source.take(2))[0]
        check(0 < distance <= len(output), 'LZ4 match history')
        count = (token & 15) + 4
        if token & 15 == 15:
            while True:
                extension = source.number('B')
                count += extension
                if extension != 255:
                    break
        check(len(output) + count <= BLOCKS * 4, 'LZ4 match output bound')
        for _ in range(count):
            output.append(output[-distance])
    source.end()
    check(len(output) == BLOCKS * 4, 'LZ4 exact output length')
    return output


def decode_region(data, single):
    check(len(data) >= HEADER and data[0] == 7, 'region header')
    segments, allocations = [], set()
    for slot in range(4096):
        sector, size = struct.unpack_from('>hH', data, 4 + slot * 4)
        if size == 0:
            continue
        check(sector > 0 and sector not in allocations and 22 <= size <= SECTOR, 'region allocation')
        allocations.add(sector)
        start = HEADER + (sector - 1) * SECTOR
        check(start + size <= len(data), 'region extent')
        reader = Reader(data[start:start + size])
        check(reader.number('B') == 7, 'segment version')
        timestamp = reader.number('q')
        position = tuple(reader.number('i') for _ in range(3))
        check(all(value % 32 == 0 for value in position) and region_cell(*position) == slot, 'segment table position')
        kind = reader.number('B')
        if kind == 3:
            check(single, 'only unchanged fixture may contain SINGLE')
            words = [reader.number('I')] * BLOCKS
        elif kind == 1:
            check(not single and reader.number('i') == 22, 'v7 LZ4 framing')
            words = [word[0] for word in struct.iter_unpack('<I', lz4(reader.take(reader.remaining())))]
        else:
            check(not single and kind == 2, 'segment kind')
            words = [0] * BLOCKS
        reader.end()
        segments.append((position, timestamp, words))
    return segments


def expected_word(mode, position, index):
    if mode == 0:
        return FILLED
    if mode == 1:
        return {0: FILLED, block_index(31, 30, 29): block_word(11, 127, False, 31, 63),
                block_index(17, 18, 19): block_word(37, 1, False, 0, 1)}.get(index, 0)
    if position[0] == -32 and index == block_index(31, 0, 16):
        return block_word(511, 73, True, 5, 12)
    if position[0] == 32 and index == block_index(0, 31, 31):
        return 0xFFFFFFFF
    return 0


def validate_header(data, mode, segments):
    counts, low, high = Counter(), [float('inf')] * 3, [-float('inf')] * 3
    for position, _, words in segments:
        for index, word in enumerate(words):
            check(word == expected_word(mode, position, index), f'block word mismatch at {position}:{index}')
            kind = word & 8191
            if kind == 0:
                continue
            counts[kind] += 1
            coordinates = [position[0] + (index & 31) - 16, position[1] + ((index >> 5) & 31) - 16,
                           position[2] + (index >> 10) - 16]
            for axis in range(3):
                low[axis], high[axis] = min(low[axis], coordinates[axis]), max(high[axis], coordinates[axis])
    check(bool(counts), 'expected occupied blocks')
    reader = Reader(data)
    check(reader.number('i') == 5, 'header version')
    check(reader.utf() == (REFERENCE_VERSION if mode == 0 else SDK_VERSION), 'modified UTF game version')
    check(reader.number('i') == 0 and reader.number('i') == (2 if mode == 0 else 7), 'header type/classification')
    for value in low:
        check(reader.number('f') == value - 1, 'minimum block bound')
    for value in high:
        check(reader.number('f') == value + 2, 'exclusive maximum block bound')
    count = reader.number('i')
    check(count == len(counts), 'header type count')
    actual = {}
    for _ in range(count):
        kind, amount = reader.number('H'), reader.number('i')
        check(kind not in actual, 'duplicate header block type')
        actual[kind] = amount
    check(actual == counts, 'header per-type block counts')
    check(reader.number('B') == 0, 'header absent score')
    reader.end()


def verify(filename, mode):
    entries = read_zip(filename)
    root = 'SDKShip/' if mode == 2 else 'JavaShip/'
    region_name = root + 'DATA/' + ('SDKShip' if mode == 2 else 'original') + '.0.0.0.smd3'
    names = {root + suffix for suffix in ['header.smbph', 'meta.smbpm', 'logic.smbpl', 'modmappings.smbmm']} | {region_name}
    if mode != 2:
        names |= {root + suffix for suffix in ['notes/\u00e9toile.bin', 'empty/', 'delete.me' if mode == 0 else 'added.bin']}
    check(set(entries) == names, 'unexpected or lost blueprint resources')
    check(entries[root + 'meta.smbpm'] == meta('sdk-rail' if mode == 2 else 'java-rail'), 'metadata contract')
    check(entries[root + 'logic.smbpl'] == logic(mode == 2), 'logic contract')
    check(entries[root + 'modmappings.smbmm'] == b'', 'empty mod mappings')
    if mode != 2:
        check(entries[root + 'notes/\u00e9toile.bin'] == NOTES and entries[root + 'empty/'] == b'', 'ancillary bytes/empty directory')
        check(entries[root + ('delete.me' if mode == 0 else 'added.bin')] == (bytes((11, 12)) if mode == 0 else bytes((9, 0, 254))), 'ancillary file edit')
        encoded, original = entries[region_name], region()
        check(len(encoded) == len(original) and encoded[1] == 0x12, 'region envelope preservation')
        size = struct.unpack_from('>H', encoded, 6 + region_cell(0, 0, 0) * 4)[0]
        check(encoded[HEADER + size:] == original[HEADER + size:], 'sector padding and trailer preservation')
    segments = decode_region(entries[region_name], mode == 0)
    check(len(segments) == (3 if mode == 2 else 1), 'segment count')
    check(all(timestamp == TIME + mode for _, timestamp, _ in segments), 'segment timestamps')
    check({position for position, _, _ in segments} == ({(-32, 32, -64), (32, 0, 0), (0, -32, 0)} if mode == 2 else {(0, 0, 0)}), 'segment positions')
    validate_header(entries[root + 'header.smbph'], mode, segments)
    return len(segments) * BLOCKS


def run(mode, directory):
    if mode == 'generate':
        generate(directory)
    else:
        check(mode == 'verify', 'unknown mode')
        check((directory / 'reference.sment').read_bytes() == (directory / 'noop.sment').read_bytes(), 'byte-exact no-op ZIP')
        positions = sum(verify(directory / filename, index) for index, filename in enumerate(['noop.sment', 'edited.sment', 'created.sment']))
        check(positions == 163840, 'complete blueprint word comparison count')
        print('Python blueprint qualification: 3 archives independently read through local records and zipfile; 163,840 words, bounds/counts, metadata, logic, CRCs and ancillary bytes.')


if __name__ == '__main__':
    run(sys.argv[1], Path(sys.argv[2]))
