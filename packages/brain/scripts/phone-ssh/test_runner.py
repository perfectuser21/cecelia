"""固定动作执行面的永久真实进程回归；CI由runner.test.js调用。"""
import copy
import fcntl
import importlib
import json
import multiprocessing
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import uuid


def load():
    try:
        return importlib.import_module('runner')
    except ImportError:
        raise AssertionError('固定动作phone runner尚未实现')


class PhoneRunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.count = self.root / 'launches'
        self.adb = self.root / 'adb'
        self.fake_adb()

    def tearDown(self):
        self.tmp.cleanup()

    def fake_adb(self, sleep=0):
        self.adb.write_text('#!' + sys.executable + '\nimport sys,time\n'
                            + 'assert sys.argv[1:]==["-s","fixture-serial","get-state"]\n'
                            + 'with open(' + repr(str(self.count)) + ',"a") as f:f.write("launch\\n")\n'
                            + 'time.sleep(' + repr(sleep) + ')\nprint("device")\n')
        self.adb.chmod(0o700)

    def setup_runner(self, **extra):
        m = load()
        self.config = m.Config(journal_root=str(self.root / 'journal'), lock_root=str(self.root / 'locks'),
                               adb=str(self.adb), machine_id='fixture-machine', worker_id='fixture-worker',
                               host='fixture-host', drain_path=str(self.root / 'drain'),
                               assert_resources=lambda: None, hard_cap_sec=0.7, **extra)
        self.runner = m.Runner(self.config)
        self.identity = {k: str(uuid.uuid4()) for k in m.BINDINGS}
        self.identity.update(dispatch_id=str(uuid.uuid4()), machine_id='fixture-machine',
                             worker_id='fixture-worker', host='fixture-host', serial='fixture-serial',
                             profile='fixture-profile', action='adb_get_state', config_digest='a' * 64,
                             worker_boot_id=m.boot_id())
        return self.runner

    def finish(self, runner=None):
        runner = runner or self.runner
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            receipt = runner.inspect(self.identity)
            if receipt['status'] in ('completed', 'failed'):
                return receipt
            time.sleep(0.03)
        self.fail('真实子进程未在限时内收口')

    def launches(self):
        return len(self.count.read_text().splitlines()) if self.count.exists() else 0

    def test_get_state_real_child_stable_receipt_private_fsync_journal(self):
        r = self.setup_runner()
        r.start(self.identity)
        receipt = self.finish()
        self.assertEqual(receipt['status'], 'completed')
        self.assertEqual(receipt['adb_state'], 'device')
        self.assertTrue(receipt['execution_exited'])
        self.assertTrue(receipt['lock_released'])
        self.assertEqual(receipt['lock_owner'], self.identity['lease_token'])
        self.assertEqual(r.start(self.identity), receipt)
        self.assertEqual(self.launches(), 1)
        for p in Path(self.config.journal_root).rglob('*'):
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o700 if p.is_dir() else 0o600)

    def test_cancel_before_start_tombstone_survives_restart(self):
        r = self.setup_runner()
        receipt = r.cancel(self.identity)
        restarted = load().Runner(self.config)
        self.assertEqual(restarted.start(self.identity), receipt)
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(self.launches(), 0)

    def test_same_identity_different_binding_refused(self):
        r = self.setup_runner()
        r.cancel(self.identity)
        for key in load().BINDINGS:
            changed = copy.deepcopy(self.identity)
            changed[key] = 'b' * 64 if key == 'config_digest' else 'changed'
            with self.assertRaises(ValueError):
                r.start(changed)

    def test_preexisting_stale_lock_never_reaped(self):
        r = self.setup_runner()
        lock = Path(self.config.lock_root) / 'fixture-serial.lock'
        lock.mkdir(parents=True)
        (lock / 'owner').write_text('colleague')
        (lock / 'pid').write_text('999999')
        (lock / 'acquired_at').write_text('1')
        r.start(self.identity)
        receipt = self.finish()
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual((lock / 'owner').read_text(), 'colleague')
        self.assertEqual(self.launches(), 0)

    def test_real_fcntl_guard_conflict_preserves_other_run(self):
        r = self.setup_runner()
        root = Path(self.config.lock_root)
        root.mkdir(parents=True)
        with open(root / 'fixture-serial.guard', 'w') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            r.start(self.identity)
            self.assertEqual(self.finish()['status'], 'failed')
        self.assertEqual(self.launches(), 0)

    def test_lost_reply_restart_inspect_never_launches_twice(self):
        r = self.setup_runner()
        self.fake_adb(0.2)
        r.start(self.identity)
        restarted = load().Runner(self.config)
        receipt = self.finish(restarted)
        self.assertEqual(restarted.start(self.identity), receipt)
        self.assertEqual(self.launches(), 1)

    def test_durable_launch_intent_crash_unknown_cannot_restart(self):
        def crash(stage):
            if stage == 'after_launch_intent':
                raise RuntimeError('fault')
        r = self.setup_runner(fault=crash)
        with self.assertRaises(RuntimeError):
            r.start(self.identity)
        restarted = load().Runner(self.config)
        self.assertEqual(restarted.inspect(self.identity)['status'], 'unknown')
        self.assertEqual(restarted.start(self.identity)['status'], 'unknown')
        self.assertEqual(restarted.cancel(self.identity)['status'], 'failed')
        self.assertEqual(self.launches(), 0)

    def test_timeout_reaps_real_child_and_only_own_lease(self):
        r = self.setup_runner()
        self.fake_adb(10)
        r.start(self.identity)
        receipt = self.finish()
        self.assertEqual(receipt['status'], 'failed')
        self.assertTrue(receipt['execution_exited'])
        self.assertTrue(receipt['lock_released'])
        self.assertFalse((Path(self.config.lock_root) / 'fixture-serial.lock').exists())

    def test_ownership_change_cannot_release_lock_or_claim_terminal(self):
        r = self.setup_runner()
        self.fake_adb(0.3)
        r.start(self.identity)
        lock = Path(self.config.lock_root) / 'fixture-serial.lock'
        deadline = time.monotonic() + 2
        while not (lock / 'owner').exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        (lock / 'owner').write_text('colleague')
        time.sleep(0.6)
        self.assertEqual(r.inspect(self.identity)['status'], 'unknown')
        self.assertEqual((lock / 'owner').read_text(), 'colleague')

    def test_drain_appearing_during_resource_probe_blocks_adb(self):
        r = self.setup_runner()
        self.config.assert_resources = lambda: (self.root / 'drain').write_text('maintenance')
        r.start(self.identity)
        self.assertEqual(self.finish()['status'], 'failed')
        self.assertEqual(self.launches(), 0)

    def test_unknown_process_identity_does_not_kill_unrelated_process(self):
        m = load()
        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(3)'])
        try:
            identity = m.process_identity(child.pid)
            self.assertTrue(m.process_matches(identity))
            changed = {**identity, 'start_time': 'wrong'}
            self.assertFalse(m.process_matches(changed))
            self.assertFalse(m.stop_verified(changed))
            self.assertIsNone(child.poll())
            self.assertFalse(m.process_matches({**identity, 'boot_id': 'other'}))
        finally:
            child.terminate()
            child.wait()

    def test_public_json_rejects_path_env_argv_and_authentication(self):
        r = self.setup_runner()
        input = {'schema': 'phone-ssh/v1', 'request_nonce': str(uuid.uuid4()), 'operation': 'inspect', 'identity': self.identity}
        self.assertEqual(r.handle(input)['receipt']['status'], 'unknown')
        for key in ('path', 'env', 'argv', 'authenticated', 'endpoint'):
            with self.assertRaises(ValueError):
                r.handle({**input, key: '/tmp/evil'})
        with self.assertRaises(ValueError):
            r.handle({**input, 'identity': {**self.identity, 'path': '/tmp/evil'}})

    def test_concurrent_real_process_start_single_launch(self):
        r = self.setup_runner()
        self.fake_adb(0.2)
        children = []
        for _ in range(3):
            pid = os.fork()
            if pid == 0:
                try:
                    r.start(self.identity)
                    os._exit(0)
                except Exception:
                    os._exit(1)
            children.append(pid)
        for pid in children:
            self.assertEqual(os.waitpid(pid, 0)[1], 0)
        self.assertEqual(self.finish()['status'], 'completed')
        self.assertEqual(self.launches(), 1)

    def test_worker_does_not_inherit_ssh_stdout_descriptors(self):
        r = self.setup_runner()
        self.fake_adb(0.5)
        source = ('import runner;from dataclasses import replace;'
                  + 'c=runner.Config(journal_root=' + repr(self.config.journal_root)
                  + ',lock_root=' + repr(self.config.lock_root)
                  + ',adb=' + repr(self.config.adb)
                  + ',machine_id="fixture-machine",worker_id="fixture-worker",host="fixture-host",'
                  + 'drain_path=' + repr(self.config.drain_path)
                  + ',assert_resources=lambda:None);'
                  + 'print(runner.Runner(c).start(' + repr(self.identity) + '))')
        started = time.monotonic()
        reply = subprocess.run([sys.executable, '-B', '-c', source], capture_output=True, timeout=2)
        self.assertEqual(reply.returncode, 0, reply.stderr)
        self.assertLess(time.monotonic() - started, 0.45)
        self.assertEqual(self.finish()['status'], 'completed')

    def test_symlink_journal_and_lock_guard_fail_closed(self):
        r = self.setup_runner()
        outside = self.root / 'outside'
        outside.write_text('preserve')
        root = Path(self.config.lock_root)
        root.mkdir(parents=True)
        (root / 'fixture-serial.guard').symlink_to(outside)
        r.start(self.identity)
        self.assertEqual(self.finish()['status'], 'failed')
        self.assertEqual(outside.read_text(), 'preserve')
        self.assertEqual(self.launches(), 0)

    def test_pending_intent_is_counted_and_broken_journal_denies_maintenance(self):
        r = self.setup_runner(fault=lambda stage: (_ for _ in ()).throw(RuntimeError('fault')))
        with self.assertRaises(RuntimeError):
            r.start(self.identity)
        self.assertEqual(r.maintenance()['pending'], 1)
        path = next(Path(self.config.journal_root).glob('*/state.json'))
        path.write_text('{partial')
        with self.assertRaises(ValueError):
            r.maintenance()


if __name__ == '__main__':
    unittest.main()
