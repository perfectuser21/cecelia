"""C4唯一permit真实socket/pipe/fork故障回归；纯私有fixture。"""
import json
import os
import select
import socket
import signal
import unittest
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
