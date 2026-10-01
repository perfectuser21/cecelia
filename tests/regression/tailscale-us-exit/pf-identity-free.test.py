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
            "routes": {"4": "utun42", "6": "utun43", "tail4": "utun42", "tail6": "utun43", "100.86.57.69": "utun42",
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
        self.assertIn("on utun42 inet proto tcp from 100.86.57.69 to any flags any no state", rules)
        self.assertIn("on utun43 inet6 proto udp from fd7a:115c:a1e0::1234 to any no state", rules)
        self.assertNotIn("on utun43 inet proto", rules)
        self.assertNotRegex(rules, r"\b(user|group)\b|log\s*\([^)]*user")
        self.assertTrue(rules.endswith("block drop out quick proto { tcp udp } all\n"))
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
                self.assertNotRegex(rules, r"on utun\d+ .* to any")
                self.assertIn("to 192.200.0.0/24 port 443", rules)
                self.assertIn("to 192.0.2.55 port 3478", rules)

    def test_ipv6_route_failure_only_removes_ipv6_public_permission(self):
        self.snapshot["routes"]["6"] = "en0"
        rules = self.rules()
        self.assertIn("on utun42 inet proto tcp from 100.86.57.69 to any", rules)
        self.assertNotIn("on utun43 inet6 proto", rules)

    def test_native_ipv6_local_self_route_on_lo0_keeps_verified_tunnel(self):
        self.snapshot["routes"]["fd7a:115c:a1e0::1234"] = "lo0"
        self.assertIn("on utun43 inet6 proto tcp from fd7a:115c:a1e0::1234", self.rules())

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

    def test_fail_closed_keeps_fresh_exact_peer_bootstrap_without_business_pass(self):
        rules = self.policy.generate_rules(self.snapshot, self.derp,
            allowed_self_ips={"100.86.57.69"}, now=self.now, allow_tunnel=False)
        self.assertIn("to 38.23.47.81 port 54192 no state", rules)
        self.assertNotIn("on utun", rules)
        expired = self.policy.generate_rules(self.snapshot, self.derp,
            allowed_self_ips={"100.86.57.69"}, now=1020, allow_tunnel=False)
        self.assertNotIn("to 38.23.47.81 port", expired)

    def test_dhcp_recovery_is_only_physical_interface_broadcast_tuple(self):
        rules = self.policy.generate_rules(None, {}, allowed_self_ips={"100.86.57.69"},
            now=1000, lan_interfaces=["en0", "utun42", "bad interface"])
        self.assertIn("on en0 inet proto udp from 0.0.0.0 port 68 to 255.255.255.255 port 67 no state", rules)
        self.assertIn("on en0 inet proto udp from (en0) port 68 to 255.255.255.255 port 67 no state", rules)
        self.assertNotIn("on utun42", rules)

    def test_stun_only_nodes_do_not_authorize_derp_tcp(self):
        self.derp["Regions"]["1"]["Nodes"][0]["STUNOnly"] = True
        rules = self.rules()
        self.assertNotIn("to 192.0.2.55 port 443", rules)
        self.assertIn("to 192.0.2.55 port 3478", rules)

    def test_root_private_malformed_and_expired_caches_are_ignored(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache.json"
            for content in ("[]", "null", '{"observed_at": 1000, "map": []}',
                            '{"observed_at": "bad", "map": {}}'):
                cache.write_text(content)
                with patch.object(self.policy.os, "fstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o600)):
                    self.assertEqual(self.policy.read_map_cache(cache, now=1000), {})
            cache.write_text('{"observed_at": 1, "map": {"Regions": {}}}')
            with patch.object(self.policy.os, "fstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o600)):
                self.assertEqual(self.policy.read_map_cache(cache, now=100000), {})
            cache.write_text('{"observed_at": 1000, "map": {"Regions": {}}}')
            with patch.object(self.policy.os, "fstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o644)):
                self.assertEqual(self.policy.read_map_cache(cache, now=1000), {})

    def test_activation_rejects_states_other_identity_rules_and_early_quick(self):
        from tailscale_us_exit_activation import validate_preflight
        good = {"root": 'scrub-anchor "com.apple/*" all fragment reassemble\nanchor "com.apple/*" all',
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

class ActivationFailureTests(unittest.TestCase):
    def test_loaded_user_agent_rejects_activation_without_stopping_it(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            for domain in ("gui", "user"):
                checked = []
                def run(arguments, **kwargs):
                    checked.append(arguments[-1])
                    if arguments[-1].startswith(domain + "/"):
                        return SimpleNamespace(returncode=0, stderr="", stdout="state = running\npid = 777")
                    return SimpleNamespace(returncode=113, stderr="Could not find service", stdout="")
                with patch.object(activation.subprocess, "run", side_effect=run), \
                     patch.object(activation, "command") as commands:
                    with self.assertRaises(RuntimeError):
                        activation.reject_user_agent(directory)
                self.assertTrue(any(item.startswith(domain + "/") for item in checked))
                commands.assert_not_called()

    def test_loaded_daemon_must_be_stopped_before_anchor_restore(self):
        import tempfile, json
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        with patch.object(activation, "job_status", return_value=SimpleNamespace(returncode=0, stdout="pid = 777")), \
             patch.object(activation, "command", side_effect=RuntimeError("bootout failed")):
            with self.assertRaises(RuntimeError):
                activation.stop_job(activation.GUARD_LABEL)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            live = path / "live.py"
            live.write_text("current")
            (path / "backup").write_text("previous")
            state = {"status": "armed", "files": [{"target": str(live),
                     "existed": True, "backup": "backup"}]}
            (path / "transaction.json").write_text(json.dumps(state))
            with patch.object(activation, "read_transaction", return_value=(path, state)), \
                 patch.object(activation, "stop_job", side_effect=RuntimeError("still alive")), \
                 patch.object(activation, "command") as commands:
                with self.assertRaises(RuntimeError):
                    activation.rollback(path)
            self.assertEqual(live.read_text(), "current")
            self.assertEqual(json.loads((path / "transaction.json").read_text())["status"], "armed")
            commands.assert_not_called()

    def test_confirmation_requires_both_target_adb_shell_results(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        targets = {"ANGYVB4227006983", "ANGYVB4402004137"}
        with tempfile.TemporaryDirectory() as directory:
            adb = Path(directory) / "adb"
            adb.touch()
            calls = []
            def run(arguments):
                calls.append(arguments)
                return "1\n" if arguments[-2:] == ["getprop", "sys.boot_completed"] else "cecelia-pf-confirm\n"
            with patch.object(activation, "adb_binary", return_value=str(adb)), \
                 patch.object(activation.pwd, "getpwuid", return_value=SimpleNamespace(pw_name="target")), \
                 patch.object(activation, "command", side_effect=run):
                self.assertEqual(set(activation.verify_adb(directory)), targets)
                self.assertEqual(len(calls), 4)
                self.assertEqual({call[call.index("-s")+1] for call in calls}, targets)
            with patch.object(activation, "adb_binary", return_value=str(adb)), \
                 patch.object(activation.pwd, "getpwuid", return_value=SimpleNamespace(pw_name="target")), \
                 patch.object(activation, "command", return_value="0\n"):
                with self.assertRaises(RuntimeError):
                    activation.verify_adb(directory)

    def test_candidate_must_match_fresh_authenticated_policy(self):
        from tailscale_us_exit_activation import validate_candidate
        rules = "pass out quick on lo0 all no state\nblock drop out quick proto { tcp udp } all\n"
        validate_candidate(rules, rules)
        for candidate in ("pass out quick all\n" + rules, rules.replace("no state", "keep state"),
                          rules + "pass out quick all\n"):
            with self.assertRaises(RuntimeError):
                validate_candidate(candidate, rules)

    def test_rollback_restores_real_files_and_only_its_anchor(self):
        import tempfile
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            target = path / "live.py"
            target.write_text("new implementation")
            (path / "backup-0").write_text("original implementation")
            (path / "previous.pf").write_text("old anchor")
            state = {"status": "armed", "anchor": activation.ANCHOR, "files": [
                {"target": str(target), "existed": True, "backup": "backup-0"}]}
            (path / "transaction.json").write_text(__import__("json").dumps(state))
            calls = []
            def run(args, input=None):
                calls.append(args)
                return ""
            with patch.object(activation, "read_transaction", return_value=(path, state)), \
                 patch.object(activation, "command", side_effect=run), \
                 patch.object(activation, "stop_job"), \
                 patch.object(activation.subprocess, "run"), \
                 patch.object(activation, "PLIST", path / "absent.plist"):
                activation.rollback(path)
            self.assertEqual(target.read_text(), "original implementation")
            self.assertEqual(__import__("json").loads((path / "transaction.json").read_text())["status"], "rolled_back")
            self.assertEqual(calls, [["/sbin/pfctl", "-a", activation.ANCHOR, "-f", str(path / "previous.pf")]])

    def test_loaded_but_exited_watchdog_is_not_armed(self):
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        state = {"status": "armed", "deadline": 2000, "rollback_label": "job", "watchdog_pid": 42}
        with patch.object(activation, "read_transaction", return_value=(Path("/tmp"), state)), \
             patch.object(activation.time, "time", return_value=1000), \
             patch.object(activation, "command", return_value="state = not running\nlast exit code = 1"):
            with self.assertRaises(RuntimeError):
                activation.verify_transaction("/tmp")

    def test_expired_installer_cannot_reload_after_rollback(self):
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        calls = []
        def expired(_):
            raise RuntimeError("deadline expired")
        with patch.object(activation, "verify_transaction", side_effect=expired), \
             patch.object(activation, "command", side_effect=lambda args: calls.append(args)):
            with self.assertRaises(RuntimeError):
                activation.guarded_command(Path("/tmp/transaction"), ["/sbin/pfctl", "-f", "candidate"])
        self.assertEqual(calls, [])

    def test_installer_crossing_deadline_restores_without_loading_new_anchor(self):
        import tempfile, json
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            txn = root / "transaction"
            live = root / "live.py"
            live.write_text("original")
            candidate = root / "candidate.pf"
            candidate.write_text("block drop out quick proto { tcp udp } all\n")
            args = SimpleNamespace(approve_scope="all-users-public-egress-and-bootstrap-exceptions",
                actor="approved-test", home=str(root), candidate=str(candidate), transaction=str(txn), timeout=60)
            clock = [1000]
            calls = []
            def read_transaction(path):
                path = Path(path)
                return path, json.loads((path / "transaction.json").read_text())
            def command(arguments, input=None):
                calls.append(arguments)
                if arguments[:3] == ["/bin/launchctl", "bootstrap", "system"] and arguments[-1].endswith("rollback.plist"):
                    state = json.loads((txn / "transaction.json").read_text())
                    state["watchdog_pid"] = 777
                    activation.save_transaction(txn, state)
                if "print" in arguments:
                    return "state = running\npid = 777"
                return ""
            def installer(arguments, **kwargs):
                if any(str(item).endswith("install-tailscale-us-exit-enforcer.sh") for item in arguments):
                    live.write_text("partially installed")
                    clock[0] = 1100
                return SimpleNamespace(returncode=0)
            audit={"anchors": {activation.ANCHOR: "original pf"}, "states":"", "info":""}
            firewall=SimpleNamespace(map={}, rules=lambda _: candidate.read_text())
            with patch.object(activation, "FILES", (live,)), \
                 patch.object(activation, "reject_user_agent"), \
                 patch.object(activation, "PLIST", root/"no-main.plist"), \
                 patch.object(activation, "GUARD_PLIST", root/"no-guard.plist"), \
                 patch.object(activation, "fresh_policy", return_value=firewall), \
                 patch.object(activation, "preflight", return_value=audit), \
                 patch.object(activation, "read_transaction", side_effect=read_transaction), \
                 patch.object(activation, "command", side_effect=command), \
                 patch.object(activation, "stop_job"), \
                 patch.object(activation.time, "time", side_effect=lambda: clock[0]), \
                 patch.object(activation.os, "geteuid", return_value=0), \
                 patch.object(activation.os, "kill"), \
                 patch.object(activation.subprocess, "run", side_effect=installer):
                with self.assertRaises(RuntimeError):
                    activation.activate(args)
            self.assertEqual(live.read_text(), "original")
            self.assertEqual(json.loads((txn/"transaction.json").read_text())["status"], "rolled_back")
            loaded=[call for call in calls if call[:3] == ["/sbin/pfctl", "-a", activation.ANCHOR] and "-n" not in call]
            self.assertEqual(loaded, [["/sbin/pfctl", "-a", activation.ANCHOR, "-f", str(txn/"previous.pf")]])

    def test_confirmed_transaction_never_rolls_back(self):
        import tempfile
        from unittest.mock import patch
        import tailscale_us_exit_activation as activation
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            state = {"status": "confirmed"}
            (path / "transaction.json").write_text(__import__("json").dumps(state))
            with patch.object(activation, "read_transaction", return_value=(path, state)), \
                 patch.object(activation, "command") as calls:
                activation.rollback(path)
            calls.assert_not_called()

    @unittest.skipUnless(sys.platform == "darwin", "仅 macOS 有原生 PF 解析器")
    def test_native_pf_parser_accepts_actual_generated_rules_without_loading(self):
        import subprocess
        import tailscale_us_exit_policy as policy
        rules = policy.generate_rules(None, {}, allowed_self_ips={"100.86.57.69"}, lan_interfaces=["en0"])
        result = subprocess.run(["/sbin/pfctl", "-vnf", "-"], input=rules,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
    def test_pf_repair_failure_reports_false_and_firewall_error(self):
        import tempfile, io, json
        from types import SimpleNamespace
        from unittest.mock import patch
        from contextlib import redirect_stdout
        def fail(*args, **kwargs):
            raise enforcer.EnforcementError("forced_pf_error")
        firewall = SimpleNamespace(protect_boot_gap=fail, apply=fail, refresh=lambda _: False)
        with tempfile.TemporaryDirectory() as directory:
            output=io.StringIO()
            with patch.object(enforcer, "FailClosedFirewall", return_value=firewall), \
                 patch.object(enforcer, "LOCK_FILE", Path(directory)/"lock"), \
                 patch.object(sys, "argv", ["enforcer", "--once"]), redirect_stdout(output):
                self.assertEqual(enforcer.main(), 3)
            records=[json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(records[0]["status"], "firewall_error")
            self.assertFalse(records[-1]["fail_closed_applied"])


class LeaseGuardTests(unittest.TestCase):
    def test_closed_peer_bootstrap_does_not_survive_expired_cache_lease(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_lease as lease
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            root = Path(directory)
            firewall = SimpleNamespace(cache=root/"cache", pf_lock=root/"lock", lease=root/"lease",
                current_rules=lambda: 'pass out quick proto udp to 38.23.47.81 port 54192 no state\nblock drop out quick',
                rules=lambda _: 'pass out quick on lo0 all no state label "cecelia-us-exit-v2"\nblock drop out quick',
                _apply=lambda allow: calls.append(allow))
            with patch.object(lease, "read_map_cache", return_value={}):
                lease.reconcile_once(firewall, now=2000)
            self.assertEqual(calls, [False])

    def test_business_lease_is_bounded_and_requires_live_guard(self):
        from tailscale_us_exit_lease import valid_lease
        lease = {"generation": "one", "observed_at": 1000, "expires_at": 1015,
                 "signature": "cecelia-us-exit-v2"}
        self.assertTrue(valid_lease(lease, 1010))
        self.assertFalse(valid_lease(lease, 1016))
        self.assertFalse(valid_lease({**lease, "expires_at": 2000}, 1010))
        self.assertFalse(valid_lease({**lease, "generation": ""}, 1010))

    def test_stopped_main_daemon_does_not_leave_expired_utun_pass(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_lease as lease
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            firewall = SimpleNamespace(pf_lock=Path(directory)/"lock", lease=Path(directory)/"lease",
                current_rules=lambda: "pass out quick on utun42 inet proto tcp from 100.86.57.69 to any no state",
                _apply=lambda allow: calls.append(allow))
            with patch.object(lease, "read_map_cache", return_value={}):
                lease.reconcile_once(firewall, now=2000)
            self.assertEqual(calls, [False])

    def test_unexpired_generation_does_not_revoke_current_business_pass(self):
        import tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        import tailscale_us_exit_lease as lease
        with tempfile.TemporaryDirectory() as directory:
            calls=[]
            firewall=SimpleNamespace(pf_lock=Path(directory)/"lock", lease=Path(directory)/"lease",
                current_rules=lambda: "pass on utun42", _apply=lambda allow: calls.append(allow))
            payload={"generation":"two", "observed_at":1000, "expires_at":1015,"signature":"cecelia-us-exit-v2"}
            with patch.object(lease, "read_map_cache", return_value=payload):
                lease.reconcile_once(firewall, now=1002)
            self.assertEqual(calls, [])

if __name__ == "__main__":
    unittest.main()
