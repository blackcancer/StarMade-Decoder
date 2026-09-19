"""Independent IEEE-754 binary32 / signed-int32 geometric test vectors.

The 35-region corpus is pinned byte-for-byte to an external OpenJDK 24.0.2
capture from 2026-09-19. Arithmetic contracts correspond to StarMade-Open
revision decf3a1990f29b9505041f122188bf19489bcf7e. Normals are synthetic;
this test neither redistributes game normals nor performs in-game acceptance.
"""
import hashlib
import math
from pathlib import Path
import struct
import sys
from oracle_binary import block_word, check, region_cell


def f32(value):
    try:
        return struct.unpack('>f', struct.pack('>f', value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def coordinate(value):
    return f32(((value + (1 << 31)) % (1 << 32)) - (1 << 31))


NORMALS = [
    [(1, 0, 0), (0, 1, 0), (0, 0, 1)],
    [(1, -1, .25), (-.125, 1, .75), (.5, .125, -1)],
    [(1, -1, 2 ** -23), (1, -1, -(2 ** -23)), (0, 1, 1)],
    [(2 ** -149, 0, 0), (0, 2 ** -126, 0), (0, 0, 2 ** -149)],
    [(f32(3.4028234663852886e38), f32(3.4028234663852886e38), -f32(3.4028234663852886e38)), (1, 0, 0), (0, 1, 0)],
]
POSITIONS = [(0, 0, 0), (32, -32, 64), (-32, 64, -64), (16777216, -16777216, 0),
             (16777248, 16777248, -16777248), (-(1 << 31), 0, 0), (2147483616, -(1 << 31), 32)]
REGION_HASHES = [
    'bc2affe3f83d5fd94f4a0242f3a818fad0e849314c00ad0529df282ee2d338a0',
    'dd60bbc700e36f2637fbc13e6b6765c21a87e8769c800b2b751e09ccce600e71',
    'd59af00a58ffe87886dac16268e49df1f70c2c21d448b466a210f39a81d80f3e',
    '95b0dbd8f6e6c586e2fb3fe9698549f25104eaf7c93d34e5f0b24c154d388a79',
    '06c94dcfc2bd1c7057b82a6195be6806350e912eb2bae421b71e60ccc0e4a6da',
    '03f40af2510ced8c6de90a17f8593a4b5f44ba1918935e1054be008d3cc4fdfd',
    '9ea5bb1d39efb51f0196376e4d08404c964491713f3e431b8c1bc9c051594eaf',
]


def inside(x, y, z, normals):
    for nx, ny, nz in normals:
        total = f32(f32(f32(nx * x) + f32(ny * y)) + f32(nz * z))
        if not total > 0:
            return False
    return True


def region(position):
    data = bytearray(4 + 4096 * 4)
    data[0] = 7
    struct.pack_into('>hH', data, 4 + region_cell(*position) * 4, 1, 26)
    data.extend(struct.pack('>BqiiiBI', 7, 123456789, *position, 5, block_word(37, 93, True, 17, 42)))
    return data


def generate(directory):
    data = bytearray(struct.pack('>i', len(NORMALS) * len(POSITIONS)))
    identifier = 0
    for normals in NORMALS:
        for position_index, position in enumerate(POSITIONS):
            data.extend(struct.pack('>9f3i', *(component for normal in normals for component in normal), *position))
            xs, ys, zs = [[coordinate(value + local - 16) for local in range(32)] for value in position]
            data.extend(inside(x, y, z, normals) for z in zs for y in ys for x in xs)
            encoded = region(position)
            check(hashlib.sha256(encoded).hexdigest() == REGION_HASHES[position_index], 'JDK region capture mismatch')
            (directory / f'region-{identifier}.smd3').write_bytes(encoded)
            identifier += 1
    check(hashlib.sha256(data).hexdigest() == '2ae855e2f3bdd6f30be7a8d30ec93f190d54e4c944eeb9091ae472a33072801f', 'JDK geometry corpus mismatch')
    (directory / 'geometry.bin').write_bytes(data)
    print('Python geometry: 35 regions and 1,146,880 positions match the pinned JDK binary corpus.')


if __name__ == '__main__':
    generate(Path(sys.argv[1]))
