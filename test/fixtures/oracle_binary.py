"""Independent test-only binary primitives; Python standard library only.

No production SDK code is imported. Modified UTF operates on UTF-16 code units
and accepts the noncanonical encodings accepted by DataInputStream.readUTF.
"""
import struct


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def mutf_encode(value):
    units = value.encode('utf-16-be', errors='surrogatepass')
    output = bytearray()
    for (unit,) in struct.iter_unpack('>H', units):
        if 0 < unit < 128:
            output.append(unit)
        elif unit < 2048:
            output.extend((192 | (unit >> 6), 128 | (unit & 63)))
        else:
            output.extend((224 | (unit >> 12), 128 | ((unit >> 6) & 63), 128 | (unit & 63)))
    check(len(output) <= 65535, 'modified UTF length overflow')
    return struct.pack('>H', len(output)) + output


def mutf_decode(payload):
    reader = Reader(payload)
    units = bytearray()
    while reader.remaining():
        lead = reader.number('B')
        if lead < 128:
            code = lead
        elif 192 <= lead < 224:
            second = reader.number('B')
            check(second & 192 == 128, 'modified UTF continuation')
            code = ((lead & 31) << 6) | (second & 63)
        elif 224 <= lead < 240:
            second, third = reader.take(2)
            check(second & 192 == 128 and third & 192 == 128, 'modified UTF continuation')
            code = ((lead & 15) << 12) | ((second & 63) << 6) | (third & 63)
        else:
            raise AssertionError('modified UTF leading byte')
        units.extend(struct.pack('>H', code))
    return bytes(units).decode('utf-16-be', errors='surrogatepass')


class Reader:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def remaining(self):
        return len(self.data) - self.offset

    def take(self, count):
        check(0 <= count <= self.remaining(), 'binary underflow')
        value = self.data[self.offset:self.offset + count]
        self.offset += count
        return value

    def number(self, code):
        return struct.unpack('>' + code, self.take(struct.calcsize('>' + code)))[0]

    def utf(self):
        return mutf_decode(self.take(self.number('H')))

    def end(self):
        check(self.remaining() == 0, 'unconsumed binary bytes')


def block_word(kind, hp, active, orientation, extra):
    return kind | hp << 13 | int(active) << 20 | orientation << 21 | extra << 26


def block_index(x, y, z):
    return x + 32 * y + 1024 * z


def region_cell(x, y, z):
    return (((x >> 5) + 8) & 15) | ((((y >> 5) + 8) & 15) << 4) | ((((z >> 5) + 8) & 15) << 8)
