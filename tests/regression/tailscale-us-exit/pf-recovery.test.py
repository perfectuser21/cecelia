import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import json
import hashlib
import io
from contextlib import ExitStack, redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

OPS = Path(__file__).resolve().parents[3] / "scripts" / "ops"
sys.path.insert(0, str(OPS))


class InstallerRecoveryTests(unittest.TestCase):
    def test_isolated_rollback_watchdog_entry_has_no_installed_helper_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rollback = root / "rollback.py"
            shutil.copy2(OPS / "tailscale_us_exit_activation.py", rollback)
            result = subprocess.run([sys.executable, "-I", str(rollback), "watchdog",
                "--transaction", str(root / "missing")], text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn("ModuleNotFoundError", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertIn("No such file or directory", result.stderr)

    def test_real_installer_uses_current_root_transaction_guard_not_user_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            for module in OPS.glob("tailscale_us_exit_*.py"):
                shutil.copy2(module, source / module.name)
            (source / "tailscale_us_exit_activation.py").write_text("# authenticated transaction boundary fixture\n")
            (source / "tailscale-us-exit-enforcer.py").write_text("# allowed client identity boundary fixture\n")
            transaction = root / "transaction"
            transaction.mkdir()
            home = root / "home"
            home.mkdir()
            sudo = root / "sudo"
            sudo.write_text('#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nif a[0].endswith("install"):\n for option in ("-o","-g"):\n  if option in a:\n   i=a.index(option);del a[i:i+2]\nos.execv(a[0],a)\n')
            sudo.chmod(0o755)
            plutil = root / "plutil"
            plutil.write_text('#!/usr/bin/env python3\nimport plistlib,sys\nplistlib.load(open(sys.argv[-1],"rb"))\n')
            plutil.chmod(0o755)
            installer = source / "install.sh"
            installer.write_text((OPS / "install-tailscale-us-exit-enforcer.sh").read_text()
                .replace("/usr/bin/python3", sys.executable).replace("/usr/bin/plutil", str(plutil)))
            plist_dir = root / "system-plists"
            environment = dict(os.environ, CECELIA_US_EXIT_ACTIVATION_TRANSACTION=str(transaction),
                CECELIA_US_EXIT_USER="fixture", CECELIA_US_EXIT_UID="501", CECELIA_SUDO_BIN=str(sudo))
            result = subprocess.run(["bash", str(installer), "--home", str(home), "--no-load",
                "--firewall-mode", "interface-v2", "--system-plist-dir", str(plist_dir),
                "--system-libexec-dir", str(root / "libexec"), "--system-state-dir", str(root / "state"),
                "--system-log-dir", str(root / "logs")], env=environment,
                text=True, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            guard = plist_dir / "com.cecelia.tailscale-us-exit.lease.plist"
            staged = transaction / guard.name
            self.assertEqual(guard.read_bytes(), staged.read_bytes())
            self.assertTrue(plistlib.loads(guard.read_bytes())["KeepAlive"])
            self.assertFalse((home / ".config").exists())


class NetworkRecoveryTests(unittest.TestCase):
    def invoke_confirm(self, root, state, evidence, verify=None, command=None, adb=None):
        import tailscale_us_exit_activation as activation
        evidence_file = root / "evidence.json"
        evidence_file.write_text(json.dumps(evidence))
        with ExitStack() as stack:
            stack.enter_context(patch.object(activation, "read_transaction", return_value=(root, state)))
            stack.enter_context(patch.object(activation, "verify_transaction", side_effect=verify or (lambda _: (root, state))))
            stack.enter_context(patch.object(activation, "verify_adb", side_effect=adb or (lambda home, serials=None: sorted(serials if serials is not None else activation.ADB_SERIALS))))
            stack.enter_context(patch.object(activation, "command", side_effect=command or (lambda _: 'label "cecelia-us-exit-v2"\nblock drop out quick proto { tcp udp } all')))
            stack.enter_context(patch.dict(os.environ, SSH_CONNECTION="100.71.151.105 123 100.86.57.69 22"))
            stack.enter_context(patch("tailscale_us_exit_lease.guard_alive", return_value=True))
            stack.enter_context(patch("tailscale_us_exit_lease.valid_lease", return_value=True))
            stack.enter_context(patch("tailscale_us_exit_policy.read_map_cache", return_value={}))
            stack.enter_context(patch("tailscale_us_exit_recovery.read_root_file", side_effect=lambda p: p.read_bytes()))
            output = io.StringIO()
            with redirect_stdout(output):
                activation.confirm(SimpleNamespace(transaction=str(root), evidence=str(evidence_file)))
            return json.loads(output.getvalue()), json.loads((root / "transaction.json").read_text())

    def fixture(self, root, online=()):
        import tailscale_us_exit_activation as activation
        import time
        now = time.time()
        baseline = {"target_serials": sorted(activation.ADB_SERIALS), "online_verified": sorted(online),
            "offline": sorted(activation.ADB_SERIALS-set(online)), "candidate_sha256": "a"*64,
            "device_states": {serial: "device" if serial in online else "absent" for serial in activation.ADB_SERIALS},
            "target_home": str(root), "actor": "approved-root", "observed_at": now}
        raw = json.dumps(baseline).encode()
        (root / "phone-baseline.json").write_bytes(raw)
        state = {"status": "armed", "deadline": now+180, "armed_at": now,
            "confirmation_scope": "network-recovery", "baseline_sha256": hashlib.sha256(raw).hexdigest(),
            "candidate_sha256": "a"*64, "target_home": str(root), "approval_actor": "approved-root",
            "rollback_label": "watchdog"}
        evidence = {"observer_ssh_ip": "100.71.151.105", "candidate_sha256": "a"*64,
            "observed_at": now, "us_exit_verified": True, "actor": "observer",
            "adb_serials_verified": sorted(online)}
        return state, evidence

    def test_offline_baseline_allows_network_only_confirmation_and_reports_outstanding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, evidence = self.fixture(root)
            output, saved = self.invoke_confirm(root, state, evidence)
            self.assertEqual(saved["status"], "confirmed")
            self.assertEqual(saved["confirmation_mode"], "network-only")
            self.assertEqual(set(output["phones_outstanding"]), {"ANGYVB4227006983", "ANGYVB4402004137"})
            self.assertFalse(output["task_completed"])

    def test_confirmation_final_pf_read_crossing_deadline_cannot_cancel_rollback(self):
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, evidence = self.fixture(root, activation.ADB_SERIALS)
            state["confirmation_scope"] = "all-phones"
            clock = [1000]
            state["deadline"] = 1005
            def verify(_):
                if clock[0] >= state["deadline"]:
                    raise RuntimeError("deadline expired")
                return root, state
            def command(args):
                if args[0] == "/sbin/pfctl":
                    clock[0] = 1010
                return "block drop out quick proto { tcp udp } all"
            with self.assertRaisesRegex(RuntimeError, "deadline"):
                self.invoke_confirm(root, state, evidence, verify, command)
            self.assertEqual(state["status"], "armed")

    def test_baseline_capture_requires_known_adb_output_and_live_shell_for_device(self):
        import tailscale_us_exit_recovery as recovery
        import tailscale_us_exit_activation as activation
        api = SimpleNamespace(ADB_SERIALS=activation.ADB_SERIALS, adb_prefix=lambda _: ["adb"])
        for output in ("", "unknown daemon output", "List of devices attached\nANGYVB4227006983 unknown\n"):
            api.command = lambda _, text=output: text
            api.verify_adb = lambda *args, **kwargs: []
            with self.assertRaises(RuntimeError):
                recovery.capture_baseline(api, "/target", "a"*64, "root")
        api.command = lambda _: "List of devices attached\nANGYVB4227006983 device\n"
        api.verify_adb = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("shell failed"))
        with self.assertRaisesRegex(RuntimeError, "shell"):
            recovery.capture_baseline(api, "/target", "a"*64, "root")
        api.command = lambda _: (_ for _ in ()).throw(RuntimeError("adb failed"))
        with self.assertRaisesRegex(RuntimeError, "adb"):
            recovery.capture_baseline(api, "/target", "a"*64, "root")

    def test_immutable_baseline_rejects_candidate_home_serial_actor_age_and_digest_changes(self):
        import tailscale_us_exit_recovery as recovery
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, _ = self.fixture(root)
            raw = (root / "phone-baseline.json").read_bytes()
            with patch.object(recovery, "read_root_file", return_value=raw):
                recovery.load_baseline(root, state, activation.ADB_SERIALS)
                for key, value in (("candidate_sha256", "b"*64), ("target_home", "/elsewhere"),
                                   ("approval_actor", "other"), ("armed_at", state["armed_at"]+121),
                                   ("baseline_sha256", "b"*64)):
                    with self.assertRaisesRegex(RuntimeError, "baseline"):
                        recovery.load_baseline(root, dict(state, **{key: value}), activation.ADB_SERIALS)
            changed = json.loads(raw)
            changed["target_serials"] = []
            bad = json.dumps(changed).encode()
            with patch.object(recovery, "read_root_file", return_value=bad):
                with self.assertRaisesRegex(RuntimeError, "baseline"):
                    recovery.load_baseline(root, dict(state, baseline_sha256=hashlib.sha256(bad).hexdigest()), activation.ADB_SERIALS)

    def test_network_recovery_cannot_hide_regression_of_previously_online_phone(self):
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, evidence = self.fixture(root, ["ANGYVB4227006983"])
            def fail(home, serials=None):
                self.assertEqual(set(serials), {"ANGYVB4227006983"})
                raise RuntimeError("online phone regressed")
            with self.assertRaisesRegex(RuntimeError, "online phone regressed"):
                self.invoke_confirm(root, state, evidence, adb=fail)
            self.assertEqual(state["status"], "armed")

    def test_default_confirmation_still_rejects_offline_phones(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, evidence = self.fixture(root)
            state.pop("confirmation_scope")
            with self.assertRaises(RuntimeError):
                self.invoke_confirm(root, state, evidence)
            self.assertEqual(state["status"], "armed")

    def test_real_empty_listing_and_online_shell_results_are_the_only_baseline_source(self):
        import tailscale_us_exit_recovery as recovery
        import tailscale_us_exit_activation as activation
        calls = []
        api = SimpleNamespace(ADB_SERIALS=activation.ADB_SERIALS, adb_prefix=lambda _: ["adb"],
            command=lambda _: "List of devices attached\n",
            verify_adb=lambda home, serials: calls.append(serials) or list(serials))
        baseline = recovery.capture_baseline(api, "/target", "a"*64, "root")
        self.assertEqual(baseline["online_verified"], [])
        self.assertEqual(set(baseline["offline"]), activation.ADB_SERIALS)
        self.assertEqual(calls, [[]])
        api.command = lambda _: "List of devices attached\nANGYVB4227006983 device product:fixture transport_id:1\n"
        baseline = recovery.capture_baseline(api, "/target", "a"*64, "root")
        self.assertEqual(baseline["online_verified"], ["ANGYVB4227006983"])
        self.assertEqual(baseline["offline"], ["ANGYVB4402004137"])

    def test_baseline_file_symlink_nonroot_or_public_permissions_are_rejected(self):
        import tailscale_us_exit_recovery as recovery
        import stat
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "baseline"
            file.write_bytes(b"{}")
            link = file.with_name("symlink")
            link.symlink_to(file)
            with self.assertRaises(RuntimeError):
                recovery.read_root_file(link)
            for uid, mode in ((501, 0o600), (0, 0o644)):
                with patch.object(recovery.os, "fstat", return_value=SimpleNamespace(st_uid=uid, st_mode=stat.S_IFREG|mode)):
                    with self.assertRaises(RuntimeError):
                        recovery.read_root_file(file)

    def test_slow_baseline_collection_cannot_retimestamp_old_phone_evidence_as_fresh(self):
        import tailscale_us_exit_recovery as recovery
        import tailscale_us_exit_activation as activation
        clock = [1000]
        def devices(_):
            clock[0] = 1130
            return "List of devices attached\n"
        api = SimpleNamespace(ADB_SERIALS=activation.ADB_SERIALS, adb_prefix=lambda _: ["adb"],
            command=devices, verify_adb=lambda home, serials: [])
        with patch.object(recovery.time, "time", side_effect=lambda: clock[0]):
            baseline = recovery.capture_baseline(api, "/target", "a"*64, "root")
        self.assertEqual(baseline["observed_at"], 1000)
        raw = json.dumps(baseline).encode()
        state = {"baseline_sha256": hashlib.sha256(raw).hexdigest(), "candidate_sha256": "a"*64,
            "target_home": "/target", "approval_actor": "root", "armed_at": 1130}
        with patch.object(recovery, "read_root_file", return_value=raw):
            with self.assertRaisesRegex(RuntimeError, "baseline"):
                    recovery.load_baseline(Path("/tmp"), state, activation.ADB_SERIALS)

    def test_preserved_baseline_distinguishes_absent_offline_unauthorized_and_verified_device(self):
        import tailscale_us_exit_recovery as recovery
        import tailscale_us_exit_activation as activation
        api = SimpleNamespace(ADB_SERIALS=activation.ADB_SERIALS, adb_prefix=lambda _: ["adb"],
            verify_adb=lambda home, serials: list(serials))
        for status in ("offline", "unauthorized", "device"):
            api.command = lambda _, value=status: "List of devices attached\nANGYVB4227006983 " + value + "\n"
            baseline = recovery.capture_baseline(api, "/target", "a"*64, "root")
            self.assertEqual(baseline["device_states"], {"ANGYVB4227006983": status, "ANGYVB4402004137": "absent"})


if __name__ == "__main__":
    unittest.main()
