"""Independent SMTPL wire vectors: Python struct/arithmetic, no SDK or game code.

The v4/v5 contract follows the local reference e5a3b49: three little-endian
bytes, 11 type bits, 7 HP bits, 1 active bit and 5 orientation bits.
The extended v6 contract has a big-endian 32-bit word with 13 type bits.
"""
import json
from pathlib import Path
import struct
import sys


def cases(version):
    widths = (13, 7, 5, 6) if version == 6 else (11, 7, 5, 0)
    result = []
    for field, width in zip(('type', 'hp', 'orientation', 'extra'), widths):
        for bit in range(width):
            for active in (False, True):
                item = dict(type=0, hp=0, orientation=0, active=active)
                item[field] = 2 ** bit
                result.append(item)
    result.extend([dict(type=0, hp=0, orientation=0, active=False),
                   dict(type=2 ** widths[0] - 1, hp=127, orientation=31, active=True)])
    return [dict(x=i - 32, y=2, z=-3, **item) for i, item in enumerate(result)]


def encode(version, pieces):
    wire = bytearray(struct.pack('>b7i', version, -32, 2, -3, 100, 2, -3, len(pieces)))
    for p in pieces:
        wire.extend(struct.pack('>3i', p['x'], p['y'], p['z']))
        width = 13 if version == 6 else 11
        value = p['type'] + p['hp'] * 2 ** width + int(p['active']) * 2 ** (width + 7)
        value += p['orientation'] * 2 ** (width + 8) + p.get('extra', 0) * 2 ** 26
        wire.extend(value.to_bytes(4 if version == 6 else 3, 'big' if version == 6 else 'little'))
    wire.extend(bytes(24 if version >= 5 else 16))
    return bytes(wire)


def decode_pieces(wire):
    version, *header = struct.unpack_from('>b7i', wire)
    assert version in (4, 5, 6)
    pieces, offset = [], 29
    for _ in range(header[-1]):
        x, y, z = struct.unpack_from('>3i', wire, offset)
        size = 4 if version == 6 else 3
        value = int.from_bytes(wire[offset + 12:offset + 12 + size], 'big' if version == 6 else 'little')
        value, kind = divmod(value, 8192 if version == 6 else 2048)
        value, hp = divmod(value, 128)
        value, active = divmod(value, 2)
        extra, orientation = divmod(value, 32)
        piece = dict(x=x, y=y, z=z, type=kind, hp=hp, active=bool(active), orientation=orientation)
        if extra:
            piece['extra'] = extra
        pieces.append(piece)
        offset += 12 + size
    return pieces, offset


def main(mode, directory):
    for version in (4, 5, 6):
        expected = cases(version)
        reference = encode(version, expected)
        if mode == 'generate':
            (directory / f'v{version}.smtpl').write_bytes(reference)
            (directory / f'v{version}.json').write_text(json.dumps(expected))
        else:
            for name in ('noop', 'created', 'edited'):
                output = (directory / f'v{version}-{name}.smtpl').read_bytes()
                wanted = [dict(p, active=not p['active']) for p in expected] if name == 'edited' else expected
                decoded, tail = decode_pieces(output)
                assert decoded == wanted, (version, name, 'decoded fields')
                assert output == encode(version, wanted), (version, name, 'wire bytes')
                assert output[tail:] == bytes(24 if version >= 5 else 16)
            assert (directory / f'v{version}-noop.smtpl').read_bytes() == reference
    if mode == 'verify':
        records = json.loads((directory / 'samples.json').read_text())
        assert len(records) == 84, 'Expected the complete checked-in SMTPL sample corpus'
        for record in records:
            expected, _ = decode_pieces(Path(record['path']).read_bytes())
            assert expected == record['pieces'], record['path']
        print('SMTPL oracle PASS: v4/v5/v6 walking bits, created/edited/no-op bytes; 84 real sample block arrays')


if __name__ == '__main__':
    main(sys.argv[1], Path(sys.argv[2]))
