import hashlib
import fcntl
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import socket
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'phone-ssh'))
from journal import Journal
from process_identity import boot_id

class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        daemon_patch=patch.object(importlib.import_module('probe'),'daemon_observation',return_value={'reachable':False})
        daemon_patch.start();self.addCleanup(daemon_patch.stop)
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
        value=self.collect(probe)
        self.assertEqual(value['external_locks']['occupied'],1);self.assertTrue(lock.exists())
        self.assertFalse(value['maintenance']['quiescent'],'旧锁真实存在时不能以空runner账证明物理静默')
        self.assertGreaterEqual(value['maintenance']['pending'],1)
        (self.locks/'evil.lock').symlink_to(lock)
        with self.assertRaises(ValueError):self.collect(probe)
    def test_public_probe_request_cannot_set_paths_host_or_environment(self):
        probe=self.setup_probe()
        for request in [{'schema':'phone-physical-probe/v1','request_nonce':'invalid'}, {'schema':'phone-physical-probe/v1','request_nonce':'123','host':'attacker'}]:
            with self.assertRaises(ValueError):probe.validate_request(request)
    def test_real_other_process_guard_is_occupied_before_lock_directory_exists(self):
        probe=self.setup_probe();ready_r,ready_w=os.pipe();go_r,go_w=os.pipe()
        guard=self.locks/'fixture-serial.guard'
        pid=os.fork()
        if pid==0:
            os.close(ready_r);os.close(go_w)
            fd=os.open(guard,os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(fd,fcntl.LOCK_EX)
            os.write(ready_w,b'1');os.read(go_r,1);os.close(fd);os._exit(0)
        os.close(ready_w);os.close(go_r)
        try:
            self.assertEqual(os.read(ready_r,1),b'1')
            value=self.collect(probe)
            self.assertEqual(value['external_locks']['occupied'],1)
            self.assertFalse(value['maintenance']['quiescent'],'真实其他进程持guard也不能签物理静默')
            self.assertGreaterEqual(value['maintenance']['pending'],1)
        finally:
            os.write(go_w,b'1');os.close(go_w);os.close(ready_r);os.waitpid(pid,0)
    def test_collect_never_connects_existing_daemon(self):
        probe=self.setup_probe()
        with patch.object(socket,'create_connection',side_effect=AssertionError('forbidden_existing_socket')) as connect:
            result=self.collect(probe)
        self.assertEqual(result['adb_daemon'],{'reachable':False})
        connect.assert_not_called()

class DaemonObservationTest(unittest.TestCase):
    def mapped_connection(self,real_connect,address):
        def connect(target,timeout):
            self.assertEqual(target,('127.0.0.1',5037));self.assertEqual(timeout,0.3)
            return real_connect(address,timeout=timeout)
        return connect
    def test_fixed_target_maps_only_to_owned_listener_and_closes_connection(self):
        probe=importlib.import_module('probe');real_connect=socket.create_connection
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(1)
            with patch.object(socket,'create_connection',side_effect=self.mapped_connection(real_connect,listener.getsockname())) as connect:
                self.assertEqual(probe.daemon_observation(),{'reachable':True})
            connect.assert_called_once_with(('127.0.0.1',5037),timeout=0.3)
            peer,_=listener.accept()
            with peer:
                peer.settimeout(1);self.assertEqual(peer.recv(1),b'')
    def test_owned_non_listening_port_preserves_real_refusal_or_timeout_contract(self):
        probe=importlib.import_module('probe');real_connect=socket.create_connection;native_error=[]
        with socket.socket() as owned:
            owned.bind(('127.0.0.1',0));address=owned.getsockname()
            def connect(target,timeout):
                self.assertEqual(target,('127.0.0.1',5037));self.assertEqual(timeout,0.3)
                try:return real_connect(address,timeout=timeout)
                except OSError as error:native_error.append(error);raise
            with patch.object(socket,'create_connection',side_effect=connect) as mapped:
                try:value=probe.daemon_observation()
                except ValueError as error:
                    self.assertEqual(str(error),'phone_adb_observation_unknown')
                    self.assertEqual(len(native_error),1);self.assertIsInstance(native_error[0],socket.timeout)
                    self.assertIs(error.__cause__,native_error[0]);outcome='timeout_unknown'
                else:
                    self.assertEqual(len(native_error),1);self.assertIsInstance(native_error[0],ConnectionRefusedError)
                    self.assertEqual(value,{'reachable':False});outcome='refused_false'
            mapped.assert_called_once_with(('127.0.0.1',5037),timeout=0.3)
            self.assertGreaterEqual(owned.fileno(),0);self.assertEqual(owned.getsockname(),address)
            self.native_result={'type':type(native_error[0]).__name__,'errno':native_error[0].errno,'outcome':outcome}
    def test_injected_connection_refused_is_false_without_real_daemon_access(self):
        probe=importlib.import_module('probe')
        with patch.object(socket,'create_connection',side_effect=ConnectionRefusedError('private fixture refusal')) as connect:
            self.assertEqual(probe.daemon_observation(),{'reachable':False})
        connect.assert_called_once_with(('127.0.0.1',5037),timeout=0.3)
    def test_timeout_is_unknown_not_false_daemon_evidence(self):
        probe=importlib.import_module('probe')
        with patch.object(socket,'create_connection',side_effect=socket.timeout('private fixture timeout')) as connect:
            with self.assertRaisesRegex(ValueError,'phone_adb_observation_unknown'):probe.daemon_observation()
        connect.assert_called_once_with(('127.0.0.1',5037),timeout=0.3)
    def test_other_socket_error_is_unknown_not_false_daemon_evidence(self):
        probe=importlib.import_module('probe')
        with patch.object(socket,'create_connection',side_effect=OSError('private fixture error')) as connect:
            with self.assertRaisesRegex(ValueError,'phone_adb_observation_unknown'):probe.daemon_observation()
        connect.assert_called_once_with(('127.0.0.1',5037),timeout=0.3)
if __name__=='__main__':unittest.main()
