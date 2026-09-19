#!/usr/bin/env python3
"""Reject Java sources/binaries in project files, including nested archives.

Installed dependencies and Git's private object store are outside this source-tree
check. Published history is checked separately when history is rewritten.
"""
import io
import pathlib
import sys
import tarfile
import zipfile

FORBIDDEN = ('.java', '.class', '.jar', '.war')
ARCHIVES = ('.zip', '.tgz', '.tar.gz', '.tar')


def inspect(name, read, depth=0):
    """Return forbidden paths; fail closed on unreadable or excessive archives."""
    lowered = name.lower()
    if lowered.endswith(FORBIDDEN):
        return [name]
    if not lowered.endswith(ARCHIVES):
        return []
    if depth >= 8:
        raise ValueError('Archive nesting exceeds eight levels: ' + name)
    data = read()
    matches = []
    if lowered.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for member in archive.infolist():
                if not member.is_dir():
                    matches.extend(inspect(name + '!' + member.filename,
                                           lambda member=member: archive.read(member), depth + 1))
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
            for member in archive:
                if member.isfile():
                    matches.extend(inspect(name + '!' + member.name,
                                           lambda member=member: archive.extractfile(member).read(), depth + 1))
    return matches


def scan(root):
    """Inspect the working tree without following directory symlinks."""
    import os
    matches = []
    count = 0
    for directory, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in ('.git', 'node_modules')]
        for name in files:
            path = pathlib.Path(directory) / name
            count += 1
            matches.extend(inspect(str(path.relative_to(root)), path.read_bytes))
    return count, matches


if __name__ == '__main__':
    root = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent
    try:
        count, matches = scan(root)
        if matches:
            raise ValueError('Java sources or binaries must not be distributed:\n' + '\n'.join(matches))
        print(f'Source boundary passed: {count} project files inspected; no Java sources or binaries.')
    except (ValueError, OSError, tarfile.TarError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
