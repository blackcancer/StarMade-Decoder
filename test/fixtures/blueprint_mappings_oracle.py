"""Independent SMBMM text/zlib qualification using Python's standard library.

The delimiter and signed-short layout are checked against local read-only
StarMade-Open revision decf3a1990f29b9505041f122188bf19489bcf7e,
BlueprintEntry.readModMappings/writeModMappings. These generated UTF-8 vectors
are separate from the pinned JDK blueprint captures in blueprint_oracle.py.
No production SDK code or game implementation is imported or executed.
"""
from pathlib import Path
import re
import struct
import sys
import zlib
from oracle_binary import check


ORIGINAL = [
    ('Étoiles🚀', 'Cœur: α', -32768),
    ('工具包', '反应堆', 32767),
    ('naïve mod', 'bloc e\u0301', -1),
    ('vanilla-ish', 'zéro', 0),
    ('signes', 'positif', 12),
]
EDITED = [
    ('Étoiles🚀', 'Cœur: α', -12345),
    ('naïve mod', 'bloc e\u0301', -1),
    ('vanilla-ish', 'zéro', 0),
    ('signes', 'positif', 12),
    ('Nouvelle🛰️', '氧气 Δ', 32767),
]


def decode(data, compressed):
    """Read complete RFC1950 streams and strict UTF-8, then validate every row."""
    if compressed:
        inflater = zlib.decompressobj()
        data = inflater.decompress(data) + inflater.flush()
        check(inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail,
              'mapping zlib stream must be complete with no suffix')
    text = data.decode('utf-8', errors='strict')
    result, names, ids = [], set(), set()
    for line in text.splitlines():
        check(bool(line), 'unexpected empty mapping row')
        fields = line.split('~')
        check(len(fields) == 3 and all(fields[:2]), 'mapping namespace tuple')
        check(re.fullmatch(r'[+-]?[0-9]+', fields[2]) is not None, 'mapping decimal ID')
        value = int(fields[2])
        check(struct.unpack('>h', struct.pack('>h', value))[0] == value, 'signed short mapping ID')
        name = (fields[0], fields[1])
        check(name not in names and value not in ids, 'mapping namespace/ID uniqueness')
        names.add(name)
        ids.add(value)
        result.append((*name, value))
    return result


def generate(directory):
    # CRLF, an explicit plus and leading zeroes discriminate exact source retention
    # from a read followed by canonical text generation. Astral characters use UTF-8.
    text = ''.join(f'{mod}~{block}~{("+00012" if value == 12 else value)}\r\n'
                   for mod, block, value in ORIGINAL).encode('utf-8')
    for kind, content in [('text', text), ('zlib', zlib.compress(text, level=9))]:
        check(decode(content, kind == 'zlib') == ORIGINAL, 'independent mapping generation')
        (directory / f'mappings-{kind}.smbmm').write_bytes(content)


def verify(directory):
    for kind in ('text', 'zlib'):
        source = (directory / f'mappings-{kind}.smbmm').read_bytes()
        for api in ('model', 'codec'):
            noop = (directory / f'mappings-{kind}-{api}-noop.smbmm').read_bytes()
            check(noop == source, f'{kind}/{api} mapping no-op byte identity')
            check(decode(noop, kind == 'zlib') == ORIGINAL, f'{kind}/{api} mapping read')
            edited = (directory / f'mappings-{kind}-{api}-edited.smbmm').read_bytes()
            check(decode(edited, kind == 'zlib') == EDITED, f'{kind}/{api} mapping edit')
    print('Python SMBMM qualification: UTF-8 text and legacy zlib; Unicode namespaces, signed-short IDs, '
          '4 exact no-ops and 4 SDK edits independently decoded.')


if __name__ == '__main__':
    mode, directory = sys.argv[1], Path(sys.argv[2])
    if mode == 'generate':
        generate(directory)
    else:
        check(mode == 'verify', 'unknown mapping oracle mode')
        verify(directory)
