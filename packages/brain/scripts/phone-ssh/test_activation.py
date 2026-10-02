"""C3永久真实私有文件/进程回归；不操作生产配置或设备。"""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

import activation
import probe
from process_identity import boot_id

BASE = Path(__file__).resolve().parent
PHYSICAL = ('runner.py', 'worker.py', 'journal.py', 'phone_lease.py', 'process_identity.py',
         'adb_socket.py', 'probe.py', 'drain_marker.py', 'http_physical.py', 'admission.py', 'activation.py', 'permit.py')
STATIC = tuple(dict.fromkeys((*PHYSICAL, 'activation.py')))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def stamp(delta):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta)).isoformat().replace('+00:00', 'Z')


class ActivationTest(unittest.TestCase):
    def setUp(self):
        # /tmp的共享可写祖先不冒充生产受信路径；fixture位于真实私有home下。
        self.temp = tempfile.TemporaryDirectory(prefix='.phone-activation-test-', dir=Path.home().resolve())
        self.root = Path(self.temp.name).resolve()
        self.install = self.root / 'install'; self.install.mkdir(mode=0o700)
        self.source = self.root / 'source'; self.source.mkdir(mode=0o700)
        for name in STATIC:
            self.write(self.source / name, (BASE / name).read_bytes())
        self.worker = {'machine_id': 'm1', 'worker_id': 'phone-m1', 'host': 'xian-m1'}
        self.hashes = {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest() for name in STATIC}
        self.probe = {'schema': 1, **self.worker, 'source_hashes': {n: self.hashes[n] for n in PHYSICAL}}
        self.hub = {'http_endpoint': 'http://100.79.41.61:3459/', 'hub_id': 'mmv-phone',
                    'hub_boot_id': 'hub-boot', 'hub_config_digest': 'a' * 64, 'hub_build_digest': 'b' * 64}
        self.manifest = {'schema': 1, 'worker_identity': self.worker, 'hub': self.hub, 'source_hashes': self.hashes}
        self.identity = {name: str(uuid.uuid4()) for name in (
            'dispatch_id', 'reservation_id', 'task_id', 'execution_version_id', 'execution_grant_id', 'lease_token', 'execution_id')}
        self.identity.update(self.worker, worker_boot_id=boot_id(), serial='e6c7ef34', profile='fixed-white',
                             account_id='fixed-account', action='adb_get_state', config_digest='c' * 64)
        self.physical = {'machine_id': self.worker['machine_id'], 'worker_id': self.worker['worker_id'],
                         'physical_boot_id': self.identity['worker_boot_id'], 'build_digest': digest(self.probe['source_hashes']),
                         'action_digest': self.hashes['adb_socket.py'],
                         'config_digest': digest({'manifest': self.probe, 'worker_identity': self.worker,
                                                  'actual_hashes': self.probe['source_hashes']})}
        self.record = {'schema': 'phone-activation/v1', 'identity': self.identity,
                       'phone_hub': {**self.hub, 'physical': self.physical},
                       'activation_manifest_digest': hashlib.sha256(self.bytes(self.manifest)).hexdigest(),
                       'activation_build_digest': digest(self.hashes),
                       'issued_at': stamp(-10), 'expires_at': stamp(60), 'grant_expires_at': stamp(120)}
        for name, value in [('worker.json', self.worker), ('probe.json', self.probe),
                            ('activation-manifest.json', self.manifest), ('activation.json', self.record)]:
            self.write(self.install / name, self.bytes(value))
        self.patches = [patch.object(activation, '_INSTALL_ROOT', self.install),
                        patch.object(activation, '_SOURCE_ROOT', self.source)]
        for item in self.patches: item.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    @staticmethod
    def bytes(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()

    @staticmethod
    def write(path, value):
        path.write_bytes(value); path.chmod(0o600)

    def store(self, record=None): self.write(self.install / 'activation.json', self.bytes(record or self.record))

    def denied(self):
        with self.assertRaises((ValueError, OSError)):
            activation.validate_activation(copy.deepcopy(self.identity))

    def test_current_physical_probe_and_activation_static_manifest_agree(self):
        self.assertEqual(tuple(probe.SOURCE_FILES), PHYSICAL)
        self.assertEqual(len(self.hashes), 12)
        installed = probe.installed_identity(manifest_path=self.install / 'probe.json',
                                            config_path=self.install / 'worker.json', source_root=self.source)
        for field in self.physical: self.assertEqual(installed[field], self.physical[field])
        activation.validate_activation(self.identity)

    def test_legacy_eight_physical_nine_activation_record_cannot_be_upgraded_implicitly(self):
        legacy_hashes = {name: value for name, value in self.hashes.items() if name not in ('http_physical.py', 'admission.py', 'permit.py')}
        legacy_manifest = {**self.manifest, 'source_hashes': legacy_hashes}
        legacy_probe = {**self.probe, 'source_hashes': {name: value for name, value in self.probe['source_hashes'].items()
                                                      if name not in ('http_physical.py', 'admission.py', 'activation.py', 'permit.py')}}
        self.write(self.install / 'activation-manifest.json', self.bytes(legacy_manifest))
        self.write(self.install / 'probe.json', self.bytes(legacy_probe))
        legacy_physical = {**self.physical, 'build_digest': digest(legacy_probe['source_hashes']),
                           'config_digest': digest({'manifest': legacy_probe, 'worker_identity': self.worker,
                                                    'actual_hashes': legacy_probe['source_hashes']})}
        self.store({**self.record, 'activation_manifest_digest': hashlib.sha256(self.bytes(legacy_manifest)).hexdigest(),
                    'activation_build_digest': digest(legacy_hashes),
                    'phone_hub': {**self.hub, 'physical': legacy_physical}})
        self.denied()

    def test_c2_nine_physical_ten_activation_pins_are_rejected(self):
        hashes = {name: value for name, value in self.hashes.items() if name not in ('admission.py', 'permit.py')}
        manifest = {**self.manifest, 'source_hashes': hashes}
        probe_record = {**self.probe, 'source_hashes': {name: value for name, value in hashes.items()
                                                      if name != 'activation.py'}}
        self.assertEqual(len(probe_record['source_hashes']), 9)
        self.assertEqual(len(hashes), 10)
        self.write(self.install / 'activation-manifest.json', self.bytes(manifest))
        self.write(self.install / 'probe.json', self.bytes(probe_record))
        physical = {**self.physical, 'build_digest': digest(probe_record['source_hashes']),
                    'config_digest': digest({'manifest': probe_record, 'worker_identity': self.worker,
                                             'actual_hashes': probe_record['source_hashes']})}
        self.store({**self.record, 'activation_manifest_digest': hashlib.sha256(self.bytes(manifest)).hexdigest(),
                    'activation_build_digest': digest(hashes), 'phone_hub': {**self.hub, 'physical': physical}})
        self.denied()
        with self.assertRaises(ValueError):
            probe.installed_identity(manifest_path=self.install / 'probe.json',
                                     config_path=self.install / 'worker.json', source_root=self.source)

    def test_valid_longer_than_five_second_window_is_immutable_and_read_only(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with patch('os.fork', side_effect=AssertionError('must not fork')), \
             patch('subprocess.Popen', side_effect=AssertionError('must not launch')):
            # boot query is pure existing OS fact; inject already observed fact to isolate no-action check.
            with patch.object(activation, '_boot_id', return_value=self.identity['worker_boot_id']):
                value = activation.validate_activation(copy.deepcopy(self.identity))
        self.assertEqual(value['identity']['dispatch_id'], self.identity['dispatch_id'])
        with self.assertRaises(TypeError): value['identity']['action'] = 'harvest'
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_every_identity_field_is_bound(self):
        for field in self.identity:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.identity)
                changed[field] = str(uuid.uuid4()) if field.endswith('_id') or field == 'lease_token' else 'different'
                with self.assertRaises(ValueError): activation.validate_activation(changed)

    def test_every_hub_physical_and_activation_digest_is_bound(self):
        for section, fields in [('hub', self.hub), ('physical', self.physical),
                                ('record', ['activation_manifest_digest', 'activation_build_digest'])]:
            for field in fields:
                with self.subTest(section=section, field=field):
                    value = copy.deepcopy(self.record)
                    target = value if section == 'record' else value['phone_hub'] if section == 'hub' else value['phone_hub']['physical']
                    target[field] = 'd' * 64 if 'digest' in field else 'different'
                    self.store(value); self.denied()
        self.store()

    def test_timestamps_are_strict_utc_not_ttl_and_cannot_exceed_grant(self):
        cases = [dict(issued_at=stamp(10)), dict(expires_at=stamp(-1)),
                 dict(grant_expires_at=stamp(20)), dict(issued_at='2026-10-02T00:00:00'),
                 dict(issued_at='2026-10-02T00:00:00+00:00'), dict(issued_at='2026-02-30T00:00:00Z'),
                 dict(issued_at='2026-10-02T00:00:00.1234567Z'), dict(issued_at='2026-10-02t00:00:00z')]
        for changes in cases:
            with self.subTest(changes=changes):
                self.store({**self.record, **changes}); self.denied()
        self.store(); activation.validate_activation(self.identity)

    def test_expiry_is_rechecked_after_final_file_verification(self):
        self.store({**self.record, 'expires_at': stamp(0.2)})
        original = activation._TrustedReads.verify
        def slow(reads):
            time.sleep(0.25)
            return original(reads)
        with patch.object(activation._TrustedReads, 'verify', slow): self.denied()

    def test_missing_permissions_hardlink_and_symlink_fail_closed(self):
        record = self.install / 'activation.json'
        record.unlink(); self.denied(); self.store()
        record.chmod(0o644); self.denied(); record.chmod(0o600)
        linked = self.install / 'alias'; os.link(record, linked); self.denied(); linked.unlink()
        original = record.read_bytes(); record.unlink(); record.symlink_to(self.install / 'worker.json')
        self.denied(); record.unlink(); self.write(record, original)
        with patch.object(activation, '_SERVICE_UID', os.getuid() + 1): self.denied()
        self.install.chmod(0o777); self.denied(); self.install.chmod(0o700)
        alias = self.root / 'install-alias'; alias.symlink_to(self.install, target_is_directory=True)
        with patch.object(activation, '_INSTALL_ROOT', alias): self.denied()

    def test_fifo_config_cannot_block_before_regular_file_rejection(self):
        path = self.install / 'activation.json'; path.unlink(); os.mkfifo(path, 0o600)
        code = ('import activation,sys,json;from pathlib import Path;'
                'activation._INSTALL_ROOT=Path(sys.argv[1]);activation._SOURCE_ROOT=Path(sys.argv[2]);'
                'activation.validate_activation(json.loads(sys.argv[3]))')
        try:
            p = subprocess.run([sys.executable, '-B', '-c', code, str(self.install), str(self.source),
                                json.dumps(self.identity)], cwd=BASE, capture_output=True, timeout=1)
        except subprocess.TimeoutExpired:
            self.fail('FIFO配置读取必须立即拒绝，不能阻塞等待writer')
        self.assertNotEqual(p.returncode, 0)

    def test_all_source_files_and_static_manifest_are_pinned(self):
        for name in STATIC:
            with self.subTest(name=name):
                p = self.source / name; original = p.read_bytes()
                self.write(p, original + b'\n# mutation\n'); self.denied(); self.write(p, original)
        value = copy.deepcopy(self.manifest); value['source_hashes']['activation.json'] = 'e' * 64
        self.write(self.install / 'activation-manifest.json', self.bytes(value)); self.denied()

    def test_duplicate_keys_unknown_fields_and_authority_bools_refused(self):
        for raw in [b'{"schema":1,"schema":1}', self.bytes({**self.record, 'verified': True}),
                    self.bytes({**self.record, 'token': 'claimed-token'})]:
            self.write(self.install / 'activation.json', raw); self.denied()
        self.store()
        for field in ('verified', 'token', 'worker', 'adb', 'config_path'):
            with self.assertRaises(ValueError): activation.validate_activation({**self.identity, field: True})

    def test_real_writer_replaces_file_or_parent_before_final_inode_check(self):
        for replace_parent in (False, True):
            with self.subTest(replace_parent=replace_parent):
                go_read, go_write = os.pipe(); done_read, done_write = os.pipe()
                child = os.fork()
                if child == 0:
                    try:
                        os.close(go_write); os.close(done_read); os.read(go_read, 1)
                        if replace_parent:
                            replacement = self.root / 'replacement'
                            shutil.copytree(self.install, replacement)
                            self.install.rename(self.root / 'old-install')
                            replacement.rename(self.install)
                        else:
                            p = self.install / 'activation.json'
                            new = self.install / 'replacement.json'
                            self.write(new, p.read_bytes()); os.replace(new, p)
                        os.write(done_write, b'D'); os._exit(0)
                    except BaseException: os._exit(1)
                os.close(go_read); os.close(done_write)
                original = activation._TrustedReads.verify
                def raced(reads):
                    os.write(go_write, b'G')
                    self.assertEqual(os.read(done_read, 1), b'D')
                    return original(reads)
                try:
                    with patch.object(activation._TrustedReads, 'verify', raced): self.denied()
                finally:
                    os.close(go_write); os.close(done_read)
                    _, status = os.waitpid(child, 0); self.assertEqual(status, 0)

    def test_real_process_cli_cannot_choose_authority_via_stdin_env_or_argv(self):
        env = {**os.environ, 'PHONE_ACTIVATION_PATH': str(self.install / 'activation.json'),
               'PHONE_WORKER_ID': self.worker['worker_id'], 'PHONE_VERIFIED': 'true',
               'DOUYIN_PHONE_TMP_ROOT': str(self.root), 'ADB': '/bin/echo'}
        requests = [self.identity, {**self.identity, 'verified': True, 'config_path': str(self.install)},
                    {**self.identity, 'token': 'authority'}, {'action': 'harvest'}]
        for request in requests:
            with self.subTest(request=request):
                p = subprocess.run([sys.executable, '-B', str(BASE / 'activation.py')],
                                   input=self.bytes(request), capture_output=True, env=env, timeout=3)
                self.assertNotEqual(p.returncode, 0); self.assertEqual(p.stdout, b'')
        p = subprocess.run([sys.executable, '-B', str(BASE / 'activation.py'), '--config', str(self.install)],
                           input=self.bytes(self.identity), capture_output=True, env=env, timeout=3)
        self.assertNotEqual(p.returncode, 0); self.assertEqual(p.stdout, b'')


if __name__ == '__main__': unittest.main()
