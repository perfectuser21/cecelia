#!/usr/bin/env python3
"""Keep the local Tailscale data path alive, and repair it without a human.

2026-09-07 xian-m4 事故形态：macsys network-extension 进程活着、GUI 显示已连接，
但扩展内部死锁——localapi 完全不应答，`tailscale status` 一律超时，持续 27 分钟。
现场没有任何组件会去动它：login-watchdog 只管认证状态（拿不到 status 就判
restart_daemon 然后停手），enforcer 则在 daemon_absent 累计超阈值后 fail-closed
拉闸，把"扩展卡死"放大成"整机断网"，最后靠人工重启恢复。

本 watchdog 补的就是这一段：每 60 秒探一次，连续 3 次探不通（≈3 分钟）就分级自愈——
先温和唤醒 GUI（enforcer.load_status 已验证的 `open -gja Tailscale`），
一轮不见效再强杀 network-extension 让 NE framework 自动重新拉起。
3 分钟检测 + 约 40 秒恢复 < enforcer 的 daemon_absent 10 分钟拉闸阈值，
所以自愈总是先于拉闸发生。

防呆三道：600 秒冷却（一轮自愈只做一次动作）、连续 3 轮无效即停手只告警
（防重启风暴把机器彻底搞失联）、DISABLED 安全闸（事故处置时人工接管）。
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


def _env_path(name: str, default: str) -> Path:
    return Path(os.path.expanduser(os.environ.get(name, default)))


STATE_FILE = _env_path(
    "CECELIA_TS_HEALTH_STATE_FILE",
    "/var/db/cecelia/tailscale-health-watchdog/state.json",
)
LOCK_FILE = _env_path(
    "CECELIA_TS_HEALTH_LOCK_FILE",
    "/var/db/cecelia/tailscale-health-watchdog/watchdog.lock",
)
DISABLED_FILE = _env_path(
    "CECELIA_TS_HEALTH_DISABLED_FILE",
    "/var/db/cecelia/tailscale-health-watchdog/DISABLED",
)

# 连续失败多少次才判定"扩展卡死"。默认 3 次 × StartInterval 60s ≈ 3 分钟，
# 既躲开单次 CLI 抖动，又赶在 enforcer 10 分钟拉闸之前。
FAIL_THRESHOLD = int(os.environ.get("CECELIA_TS_HEALTH_FAIL_THRESHOLD", "3"))
# 一轮自愈后至少等这么久再动第二次，给 NE framework 留出重新拉起的时间。
COOLDOWN_SECONDS = int(os.environ.get("CECELIA_TS_HEALTH_COOLDOWN", "600"))
# 连续这么多轮自愈都没救回来，说明不是重启能解决的问题，停手只告警。
MAX_RESTART_ROUNDS = int(os.environ.get("CECELIA_TS_HEALTH_MAX_ROUNDS", "3"))
# 扩展死锁时 status 不是报错而是永远不返回，必须有超时才能判定失败。
PROBE_TIMEOUT = int(os.environ.get("CECELIA_TS_HEALTH_PROBE_TIMEOUT", "15"))

OPEN_BIN = os.environ.get("CECELIA_TS_HEALTH_OPEN_BIN", "/usr/bin/open")
PKILL_BIN = os.environ.get("CECELIA_TS_HEALTH_PKILL_BIN", "/usr/bin/pkill")
GUI_APP = os.environ.get("CECELIA_TS_HEALTH_GUI_APP", "Tailscale")
NETWORK_EXTENSION = os.environ.get(
    "CECELIA_TS_HEALTH_EXTENSION_PATTERN",
    "io.tailscale.ipn.macsys.network-extension",
)
ALLOWED_HOSTS = {
    value.strip().lower()
    for value in os.environ.get(
        "CECELIA_TS_HEALTH_ALLOWED_HOSTS", "mac-mini-m4-xian,mac-mini-m1-us"
    ).split(",")
    if value.strip()
}


class WatchdogError(RuntimeError):
    """A recoverable failure worth reporting but not crashing on."""


def emit(action: str, **details: Any) -> None:
    print(
        json.dumps(
            {"component": "tailscale_health_watchdog", "action": action, **details},
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )


def tailscale_binary() -> str:
    """Locate the CLI. Mirrors tailscale-us-exit-enforcer.tailscale_binary()."""
    for candidate in [
        os.environ.get("TAILSCALE_BIN"),
        shutil.which("tailscale"),
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ]:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise WatchdogError("tailscale_binary_not_found")


def probe(binary: str) -> dict[str, Any] | None:
    """None 表示"问不到 tailscaled"——超时、非零退出、答非 JSON 都算。

    死锁时 localapi 既不拒绝也不应答，所以超时本身就是最重要的失败信号。
    """
    try:
        result = subprocess.run(
            [binary, "status", "--json"],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
            check=False,
            env={**os.environ, "TAILSCALE_BE_CLI": "1"},
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def load_state() -> dict[str, Any]:
    try:
        with open(STATE_FILE, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def persist_state(state: dict[str, Any]) -> None:
    """Atomic 0600 write. Mirrors tailscale-login-watchdog.persist_state()."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
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
            json.dump(state, temporary, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, STATE_FILE)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def run_repair(command: list[str]) -> dict[str, Any]:
    """自愈动作本身失败也不能让 watchdog 崩——下一轮还要继续救。"""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        return {"ok": False, "error": str(exc)[:200]}
    if result.returncode != 0:
        # pkill 找不到进程会返回 1，这不算 watchdog 的错误，如实记录即可。
        return {"ok": False, "error": (result.stderr.strip() or f"exit={result.returncode}")[:200]}
    return {"ok": True}


