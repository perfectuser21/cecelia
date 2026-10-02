import hashlib
import importlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'phone-ssh'))
from journal import Journal
from process_identity import boot_id

class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def setup_probe(self):
        probe=importlib.import_module('probe');self.source=self.root/'source';self.source.mkdir()
        hashes={}
        for name in probe.SOURCE_FILES:
            path=self.source/name;path.write_bytes(('private installed fixture '+name).encode());path.chmod(0o600)
            hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
        self.identity={'machine_id':'fixture-machine','worker_id':'fixture-worker','host':'fixture-host'}
        self.config=self.root/'worker.json';self.config.write_text(json.dumps(self.identity));self.config.chmod(0o600)
        self.manifest=self.root/'manifest.json';self.manifest.write_text(json.dumps({'schema':1,**self.identity,'source_hashes':hashes}));self.manifest.chmod(0o600)
        self.journal=self.root/'journal';Journal(self.journal);self.locks=self.root/'locks';self.locks.mkdir();self.marker=self.root/'drain';self.marker.write_text('drain')
        return probe
    def collect(self,probe):
        return probe.collect(manifest_path=self.manifest,source_root=self.source,config_path=self.config,journal_root=self.journal,lock_root=self.locks,drain_path=self.marker)
    def test_real_boot_resources_and_installed_bytes_not_self_reported_digest(self):
        probe=self.setup_probe();result=self.collect(probe)
        self.assertEqual(result['physical_boot_id'],boot_id());self.assertEqual(result['action'],'adb_get_state')
        self.assertGreater(result['resources']['cpu_count'],0);self.assertGreater(result['resources']['memory_total_bytes'],0)
        self.assertTrue(result['maintenance']['quiescent']);self.assertNotIn('available',result)
        (self.source/'worker.py').write_text('changed')
        with self.assertRaises(ValueError):self.collect(probe)
    def test_missing_physical_journal_and_manifest_identity_conflict_fail_closed(self):
        probe=self.setup_probe();(self.journal/'.activity.json').unlink()
        with self.assertRaises((ValueError,OSError)):self.collect(probe)
    def test_legacy_external_lock_is_occupied_never_reaped(self):
        probe=self.setup_probe();lock=self.locks/'fixture-serial.lock';lock.mkdir();(lock/'owner').write_text('old colleague')
        self.assertEqual(self.collect(probe)['external_locks']['occupied'],1);self.assertTrue(lock.exists())
        (self.locks/'evil.lock').symlink_to(lock)
        with self.assertRaises(ValueError):self.collect(probe)
    def test_public_probe_request_cannot_set_paths_host_or_environment(self):
        probe=self.setup_probe()
        for request in [{'schema':'phone-physical-probe/v1','request_nonce':'invalid'}, {'schema':'phone-physical-probe/v1','request_nonce':'123','host':'attacker'}]:
            with self.assertRaises(ValueError):probe.validate_request(request)
if __name__=='__main__':unittest.main()
