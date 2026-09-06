#!/usr/bin/env python3
"""Keep this machine authenticated to the tailnet.

替代 com.cecelia.tailscale-watchdog —— 那个 watchdog 检测 GUI App 是否在跑
(`pgrep -x Tailscale || open -a Tailscale`)，而本机运行的是 brew 版 tailscaled，
`/Applications/Tailscale.app` 并不存在，因此它每 60 秒失败一次、长期无效；
即便修正了对象，"进程是否存活" 也抓不到 2026-09-06 04:42 那类故障——
tailscaled 存活了 7 天，掉的是认证状态 (Running -> NeedsLogin)，
所有 mosh-server 绑定的 100.71.151.105 随之不可达，slot1-10 全部卡死。

判定支点：以 `tailscale status --json` 的 BackendState 为唯一依据，绝不看 IP。
故障期间 utun4 上的 100.71.151.105 始终残留，任何 "IP 还在就算健康" 的检查
都会误判（现有 tailscale-us-exit-enforcer.validate_self 即是如此）。
"""

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# 退避阶梯：连续失败 N 次后，距上次尝试至少间隔这么多秒才允许再试。
# 防止重认证持续失败时每 60 秒打一次 control plane 触发限流（反而更难恢复）。
BACKOFF_SECONDS = [60, 300, 900, 1800]

AUTHKEY_EXPIRY_WARN_DAYS = 14
SECRET_PATTERN = re.compile(r"tskey-[a-z]+-\S+")

STATE_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_TS_WATCHDOG_STATE_FILE",
            "/var/db/cecelia/tailscale-login-watchdog/state.json",
        )
    )
)
LOCK_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_TS_WATCHDOG_LOCK_FILE",
            "/var/db/cecelia/tailscale-login-watchdog/watchdog.lock",
        )
    )
)
DISABLED_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_TS_WATCHDOG_DISABLED_FILE",
            "/var/db/cecelia/tailscale-login-watchdog/DISABLED",
        )
    )
)
CREDENTIALS_FILE = Path(
    os.path.expanduser(
        os.environ.get("CECELIA_TS_WATCHDOG_CREDENTIALS", "~/.credentials/tailscale.env")
    )
)
HOSTNAME = os.environ.get("CECELIA_TS_WATCHDOG_HOSTNAME", "perfect21")


class WatchdogError(RuntimeError):
    """A recoverable failure worth reporting but not crashing on."""


