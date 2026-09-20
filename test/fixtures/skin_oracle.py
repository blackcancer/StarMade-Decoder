"""Independent standard-library PNG/ZIP qualification for SMSKIN exports.

generate DIR writes reference.smskin and replacement.png. verify DIR requires
noop.smskin and edited.smskin, with only skin_main_diff.png replaced. No created
archive is required. Fixtures are synthetic RGBA8 PNGs, never game assets;
no production SDK, image library or game implementation is imported.
"""
import io
from pathlib import Path
import struct
import sys
import zipfile
import zlib


TEXTURES = {
    'skin_main_diff.png': (4, 8, 1),
    'skin_main_em.png': (2, 4, 2),
    'skin_helmet_diff.png': (4, 4, 3),
    'skin_helmet_em.png': (2, 2, 4),
}
REPLACED = 'skin_main_diff.png'
COMMENT = b'Independent SMSKIN descriptor fixture'
SIGNATURE = b'\x89PNG\r\n\x1a\n'


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def pixels(width, height, seed):
    """Nonuniform color/alpha values detect channel, row and filter mistakes."""
    return bytes(channel for y in range(height) for x in range(width) for channel in (
        (seed * 41 + x * 17 + y * 3) & 255,
        (seed * 67 + x * 5 + y * 29) & 255,
        (seed * 13 + x * 43 + y * 7) & 255,
        (255 - x * 31 - y * 11 - seed * 19) & 255,
    ))


def paeth(left, up, corner):
    estimate = left + up - corner
    distances = (abs(estimate - left), abs(estimate - up), abs(estimate - corner))
    return (left, up, corner)[distances.index(min(distances))]


