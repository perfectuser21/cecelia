"""C4原子闸永久真实fork/flock回归；仅私有fixture，无生产授权/设备。"""
import json
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch
import admission
import probe
import worker
from journal import Journal
from runner import Runner, Config
import test_activation as activation_fixture


class AdmissionTest(unittest.TestCase):
    def setUp(self):
        self.fixture = activation_fixture.ActivationTest('test_valid_longer_than_five_second_window_is_immutable_and_read_only')
        self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root / 'admission'; self.root.mkdir(mode=0o700)
        self.journal_root = self.fixture.root / 'journal'
        self.host_root = self.fixture.root / 'host'; self.host_root.mkdir(mode=0o700)
        for name in ('admission.guard',): self.write(self.root / name, b'')
        self.write(self.root / 'admission-state.json', json.dumps({'schema':'phone-admission/v1',
                   'revision':0,'control_epoch':str(uuid.uuid4()),'pending':{}}).encode())
        self.write(self.host_root / 'host.guard', b'')
        self.write(self.host_root / '.host-activity.json', b'{"schema":1,"activities":{}}')
        self.patches = [patch.object(admission, '_ROOT', self.root),
                        patch.object(admission, '_JOURNAL_ROOT', self.journal_root),
                        patch.object(admission, '_HOST_ROOT', self.host_root)]
        for p in self.patches: p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    @staticmethod
    def write(path, raw): path.write_bytes(raw); path.chmod(0o600)

    def child(self, fn):
        read, write = os.pipe(); pid = os.fork()
        if pid == 0:
            os.close(read)
            try: fn(); os.write(write, b'accepted')
            except Exception: os.write(write, b'denied')
            os._exit(0)
        os.close(write); result = os.read(read, 64); os.close(read); os.waitpid(pid, 0)
        return result

    def test_new_admission_code_is_part_of_real_physical_static_hashes(self):
        self.assertIn('admission.py', probe.SOURCE_FILES)
        installed = probe.installed_identity(manifest_path=self.fixture.install / 'probe.json',
                                            config_path=self.fixture.install / 'worker.json', source_root=self.fixture.source)
        self.assertEqual(installed['build_digest'], self.fixture.physical['build_digest'])
        path = self.fixture.source / 'admission.py'
        path.write_bytes(path.read_bytes() + b'\n# tampered control\n')
        with self.assertRaises(ValueError):
            probe.installed_identity(manifest_path=self.fixture.install / 'probe.json',
                                     config_path=self.fixture.install / 'worker.json', source_root=self.fixture.source)

    def test_real_activation_dependency_is_pinned_by_physical_and_hub(self):
        self.assertIn('activation.py', probe.SOURCE_FILES)
        hub = Path(__file__).parent.parent / 'phone-hub' / 'configuration.cjs'
        names = json.loads(subprocess.check_output(['node', '-e',
            'process.stdout.write(JSON.stringify(require(process.argv[1]).SOURCE_FILES))', str(hub)]))
        for name in ('admission.py', 'activation.py'):
            self.assertIn('../phone-ssh/' + name, names)
        installed = probe.installed_identity(manifest_path=self.fixture.install / 'probe.json',
                                            config_path=self.fixture.install / 'worker.json', source_root=self.fixture.source)
        self.assertEqual(installed['build_digest'], self.fixture.physical['build_digest'])
        path = self.fixture.source / 'activation.py'
        path.write_bytes(path.read_bytes() + b'\n# tampered validator\n')
        with self.assertRaises(ValueError):
            probe.installed_identity(manifest_path=self.fixture.install / 'probe.json',
                                     config_path=self.fixture.install / 'worker.json', source_root=self.fixture.source)

    def test_native_system_sticky_tmp_allows_only_private_host_directory(self):
        native = '/private/tmp' if os.uname().sysname == 'Darwin' else '/tmp'
        with tempfile.TemporaryDirectory(prefix='phone-host-native-', dir=native) as folder:
            root = Path(folder); root.chmod(0o700)
            self.write(root / 'host.guard', b'')
            self.write(root / '.host-activity.json', b'{"schema":1,"activities":{}}')
            with patch.object(admission, '_HOST_ROOT', root):
                host = admission.HostExclusive().acquire()
                try: host.verify(); self.assertEqual(self.child(lambda: admission.HostExclusive().acquire()), b'denied')
                finally: host.close()
                root.chmod(0o755)
                with self.assertRaises(ValueError): admission.HostExclusive().acquire()
                root.chmod(0o700)
                def replacement():
                    host = admission.HostExclusive().acquire()
                    (root / 'host.guard').unlink(); self.write(root / 'host.guard', b'')
                    with self.assertRaises(ValueError): host.verify()
                    with self.assertRaises(ValueError): host.close()
                # 破坏路径后的句柄无close权限；仅此自有fork自然退出关继承FD。
                self.assertEqual(self.child(replacement), b'accepted')

    def test_arbitrary_writable_host_parent_and_symlink_are_not_trusted(self):
        parent = self.fixture.root / 'writable'; parent.mkdir(mode=0o777); parent.chmod(0o777)
        root = parent / 'host'; root.mkdir(mode=0o700)
        self.write(root / 'host.guard', b'')
        self.write(root / '.host-activity.json', b'{"schema":1,"activities":{}}')
        with patch.object(admission, '_HOST_ROOT', root):
            with self.assertRaises(ValueError): admission.HostExclusive().acquire()
            parent.chmod(0o1777)
            with self.assertRaises(ValueError): admission.HostExclusive().acquire()
        link = self.fixture.root / 'host-link'; link.symlink_to(self.host_root, target_is_directory=True)
        with patch.object(admission, '_HOST_ROOT', link):
            with self.assertRaises((ValueError, OSError)): admission.HostExclusive().acquire()

    def test_real_admission_lock_blocks_all_second_process_journal_writers(self):
        journal = Journal(self.journal_root)
        with admission.locked():
            self.assertEqual(self.child(lambda: Journal(self.journal_root).write(str(uuid.uuid4()), {})), b'denied')
        self.assertEqual(self.child(lambda: Journal(self.journal_root).write(str(uuid.uuid4()), {})), b'accepted')

    def test_a_d_t_write_under_activity_does_not_relock_and_fake_context_refused(self):
        journal = Journal(self.journal_root); key = str(uuid.uuid4())
        with admission.locked():
            with journal.locked(key):
                with journal.activity_locked() as held:
                    journal.write_under_activity(key, {'phase':'fixture'}, held)
                    with self.assertRaises(ValueError): journal.write(key, {'phase':'bad'})
                    with self.assertRaises(ValueError): journal.write_under_activity(key, {}, object())
        self.assertEqual(journal.read(key)['phase'], 'fixture')
        with self.assertRaises(ValueError): journal.write_under_activity(key, {}, held)

    def test_activity_capability_cannot_be_borrowed_by_another_thread(self):
        journal = Journal(self.journal_root); key = str(uuid.uuid4()); result = []
        with journal.activity_locked() as held:
            def borrowed():
                try: journal.write_under_activity(key, {'phase':'forged'}, held); result.append('accepted')
                except ValueError: result.append('denied')
            thread = threading.Thread(target=borrowed); thread.start(); thread.join(timeout=1)
            self.assertFalse(thread.is_alive())
        self.assertEqual(result, ['denied'])
        self.assertIsNone(journal.read(key))

    def test_pre_intent_persistent_account_is_not_terminal_and_dead_owner_not_removed(self):
        gate = admission.Admission()
        identity = self.fixture.identity
        self.assertEqual(self.child(lambda: gate.register(identity)), b'accepted')
        state = gate.snapshot()
        self.assertEqual(state['pending'][identity['dispatch_id']]['phase'], 'pre_intent')
        self.assertEqual(state['pending'][identity['dispatch_id']]['identity'], identity)
        self.assertNotIn('receipt', state['pending'][identity['dispatch_id']])
        self.assertEqual(gate.snapshot()['pending'], state['pending'])

    def test_pre_intent_is_visible_to_physical_maintenance_before_dispatch_journal(self):
        runner = Runner(Config(**self.fixture.worker, journal_root=str(self.journal_root)))
        admission.Admission().register(self.fixture.identity)
        self.assertEqual(list(runner.journal.keys()), [])
        maintenance = runner.maintenance()
        self.assertGreaterEqual(maintenance['pending'], 1)
        self.assertGreaterEqual(maintenance['in_flight'], 1)

    def test_corrupt_missing_or_replaced_guard_is_unknown_not_initialized(self):
        path = self.root / 'admission-state.json'; original = path.read_bytes()
        self.write(path, b'{}')
        with self.assertRaises(ValueError): admission.Admission().snapshot()
        self.write(path, original)
        with self.assertRaises(ValueError):
            with admission.locked():
                guard = self.root / 'admission.guard'; guard.unlink(); self.write(guard, b'')
                with self.assertRaises(ValueError):
                    with admission.locked(): pass
        (self.root / 'admission.guard').unlink()
        with self.assertRaises(OSError): admission.Admission().snapshot()

    def test_host_exclusive_is_inherited_by_child_after_owner_death(self):
        ready_r, ready_w = os.pipe(); release_r, release_w = os.pipe()
        owner = os.fork()
        if owner == 0:
            os.close(ready_r); os.close(release_w)
            host = admission.HostExclusive().acquire()
            child = os.fork()
            if child == 0:
                os.setsid(); os.close(ready_w)
                os.read(release_r, 1); os._exit(0)
            os.write(ready_w, str(child).encode()); os._exit(0)
        os.close(ready_w); os.close(release_r)
        child = int(os.read(ready_r, 64)); os.close(ready_r); os.waitpid(owner, 0)
        try:
            os.kill(child, 0)
            self.assertEqual(self.child(lambda: admission.HostExclusive().acquire()), b'denied')
        finally: os.write(release_w, b'D'); os.close(release_w)

    def test_transferred_host_fd_survives_metadata_descriptor_cleanup(self):
        host = admission.HostExclusive().acquire()
        read, write = os.pipe()
        child = host.fork()
        if child == 0:
            os.close(read)
            try:
                fd = host.transfer()
                # 传给detach的白名单只需真正E FD，不保留已关闭metadata FD数字。
                self.assertEqual(host.fd, fd)
                host.verify()
                self.assertEqual(self.child(lambda: admission.HostExclusive().acquire()), b'denied')
                host.close(); os.write(write, b'accepted')
            except Exception: os.write(write, b'denied')
            os._exit(0)
        os.close(write); result = os.read(read, 64); os.close(read); os.waitpid(child, 0)
        host.close(); self.assertEqual(result, b'accepted')

    def test_detached_worker_resets_parent_lock_metadata_but_keeps_real_host_fd(self):
        journal = Journal(self.journal_root); key = str(uuid.uuid4())
        host = admission.HostExclusive().acquire()
        ready_r, ready_w = os.pipe(); go_r, go_w = os.pipe()
        with journal.locked(key):
            child = host.fork()
            if child == 0:
                try:
                    os.close(ready_r); os.close(go_w)
                    fd = host.transfer()
                    worker.detach(keep_fds=(*host._detach_fds(), ready_w, go_r))
                    host._after_detach()
                    journal.after_detach()
                    admission.discard_fork_context()
                    os.write(ready_w, b'R'); os.close(ready_w)
                    if os.read(go_r, 1) != b'G': os._exit(2)
                    os.close(go_r); host.verify()
                    with journal.locked(key): journal.write(key, {'phase':'worker_verified'})
                    host.close(); os._exit(0)
                except Exception: os._exit(1)
            os.close(ready_w); os.close(go_r)
            self.assertEqual(os.read(ready_r, 1), b'R'); os.close(ready_r)
        os.write(go_w, b'G'); os.close(go_w)
        _, status = os.waitpid(child, 0); host.close()
        self.assertEqual(status, 0)
        self.assertEqual(journal.read(key)['phase'], 'worker_verified')

    def test_host_pending_legacy_activity_is_not_reaped_or_treated_as_free(self):
        raw = b'{"schema":1,"activities":{"unknown-owner":{"pid":1}}}'
        self.write(self.host_root / '.host-activity.json', raw)
        with self.assertRaises(ValueError): admission.HostExclusive().acquire()
        self.assertEqual((self.host_root / '.host-activity.json').read_bytes(), raw)


    def test_host_primary_numeric_fd_reuse_for_same_inode_is_rejected(self):
        host = admission.HostExclusive().acquire(); fd = host.fd; original = os.dup(fd)
        try:
            os.close(fd); raw = os.open(self.host_root / 'host.guard', os.O_RDONLY)
            if raw != fd: os.dup2(raw, fd); os.close(raw)
            with self.assertRaises(ValueError): host.verify()
        finally:
            os.dup2(original, fd); os.close(original); host.close()

    def test_host_fd_assignment_and_cross_thread_borrow_are_rejected(self):
        host = admission.HostExclusive().acquire()
        try:
            with self.assertRaises((ValueError, AttributeError)): host.fd = host.fd
        finally: host.close()

    def test_host_cross_thread_verify_is_rejected(self):
        host = admission.HostExclusive().acquire(); result = []
        try:
            def borrowed():
                try: host.verify(); result.append('accepted')
                except ValueError: result.append('denied')
            thread = threading.Thread(target=borrowed); thread.start(); thread.join(timeout=1)
            self.assertFalse(thread.is_alive()); self.assertEqual(result, ['denied'])
        finally: host.close()

    def test_host_raw_fork_cannot_adopt_owner_or_transfer_authority(self):
        host = admission.HostExclusive().acquire()
        try:
            self.assertEqual(self.child(lambda: host.verify()), b'denied')
            self.assertEqual(self.child(lambda: host.transfer()), b'denied')
            self.assertEqual(self.child(lambda: host.close()), b'denied')
        finally: host.close()

    def test_host_verify_never_repairs_downgraded_shared_lock(self):
        host = admission.HostExclusive().acquire(); fd = host.fd
        try:
            fcntl.flock(fd, fcntl.LOCK_SH)
            with self.assertRaises(ValueError): host.verify()
            raw = os.open(self.host_root / 'host.guard', os.O_RDONLY)
            try: fcntl.flock(raw, fcntl.LOCK_SH | fcntl.LOCK_NB)
            finally: os.close(raw)
        finally:
            fcntl.flock(fd, fcntl.LOCK_EX); host.close()

if __name__ == '__main__': unittest.main()
