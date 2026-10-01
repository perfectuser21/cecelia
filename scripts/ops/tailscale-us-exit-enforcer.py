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

from tailscale_us_exit_legacy import (
    EnforcementError, LegacyFailClosedFirewall, CONSECUTIVE_FAILURE_THRESHOLD,
    DAEMON_ABSENT_FAILURE_THRESHOLD, COUNTER_EXPIRY_SECONDS,
    FAILURE_COUNT_FILE, DAEMON_ABSENT_COUNT_FILE, read_count, write_count,
    read_failure_count, write_failure_count, read_daemon_absent_count,
    write_daemon_absent_count, is_daemon_absent_error,
)

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



def FailClosedFirewall():
    mode = os.environ.get("CECELIA_US_EXIT_FIREWALL_MODE", "legacy")
    if mode == "interface-v2":
        from tailscale_us_exit_policy import InterfaceFirewall
        from types import SimpleNamespace
        return InterfaceFirewall(SimpleNamespace(**globals()))
    if mode != "legacy":
        raise EnforcementError("unknown_firewall_mode")
    return LegacyFailClosedFirewall()


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
    parser.add_argument("--candidate-rules", action="store_true", help="只读生成 interface-v2 候选规则")
    parser.add_argument(
        "--check-client",
        action="store_true",
        help="validate that this is an approved Xi'an execution Mac without changing state",
    )
    args = parser.parse_args()

    if args.candidate_rules:
        from tailscale_us_exit_policy import InterfaceFirewall
        firewall = InterfaceFirewall(__import__("types").SimpleNamespace(**globals()))
        binary = tailscale_binary()
        firewall.refresh(binary, persist=False)
        sys.stdout.write(firewall.rules(True))
        return 0

    if args.check_client:
        try:
            binary = tailscale_binary()
            status = load_status(binary)
            validate_self(status)
            emit(
                "client_approved",
                self_ips=sorted(status.get("Self", {}).get("TailscaleIPs") or []),
            )
            return 0
        except (EnforcementError, OSError, subprocess.SubprocessError) as exc:
            emit("error", error=str(exc))
            return 3

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
            if hasattr(firewall, "refresh"):
                fail_closed = fail_closed or not firewall.refresh(binary)
            firewall.apply(allow_tunnel=not fail_closed if hasattr(firewall, "refresh") else True)
            persist_state(chosen, reason, fail_closed)
            write_failure_count(0)
            write_daemon_absent_count(0)
            emit(
                "fail_closed" if fail_closed else "healthy",
                changed=changed,
                exit_node_dns=normalized_dns(chosen),
                exit_node_id=chosen.get("ID"),
                reason=reason,
            )
            return 2 if fail_closed else 0
        except (EnforcementError, OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError) as exc:
            message = str(exc)
            if "firewall" in locals() and hasattr(firewall, "refresh"):
                fail_closed_applied = False
                try:
                    firewall.apply(allow_tunnel=False)
                    fail_closed_applied = True
                except (EnforcementError, OSError, subprocess.SubprocessError) as firewall_exc:
                    emit("firewall_error", error=str(firewall_exc))
                emit("error", error=message, fail_closed_applied=fail_closed_applied, firewall_mode="interface-v2")
                return 3
            if is_daemon_absent_error(message):
                failures = read_daemon_absent_count() + 1
                write_daemon_absent_count(failures)
                fail_closed_applied = False
                if failures >= DAEMON_ABSENT_FAILURE_THRESHOLD:
                    fail_closed_applied = True
                    try:
                        if "firewall" in locals():
                            firewall.apply(allow_tunnel=False)
                    except (EnforcementError, OSError, subprocess.SubprocessError) as firewall_exc:
                        emit("firewall_error", error=str(firewall_exc))
                emit(
                    "error",
                    error=message,
                    error_class="daemon_absent",
                    consecutive_failures=failures,
                    fail_closed_applied=fail_closed_applied,
                )
                return 3
            failures = read_failure_count() + 1
            write_failure_count(failures)
            fail_closed_applied = False
            if failures >= CONSECUTIVE_FAILURE_THRESHOLD:
                fail_closed_applied = True
                try:
                    if "firewall" in locals():
                        firewall.apply(allow_tunnel=False)
                except (EnforcementError, OSError, subprocess.SubprocessError) as firewall_exc:
                    emit("firewall_error", error=str(firewall_exc))
            emit(
                "error",
                error=message,
                consecutive_failures=failures,
                fail_closed_applied=fail_closed_applied,
            )
            return 3


if __name__ == "__main__":
    sys.exit(main())
