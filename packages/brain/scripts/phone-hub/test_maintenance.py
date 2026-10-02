import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'phone-ssh'))
from journal import Journal

class MaintenanceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.journal=Journal(self.root/'journal');self.marker=self.root/'drain'
    def tearDown(self):self.tmp.cleanup()
    def read(self,scan=None):
        from maintenance import read_maintenance
        return read_maintenance(self.journal,self.marker,scan=scan)
    def test_requires_marker_and_empty_known_stable_journal(self):
        self.assertFalse(self.read()['quiescent'])
        self.marker.write_text('drain')
        self.assertTrue(self.read()['quiescent'])
        token=self.journal.begin_activity('capabilities')
        self.assertFalse(self.read()['quiescent'])
        self.journal.end_activity(token)
        self.assertTrue(self.read()['quiescent'])
    def test_marker_native_generation_returned_for_whole_round_comparison(self):
        self.marker.write_text('drain');first=self.read()
        native=self.marker.stat();identity=first['marker_identity']
        self.assertEqual(identity['ino'],str(native.st_ino));self.assertEqual(identity['mtime_ns'],str(native.st_mtime_ns))
        self.assertTrue(identity['boot_id']);self.assertIsInstance(identity['ctime_ns'],str)
        self.marker.rename(self.root/'previous');self.marker.write_text('drain')
        second=self.read();self.assertNotEqual(identity,second['marker_identity'])
    def test_real_fork_activity_mutation_during_scan_revokes_quiescence(self):
        self.marker.write_text('drain')
        def mutate():
            pid=os.fork()
            if pid==0:
                token=Journal(self.journal.root).begin_activity('capabilities')
                Journal(self.journal.root).end_activity(token);os._exit(0)
            self.assertEqual(os.waitpid(pid,0)[1],0)
            return {'pending':0}
        result=self.read(mutate)
        self.assertFalse(result['stable']);self.assertFalse(result['quiescent'])
    def test_real_marker_remove_recreate_during_scan_revokes_quiescence(self):
        self.marker.write_text('drain')
        def mutate():
            self.marker.unlink();self.marker.write_text('changed')
            return {'pending':0}
        self.assertFalse(self.read(mutate)['quiescent'])
    def test_unknown_scan_missing_record_and_symlink_marker_fail_closed(self):
        self.marker.write_text('drain')
        for bad in [lambda:None,lambda:{'pending':-1},lambda:{'pending':False}]:
            with self.assertRaises(ValueError):self.read(bad)
        self.marker.unlink();self.marker.symlink_to(self.root/'missing')
        with self.assertRaises(ValueError):self.read()
    def test_physical_runner_uses_global_revision_and_unknown_activity(self):
        from runner import Runner,Config
        runner=Runner(Config(journal_root=str(self.journal.root),machine_id='fixture',worker_id='fixture',host='fixture'))
        token=self.journal.begin_activity('capabilities')
        result=runner.maintenance()
        self.assertEqual(result['in_flight'],1)
        self.assertEqual(result['activity_revision'],self.journal.activity_snapshot()['revision'])
        self.journal.end_activity(token)
if __name__=='__main__':unittest.main()
