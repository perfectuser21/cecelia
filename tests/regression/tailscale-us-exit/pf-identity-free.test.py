import importlib.util
import os
import sys
import unittest
from pathlib import Path

OPS = Path(__file__).resolve().parents[3] / "scripts" / "ops"
sys.path.insert(0, str(OPS))
spec = importlib.util.spec_from_file_location("enforcer", OPS / "tailscale-us-exit-enforcer.py")
enforcer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enforcer)

class IdentityFreeRegression(unittest.TestCase):
    def test_explicit_safe_mode_never_enters_pf_socket_identity_lookup(self):
        os.environ.update(CECELIA_US_EXIT_FIREWALL_MODE="interface-v2",
                          CECELIA_US_EXIT_TARGET_UID="501",
                          CECELIA_US_EXIT_ALLOW_UNPRIVILEGED_FIREWALL="true")
        rules = enforcer.FailClosedFirewall().rules(False)
        # Darwin pf_test_rule uid/gid -> pf_socket_lookup -> global TCP PCB lock.
        self.assertNotRegex(rules, r"\b(user|group)\b|log\s*\([^)]*user")
        self.assertIn("block drop out quick", rules)

if __name__ == "__main__":
    unittest.main()
