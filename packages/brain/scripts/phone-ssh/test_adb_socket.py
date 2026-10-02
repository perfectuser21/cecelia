"""真实本机socket协议回归：分片、失败、EOF、长度与整轮限时。"""
import importlib
import json
import os
from pathlib import Path
import socket
import tempfile
import time
import unittest
from unittest.mock import patch
from adb_socket_fixture import SocketFixture


class AdbSocketTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.fixture = SocketFixture(self.root, self.root / 'requests')

    def tearDown(self):
        self.fixture.close()
        self.tmp.cleanup()

    def query(self, **options):
        try:
            module = importlib.import_module('adb_socket')
        except ImportError:
            self.fail('固定host-serial socket客户端尚未实现')
        return module.get_state('fixture-serial', _port=self.fixture.port, **options)

    def test_fragmented_okay_length_and_body(self):
        self.fixture.set(fragment=1, fragment_delay=0.003)
        self.assertEqual(self.query(timeout_sec=0.5), 'device')
        self.assertIsNone(self.fixture.child.poll())

    def test_fail_body_is_not_exposed_and_daemon_stays_alive(self):
        self.fixture.set(wire=b'FAIL0011private diagnostic'.hex())
        with self.assertRaisesRegex(ValueError, '^phone_adb_server_fail$'):
            self.query(timeout_sec=0.5)
        self.assertIsNone(self.fixture.child.poll())

    def test_early_eof_prefix_length_body(self):
        for wire in (b'', b'OK', b'OKAY00', b'OKAY0006dev'):
            with self.subTest(wire=wire):
                self.fixture.set(wire=wire.hex())
                with self.assertRaisesRegex(ValueError, '^phone_adb_server_eof$'):
                    self.query(timeout_sec=0.5)

    def test_oversized_invalid_zero_length_and_status(self):
        for wire in (b'OKAYffff', b'OKAYZZZZ', b'OKAY0000', b'WUT?'):
            with self.subTest(wire=wire):
                self.fixture.set(wire=wire.hex())
                with self.assertRaisesRegex(ValueError, '^phone_adb_server_protocol$'):
                    self.query(timeout_sec=0.5)

    def test_timeout_bounds_entire_fragmented_round(self):
        self.fixture.set(fragment=1, fragment_delay=0.04)
        started = time.monotonic()
        with self.assertRaisesRegex(ValueError, '^phone_adb_server_timeout$'):
            self.query(timeout_sec=0.15)
        self.assertLess(time.monotonic() - started, 0.4)
        self.assertIsNone(self.fixture.child.poll())

    def test_extra_bytes_and_no_orderly_close_not_success(self):
        self.fixture.set(wire=b'OKAY0006deviceextra'.hex())
        with self.assertRaisesRegex(ValueError, '^phone_adb_server_protocol$'):
            self.query(timeout_sec=0.5)
        self.fixture.set(hold=1)
        with self.assertRaisesRegex(ValueError, '^phone_adb_server_timeout$'):
            self.query(timeout_sec=0.15)

    def test_production_config_has_no_socket_or_execution_override(self):
        runner = importlib.import_module('runner')
        path = self.root / 'worker.json'
        base = {'machine_id': 'fixture-machine', 'worker_id': 'fixture-worker', 'host': 'fixture-host'}
        def fixed_config_fd(requested, flags):
            self.assertEqual(requested, '/etc/cecelia/phone-ssh/worker.json')
            return os.open(path, flags)
        path.write_text(json.dumps(base))
        with patch('runner.safe_open', fixed_config_fd), patch.dict(os.environ, {'ADB_SERVER_SOCKET': 'tcp:attacker:5555'}):
            config = runner.production_config()
            self.assertEqual(config.adb_server_port, 5037)
            self.assertIs(config.assert_resources, runner.denied_resources)
        for key in ('adb_server_port', 'adb', 'assert_resources', 'host_server_socket'):
            path.write_text(json.dumps({**base, key: 'attacker'}))
            with patch('runner.safe_open', fixed_config_fd):
                with self.assertRaises(ValueError):
                    runner.production_config()

    def test_unavailable_daemon_not_started(self):
        with socket.socket() as unused:
            unused.bind(('127.0.0.1', 0))
            port = unused.getsockname()[1]
        try:
            module = importlib.import_module('adb_socket')
        except ImportError:
            self.fail('固定host-serial socket客户端尚未实现')
        with self.assertRaisesRegex(ValueError, '^phone_adb_server_unavailable$'):
            module.get_state('fixture-serial', _port=port, timeout_sec=0.2)


if __name__ == '__main__':
    unittest.main()
