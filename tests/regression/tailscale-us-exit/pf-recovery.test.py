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
    def invoke_confirm(self, root, state, evidence, verify=None, command=None):
        import tailscale_us_exit_activation as activation
        evidence_file = root / "evidence.json"
        evidence_file.write_text(json.dumps(evidence))
        with ExitStack() as stack:
            stack.enter_context(patch.object(activation, "read_transaction", return_value=(root, state)))
            stack.enter_context(patch.object(activation, "verify_transaction", side_effect=verify or (lambda _: (root, state))))
            stack.enter_context(patch.object(activation, "verify_adb", side_effect=lambda home, serials=None: sorted(serials if serials is not None else activation.ADB_SERIALS)))
            stack.enter_context(patch.object(activation, "command", side_effect=command or (lambda _: 'label "cecelia-us-exit-v2"\nblock drop out quick proto { tcp udp } all')))
            stack.enter_context(patch.dict(os.environ, SSH_CONNECTION="100.71.151.105 123 100.86.57.69 22"))
            stack.enter_context(patch("tailscale_us_exit_lease.guard_alive", return_value=True))
            stack.enter_context(patch("tailscale_us_exit_lease.valid_lease", return_value=True))
            stack.enter_context(patch("tailscale_us_exit_policy.read_map_cache", return_value={}))
            stack.enter_context(patch("tailscale_us_exit_recovery.read_root_file", side_effect=lambda p: p.read_bytes(), create=True)) if "tailscale_us_exit_recovery" in sys.modules else None
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


if __name__ == "__main__":
    unittest.main()
