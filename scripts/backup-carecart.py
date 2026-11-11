#!/usr/bin/env python3
"""Owner-run, quiesced SQLite backup. Never restores, deletes or overwrites data."""
from contextlib import closing
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def backup(data_root: Path, destination: Path, writers_stopped: bool):
    if not writers_stopped:
        raise ValueError('Stop all database writers before backing up the registry and clinic set.')
    source = data_root.resolve(strict=True)
    target = destination.resolve()
    if not source.is_dir() or target == source or source in target.parents:
        raise ValueError('Backup destination must be outside the data directory.')
    if destination.exists() or destination.is_symlink():
        raise ValueError('Use a new backup directory; existing backups are never overwritten.')
    files = sorted(source.rglob('*.sqlite'))
    if not files:
        raise ValueError('No SQLite databases found.')
    for path in files:
        if path.is_symlink() or source not in path.resolve().parents or path.stat().st_nlink != 1:
            raise ValueError('Database links are not supported.')
    old_umask = os.umask(0o077)
    try:
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
        manifest = {'format': 'carecart-sqlite-backup-v1', 'status': 'incomplete', 'databases': []}
        manifest_path = destination / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        for path in files:
            relative = path.relative_to(source)
            copy = destination / relative
            copy.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)) as reader:
                with closing(sqlite3.connect(copy)) as writer:
                    reader.backup(writer)
                    if writer.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                        raise ValueError('Backup database integrity check failed.')
            manifest['databases'].append({'path': relative.as_posix(), 'bytes': copy.stat().st_size,
                                          'sha256': hashlib.sha256(copy.read_bytes()).hexdigest()})
        manifest['status'] = 'complete'
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        return manifest
    finally:
        os.umask(old_umask)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--writers-stopped', action='store_true')
    args = parser.parse_args()
    try:
        result = backup(args.data_root, args.destination, args.writers_stopped)
        print(json.dumps({'status': result['status'], 'databases': len(result['databases'])}))
    except (ValueError, OSError, sqlite3.Error):
        parser.exit(1, 'Backup failed. Check paths, permissions, stopped writers and SQLite integrity. No source database was changed.\n')