def prediction(kind, left, up, corner):
    return (0, left, up, (left + up) // 2, paeth(left, up, corner))[kind]


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


def png(width, height, seed):
    raw = pixels(width, height, seed)
    stride, scanlines = width * 4, bytearray()
    for y in range(height):
        kind = y % 5
        scanlines.append(kind)
        for x in range(stride):
            offset = y * stride + x
            left = raw[offset - 4] if x >= 4 else 0
            up = raw[offset - stride] if y else 0
            corner = raw[offset - stride - 4] if y and x >= 4 else 0
            scanlines.append((raw[offset] - prediction(kind, left, up, corner)) & 255)
    packed = zlib.compress(scanlines, level=9)
    middle = len(packed) // 2
    return (SIGNATURE + chunk(b'IHDR', struct.pack('>2I5B', width, height, 8, 6, 0, 0, 0))
            + chunk(b'tEXt', b'Fixture\x00Independent RGBA pixels')
            + chunk(b'IDAT', packed[:middle]) + chunk(b'IDAT', packed[middle:]) + chunk(b'IEND', b''))


def decode_png(data):
    """Check every chunk CRC, a complete zlib stream, and unfilter all RGBA rows."""
    check(data.startswith(SIGNATURE), 'PNG signature')
    offset, parts = len(SIGNATURE), []
    while offset < len(data):
        check(offset + 12 <= len(data), 'truncated PNG chunk')
        length = struct.unpack_from('>I', data, offset)[0]
        end = offset + 12 + length
        check(end <= len(data), 'PNG chunk extent')
        kind, payload = data[offset + 4:offset + 8], data[offset + 8:end - 4]
        crc = struct.unpack_from('>I', data, end - 4)[0]
        check(zlib.crc32(kind + payload) & 0xffffffff == crc, 'PNG chunk CRC')
        parts.append((kind, payload))
        offset = end
    kinds = [kind for kind, _ in parts]
    check(kinds and kinds[0] == b'IHDR' and kinds[-1] == b'IEND', 'PNG first/last chunks')
    check(kinds.count(b'IHDR') == kinds.count(b'IEND') == 1 and parts[-1][1] == b'', 'PNG unique header/end')
    check(len(parts[0][1]) == 13, 'PNG IHDR size')
    width, height, depth, color, compression, filtering, interlace = struct.unpack('>2I5B', parts[0][1])
    check(width > 0 and height > 0 and width & (width - 1) == height & (height - 1) == 0, 'PNG power-of-two dimensions')
    check((depth, color, compression, filtering, interlace) == (8, 6, 0, 0, 0), 'PNG RGBA8 format')
    idats = [index for index, kind in enumerate(kinds) if kind == b'IDAT']
    check(idats and idats == list(range(idats[0], idats[-1] + 1)), 'PNG contiguous IDAT chunks')
    check(all(kind in (b'IHDR', b'IDAT', b'IEND') or kind[0] & 32 for kind in kinds), 'unknown critical PNG chunk')
    inflater = zlib.decompressobj()
    packed = b''.join(payload for kind, payload in parts if kind == b'IDAT')
    scanlines = inflater.decompress(packed) + inflater.flush()
    check(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail, 'PNG complete zlib stream')
    stride = width * 4
    check(len(scanlines) == height * (stride + 1), 'PNG exact scanline size')
    decoded = bytearray(width * height * 4)
    for y in range(height):
        start = y * (stride + 1)
        kind = scanlines[start]
        check(kind <= 4, 'PNG row filter')
        for x in range(stride):
            offset = y * stride + x
            left = decoded[offset - 4] if x >= 4 else 0
            up = decoded[offset - stride] if y else 0
            corner = decoded[offset - stride - 4] if y and x >= 4 else 0
            decoded[offset] = (scanlines[start + x + 1] + prediction(kind, left, up, corner)) & 255
    return width, height, bytes(decoded)


class DescriptorOutput(io.BytesIO):
    """Force streaming ZIP descriptors instead of seek-and-patch local headers."""
    def seek(self, *args):
        raise io.UnsupportedOperation('nonseekable fixture output')


def local_entries(data):
    """Read ZIP local records without trusting central sizes or zipfile."""
    offset, entries = 0, {}
    while data[offset:offset + 4] == b'PK\x03\x04':
        check(offset + 30 <= len(data), 'truncated local ZIP header')
        _, version, flags, method, _, _, crc, compressed_size, size, name_size, extra_size = struct.unpack_from('<I5H3I2H', data, offset)
        check(version <= 20 and flags & ~0x808 == 0 and method in (0, 8), 'supported local ZIP record')
        start = offset + 30 + name_size + extra_size
        check(start <= len(data), 'ZIP local variable fields')
        name = data[offset + 30:offset + 30 + name_size].decode('utf-8' if flags & 0x800 else 'cp437')
        check(name not in entries, 'duplicate local ZIP name')
        extra = data[offset + 30 + name_size:start]
        if method == 8:
            inflater = zlib.decompressobj(-15)
            content = inflater.decompress(data[start:])
            check(inflater.eof, 'ZIP deflate completion')
            consumed = len(data) - start - len(inflater.unused_data)
        else:
            check(not flags & 8, 'stored descriptor size is unavailable')
            content, consumed = data[start:start + compressed_size], compressed_size
        offset = start + consumed
        actual = zlib.crc32(content) & 0xffffffff
        if flags & 8:
            if data[offset:offset + 4] == b'PK\x07\x08':
                offset += 4
            check(offset + 12 <= len(data), 'truncated ZIP descriptor')
            check(struct.unpack_from('<III', data, offset) == (actual, consumed, len(content)), 'ZIP descriptor CRC/sizes')
            check(crc in (0, actual) and compressed_size in (0, consumed) and size in (0, len(content)), 'ZIP local descriptor placeholders')
            offset += 12
        else:
            check((crc, compressed_size, size) == (actual, consumed, len(content)), 'ZIP local CRC/sizes')
        entries[name] = (content, extra, flags)
    check(data[offset:offset + 4] == b'PK\x01\x02', 'ZIP central directory boundary')
    return entries


def read_archive(data):
    local = local_entries(data)
    entries, metadata = {}, {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            check(entry.filename not in entries, 'duplicate central ZIP name')
            content = archive.read(entry)
            check((content, entry.extra, entry.flag_bits) == local.get(entry.filename), 'ZIP local/central agreement')
            check(entry.CRC == zlib.crc32(content) & 0xffffffff and entry.file_size == len(content), 'ZIP central CRC/size')
            entries[entry.filename] = content
            metadata[entry.filename] = (entry.comment, entry.extra)
        check(archive.testzip() is None and set(local) == set(entries), 'complete ZIP inventory/CRCs')
        return entries, metadata, archive.comment


def generate(directory):
    output = DescriptorOutput()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.comment = COMMENT
        for name, (width, height, seed) in TEXTURES.items():
            entry = zipfile.ZipInfo(name, date_time=(2024, 1, 2, 3, 4, 6))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.comment = f'RGBA fixture {seed}'.encode('ascii')
            entry.extra = struct.pack('<HHI', 0xcafe, 4, seed)
            archive.writestr(entry, png(width, height, seed))
    data = output.getvalue()
    check(all(flags & 8 for _, _, flags in local_entries(data).values()), 'fixture ZIP descriptors')
    (directory / 'reference.smskin').write_bytes(data)
    (directory / 'replacement.png').write_bytes(png(4, 8, 7))
    validate(data, False, (directory / 'replacement.png').read_bytes())


def validate(data, edited, replacement):
    entries, metadata, comment = read_archive(data)
    check(set(entries) == set(TEXTURES), 'SMSKIN exact texture inventory')
    check(comment == COMMENT, 'SMSKIN archive comment')
    for name, (width, height, seed) in TEXTURES.items():
        check(metadata[name] == (f'RGBA fixture {seed}'.encode('ascii'), struct.pack('<HHI', 0xcafe, 4, seed)), 'SMSKIN entry comments/extras')
        expected = replacement if edited and name == REPLACED else png(width, height, seed)
        check(entries[name] == expected, 'SMSKIN exact replaced/retained PNG bytes')
        actual_width, actual_height, actual_pixels = decode_png(entries[name])
        check((actual_width, actual_height) == (width, height), 'SMSKIN texture dimensions')
        check(actual_pixels == pixels(width, height, 7 if edited and name == REPLACED else seed), 'SMSKIN decoded RGBA pixels')


def verify(directory):
    reference = (directory / 'reference.smskin').read_bytes()
    noop = (directory / 'noop.smskin').read_bytes()
    replacement = (directory / 'replacement.png').read_bytes()
    check(noop == reference, 'SMSKIN exact no-op archive')
    check(decode_png(replacement) == (4, 8, pixels(4, 8, 7)), 'replacement PNG pixels')
    validate(noop, False, replacement)
    validate((directory / 'edited.smskin').read_bytes(), True, replacement)
    print('Python SMSKIN qualification: 2 archives independently read through local records and zipfile; '
          '8 RGBA textures, all pixels/PNG CRCs/zlib streams, ZIP descriptors/CRCs/comments/extras and exact no-op.')


if __name__ == '__main__':
    mode, directory = sys.argv[1], Path(sys.argv[2])
    if mode == 'generate':
        generate(directory)
    else:
        check(mode == 'verify', 'unknown skin oracle mode')
        verify(directory)
