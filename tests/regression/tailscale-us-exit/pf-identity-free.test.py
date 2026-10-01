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


class InterfacePolicyTests(unittest.TestCase):
    def setUp(self):
        import tailscale_us_exit_policy as policy
        self.policy = policy
        self.now = 1000
        self.snapshot = {
            "observed_at": 1000,
            "status": {"BackendState": "Running", "Self": {
                "ID": "self-m4", "Online": True,
                "TailscaleIPs": ["100.86.57.69", "fd7a:115c:a1e0::1234"]},
                "ExitNodeStatus": {"ID": "n6kr9EqWwN11CNTRL", "Online": True},
                "Peer": {"primary": {"ID": "n6kr9EqWwN11CNTRL", "Online": True,
                    "ExitNodeOption": True, "DNSName": "mac-mini-m4-us.tailce7a8b.ts.net.",
                    "CurAddr": "38.23.47.81:54192"},
                    "secondary": {"ID": "nWC4TTvpLA11CNTRL", "Online": True,
                    "ExitNodeOption": True, "DNSName": "vps-us.tailce7a8b.ts.net.",
                    "CurAddr": "134.199.234.147:41641"}}},
            "prefs": {"ExitNodeID": "n6kr9EqWwN11CNTRL", "WantRunning": True,
                      "ExitNodeAllowLANAccess": True, "CorpDNS": True},
            "routes": {"4": "utun42", "6": "utun43", "100.86.57.69": "utun42",
                       "fd7a:115c:a1e0::1234": "utun43"},
            "interfaces": {"utun42": "inet 100.86.57.69 --> 100.86.57.69 netmask 0xffffffff",
                           "utun43": "inet6 fd7a:115c:a1e0::1234 prefixlen 48"},
        }
        self.derp = {"Regions": {"1": {"Nodes": [
            {"HostName": "derp1.tailscale.com", "IPv4": "192.0.2.55",
             "IPv6": "2001:db8::55", "STUNPort": 3478} ]}}}

    def rules(self, snapshot=None):
        return self.policy.generate_rules(snapshot or self.snapshot, self.derp,
            allowed_self_ips={"100.86.57.69"}, now=self.now)

    def test_healthy_dual_stack_authorizes_only_verified_family_interfaces(self):
        rules = self.rules()
        self.assertIn("on utun42 inet proto tcp from any to any flags any no state", rules)
        self.assertIn("on utun43 inet6 proto udp from any to any no state", rules)
        self.assertNotIn("on utun43 inet proto", rules)
        self.assertNotRegex(rules, r"\b(user|group)\b|log\s*\([^)]*user")
        self.assertTrue(rules.endswith("block drop out quick all\n"))
        self.assertIn("pass out quick on lo0 all no state", rules)

    def test_failures_remove_business_pass_but_keep_control_and_derp(self):
        import copy
        mutations = [
            lambda s: s.update(observed_at=900),
            lambda s: s["status"].update(BackendState="Stopped"),
            lambda s: s["status"]["Self"].update(Online=False),
            lambda s: s["status"]["ExitNodeStatus"].update(Online=False),
            lambda s: s["status"]["ExitNodeStatus"].update(ID="hong-kong"),
            lambda s: s["prefs"].update(ExitNodeID="hong-kong"),
            lambda s: s["interfaces"].update(utun42="inet 100.99.99.99 netmask 0xffffffff"),
            lambda s: s["status"]["Peer"]["primary"].update(DNSName="spoofed.ts.net"),
            lambda s: s["routes"].update({"4": "en0"}),
        ]
        for mutation in mutations:
            snapshot = copy.deepcopy(self.snapshot)
            mutation(snapshot)
            with self.subTest(mutation=mutation):
                rules = self.rules(snapshot)
                self.assertNotIn("from any to any flags any", rules)
                self.assertNotRegex(rules, r"on utun\d+ .* from any to any")
                self.assertIn("to 192.200.0.0/24 port 443", rules)
                self.assertIn("to 192.0.2.55 port 3478", rules)

    def test_ipv6_route_failure_only_removes_ipv6_public_permission(self):
        self.snapshot["routes"]["6"] = "en0"
        rules = self.rules()
        self.assertIn("on utun42 inet proto tcp from any to any", rules)
        self.assertNotIn("on utun43 inet6 proto", rules)

    def test_peer_endpoints_are_exact_tuples_without_cartesian_product(self):
        rules = self.rules()
        self.assertIn("proto udp from any to 38.23.47.81 port 54192 no state", rules)
        self.assertIn("proto udp from any to 134.199.234.147 port 41641 no state", rules)
        self.assertNotIn("to 38.23.47.81 port 41641", rules)
        self.assertNotIn("to 134.199.234.147 port 54192", rules)
        self.snapshot["status"]["Peer"]["primary"]["CurAddr"] = "38.23.47.81:0"
        self.assertNotIn("to 38.23.47.81 port", self.rules())

    def test_invalid_derp_hostname_and_ports_never_widen_bootstrap(self):
        self.derp["Regions"]["1"]["Nodes"][0]["HostName"] = "tailscale.com.attacker.net"
        rules = self.rules()
        self.assertNotIn("192.0.2.55", rules)
        self.assertNotRegex(rules, r"proto udp .* port \{")

    def test_missing_map_or_expired_status_stays_closed_without_dns(self):
        rules = self.policy.generate_rules(None, {}, allowed_self_ips={"100.86.57.69"}, now=1000)
        self.assertNotIn("on utun", rules)
        self.assertIn("2606:b740:49::/48", rules)
        self.assertNotIn("keep state", rules)
        self.assertNotIn("tailscale.com", rules)

    def test_activation_rejects_states_other_identity_rules_and_early_quick(self):
        from tailscale_us_exit_activation import validate_preflight
        good = {"root": 'anchor "com.apple/*" all',
                "com.apple": 'anchor "cecelia-us-exit" all',
                "com.apple/cecelia-us-exit": "block out user 501"}
        validate_preflight(good, "Status: Enabled\ncurrent entries 0", "")
        for anchors, info, states in [
            (good, "Status: Enabled\ncurrent entries 2", ""),
            (good, "Status: Enabled\ncurrent entries 0", "all tcp state"),
            ({**good, "other": "pass out user 501"}, "Status: Enabled\ncurrent entries 0", ""),
            ({**good, "other": "pass out quick all"}, "Status: Enabled\ncurrent entries 0", ""),
            ({**good, "other": "pass log (user) all"}, "Status: Enabled\ncurrent entries 0", ""),
        ]:
            with self.subTest(anchors=anchors, info=info):
                with self.assertRaises(RuntimeError):
                    validate_preflight(anchors, info, states)

if __name__ == "__main__":
    unittest.main()
