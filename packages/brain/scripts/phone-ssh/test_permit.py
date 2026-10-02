"""C4唯一permit真实socket/pipe/fork故障回归；纯私有fixture。"""
import json
import fcntl
import os
import select
import socket
import signal
import threading
import unittest
import uuid
from unittest.mock import patch
import admission
import permit
import test_admission as fixture


class PermitTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.AdmissionTest('test_real_admission_lock_blocks_all_second_process_journal_writers')
        self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.identity = self.fixture.fixture.identity
        self.host = admission.HostExclusive().acquire(); self.addCleanup(self.host.close)
        self.server = socket.socket(); self.server.bind(('127.0.0.1', 0)); self.server.listen()
        self.addCleanup(self.server.close)
        self.port_patch = patch.object(permit, '_PORT', self.server.getsockname()[1]); self.port_patch.start()
        self.addCleanup(self.port_patch.stop)
        data_patch = patch.object(permit, '_DATA_ROOT', self.fixture.root); data_patch.start()
        self.addCleanup(data_patch.stop)
        self.control = {'schema':'phone-admission-control/v1','revision':0,
                        'control_epoch':admission.Admission().snapshot()['control_epoch'], 'draining':False,
                        'writer_contract':'phone-admission-writers/v1','host_gate_contract':'managed-phone-host/v1'}
        self.fixture.write(self.fixture.root / 'control.json', json.dumps(self.control).encode())
        admission.Admission().register(self.identity)

    def child(self):
        child = permit.FixedSocketChild(self.identity, self.host)
        self.addCleanup(child.close)
        return child

    def respond(self):
        self.assertTrue(select.select([self.server], [], [], 1)[0])
        conn, _ = self.server.accept()
        with conn:
            length = int(conn.recv(4), 16); request = conn.recv(length)
            self.assertEqual(request, ('host-serial:' + self.identity['serial'] + ':get-state').encode())
            conn.sendall(b'OKAY0006device'); conn.shutdown(socket.SHUT_WR)

    def test_durable_go_precedes_only_permit_and_socket_is_fixed(self):
        child = self.child()
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])
        permit.send(self.identity, self.host, child)
        state = admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]
        self.assertEqual(state['phase'], 'go_committed')
        self.assertEqual(state['child']['pid'], child.pid)
        self.respond(); self.assertEqual(child.wait(), 'device')
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)

    def test_missing_or_changed_control_never_sends_permission(self):
        child = self.child(); path = self.fixture.root / 'control.json'; path.unlink()
        with self.assertRaises((ValueError, OSError)): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])
        self.assertEqual(admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]['phase'], 'pre_intent')

    def test_drain_and_expired_activation_are_rechecked_under_guard(self):
        child = self.child()
        self.control['draining'] = True
        self.fixture.write(self.fixture.root / 'control.json', json.dumps(self.control).encode())
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_durable_go_lost_pipe_reply_is_unknown_and_never_reissued(self):
        child = self.child(); child.close()
        with self.assertRaises((ValueError, OSError)): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])
        self.assertEqual(admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]['phase'], 'pre_intent')

    def test_real_go_committed_then_write_failure_preserves_unknown(self):
        child = self.child(); write = os.write
        def lose(fd, raw):
            if raw == b'1': raise BrokenPipeError('fixture lost delivery')
            return write(fd, raw)
        with patch.object(permit.os, 'write', side_effect=lose):
            with self.assertRaises(BrokenPipeError): permit.send(self.identity, self.host, child)
        state = admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]
        self.assertEqual(state['phase'], 'go_committed')
        self.assertNotIn('receipt', state)
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_control_writer_changes_epoch_and_revision_and_blocks_old_pending(self):
        child = self.child(); before = admission.Admission().snapshot()
        permit._replace_control(draining=True)
        current = permit._control()
        self.assertEqual(current['revision'], self.control['revision'] + 1)
        self.assertNotEqual(current['control_epoch'], self.control['control_epoch'])
        self.assertEqual(admission.Admission().snapshot()['control_epoch'], current['control_epoch'])
        self.assertEqual(admission.Admission().snapshot()['pending'], before['pending'])
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)

    def test_raw_handle_or_identity_cannot_mint_permission(self):
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, object())
        forged = object.__new__(permit.FixedSocketChild)
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, forged)

    def test_actual_permit_source_dependency_is_pinned(self):
        import probe
        self.assertIn('permit.py', probe.SOURCE_FILES)

    def test_child_alone_keeps_ex_after_parent_fd_is_closed(self):
        child = self.child(); permit.send(self.identity, self.host, child)
        self.host.close()
        self.assertEqual(self.fixture.child(lambda: admission.HostExclusive().acquire()), b'denied')
        self.respond(); self.assertEqual(child.wait(), 'device')
        host = admission.HostExclusive().acquire(); host.close()
        self.assertEqual(admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]['phase'], 'go_committed')

    def test_activation_writer_revision_revokes_old_pending_without_clear(self):
        child = self.child(); record = dict(self.fixture.fixture.record)
        record['expires_at'] = record['issued_at']
        permit._replace_control(draining=False, activation_record=record)
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])
        self.assertEqual(admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]['phase'], 'pre_intent')

    def test_worker_dies_after_durable_go_child_keeps_ex_until_fixed_socket_exit(self):
        self.host.close(); ready_r, ready_w = os.pipe(); owner = os.fork()
        if owner == 0:
            try:
                os.close(ready_r); host = admission.HostExclusive().acquire()
                child = permit.FixedSocketChild(self.identity, host)
                permit.send(self.identity, host, child)
                os.write(ready_w, str(child.pid).encode()); os.close(ready_w)
                signal.pause()
            except BaseException: os._exit(126)
        os.close(ready_w)
        try:
            self.assertTrue(select.select([ready_r], [], [], 2)[0])
            self.assertTrue(os.read(ready_r, 64))
            self.assertTrue(select.select([self.server], [], [], 2)[0])
            conn, _ = self.server.accept()
            try:
                os.kill(owner, signal.SIGKILL); os.waitpid(owner, 0); owner = None
                self.assertEqual(self.fixture.child(lambda: admission.HostExclusive().acquire()), b'denied')
                state = admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]
                self.assertEqual(state['phase'], 'go_committed'); self.assertNotIn('receipt', state)
            finally: conn.close()
        finally:
            os.close(ready_r)
            if owner is not None:
                os.kill(owner, signal.SIGKILL); os.waitpid(owner, 0)

    def test_child_handle_cannot_be_borrowed_by_another_thread(self):
        child = self.child(); result = []
        def borrowed():
            try: permit.send(self.identity, self.host, child); result.append('accepted')
            except ValueError: result.append('denied')
        thread = threading.Thread(target=borrowed); thread.start(); thread.join(timeout=1)
        self.assertFalse(thread.is_alive()); self.assertEqual(result, ['denied'])
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_parent_death_after_durable_go_before_byte_does_not_restart(self):
        self.host.close(); owner = os.fork()
        if owner == 0:
            try:
                host = admission.HostExclusive().acquire(); child = permit.FixedSocketChild(self.identity, host)
                write = os.write
                def die(fd, raw):
                    if raw == b'1': os.kill(os.getpid(), signal.SIGKILL)
                    return write(fd, raw)
                with patch.object(permit.os, 'write', side_effect=die): permit.send(self.identity, host, child)
            except BaseException: os._exit(126)
            os._exit(127)
        _, status = os.waitpid(owner, 0)
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        state = admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]
        self.assertEqual(state['phase'], 'go_committed'); self.assertNotIn('receipt', state)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_control_writers_obey_real_cross_process_admission_guard(self):
        with admission.locked():
            self.assertEqual(self.fixture.child(lambda: permit._replace_control(draining=True)), b'denied')
        self.assertEqual(self.fixture.child(lambda: permit._replace_control(draining=True)), b'accepted')

    def test_final_disk_and_activation_recheck_rejects_without_socket(self):
        child = self.child()
        class LowDisk:
            f_bavail = 1
            f_frsize = 1
        with patch.object(permit.os, 'statvfs', return_value=LowDisk()):
            with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        record = dict(self.fixture.fixture.record); record['expires_at'] = record['issued_at']
        self.fixture.fixture.store(record)
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_permit_actual_bytes_tamper_refuses_installed_identity(self):
        import probe
        path = self.fixture.fixture.source / 'permit.py'
        path.write_bytes(path.read_bytes() + b'\n# changed permit\n')
        with self.assertRaises(ValueError):
            probe.installed_identity(manifest_path=self.fixture.fixture.install / 'probe.json',
                                     config_path=self.fixture.fixture.install / 'worker.json',
                                     source_root=self.fixture.fixture.source)

    def test_expiry_during_go_fsync_stays_unknown_without_permit(self):
        child = self.child(); publish = permit._publish
        def expire(path, value):
            publish(path, value)
            if path.name == 'admission-state.json':
                record = dict(self.fixture.fixture.record); record['expires_at'] = record['issued_at']
                self.fixture.fixture.store(record)
        with patch.object(permit, '_publish', side_effect=expire):
            with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertEqual(admission.Admission().snapshot()['pending'][self.identity['dispatch_id']]['phase'], 'go_committed')
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])

    def test_native_fork_failure_does_not_leak_owned_pipe_or_host_fds(self):
        def opened():
            found = set()
            for fd in range(3, 256):
                try: fcntl.fcntl(fd, fcntl.F_GETFD); found.add(fd)
                except OSError: pass
            return found
        before = opened()
        try:
            with patch.object(permit.os, 'fork', side_effect=OSError('fixture fork unavailable')):
                with self.assertRaises(OSError): permit.FixedSocketChild(self.identity, self.host)
            self.assertEqual(opened(), before)
        finally:
            for fd in opened() - before: os.close(fd)

    def test_partial_control_publication_epoch_mismatch_never_permits(self):
        child = self.child(); state = admission.Admission().snapshot()
        state['control_epoch'] = str(uuid.uuid4())
        self.fixture.write(self.fixture.root / 'admission-state.json', json.dumps(state).encode())
        with self.assertRaises(ValueError): permit.send(self.identity, self.host, child)
        self.assertFalse(select.select([self.server], [], [], 0.02)[0])
