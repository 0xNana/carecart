import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('carecart_backup', Path(__file__).with_name('backup-carecart.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupTests(unittest.TestCase):
    def test_wal_records_restore_and_overwrite_guards(self):
        with tempfile.TemporaryDirectory(prefix='carecart-backup-test-') as temp:
            root = Path(temp); data = root / 'data'; data.mkdir()
            source = sqlite3.connect(data / 'registry.sqlite')
            try:
                source.execute('PRAGMA journal_mode=WAL')
                source.execute('CREATE TABLE audit(id TEXT PRIMARY KEY, event TEXT)')
                source.execute("INSERT INTO audit VALUES('event-1','StockReceived')"); source.commit()
                with self.assertRaises(ValueError): module.backup(data, root / 'copy', False)
                with self.assertRaises(ValueError): module.backup(data, data / 'copy', True)
                result = module.backup(data, root / 'copy', True)
                self.assertEqual(result['status'], 'complete')
                self.assertEqual(len(result['databases']), 1)
                with sqlite3.connect(root / 'copy/registry.sqlite') as restored:
                    self.assertEqual(restored.execute('SELECT * FROM audit').fetchall(), [('event-1','StockReceived')])
                self.assertEqual((root / 'copy/registry.sqlite').stat().st_mode & 0o777, 0o600)
                with self.assertRaises(ValueError): module.backup(data, root / 'copy', True)
                self.assertEqual(source.execute('SELECT COUNT(*) FROM audit').fetchone()[0], 1)
            finally: source.close()

    def test_database_links_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='carecart-backup-test-') as temp:
            root=Path(temp); data=root/'data'; data.mkdir()
            with sqlite3.connect(root/'external.sqlite') as source: source.execute('CREATE TABLE x(a)')
            (data/'linked.sqlite').symlink_to(root/'external.sqlite')
            with self.assertRaises(ValueError): module.backup(data,root/'copy',True)
            self.assertFalse((root/'copy').exists())


if __name__ == '__main__': unittest.main()
