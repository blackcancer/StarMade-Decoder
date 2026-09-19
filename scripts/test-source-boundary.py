#!/usr/bin/env python3
"""Exercise the publication boundary with files created outside the repository."""
import importlib.util
import io
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import zipfile

script = pathlib.Path(__file__).with_name('check-source-boundary.py')
spec = importlib.util.spec_from_file_location('source_boundary', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix='decoder-source-boundary-') as folder:
    root = pathlib.Path(folder)
    (root / 'valid.ts').write_text('export const valid = true;\n')
    assert module.scan(root) == (1, [])
    for extension in ('.java', '.JAVA', '.class', '.jar', '.war'):
        source = root / ('forbidden' + extension)
        source.write_bytes(b'publication-boundary-test')
        result = subprocess.run([sys.executable, str(script), str(root)], capture_output=True)
        assert result.returncode == 1 and source.name.encode() in result.stderr
        source.unlink()
    nested = io.BytesIO()
    with tarfile.open(fileobj=nested, mode='w:gz') as archive:
        entry = tarfile.TarInfo('nested/Forbidden.java')
        entry.size = 1
        archive.addfile(entry, io.BytesIO(b'x'))
    with zipfile.ZipFile(root / 'package.zip', 'w') as archive:
        archive.writestr('source.tar.gz', nested.getvalue())
    assert module.scan(root)[1] == ['package.zip!source.tar.gz!nested/Forbidden.java']
    (root / 'package.zip').write_bytes(b'invalid archive')
    result = subprocess.run([sys.executable, str(script), str(root)], capture_output=True)
    assert result.returncode == 1
print('Source boundary negative checks passed: direct, nested and unreadable archives.')
