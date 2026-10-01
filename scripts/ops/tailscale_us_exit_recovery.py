"""明确网络恢复范围的真实手机基线；不改变出口或回滚策略。"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
import time
from pathlib import Path


def capture_baseline(api, home, candidate_sha256, actor):
    observed_at = time.time()
    output = api.command(api.adb_prefix(home) + ["devices", "-l"])
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines or lines[0] != "List of devices attached":
        raise RuntimeError("phone baseline: unknown adb output")
    devices = {}
    for line in lines[1:]:
        parts = line.split()
        if (len(parts) < 2 or parts[0] not in api.ADB_SERIALS or parts[0] in devices
                or parts[1] not in ("device", "offline", "unauthorized")
                or any(not re.fullmatch(r"(?:product|model|device|transport_id):[^\s]+", item) for item in parts[2:])):
            raise RuntimeError("phone baseline: unknown device row")
        devices[parts[0]] = parts[1]
    online = sorted(serial for serial, status in devices.items() if status == "device")
    verified = api.verify_adb(home, serials=online)
    if sorted(verified) != online:
        raise RuntimeError("phone baseline: live shell verification mismatch")
    return {"target_serials": sorted(api.ADB_SERIALS), "online_verified": online,
            "offline": sorted(api.ADB_SERIALS-set(online)), "observed_at": observed_at,
            "device_states": {serial: devices.get(serial, "absent") for serial in sorted(api.ADB_SERIALS)},
            "candidate_sha256": candidate_sha256, "target_home": home, "actor": actor}


def save_baseline(path, baseline):
    raw = json.dumps(baseline, sort_keys=True).encode()
    with (Path(path) / "phone-baseline.json").open("xb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return hashlib.sha256(raw).hexdigest()


def read_root_file(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if (metadata.st_uid != 0 or metadata.st_mode & 0o077
                    or not stat.S_ISREG(metadata.st_mode)):
                raise RuntimeError("phone baseline: require root600 regular file")
            raw = stream.read(16385)
            if len(raw) > 16384:
                raise RuntimeError("phone baseline: oversized file")
            return raw
    except OSError as exc:
        raise RuntimeError("phone baseline: missing or unsafe file") from exc


def load_baseline(path, state, serials):
    raw = read_root_file(Path(path) / "phone-baseline.json")
    try:
        baseline = json.loads(raw)
        online = baseline["online_verified"]
        offline = baseline["offline"]
        states = baseline["device_states"]
        observed = baseline["observed_at"]
        valid = (isinstance(baseline, dict)
            and hashlib.sha256(raw).hexdigest() == state["baseline_sha256"]
            and baseline["target_serials"] == sorted(serials)
            and isinstance(online, list) and online == sorted(set(online))
            and set(online) <= serials and offline == sorted(serials-set(online))
            and isinstance(states, dict) and set(states) == serials
            and all(value in ("absent", "offline", "unauthorized", "device") for value in states.values())
            and sorted(serial for serial, value in states.items() if value == "device") == online
            and baseline["candidate_sha256"] == state["candidate_sha256"]
            and re.fullmatch(r"[0-9a-f]{64}", baseline["candidate_sha256"]) is not None
            and baseline["target_home"] == state["target_home"]
            and baseline["actor"] == state["approval_actor"] and bool(baseline["actor"])
            and isinstance(observed, (int, float)) and math.isfinite(observed)
            and 0 <= state["armed_at"]-observed <= 120)
    except (ValueError, KeyError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise RuntimeError("phone baseline: digest or transaction binding invalid")
    return baseline


def required_phones(path, state, serials):
    scope = state.get("confirmation_scope", "all-phones")
    if scope == "all-phones":
        return sorted(serials), []
    if scope != "network-recovery":
        raise RuntimeError("unknown armed confirmation scope")
    baseline = load_baseline(path, state, serials)
    return baseline["online_verified"], baseline["offline"]
