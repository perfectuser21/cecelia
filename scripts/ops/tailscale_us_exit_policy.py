"""显式 interface-v2：不用 PF socket 身份查询的全机美国出口策略。"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

ANCHOR = "com.apple/cecelia-us-exit"
CONTROL_NETS = ("192.200.0.0/24", "2606:b740:49::/48",
                "199.165.136.0/24", "2606:b740:1::/48")
PRIVATE_NETS = ("10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12",
                "192.168.0.0/16", "fd7a:115c:a1e0::/48")
APPROVED = {"n6kr9EqWwN11CNTRL": "mac-mini-m4-us.tailce7a8b.ts.net",
            "nWC4TTvpLA11CNTRL": "vps-us.tailce7a8b.ts.net"}
MAX_EVIDENCE_AGE = 15
MAX_MAP_AGE = 86400


def address(value):
    try:
        return ipaddress.ip_address(value)
    except (ValueError, TypeError):
        return None


def family(ip):
    return "inet" if ip.version == 4 else "inet6"


def peers(status):
    value = status.get("Peer", {})
    candidates = list(value.values()) if isinstance(value, dict) else value if isinstance(value, list) else []
    return [item for item in candidates if isinstance(item, dict)]


def approved(peer, approved_nodes):
    return (isinstance(peer, dict) and peer.get("ExitNodeOption") is True
            and str(peer.get("DNSName", "")).rstrip(".").lower()
            == approved_nodes.get(peer.get("ID"), "__unapproved__"))


def verified_interfaces(snapshot, allowed_self_ips, now, approved_nodes):
    """过期、身份变化或接口复用撤销所有业务 pass；双栈路由各自核实。"""
    if not snapshot or not 0 <= now - snapshot.get("observed_at", 0) <= MAX_EVIDENCE_AGE:
        return {}
    status, prefs = snapshot.get("status", {}), snapshot.get("prefs", {})
    self_status = status.get("Self", {})
    self_ips = self_status.get("TailscaleIPs", [])
    exit_status = status.get("ExitNodeStatus", {}) or {}
    selected = prefs.get("ExitNodeID")
    if (status.get("BackendState") != "Running" or not self_status.get("ID")
            or self_status.get("Online") is not True
            or not set(self_ips).intersection(allowed_self_ips)
            or prefs.get("WantRunning") is not True
            or prefs.get("CorpDNS") is not True
            or prefs.get("ExitNodeAllowLANAccess") is not True
            or selected not in approved_nodes or exit_status.get("ID") != selected
            or exit_status.get("Online") is not True):
        return {}
    selected_peer = next((p for p in peers(status) if p.get("ID") == selected), {})
    if not approved(selected_peer, approved_nodes) or selected_peer.get("Online") is not True:
        return {}
    routes, interfaces = snapshot.get("routes", {}), snapshot.get("interfaces", {})
    result = {}
    for version in (4, 6):
        interface = routes.get(str(version), "")
        if not re.fullmatch(r"utun\d+", interface):
            continue
        observed = set()
        for item in re.findall(r"\binet6?\s+([^\s]+)", interfaces.get(interface, "")):
            parsed = address(item.split("%", 1)[0])
            if parsed:
                observed.add(str(parsed))
        own = [ip for ip in self_ips if address(ip) and address(ip).version == version]
        if routes.get(f"tail{version}") == interface and any(str(address(ip)) in observed for ip in own):
            result[version] = interface
    # Interface reuse of the IPv4 identity is a global failure, even if IPv6 survived.
    if any(address(ip) and address(ip).version == 4 for ip in self_ips) and 4 not in result:
        return {}
    return result


def derp_endpoints(derp_map):
    result = set()
    regions = derp_map.get("Regions", {}) if isinstance(derp_map, dict) else {}
    if not isinstance(regions, dict):
        return []
    for region in regions.values():
        if not isinstance(region, dict) or not isinstance(region.get("Nodes", []), list):
            continue
        for node in region.get("Nodes", []):
            if not isinstance(node, dict):
                continue
            hostname = str(node.get("HostName", "")).rstrip(".").lower()
            if not hostname.endswith(".tailscale.com"):
                continue
            # Non-default DERP/STUN ports require a separately approved policy.
            if node.get("DERPPort", 0) not in (0, 443) or node.get("STUNPort", 3478) not in (-1, 0, 3478):
                continue
            for key in ("IPv4", "IPv6"):
                ip = address(node.get(key))
                if ip and not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified:
                    if not node.get("STUNOnly"):
                        result.add((str(ip), 443, "tcp"))
                    if node.get("STUNPort", 3478) != -1:
                        result.add((str(ip), 3478, "udp"))
    return sorted(result)


def peer_endpoints(snapshot, now, approved_nodes):
    if not snapshot or not 0 <= now - snapshot.get("observed_at", 0) <= MAX_EVIDENCE_AGE:
        return []
    result = []
    for peer in peers(snapshot.get("status", {})):
        if not approved(peer, approved_nodes):
            continue
        endpoint = str(peer.get("CurAddr", ""))
        try:
            host, port = endpoint.rsplit(":", 1)
            ip = address(host.strip("[]"))
            port = int(port)
        except ValueError:
            continue
        if ip and not ip.is_loopback and not ip.is_multicast and not ip.is_unspecified and 0 < port < 65536:
            result.append((str(ip), port, "udp"))
    return sorted(set(result))


def generate_rules(snapshot, derp_map, *, allowed_self_ips, now=None, approved_nodes=None, lan_interfaces=(), allow_tunnel=True):
    now = time.time() if now is None else now
    approved_nodes = APPROVED if approved_nodes is None else approved_nodes
    lines = ['pass out quick on lo0 all no state label "cecelia-us-exit-v2"']
    for interface in sorted({value for value in lan_interfaces if isinstance(value, str)}):
        if re.fullmatch(r"en\d+", interface):
            lines.append(f"pass out quick on {interface} inet proto udp from 0.0.0.0 port 68 to 255.255.255.255 port 67 no state")
    for net in PRIVATE_NETS:
        lines.append(f"pass out quick {family(ipaddress.ip_network(net).network_address)} from any to {net} no state")
    for net in CONTROL_NETS:
        lines.append(f"pass out quick {family(ipaddress.ip_network(net).network_address)} proto tcp from any to {net} port 443 flags any no state")
    for ip, port, protocol in sorted(set(derp_endpoints(derp_map) + peer_endpoints(snapshot, now, approved_nodes))):
        flags = " flags any" if protocol == "tcp" else ""
        lines.append(f"pass out quick {family(address(ip))} proto {protocol} from any to {ip} port {port}{flags} no state")
    for version, interface in (verified_interfaces(snapshot, allowed_self_ips, now, approved_nodes) if allow_tunnel else {}).items():
        af = "inet" if version == 4 else "inet6"
        for self_ip in snapshot["status"]["Self"]["TailscaleIPs"]:
            if address(self_ip) and address(self_ip).version == version:
                own = str(address(self_ip))
                lines.append(f"pass out quick on {interface} {af} proto tcp from {own} to any flags any no state")
                lines.append(f"pass out quick on {interface} {af} proto udp from {own} to any no state")
    lines.append("block drop out quick proto { tcp udp } all")
    return "\n".join(lines) + "\n"


def read_map_cache(path, now=None, max_age=MAX_MAP_AGE):
    """只信 root 独占、非符号链接且有期限的认证 DERP map 缓存。"""
    now = time.time() if now is None else now
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as stream:
            metadata = os.fstat(stream.fileno())
            if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
                return {}
            payload = json.load(stream)
        if not isinstance(payload, dict) or not isinstance(payload.get("map"), dict):
            return {}
        if 0 <= now - payload.get("observed_at", 0) <= max_age:
            return payload.get("map", {})
    except (OSError, ValueError, TypeError):
        pass
    return {}


def save_map_cache(path, derp_map):
    if os.geteuid() != 0 or not derp_map:
        return
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temporary = stream.name
        os.fchmod(stream.fileno(), 0o600)
        json.dump({"observed_at": time.time(), "map": derp_map}, stream)
    os.replace(temporary, path)


def native_read(command):
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=10, check=False)
        return result.stdout if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def collect_snapshot(api, binary):
    started = time.time()
    status = api.run_json([binary, "status", "--json"])
    prefs = api.run_json([binary, "debug", "prefs"])
    routes, interfaces = {}, {}
    targets = {"4": ["-inet", "1.1.1.1"], "6": ["-inet6", "2606:4700:4700::1111"],
               "tail4": ["-inet", "100.100.100.100"], "tail6": ["-inet6", "fd7a:115c:a1e0::53"]}
    for own_ip in status.get("Self", {}).get("TailscaleIPs", []):
        if address(own_ip):
            targets[own_ip] = ["-inet" if address(own_ip).version == 4 else "-inet6", own_ip]
    for key, target in targets.items():
        output = native_read(["/sbin/route", "-n", "get", *target])
        match = re.search(r"^\s*interface:\s*(\S+)", output, re.MULTILINE)
        routes[key] = match.group(1) if match else ""
    for interface in set(routes.values()):
        if re.fullmatch(r"utun\d+", interface):
            interfaces[interface] = native_read(["/sbin/ifconfig", interface])
    return {"observed_at": started, "status": status, "prefs": prefs,
            "routes": routes, "interfaces": interfaces}


class InterfaceFirewall:
    ANCHOR = ANCHOR

    def __init__(self, api, read_interfaces=True):
        self.api = api
        self.binary = os.environ.get("CECELIA_US_EXIT_PFCTL_BIN", "/sbin/pfctl")
        self.cache = Path(os.environ.get("CECELIA_US_EXIT_DERP_CACHE", "/var/db/cecelia/tailscale-us-exit/derp-map.json"))
        self.map = read_map_cache(self.cache)
        self.peer_cache = self.cache.with_name("bootstrap-peers.json")
        self.snapshot = read_map_cache(self.peer_cache, max_age=MAX_EVIDENCE_AGE) or None
        if self.snapshot and (not isinstance(self.snapshot.get("observed_at"), (int, float))
                              or not isinstance(self.snapshot.get("status"), dict)):
            self.snapshot = None
        context = read_map_cache(self.cache.with_name("bootstrap-context.json"))
        self.lan_interfaces = native_read(["/sbin/ifconfig", "-l"]).split() if read_interfaces else context.get("lan_interfaces", [])
        if not isinstance(self.lan_interfaces, list):
            self.lan_interfaces = []
        self.lan_interfaces = [value for value in self.lan_interfaces if isinstance(value, str) and re.fullmatch(r"en\d+", value)]
        self.pf_lock = self.cache.with_name("pf-transaction.lock")
        self.lease = self.cache.with_name("business-lease.json")
        self.approved = {api.PRIMARY_ID: api.PRIMARY_DNS, api.SECONDARY_ID: api.SECONDARY_DNS}
        if os.geteuid() != 0 and os.environ.get("CECELIA_US_EXIT_ALLOW_UNPRIVILEGED_FIREWALL") != "true":
            raise api.EnforcementError("root_required_for_fail_closed_firewall")

    def run(self, arguments, rules=None):
        result = subprocess.run([self.binary, *arguments], input=rules, text=True,
                                capture_output=True, timeout=15, check=False)
        if result.returncode:
            raise self.api.EnforcementError("pfctl_failed:" + result.stderr[:300])
        return result

    def current_rules(self):
        return self.run(["-a", self.ANCHOR, "-sr"]).stdout

    def rules(self, allow_tunnel):
        return generate_rules(self.snapshot, self.map,
            allowed_self_ips=self.api.ALLOWED_SELF_IPS, approved_nodes=self.approved, lan_interfaces=self.lan_interfaces, allow_tunnel=allow_tunnel)

    def apply(self, allow_tunnel):
        from tailscale_us_exit_lease import pf_lock
        with pf_lock(self.pf_lock):
            self._apply(allow_tunnel)

    def _apply(self, allow_tunnel):
        from tailscale_us_exit_lease import guard_alive, SIGNATURE
        allow_tunnel = bool(allow_tunnel and verified_interfaces(self.snapshot,
            self.api.ALLOWED_SELF_IPS, time.time(), self.approved))
        if allow_tunnel and not guard_alive(self.cache):
            raise self.api.EnforcementError("independent_lease_guard_not_alive")
        save_map_cache(self.cache.with_name("bootstrap-context.json"), {"lan_interfaces": self.lan_interfaces})
        rules = self.rules(allow_tunnel)
        self.run(["-n", "-a", self.ANCHOR, "-f", "-"], rules)
        if "Status: Enabled" not in self.run(["-s", "info"]).stdout:
            raise self.api.EnforcementError("pf_disabled_requires_safe_activation")
        # 解析等待期间 evidence 可能过期；加载前重新判定，绝不重新授予过期授权。
        rules = self.rules(allow_tunnel)
        self.run(["-a", self.ANCHOR, "-f", "-"], rules)
        installed = self.current_rules()
        if "cecelia-us-exit-v2" not in installed or "block drop out quick" not in installed or re.search(r"\b(user|group)\b", installed):
            raise self.api.EnforcementError("pf_anchor_verification_failed")
        if allow_tunnel and verified_interfaces(self.snapshot, self.api.ALLOWED_SELF_IPS, time.time(), self.approved):
            save_map_cache(self.lease, {"signature": SIGNATURE, "generation": uuid.uuid4().hex,
                "observed_at": self.snapshot["observed_at"],
                "expires_at": self.snapshot["observed_at"] + MAX_EVIDENCE_AGE})
        elif allow_tunnel:
            self._apply(False)
        else:
            self.lease.unlink(missing_ok=True)

    def protect_boot_gap(self):
        # Never reuse last cycle's public authorization, including a reused utun name.
        self.apply(False)

    def refresh(self, binary, persist=True):
        self.snapshot = collect_snapshot(self.api, binary)
        if persist:
            # 仅保存认证状态的两 US peer 精确字段；禁止缓存含密钥的 prefs。
            safe_peers = [{key: peer.get(key) for key in ("ID", "DNSName", "ExitNodeOption", "CurAddr")}
                          for peer in peers(self.snapshot["status"]) if approved(peer, self.approved)]
            save_map_cache(self.peer_cache, {"observed_at": self.snapshot["observed_at"], "status": {"Peer": safe_peers}})
        try:
            current_map = self.api.run_json([binary, "debug", "derp-map"])
            if derp_endpoints(current_map):
                self.map = current_map
                if persist:
                    save_map_cache(self.cache, current_map)
        except (self.api.EnforcementError, OSError, subprocess.SubprocessError):
            self.map = read_map_cache(self.cache)
        return bool(verified_interfaces(self.snapshot, self.api.ALLOWED_SELF_IPS,
            time.time(), self.approved))