def self_hostname(status: dict[str, Any] | None) -> str:
    if not status:
        return ""
    return str(status.get("Self", {}).get("HostName") or "")


def check_client() -> int:
    """安装前的安全闸：只有目标机才允许装这个会强杀扩展的 daemon。"""
    try:
        binary = tailscale_binary()
    except WatchdogError as exc:
        emit("error", reason=str(exc))
        return 3
    status = probe(binary)
    if status is None:
        emit("error", reason="tailscale_status_unavailable")
        return 3
    hostname = self_hostname(status)
    if hostname.lower() not in ALLOWED_HOSTS:
        emit("error", reason=f"unapproved_client:{hostname}")
        return 3
    emit("client_approved", hostname=hostname)
    return 0


def run_once() -> int:
    now = time.time()

    if DISABLED_FILE.exists():
        emit("disabled", reason=f"safety_gate_present:{DISABLED_FILE}")
        return 0

    try:
        binary = tailscale_binary()
    except WatchdogError as exc:
        emit("error", reason=str(exc))
        return 3

    state = load_state()
    status = probe(binary)
    backend_state = str((status or {}).get("BackendState") or "")

    if status is not None and backend_state == "Running":
        state.update({"fail_count": 0, "restart_round": 0, "last_ok_ts": int(now)})
        persist_state(state)
        emit("healthy", backend_state=backend_state)
        return 0

    reason = "status_unavailable" if status is None else f"backend_state:{backend_state}"
    state["fail_count"] = int(state.get("fail_count") or 0) + 1

    if state["fail_count"] < FAIL_THRESHOLD:
        persist_state(state)
        emit("degraded", reason=reason, fail_count=state["fail_count"])
        return 1

    elapsed = now - float(state.get("last_restart_ts") or 0)
    if elapsed < COOLDOWN_SECONDS:
        persist_state(state)
        emit(
            "cooldown_wait",
            reason=reason,
            fail_count=state["fail_count"],
            remaining=int(COOLDOWN_SECONDS - elapsed),
        )
        return 1

    restart_round = int(state.get("restart_round") or 0)
    if restart_round >= MAX_RESTART_ROUNDS:
        persist_state(state)
        # 重启已经证明救不回来，继续重启只会把机器搞得更不可用。留给人处理。
        emit(
            "stuck_gave_up",
            reason=reason,
            fail_count=state["fail_count"],
            restart_round=restart_round,
        )
        return 2

    restart_round += 1
    # 一级只唤醒 GUI（代价最小）；再不行才强杀扩展，由 NE framework 重新拉起。
    if restart_round == 1:
        method = "open"
        command = [OPEN_BIN, "-gja", GUI_APP]
    else:
        method = "pkill"
        command = [PKILL_BIN, "-f", NETWORK_EXTENSION]
    outcome = run_repair(command)

    state["restart_round"] = restart_round
    state["last_restart_ts"] = int(now)
    # 计数清零：下一轮要重新累计 3 次失败才能证明这次自愈没生效。
    state["fail_count"] = 0
    persist_state(state)
    emit(
        "restart_attempted",
        reason=reason,
        round=restart_round,
        method=method,
        command_ok=outcome["ok"],
        **({"command_error": outcome["error"]} if not outcome["ok"] else {}),
    )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one health pass")
    parser.add_argument(
        "--check-client",
        action="store_true",
        help="validate that this host is an approved target without changing state",
    )
    args = parser.parse_args()

    if args.check_client:
        return check_client()

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
            # 上一轮探测还卡在超时里，这一轮直接让开，不叠加自愈动作。
            emit("already_running")
            return 0
        return run_once()


if __name__ == "__main__":
    sys.exit(main())
