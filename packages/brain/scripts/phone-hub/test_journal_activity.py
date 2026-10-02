import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'phone-ssh'))
from journal import Journal

class JournalActivityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'journal'
        self.journal = Journal(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_global_revision_changes_for_all_real_process_writes(self):
        before = self.journal.activity_snapshot()
        source = 'from journal import Journal;import sys,uuid\nj=Journal(sys.argv[1]);k=str(uuid.uuid4())\nfor n in range(4):\n with j.locked(k):j.write(k,{"phase":"unknown"})\n'
        env = {**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parent.parent / 'phone-ssh')}
        children = [subprocess.Popen([sys.executable, '-B', '-c', source, str(self.root)], env=env) for _ in range(3)]
        for child in children:
            self.assertEqual(child.wait(timeout=5), 0)
        after = self.journal.activity_snapshot()
        self.assertEqual(after['revision'] - before['revision'], 12)
        self.assertEqual(len(list(self.journal.keys())), 3)

    def test_activity_survives_owner_exit_and_only_explicit_end_releases(self):
        token = self.journal.begin_activity('capabilities')
        self.assertEqual(Journal(self.root).activity_snapshot()['in_flight'], 1)
        self.journal.end_activity(token)
        self.assertEqual(self.journal.activity_snapshot()['in_flight'], 0)
        with self.assertRaises(ValueError):
            self.journal.end_activity(token)
        source = 'from journal import Journal;import sys\nJournal(sys.argv[1]).begin_activity("capabilities")\n'
        child = subprocess.run([sys.executable, '-B', '-c', source, str(self.root)],env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parent.parent/'phone-ssh')},timeout=5)
        self.assertEqual(child.returncode,0)
        self.assertEqual(self.journal.activity_snapshot()['in_flight'],1,'dead owner remains unknown, never inferred zero')

    def test_revision_document_corruption_or_missing_existing_state_is_unknown(self):
        key=str(uuid.uuid4())
        with self.journal.locked(key):self.journal.write(key,{'phase':'unknown'})
        (self.root/'.activity.json').unlink()
        with self.assertRaises(ValueError):Journal(self.root)

    def test_unknown_guard_and_symlink_cannot_be_hidden_from_scan(self):
        (self.root/'strange.guard').write_text('')
        with self.assertRaises(ValueError):list(self.journal.keys())
        (self.root/'strange.guard').unlink()
        (self.root/(str(uuid.uuid4())+'.guard')).symlink_to('/dev/null')
        with self.assertRaises((ValueError,OSError)):list(self.journal.keys())

if __name__=='__main__':unittest.main()
