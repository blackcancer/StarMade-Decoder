"""Independent wire checks, locked against binary captures from OpenJDK 24.0.2.

Captures were generated outside this repository on 2026-09-19. SHA256 values
below pin real DataOutputStream results; CI uses Python, not a running JDK.
"""
import gzip
import hashlib
from pathlib import Path
import struct
import sys
from oracle_binary import Reader, block_word, check, mutf_encode

VALUES = ['', 'ASCII', '\0', '\u00e9\u4e2d', '\U0001f680', '\ud800', 'x' * 65535, '\0' * 32767]
HASHES = [
    '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
    '7dd113677259b620e2cfc14206517721b2f164fc04a71da43b88de211ad380c5',
    '3c113bcecba9f03f04926fbcfd4765025c9e86fe2aa8141bf22dae411cb96d0d',
    'edbb7e79ce5dd0e1bed26079f5473bac8bc0d0dee2075625b173b840aa5e885b',
    '3ce3d365a87393c0a9e02eab8478aeebf481bc6506195e167c4d1eb7eb606707',
    '7250d9bc1373210eb3308313285d27da5b61c04853556c817a6577aa955e20a8',
    '9437398e131986cc305d2550488217868fa5b2b38b8097a1258a4006947e5ec3',
    '9b658254ff521f87c01d50ac4ab2d9979abdd8666402432066e6463c7fbbcd9e',
]
NAME, VALUE = 'name\0\ud800', 'value\U0001f680\0'


def run(mode, directory):
    if mode == 'generate':
        for index, value in enumerate(VALUES):
            data = mutf_encode(value)
            check(hashlib.sha256(data).hexdigest() == HASHES[index], 'JDK UTF capture mismatch')
            (directory / f'reference-utf-{index}').write_bytes(data)
        payload = b'\x08' + mutf_encode(NAME) + mutf_encode(VALUE)
        plain = struct.pack('>h', 17) + payload
        check(hashlib.sha256(plain).hexdigest() == '1400fba024e3912dc5311ec0725d139adcb0e6c9e63f01e86f97d93ce1875183', 'JDK Tag capture mismatch')
        (directory / 'reference-tag').write_bytes(plain)
        (directory / 'reference-tag-gzip').write_bytes(gzip.compress(payload, mtime=0))
        words = b''.join(struct.pack('<I', block_word(i & 8191, i & 127, i & 1, i & 31, i & 63)) for i in range(32768))
        check(hashlib.sha256(words).hexdigest() == 'a1f1ad2061e0fce781ec9186bc0c2cb9cbe8c9dd9be3fbf4a5dd102a92251bcb', 'JDK block capture mismatch')
        (directory / 'reference-block-words').write_bytes(words)
    elif mode == 'verify':
        for index, expected in enumerate(VALUES):
            data = (directory / f'js-utf-{index}').read_bytes()
            reader = Reader(data)
            check(reader.utf() == expected, f'SDK UTF {index}')
            reader.end()
            check(hashlib.sha256(data).hexdigest() == HASHES[index], 'SDK/JDK exact UTF bytes')
        reader = Reader((directory / 'js-tag').read_bytes())
        check(reader.number('h') == 0 and reader.number('b') == 8, 'SDK Tag header')
        check(reader.utf() == NAME and reader.utf() == VALUE, 'SDK Tag fields')
        reader.end()
        check((directory / 'sdk-block-words').read_bytes() == (directory / 'reference-block-words').read_bytes(), 'SDK block bytes')
        print('Python accepted SDK UTF, Tag and 32,768 words; UTF and words match JDK captures.')
    elif mode == 'malformed':
        for value in ['0002c241', '0003e28241', '0003e24180', '0001c2', '0002e280', '0004f09f9880']:
            try:
                Reader(bytes.fromhex(value)).utf()
            except AssertionError:
                continue
            raise AssertionError('accepted malformed modified UTF: ' + value)
        print('Python rejected all six independently JDK-qualified malformed UTF vectors.')
    else:
        raise AssertionError('unknown mode')


if __name__ == '__main__':
    run(sys.argv[1], Path(sys.argv[2]))
