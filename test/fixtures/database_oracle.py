"""ObjectStream subset checked independently with Python standard-library readers.

The compressed constants are actual HashMap<String,Boolean> binary captures from
OpenJDK 24.0.2 on 2026-09-19, generated outside this repository. They are data,
not source code or class files. SDK hashes were separately accepted by that JDK's
ObjectInputStream. CI checks exact qualified bytes plus a structural decoder;
it does not execute a JDK or claim arbitrary ObjectStream support.
"""
import base64
import hashlib
import math
from pathlib import Path
import sys
import zlib
from oracle_binary import Reader, check

CAPTURES = [
    'eJxb85aBtbiIQTArsSxRr7QkM0fPI7E4wzexgJX91sHDYgkXmRmY3Bi4cvITU9wSk0vyizwZOEsyilKLM/JzUioK7B0YwKCcA0gIgFgVAG5kF4U=',
    'eJztzT9OG1EQB+Dhj2UHUUBDnRM4R0hEgaDIBajyhFdxkseu2X02WyEfhIIDcIJISIlSp6BIkzs4B6Ahtohyiu+T5km/maeZ+1UMujYOP6dFGs/Lpzw+Td30fZoNhr+//zj68LgT2yexl5s0OUkXpWnP4lWZtlU3bfKkn719Fxv716P1e7CuUYn4vy+n+uP4uGlyleqfr9vlr9unP9uxdR6DRcrzqp9tldjr8vrgmzpdVldxE7sl9tvm4ktVVncPq6/LbtPciRLD3NTV6m758un5uQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIC+v4qbGJYYTZoyrtNl9S8P6nn+ttyE3XVYpDx/mfR/Ac82UW0=',
]
JDK_HASHES = ['1ab7b773c68626d7403a01dbe1695b2c58e9c3a784054f7e77ecf114747cb009', '719982f1b8968dc40e82e5ef9295e66ffca015be6c0296046fdf8edab3d0cebe']
SDK_HASHES = [JDK_HASHES[0], '2b5a332d6630e0544f69d975ead309f87f99d8029f05af8727255bd6338c3e93']
KEYS = ['', 'dot.name', 'slash/name', 'value', 'nul\0', 'rocket\U0001f680', 'lone\ud800', 'x' * 65535]
SCHEMAS = {
    'java.util.HashMap': (0x0507DAC1C31660D1, 3, [('F', 'loadFactor'), ('I', 'threshold')]),
    'java.lang.Boolean': (0xCD207280D59CFAEE, 2, [('Z', 'value')]),
}


class ObjectStream:
    def __init__(self, data):
        self.reader = Reader(data)
        self.handles = []

    def register(self, value):
        self.handles.append(value)
        return len(self.handles) - 1

    def reference(self):
        handle = self.reader.number('I') - 0x7E0000
        check(0 <= handle < len(self.handles), 'invalid ObjectStream handle')
        return self.handles[handle]

    def schema(self):
        tag = self.reader.number('B')
        if tag == 0x71:
            descriptor = self.reference()
            check(isinstance(descriptor, tuple) and descriptor[0] == 'class', 'class handle type')
            return descriptor[1]
        check(tag == 0x72, 'class descriptor marker')
        name, uid = self.reader.utf(), self.reader.number('Q')
        check(name in SCHEMAS, 'unexpected class')
        self.register(('class', name))
        flags, count = self.reader.number('B'), self.reader.number('H')
        fields = [(chr(self.reader.number('B')), self.reader.utf()) for _ in range(count)]
        check((uid, flags, fields) == SCHEMAS[name], 'class schema/UID mismatch')
        check(self.reader.take(2) == b'\x78\x70', 'class annotations/superclass')
        return name

    def value(self):
        tag = self.reader.number('B')
        if tag == 0x71:
            return self.reference()
        if tag == 0x74:
            value = self.reader.utf()
            self.register(value)
            return value
        check(tag == 0x73, 'object marker')
        schema = self.schema()
        handle = self.register(None)
        if schema == 'java.lang.Boolean':
            byte = self.reader.number('B')
            check(byte in (0, 1), 'Boolean payload')
            result = bool(byte)
        else:
            load, threshold = self.reader.number('f'), self.reader.number('i')
            check(math.isfinite(load) and load > 0 and threshold >= 0, 'HashMap metadata')
            block = self.reader.number('B')
            check(block in (0x77, 0x7A), 'HashMap block data')
            check(self.reader.number('B' if block == 0x77 else 'I') == 8, 'HashMap block size')
            capacity, count = self.reader.number('i'), self.reader.number('i')
            check(capacity >= 0 and 0 <= count <= 32767, 'HashMap dimensions')
            result = {}
            for _ in range(count):
                key, value = self.value(), self.value()
                check(type(key) is str and type(value) is bool and key not in result, 'HashMap entry types/uniqueness')
                result[key] = value
            check(self.reader.number('B') == 0x78, 'HashMap end data')
        self.handles[handle] = result
        return result

    def read(self):
        check(self.reader.take(4) == bytes.fromhex('aced0005'), 'ObjectStream magic/version')
        result = self.value()
        self.reader.end()
        check(type(result) is dict, 'root must be HashMap')
        return result


def run(mode, directory):
    for index in range(2):
        expected = {} if index == 0 else {key: i % 2 == 0 for i, key in enumerate(KEYS)}
        if mode == 'generate':
            data = zlib.decompress(base64.b64decode(CAPTURES[index]))
            check(hashlib.sha256(data).hexdigest() == JDK_HASHES[index], 'JDK capture integrity')
            (directory / f'reference-map-{index}').write_bytes(data)
        else:
            check(mode == 'verify', 'unknown mode')
            data = (directory / f'sdk-map-{index}').read_bytes()
            check(hashlib.sha256(data).hexdigest() == SDK_HASHES[index], 'SDK bytes differ from ObjectInputStream-qualified capture')
        check(ObjectStream(data).read() == expected, 'ObjectStream value mismatch')
    print(f'Python ObjectStream {mode}: empty/UTF maps, descriptors and shared handles; fixed JDK references.')


if __name__ == '__main__':
    run(sys.argv[1], Path(sys.argv[2]))
