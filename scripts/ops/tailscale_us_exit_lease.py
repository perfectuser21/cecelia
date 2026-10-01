#!/usr/bin/env python3
"""独立 KeepAlive 守卫：主巡检停止时撤过期业务 pass，保留恢复规则。"""
from __future__ import annotations

import fcntl
import hashlib
import importlib.util
import os
import re
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from tailscale_us_exit_policy import InterfaceFirewall, MAX_EVIDENCE_AGE, read_map_cache, save_map_cache

SIGNATURE = "cecelia-us-exit-v2"
GUARD_LABEL = "com.cecelia.tailscale-us-exit.lease"
GUARD_INTERVAL = 2


@contextmanager
def pf_lock(path):
    flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW
    with os.fdopen(os.open(path, flags, 0o600), "a+") as stream:
        os.fchmod(stream.fileno(), 0o600)
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        yield


def valid_lease(lease, now):
    try:
        return (lease.get("signature") == SIGNATURE and bool(lease.get("generation"))
                and 0 <= now - lease["observed_at"] <= MAX_EVIDENCE_AGE
                and now < lease["expires_at"] <= lease["observed_at"] + MAX_EVIDENCE_AGE)
    except (KeyError, TypeError, AttributeError):
        return False


def guard_alive(cache, now=None):
    now = time.time() if now is None else now
    health = read_map_cache(cache.with_name("guard-health.json"), now=now, max_age=4)
    try:
        if health.get("signature") != SIGNATURE or not 0 <= now - health.get("observed_at", 0) <= 4:
            return False
        os.kill(int(health["pid"]), 0)
        return True
    except (KeyError, TypeError, ValueError, OSError):
        return False


def reconcile_once(firewall, now=None):
    with pf_lock(firewall.pf_lock):
        lease = read_map_cache(firewall.lease, max_age=MAX_EVIDENCE_AGE)
        if valid_lease(lease, time.time() if now is None else now):
            return
        # 同一短锁核当代 lease；封闭规则也必须随 peer/DERP cache 到期更新。
        desired = hashlib.sha256(firewall.rules(False).encode()).hexdigest()
        recorded = read_map_cache(firewall.cache.with_name("closed-policy.json"))
        installed = firewall.current_rules()
        if (recorded.get("sha256") != desired or re.search(r"\bon utun\d+\b|\b(user|group)\b", installed)
                or SIGNATURE not in installed or "block drop out quick" not in installed):
            firewall._apply(False)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("租约守卫必须 root 运行")
    source = Path(__file__).resolve().with_name("tailscale-us-exit-enforcer.py")
    spec = importlib.util.spec_from_file_location("lease_enforcer", source)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    cache = Path(os.environ.get("CECELIA_US_EXIT_DERP_CACHE", "/var/db/cecelia/tailscale-us-exit/derp-map.json"))
    cache.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            firewall = InterfaceFirewall(api, read_interfaces=False)
            reconcile_once(firewall)
            save_map_cache(cache.with_name("guard-health.json"),
                {"signature": SIGNATURE, "pid": os.getpid(), "observed_at": time.time()})
        except (OSError, RuntimeError, ValueError) as exc:
            print(str(exc), file=sys.stderr, flush=True)
        time.sleep(GUARD_INTERVAL)


if __name__ == "__main__":
    main()
