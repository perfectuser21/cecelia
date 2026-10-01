import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
