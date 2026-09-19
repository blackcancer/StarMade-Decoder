"""Cross-check SDK raw LZ4 blocks with independently maintained python-lz4.

Install the isolated validation dependency with: python -m pip install lz4==4.4.5
This script is a qualification tool, not a dependency of the distributed SDK.
"""
import json
import subprocess
import tempfile
from pathlib import Path
import lz4.block

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="decoder-lz4-") as name:
    work = Path(name)
    cases = []
    for size in [0, 1, 4, 12, 13, 19, 31, 255, 270, 1024, 65536, 131072]:
        for mode in ["zeros", "pattern", "noise"]:
            seed = 123
            raw = bytearray()
            for i in range(size):
                seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
                raw.append(0 if mode == "zeros" else i % 57 if mode == "pattern" else seed >> 24)
            key = f"{size}-{mode}"
            (work / (key + ".raw")).write_bytes(raw)
            for level in ["default", "high_compression"]:
                (work / (key + "." + level)).write_bytes(lz4.block.compress(bytes(raw), store_size=False, mode=level))
            cases.append(key)
    js = """
import fs from 'node:fs'; import assert from 'node:assert/strict';
import { encodeLz4Block, decodeLz4Block } from './dist/smd3/Lz4Block.js';
const [directory, names] = process.argv.slice(1);
for (const key of JSON.parse(names)) {
  const raw = fs.readFileSync(`${directory}/${key}.raw`);
  fs.writeFileSync(`${directory}/${key}.js`, encodeLz4Block(raw));
  for (const mode of ['default', 'high_compression']) {
    assert.deepEqual(decodeLz4Block(fs.readFileSync(`${directory}/${key}.${mode}`), raw.length), raw);
  }
}
"""
    subprocess.run(["node", "--input-type=module", "-e", js, str(work), json.dumps(cases)], cwd=ROOT, check=True, timeout=60)
    for key in cases:
        raw = (work / (key + ".raw")).read_bytes()
        assert lz4.block.decompress((work / (key + ".js")).read_bytes(), uncompressed_size=len(raw)) == raw, key
    print(f"Independent LZ4 interoperability passed: {len(cases)} SDK blocks decoded; {len(cases) * 2} external blocks decoded.")