def redact(value: Any) -> Any:
    """Never let an authkey reach stdout/stderr or the state file."""
    if isinstance(value, str):
        return SECRET_PATTERN.sub("tskey-***", value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


def emit(action: str, **details: Any) -> None:
    print(
        json.dumps(
            redact({"component": "tailscale_login_watchdog", "action": action, **details}),
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )


def tailscale_binary() -> str:
    """Locate the CLI. Mirrors tailscale-us-exit-enforcer.tailscale_binary().

    坏 watchdog 硬编码 /Applications/Tailscale.app 正是踩在这里：
    本机是 brew 版，那个路径不存在。
    """
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


def run_tailscale(command: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env={**os.environ, "TAILSCALE_BE_CLI": "1"},
    )


def load_json(binary: str, args: list[str]) -> dict[str, Any] | None:
    """Return parsed JSON, or None when the CLI could not answer.

    None 明确表示 "问不到 tailscaled"（守护进程死了/无响应），
    与 "问到了但没登录" 是两种故障，处置方式不同。
    """
    try:
        result = run_tailscale([binary, *args])
    except (subprocess.SubprocessError, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def load_state() -> dict[str, Any]:
    try:
        with open(STATE_FILE, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def persist_state(state: dict[str, Any]) -> None:
    """Atomic 0600 write. Mirrors tailscale-us-exit-enforcer.persist_state()."""
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
            json.dump(redact(state), temporary, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, STATE_FILE)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def backoff_for(failures: int) -> int:
    if failures <= 0:
        return 0
    index = min(failures, len(BACKOFF_SECONDS)) - 1
    return BACKOFF_SECONDS[index]


def authkey_warnings(now: float) -> list[str]:
    """authkey 字符串本身不含到期时间，且查询 API 需要 Tailscale API key
    （1Password 里那把已于 2026-08-29 过期）。故到期日以可选环境变量提供；
    未提供则跳过——不因缺少可选配置阻塞主逻辑。"""
    raw = os.environ.get("TAILSCALE_AUTHKEY_EXPIRES", "").strip()
    if not raw:
        return []
    try:
        expires = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return [f"authkey_expires_unparsable:{raw}"]
    remaining = (expires - datetime.fromtimestamp(now, tz=timezone.utc)).days
    if remaining <= AUTHKEY_EXPIRY_WARN_DAYS:
        return [f"authkey_expiring_in_{remaining}_days"]
    return []


def decide_action(
    status: dict[str, Any] | None,
    prefs: dict[str, Any] | None,
    now: float,
    state: dict[str, Any],
    disabled: bool,
) -> dict[str, Any]:
    """Pure decision function — no side effects, fully covered by CI.

    status=None 表示 `tailscale status --json` 问不到 tailscaled。
    """
    warnings = authkey_warnings(now)

    if status is None:
        return {
            "action": "restart_daemon",
            "reason": "tailscale_status_unavailable",
            "warnings": warnings,
        }

    backend_state = str(status.get("BackendState") or "")

    if backend_state == "Running":
        return {"action": "ok", "reason": "running", "warnings": warnings}

    # Stopped 有两种成因：人主动 `tailscale down`（WantRunning=false），
    # 与异常停止。前者自动 up 会对抗管理意图，必须区分。
    if backend_state == "Stopped" and prefs is not None and prefs.get("WantRunning") is False:
        return {"action": "ok", "reason": "stopped_by_operator", "warnings": warnings}

    if backend_state not in ("NeedsLogin", "Stopped", "NoState"):
        return {
            "action": "ok",
            "reason": f"unhandled_backend_state:{backend_state}",
            "warnings": warnings,
        }

    # 需要重认证——先过安全闸与退避两道关。
    if disabled:
        return {
            "action": "disabled",
            "reason": f"safety_gate_present:{backend_state}",
            "warnings": warnings,
        }

    failures = int(state.get("consecutive_failures") or 0)
    if failures > 0:
        elapsed = now - float(state.get("last_attempt_ts") or 0)
        required = backoff_for(failures)
        if elapsed < required:
            return {
                "action": "backoff",
                "reason": f"cooling_down:{int(required - elapsed)}s_remaining",
                "warnings": warnings,
            }

    return {"action": "reauth", "reason": f"backend_state:{backend_state}", "warnings": warnings}


def resolve_authkey() -> str:
    """env → ~/.credentials/tailscale.env → 1Password，取到后回写本地。

    回写遵循 CLAUDE.md「1Password 唯一源 → 双写 ~/.credentials/」：
    本地有缓存后，即便 1Password 不可达也能自救。
    """
    from_env = os.environ.get("TAILSCALE_AUTHKEY", "").strip()
    if from_env:
        return from_env

    if CREDENTIALS_FILE.is_file():
        try:
            for line in CREDENTIALS_FILE.read_text(encoding="utf-8").splitlines():
                match = re.match(r"\s*(?:export\s+)?TAILSCALE_AUTHKEY=['\"]?([^'\"\s]+)", line)
                if match:
                    return match.group(1)
        except OSError:
            pass

    key = fetch_authkey_from_1password()
    if key:
        cache_authkey(key)
        return key
    raise WatchdogError("authkey_unavailable")


def fetch_authkey_from_1password() -> str:
    token = os.environ.get("OP_SERVICE_ACCOUNT_TOKEN", "")
    if not token:
        # 1password.env 只在本函数内读取，绝不落盘、绝不进日志。
        env_file = Path(os.path.expanduser("~/.credentials/1password.env"))
        if not env_file.is_file():
            return ""
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                match = re.match(
                    r"\s*(?:export\s+)?OP_SERVICE_ACCOUNT_TOKEN=['\"]?([^'\"\s]+)", line
                )
                if match:
                    token = match.group(1)
                    break
        except OSError:
            return ""
    if not token:
        return ""

    try:
        result = subprocess.run(
            ["op", "item", "get", "Tailscale", "--vault", "CS", "--format", "json"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
            env={**os.environ, "OP_SERVICE_ACCOUNT_TOKEN": token},
        )
    except (subprocess.SubprocessError, OSError):
        return ""
    if result.returncode != 0:
        return ""
    try:
        item = json.loads(result.stdout)
    except json.JSONDecodeError:
        return ""
    for field in item.get("fields", []) or []:
        value = field.get("value") or ""
        match = re.search(r"TAILSCALE_ONBOARD_AUTHKEY=(\S+)", value)
        if match:
            return match.group(1)
    return ""


def cache_authkey(key: str) -> None:
    try:
        CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing = ""
        if CREDENTIALS_FILE.is_file():
            existing = CREDENTIALS_FILE.read_text(encoding="utf-8")
            existing = "\n".join(
                line for line in existing.splitlines() if "TAILSCALE_AUTHKEY=" not in line
            )
            if existing and not existing.endswith("\n"):
                existing += "\n"
        CREDENTIALS_FILE.write_text(f"{existing}TAILSCALE_AUTHKEY={key}\n", encoding="utf-8")
        os.chmod(CREDENTIALS_FILE, 0o600)
    except OSError:
        pass  # 缓存失败不影响本次重认证


def reauth(binary: str, authkey: str) -> subprocess.CompletedProcess[str]:
    """只带 --hostname / --accept-dns。

    绝不带 --reset / --exit-node / --advertise-routes —— 那会覆盖现有 prefs。
    2026-09-06 手动恢复即用此法，prefs 未被破坏。
    """
    return run_tailscale(
        [
            binary,
            "up",
            f"--authkey={authkey}",
            f"--hostname={HOSTNAME}",
            "--accept-dns=true",
        ],
        timeout=90,
    )


def self_ips(status: dict[str, Any] | None) -> list[str]:
    if not status:
        return []
    return list(status.get("Self", {}).get("TailscaleIPs") or [])


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
        return reconcile()


def reconcile() -> int:
    now = time.time()
    state = load_state()

    try:
        binary = tailscale_binary()
    except WatchdogError as exc:
        emit("error", reason=str(exc))
        return 3

    status = load_json(binary, ["status", "--json"])
    prefs = load_json(binary, ["debug", "prefs"]) if status is not None else None
    decision = decide_action(status, prefs, now, state, DISABLED_FILE.exists())
    action = decision["action"]

    if action in ("ok", "backoff", "disabled", "restart_daemon"):
        if action == "ok":
            state["consecutive_failures"] = 0
            ips = self_ips(status)
            if ips:
                state["last_ip"] = ips[0]
            persist_state(state)
        emit(action, reason=decision["reason"], warnings=decision["warnings"])
        # restart_daemon / disabled 需要人工介入，用非 0 返回码让 launchd 日志留痕
        return 2 if action in ("restart_daemon", "disabled") else 0

    # action == "reauth"
    previous_ip = state.get("last_ip") or (self_ips(status)[:1] or [""])[0]
    try:
        authkey = resolve_authkey()
    except WatchdogError as exc:
        state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1
        state["last_attempt_ts"] = now
        persist_state(state)
        emit("error", reason=str(exc), warnings=decision["warnings"])
        return 3

    result = reauth(binary, authkey)
    state["last_attempt_ts"] = now

    if result.returncode != 0:
        state["consecutive_failures"] = int(state.get("consecutive_failures") or 0) + 1
        persist_state(state)
        emit(
            "reauth_failed",
            reason=(result.stderr.strip() or f"exit={result.returncode}")[:300],
            consecutive_failures=state["consecutive_failures"],
            warnings=decision["warnings"],
        )
        return 3

    state["consecutive_failures"] = 0
    verified = load_json(binary, ["status", "--json"])
    current_ips = self_ips(verified)
    if current_ips:
        state["last_ip"] = current_ips[0]
    persist_state(state)

    warnings = list(decision["warnings"])
    # IP 漂移会让所有 mosh-server 绑定的旧地址失效（slot 全断），
    # watchdog 自身救不了（需重启 slot 会话），必须告警。
    if previous_ip and current_ips and previous_ip not in current_ips:
        warnings.append(f"tailscale_ip_changed:{previous_ip}->{current_ips[0]}")

    emit(
        "reauth",
        reason=decision["reason"],
        backend_state=str((verified or {}).get("BackendState") or "unknown"),
        self_ips=current_ips,
        warnings=warnings,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
