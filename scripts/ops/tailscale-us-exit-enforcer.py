#!/usr/bin/env python3
"""Keep the Xi'an execution Macs on approved US Tailscale exit nodes."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


PRIMARY_DNS = os.environ.get(
    "CECELIA_US_EXIT_PRIMARY_DNS", "mac-mini-m4-us.tailce7a8b.ts.net"
).rstrip(".").lower()
SECONDARY_DNS = os.environ.get(
    "CECELIA_US_EXIT_SECONDARY_DNS", "vps-us.tailce7a8b.ts.net"
).rstrip(".").lower()
PRIMARY_ID = os.environ.get("CECELIA_US_EXIT_PRIMARY_ID", "n6kr9EqWwN11CNTRL")
SECONDARY_ID = os.environ.get("CECELIA_US_EXIT_SECONDARY_ID", "nWC4TTvpLA11CNTRL")
APPROVED_IDS = {PRIMARY_ID, SECONDARY_ID}
ALLOWED_SELF_IPS = {
    value.strip()
    for value in os.environ.get(
        "CECELIA_US_EXIT_ALLOWED_SELF_IPS", "100.86.57.69,100.88.166.55"
    ).split(",")
    if value.strip()
}
STATE_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_US_EXIT_STATE_FILE",
            "/var/db/cecelia/tailscale-us-exit/state.json",
        )
    )
)
LOCK_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_US_EXIT_LOCK_FILE",
            "/var/db/cecelia/tailscale-us-exit/enforcer.lock",
        )
    )
)


class EnforcementError(RuntimeError):
    """The required US-only exit invariant could not be established."""


def target_command(command: list[str]) -> tuple[list[str], dict[str, str]]:
    """Run App Store/Standalone CLI in the target user's bootstrap context."""
    environment = {**os.environ, "TAILSCALE_BE_CLI": "1"}
    target_uid = os.environ.get("CECELIA_US_EXIT_TARGET_UID", "")
    target_user = os.environ.get("CECELIA_US_EXIT_TARGET_USER", "")
    target_home = os.environ.get("CECELIA_US_EXIT_TARGET_HOME", "")
    if os.geteuid() == 0:
        if not (target_uid and target_uid.isdigit() and target_user and target_home):
            raise EnforcementError("target_user_context_required_for_root")
        prefix = [
            "/bin/launchctl",
            "asuser",
            target_uid,
            "/usr/bin/sudo",
            "-u",
            target_user,
            "/usr/bin/env",
            f"HOME={target_home}",
            f"USER={target_user}",
            f"LOGNAME={target_user}",
            "TAILSCALE_BE_CLI=1",
            "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        ]
        return prefix + command, environment
    return command, environment


def run_tailscale(
    command: list[str], timeout: int = 20
) -> subprocess.CompletedProcess[str]:
    wrapped, environment = target_command(command)
    return subprocess.run(
        wrapped,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=environment,
    )


def emit(status: str, **details: Any) -> None:
    print(
        json.dumps(
            {"component": "tailscale_us_exit", "status": status, **details},
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )


def tailscale_binary() -> str:
    configured = os.environ.get("TAILSCALE_BIN")
    candidates = [
        configured,
        shutil.which("tailscale"),
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise EnforcementError("tailscale_binary_not_found")


def run_json(command: list[str]) -> dict[str, Any]:
    result = run_tailscale(command)
    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
        raise EnforcementError(f"command_failed:{command[1]}:{error[:300]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise EnforcementError(f"invalid_json:{command[1]}:{exc}") from exc


def load_status(binary: str) -> dict[str, Any]:
    last_error: EnforcementError | None = None
    for attempt in range(2):
        try:
            return run_json([binary, "status", "--json"])
        except EnforcementError as exc:
            last_error = exc
            if attempt == 0 and Path("/Applications/Tailscale.app").exists():
                wrapped, environment = target_command(
                    ["/usr/bin/open", "-gja", "Tailscale"]
                )
                subprocess.run(
                    wrapped,
                    capture_output=True,
                    timeout=10,
                    check=False,
                    env=environment,
                )
                time.sleep(3)
    raise last_error or EnforcementError("tailscale_status_unavailable")


class FailClosedFirewall:
    """Allow provider traffic only through Tailscale's utun interface."""

    ANCHOR = "com.apple/cecelia-us-exit"

    def __init__(self) -> None:
        self.binary = os.environ.get("CECELIA_US_EXIT_PFCTL_BIN", "/sbin/pfctl")
        configured_uid = os.environ.get("CECELIA_US_EXIT_TARGET_UID")
        if os.geteuid() == 0 and not configured_uid:
            raise EnforcementError("target_uid_required_for_root_firewall")
        self.uid = configured_uid or str(os.getuid())
        if not self.uid.isdigit():
            raise EnforcementError("invalid_target_uid")
        if (
            os.geteuid() != 0
            and os.environ.get("CECELIA_US_EXIT_ALLOW_UNPRIVILEGED_FIREWALL") != "true"
        ):
            raise EnforcementError("root_required_for_fail_closed_firewall")

    def run(
        self, arguments: list[str], rules: str | None = None
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [self.binary, *arguments],
            input=rules,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            error = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
            raise EnforcementError(f"pfctl_failed:{' '.join(arguments)}:{error[:300]}")
        return result

    def tunnel_interface(self) -> str:
        configured = os.environ.get("CECELIA_US_EXIT_TUN_INTERFACE")
        if configured:
            interface = configured
        else:
            route = subprocess.run(
                ["/sbin/route", "-n", "get", "100.100.100.100"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            match = re.search(r"^\s*interface:\s*(\S+)", route.stdout, re.MULTILINE)
            interface = match.group(1) if route.returncode == 0 and match else ""
        if not re.fullmatch(r"utun\d+", interface):
            raise EnforcementError(f"tailscale_tunnel_interface_not_found:{interface}")
        return interface

    def rules(self, allow_tunnel: bool) -> str:
        lines = [
            f"pass out quick on lo0 proto {{ tcp udp }} user {self.uid} no state",
            (
                "pass out quick inet proto { tcp udp } "
                "to { 10.0.0.0/8 100.64.0.0/10 172.16.0.0/12 192.168.0.0/16 } "
                f"user {self.uid} no state"
            ),
            (
                "pass out quick inet6 proto { tcp udp } "
                f"to fd7a:115c:a1e0::/48 user {self.uid} no state"
            ),
        ]
        if allow_tunnel:
            lines.append(
                f"pass out quick on {self.tunnel_interface()} "
                f"proto {{ tcp udp }} user {self.uid} no state"
            )
        lines.append(f"block drop out quick proto {{ tcp udp }} user {self.uid}")
        return "\n".join(lines) + "\n"

    def current_rules(self) -> str:
        return self.run(["-a", self.ANCHOR, "-sr"]).stdout

    def ensure_enabled(self) -> None:
        info = self.run(["-s", "info"]).stdout
        if "Status: Enabled" not in info:
            self.run(["-E"])

    def apply(self, allow_tunnel: bool) -> None:
        try:
            previous = self.current_rules()
        except EnforcementError:
            previous = ""
        self.ensure_enabled()
        rules = self.rules(allow_tunnel)
        self.run(["-a", self.ANCHOR, "-f", "-"], rules=rules)
        if not allow_tunnel and (not previous.strip() or " on utun" in previous):
            # PF state lookup precedes rule evaluation. Flush once on the transition
            # into strict mode so a connection created before the block cannot survive.
            self.run(["-F", "states"])
        installed = self.current_rules()
        if "block drop out quick" not in installed or self.uid not in installed:
            raise EnforcementError("pf_anchor_verification_failed")

    def protect_boot_gap(self) -> None:
        try:
            installed = self.current_rules()
        except EnforcementError:
            installed = ""
        if "block drop out quick" not in installed or self.uid not in installed:
            self.apply(allow_tunnel=False)


def peer_values(status: dict[str, Any]) -> list[dict[str, Any]]:
    peers = status.get("Peer", {})
    if isinstance(peers, dict):
        return [peer for peer in peers.values() if isinstance(peer, dict)]
    if isinstance(peers, list):
        return [peer for peer in peers if isinstance(peer, dict)]
    return []


def normalized_dns(peer: dict[str, Any]) -> str:
    return str(peer.get("DNSName") or "").rstrip(".").lower()


def validate_self(status: dict[str, Any]) -> None:
    self_ips = set(status.get("Self", {}).get("TailscaleIPs") or [])
    if not self_ips.intersection(ALLOWED_SELF_IPS):
        raise EnforcementError(
            "unapproved_client:" + ",".join(sorted(self_ips))
        )


def approved_peers(status: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    primary = None
    secondary = None
    for peer in peer_values(status):
        if peer.get("ExitNodeOption") is not True:
            continue
        peer_dns = normalized_dns(peer)
        peer_id = str(peer.get("ID") or "")
        if peer_dns == PRIMARY_DNS and peer_id == PRIMARY_ID:
            primary = peer
        elif peer_dns == SECONDARY_DNS and peer_id == SECONDARY_ID:
            secondary = peer
    return primary, secondary


def choose_exit(
    primary: dict[str, Any] | None,
    secondary: dict[str, Any] | None,
) -> tuple[dict[str, Any], bool, str]:
    if primary and primary.get("Online") is True:
        return primary, False, "primary_online"
    if secondary and secondary.get("Online") is True:
        return secondary, False, "secondary_online"
    if primary:
        return primary, True, "all_us_exits_offline"
    if secondary:
        return secondary, True, "all_us_exits_offline"
    raise EnforcementError("approved_us_exit_not_found")


def enforce(binary: str, chosen: dict[str, Any], prefs: dict[str, Any] | None = None) -> bool:
    chosen_id = str(chosen.get("ID") or "")
    chosen_dns = normalized_dns(chosen)
    chosen_name = chosen_dns.split(".", 1)[0]
    if not chosen_id:
        raise EnforcementError("approved_us_exit_missing_id")
    if not chosen_dns:
        raise EnforcementError("approved_us_exit_missing_dns")

    prefs = prefs or run_json([binary, "debug", "prefs"])
    compliant = (
        prefs.get("ExitNodeID") == chosen_id
        and prefs.get("ExitNodeAllowLANAccess") is True
        and prefs.get("CorpDNS") is True
    )
    if compliant:
        return False

    result = run_tailscale(
        [
            binary,
            "set",
            f"--exit-node={chosen_name}",
            "--exit-node-allow-lan-access=true",
            "--accept-dns=true",
        ],
        timeout=30,
    )
    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
        raise EnforcementError(f"tailscale_set_failed:{error[:300]}")

    verified = run_json([binary, "debug", "prefs"])
    if (
        verified.get("ExitNodeID") != chosen_id
        or verified.get("ExitNodeAllowLANAccess") is not True
        or verified.get("CorpDNS") is not True
    ):
        raise EnforcementError("post_set_verification_failed")
    return True


def persist_state(chosen: dict[str, Any], reason: str, fail_closed: bool) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "exit_node_id": chosen.get("ID"),
        "exit_node_dns": normalized_dns(chosen),
        "reason": reason,
        "fail_closed": fail_closed,
        "verified_at": int(time.time()),
    }
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=STATE_FILE.parent,
            prefix=".state-",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            os.fchmod(temporary.fileno(), 0o600)
            json.dump(payload, temporary, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, STATE_FILE)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one reconciliation pass")
    parser.parse_args()

    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        lock_flags |= os.O_NOFOLLOW
    lock_fd = os.open(LOCK_FILE, lock_flags, 0o600)
    os.fchmod(lock_fd, 0o600)
    with os.fdopen(lock_fd, "a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            emit("already_running")
            return 0

        try:
            firewall = FailClosedFirewall()
            firewall.protect_boot_gap()
            binary = tailscale_binary()
            prefs = run_json([binary, "debug", "prefs"])
            if prefs.get("ExitNodeID") not in APPROVED_IDS:
                firewall.apply(allow_tunnel=False)
            status = load_status(binary)
            validate_self(status)
            primary, secondary = approved_peers(status)
            chosen, fail_closed, reason = choose_exit(primary, secondary)
            changed = enforce(binary, chosen, prefs)
            firewall.apply(allow_tunnel=True)
            persist_state(chosen, reason, fail_closed)
            emit(
                "fail_closed" if fail_closed else "healthy",
                changed=changed,
                exit_node_dns=normalized_dns(chosen),
                exit_node_id=chosen.get("ID"),
                reason=reason,
            )
            return 2 if fail_closed else 0
        except (EnforcementError, OSError, subprocess.SubprocessError) as exc:
            try:
                if "firewall" in locals():
                    firewall.apply(allow_tunnel=False)
            except (EnforcementError, OSError, subprocess.SubprocessError) as firewall_exc:
                emit("firewall_error", error=str(firewall_exc))
            emit("error", error=str(exc))
            return 3


if __name__ == "__main__":
    sys.exit(main())
