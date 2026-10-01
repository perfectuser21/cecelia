"""旧模式回滚支持；生产默认保留，interface-v2 不使用旧 PF 身份过滤。"""
from __future__ import annotations
import json
import os
import re
import subprocess
import time
from pathlib import Path

# 2026-09-03: 连续失败容错。此前任何一次瞬时错误（tailscale CLI 超时、
# configd 抖动导致 socket 短暂不可达等）都会立刻 fail-closed 拉闸，
# 把 configd watchdog 崩溃这类和"选错出口"完全无关的瞬时故障也放大成
# 用户全网断流。容错阈值内只记录不拉闸，超过阈值才真正拉闸，
# 一次成功即清零计数。
CONSECUTIVE_FAILURE_THRESHOLD = int(
    os.environ.get("CECELIA_US_EXIT_FAILURE_THRESHOLD", "3")
)
FAILURE_COUNT_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_US_EXIT_FAILURE_COUNT_FILE",
            "/var/db/cecelia/tailscale-us-exit/failure-count.txt",
        )
    )
)

# 2026-09-04: 单独区分"daemon/socket 本身不可达"这一类错误。这类错误
# 发生时 utun 隧道接口根本不存在，旧规则里 "pass ... on utunN" 天然匹配
# 不上任何流量，非LAN流量早已落到默认的 block drop——主动再拉一次闸
# 对安全边界没有增量收益，却会把"正在重装/重启 Tailscale"这种正常维护
# 窗口放大成整机失联，且要等下一次"healthy"巡检才能解闸。给这一类错误
# 单独更宽松的阈值（默认10次≈10分钟），不影响"daemon有响应但选错出口"
# 这种真正的合规违规——那类错误仍然沿用上面 3 次的严格阈值。
DAEMON_ABSENT_FAILURE_THRESHOLD = int(
    os.environ.get("CECELIA_US_EXIT_DAEMON_ABSENT_THRESHOLD", "10")
)
DAEMON_ABSENT_COUNT_FILE = Path(
    os.path.expanduser(
        os.environ.get(
            "CECELIA_US_EXIT_DAEMON_ABSENT_COUNT_FILE",
            "/var/db/cecelia/tailscale-us-exit/daemon-absent-count.txt",
        )
    )
)
_DAEMON_ABSENT_MARKERS = (
    "no such file or directory",
    "connection refused",
    "tailscale_binary_not_found",
    "tailscale_status_unavailable",
)

# 2026-09-07: 计数器过期语义。此前计数是裸整数，只在"成功 tick"时清零；
# 一旦某次事故以失败收场（机器重启、Tailscale 重装、巡检被 launchd 停掉），
# 残留计数就会一直躺在盘上。9-07 xian-m4 断网事故里，故障刚开始的第一条
# 错误日志就是 consecutive_failures=51 —— 上面两个阈值的容错保护等于不存在，
# 第一秒就拉闸。改为记录 last_failure_ts，超过 5 倍 StartInterval 没有新失败
# 即视为上一次事故的残留，从 0 重计。
COUNTER_EXPIRY_SECONDS = int(os.environ.get("CECELIA_US_EXIT_COUNTER_EXPIRY", "300"))


class EnforcementError(RuntimeError):
    """The required US-only exit invariant could not be established."""


def is_daemon_absent_error(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in _DAEMON_ABSENT_MARKERS)


def read_count(path: Path, now: float | None = None) -> int:
    """读计数，过期或格式不认识一律当 0。

    旧的裸整数格式没有时间戳，无法判断新鲜度，按过期处理——宁可少算一次
    容错，也不能把上一次事故的计数带进这一次。
    """
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return 0
    if not isinstance(payload, dict):
        return 0
    try:
        count = int(payload.get("count") or 0)
        last_failure_ts = float(payload.get("last_failure_ts") or 0)
    except (TypeError, ValueError):
        return 0
    if (now if now is not None else time.time()) - last_failure_ts > COUNTER_EXPIRY_SECONDS:
        return 0
    return max(count, 0)


def write_count(path: Path, count: int, now: float | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "count": count,
        "last_failure_ts": now if now is not None else time.time(),
    }
    path.write_text(json.dumps(payload, sort_keys=True))


def read_failure_count() -> int:
    return read_count(FAILURE_COUNT_FILE)


def write_failure_count(count: int) -> None:
    write_count(FAILURE_COUNT_FILE, count)


def read_daemon_absent_count() -> int:
    return read_count(DAEMON_ABSENT_COUNT_FILE)


def write_daemon_absent_count(count: int) -> None:
    write_count(DAEMON_ABSENT_COUNT_FILE, count)


class LegacyFailClosedFirewall:
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

