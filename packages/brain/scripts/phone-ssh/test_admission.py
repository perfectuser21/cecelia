"""C4原子闸永久真实fork/flock回归；仅私有fixture，无生产授权/设备。"""
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch
import admission
from journal import Journal
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
                os.read(release_r, 1); host.close(); os._exit(0)
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
        child = os.fork()
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

    def test_host_pending_legacy_activity_is_not_reaped_or_treated_as_free(self):
        raw = b'{"schema":1,"activities":{"unknown-owner":{"pid":1}}}'
        self.write(self.host_root / '.host-activity.json', raw)
        with self.assertRaises(ValueError): admission.HostExclusive().acquire()
        self.assertEqual((self.host_root / '.host-activity.json').read_bytes(), raw)


if __name__ == '__main__': unittest.main()
