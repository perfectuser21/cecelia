#!/usr/bin/env python3
"""全机公网策略的显式审批切换；只改专用 anchor，独立 launchd 定时恢复。"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import pwd
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ANCHOR = "com.apple/cecelia-us-exit"
LABEL = "com.cecelia.tailscale-us-exit"
INSTALL = Path("/usr/local/libexec/cecelia")
CACHE = Path("/var/db/cecelia/tailscale-us-exit/derp-map.json")
GUARD_LABEL = LABEL + ".lease"
GUARD_PLIST = Path(f"/Library/LaunchDaemons/{GUARD_LABEL}.plist")
PLIST = Path(f"/Library/LaunchDaemons/{LABEL}.plist")
FILES = (INSTALL / "tailscale-us-exit-enforcer.py", INSTALL / "tailscale_us_exit_policy.py",
         INSTALL / "tailscale_us_exit_activation.py", INSTALL / "tailscale_us_exit_legacy.py", PLIST, GUARD_PLIST, INSTALL / "tailscale_us_exit_lease.py", CACHE,
         CACHE.with_name("bootstrap-peers.json"), CACHE.with_name("bootstrap-context.json"),
         CACHE.with_name("business-lease.json"), CACHE.with_name("guard-health.json"))


def command(args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True,
                            timeout=30, check=False)
    if result.returncode:
        raise RuntimeError("命令失败: " + " ".join(args) + ": " + result.stderr[:300])
    return result.stdout


def validate_preflight(anchors, info, states):
    if "Status: Enabled" not in info:
        raise RuntimeError("PF 必须已启用；本切换不改变 PF 全局状态")
    counts = re.findall(r"current entries\s+(\d+)", info)
    if not counts or any(int(count) for count in counts) or states.strip():
        raise RuntimeError("已有 PF states 或状态数不明；拒绝切换，禁止全局清除")
    root = anchors.get("root", "")
    if not re.search(r'anchor\s+"com\.apple/\*"', root):
        raise RuntimeError("根规则未包含专用 anchor 的加载路径")
    for name, rules in anchors.items():
        if name == ANCHOR:
            continue  # 本事务替换的唯一旧身份过滤位置。
        if re.search(r"\b(user|group)\b|log\s*\([^)]*user", rules):
            raise RuntimeError("其他有效 anchor 仍有 PF 身份查询: " + name)
        if re.search(r"\bpass\b[^\n]*\bquick\b|\banchor\b[^\n]*\bquick\b", rules):
            raise RuntimeError("未知 quick 提前授权可能绕过终止规则: " + name)
        # 有效树除本 anchor 不容存在任何非空过滤规则；此前诊断其他均空。
        for line in rules.splitlines():
            if line.strip() and not re.match(r"\s*(anchor|scrub-anchor|#)", line):
                raise RuntimeError("需独审的其他全局过滤规则: " + name)


def preflight():
    anchors = {"root": command(["/sbin/pfctl", "-sr"])}
    queue = [name.strip() for name in command(["/sbin/pfctl", "-s", "Anchors"]).splitlines() if name.strip()]
    seen = set()
    while queue:
        name = queue.pop(0)
        if name in seen:
            continue
        seen.add(name)
        anchors[name] = command(["/sbin/pfctl", "-a", name, "-sr"])
        for child in command(["/sbin/pfctl", "-a", name, "-s", "Anchors"]).splitlines():
            child = child.strip()
            if child:
                queue.append(child if child.startswith(name + "/") else name + "/" + child)
    info = command(["/sbin/pfctl", "-s", "info"])
    states = command(["/sbin/pfctl", "-ss"])
    validate_preflight(anchors, info, states)
    return {"anchors": anchors, "info": info, "states": states, "observed_at": time.time()}


def read_transaction(path):
    path = Path(path)
    metadata = path.lstat()
    if path.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o077:
        raise RuntimeError("切换事务必须是 root 独占目录")
    state = json.loads((path / "transaction.json").read_text())
    if state.get("anchor") != ANCHOR or not state.get("approval_actor"):
        raise RuntimeError("缺明确审批记录")
    return path, state


def save_transaction(path, state):
    temporary = path / ".transaction.json"
    with temporary.open("w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(state, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path / "transaction.json")


def verify_transaction(path):
    path, state = read_transaction(path)
    if state.get("status") != "armed" or time.time() >= state["deadline"]:
        raise RuntimeError("未武装或已过期的自动回滚事务")
    job = command(["/bin/launchctl", "print", "system/" + state["rollback_label"]])
    pid = state.get("watchdog_pid", 0)
    if not pid or not re.search(r"state\s*=\s*running", job) or not re.search(rf"pid\s*=\s*{pid}\b", job):
        raise RuntimeError("自动回滚没有存活且已握手的独立进程")
    os.kill(pid, 0)
    return path, state


def locked(path):
    stream = (path / "transaction.lock").open("a+")
    os.fchmod(stream.fileno(), 0o600)
    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
    return stream


def rollback(path):
    path, state = read_transaction(path)
    with locked(path):
        state = json.loads((path / "transaction.json").read_text())
        if state["status"] in ("confirmed", "rolled_back"):
            return
        subprocess.run(["/bin/launchctl", "bootout", "system/" + GUARD_LABEL], capture_output=True, timeout=20)
        subprocess.run(["/bin/launchctl", "bootout", "system/" + LABEL], capture_output=True, timeout=20)
        for entry in state["files"]:
            target = Path(entry["target"])
            if entry["existed"]:
                shutil.copy2(path / entry["backup"], target)
            elif target.exists():
                target.unlink()
        command(["/sbin/pfctl", "-a", ANCHOR, "-f", str(path / "previous.pf")])
        if GUARD_PLIST.exists():
            command(["/bin/launchctl", "bootstrap", "system", str(GUARD_PLIST)])
        if PLIST.exists():
            command(["/bin/launchctl", "bootstrap", "system", str(PLIST)])
        state.update(status="rolled_back", rolled_back_at=time.time())
        save_transaction(path, state)


def watchdog(path):
    path, state = read_transaction(path)
    with locked(path):
        state = json.loads((path / "transaction.json").read_text())
        state.update(watchdog_pid=os.getpid(), watchdog_ready_at=time.time())
        save_transaction(path, state)
    while time.time() < state["deadline"]:
        state = json.loads((path / "transaction.json").read_text())
        if state["status"] in ("confirmed", "rolled_back"):
            return
        time.sleep(min(2, max(0, state["deadline"] - time.time())))
    rollback(path)


def guarded_command(path, arguments):
    verify_transaction(path)
    output = command(arguments)
    verify_transaction(path)
    return output


def validate_candidate(candidate, current):
    if candidate != current:
        raise RuntimeError("候选与 fresh 认证策略不一致；请重新生成候选并复核")


def fresh_policy(home):
    # 身份凭证只留在目标用户的 Tailscale 上下文；不读取或输出原始 prefs。
    metadata = Path(home).stat()
    user = pwd.getpwuid(metadata.st_uid)
    os.environ.update(CECELIA_US_EXIT_TARGET_USER=user.pw_name,
                      CECELIA_US_EXIT_TARGET_UID=str(user.pw_uid),
                      CECELIA_US_EXIT_TARGET_HOME=str(home))
    source = Path(__file__).resolve().parent / "tailscale-us-exit-enforcer.py"
    spec = importlib.util.spec_from_file_location("activation_enforcer", source)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    from tailscale_us_exit_policy import InterfaceFirewall
    firewall = InterfaceFirewall(api)
    firewall.refresh(api.tailscale_binary(), persist=False)
    return firewall


def activate(args):
    if os.geteuid() != 0:
        raise RuntimeError("切换需要 root")
    if args.approve_scope != "all-users-public-egress-and-bootstrap-exceptions":
        raise RuntimeError("必须明确审批全用户公网限制及 bootstrap 例外")
    source = Path(__file__).resolve().parent
    firewall = fresh_policy(args.home)
    audit = preflight()
    candidate = Path(args.candidate).read_text()
    if re.search(r"\b(user|group)\b|log\s*\([^)]*user", candidate):
        raise RuntimeError("候选含身份查询")
    if not candidate.rstrip().endswith("block drop out quick proto { tcp udp } all"):
        raise RuntimeError("候选缺全接口公网终止规则")
    validate_candidate(candidate, firewall.rules(True))
    command(["/sbin/pfctl", "-n", "-a", ANCHOR, "-f", args.candidate])
    path = Path(args.transaction)
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(path, 0o700)
    entries = []
    for index, target in enumerate(FILES):
        backup = f"backup-{index}"
        entries.append({"target": str(target), "existed": target.exists(), "backup": backup})
        if target.exists():
            shutil.copy2(target, path / backup)
    (path / "previous.pf").write_text(audit["anchors"].get(ANCHOR, ""))
    (path / "preflight.json").write_text(json.dumps(audit))
    (path / "bootstrap.pf").write_text(firewall.rules(False))
    # Watchdog code is copied outside libexec so installer cannot replace/delete it.
    shutil.copy2(__file__, path / "rollback.py")
    state = {"anchor": ANCHOR, "approval_actor": args.actor,
             "approval_scope": args.approve_scope, "status": "armed",
             "deadline": time.time() + args.timeout, "files": entries,
             "rollback_label": LABEL + ".rollback." + path.name,
             "candidate_sha256": hashlib.sha256(candidate.encode()).hexdigest()}
    save_transaction(path, state)
    rollback_plist = path / "rollback.plist"
    with rollback_plist.open("wb") as stream:
        plistlib.dump({"Label": state["rollback_label"], "RunAtLoad": True,
            "ProgramArguments": ["/usr/bin/python3", str(path / "rollback.py"), "watchdog", "--transaction", str(path)],
            "StandardOutPath": str(path / "rollback.log"), "StandardErrorPath": str(path / "rollback.log")}, stream)
    command(["/bin/launchctl", "bootstrap", "system", str(rollback_plist)])
    try:
        ready_deadline = time.time() + 5
        while True:
            try:
                verify_transaction(path)
                break
            except RuntimeError:
                if time.time() >= ready_deadline:
                    raise
                time.sleep(0.05)
        with locked(path):
            verify_transaction(path)
            preflight()
            guarded_command(path, ["/bin/launchctl", "bootout", "system/" + LABEL])
            environment = dict(os.environ, CECELIA_US_EXIT_ACTIVATION_TRANSACTION=str(path))
            verify_transaction(path)
            subprocess.run(["/bin/bash", str(source / "install-tailscale-us-exit-enforcer.sh"),
                            "--home", args.home, "--firewall-mode", "interface-v2", "--no-load"],
                           env=environment, check=True, timeout=60)
            verify_transaction(path)
            from tailscale_us_exit_policy import save_map_cache
            save_map_cache(CACHE, firewall.map)
            guarded_command(path, ["/sbin/pfctl", "-a", ANCHOR, "-f", str(path / "bootstrap.pf")])
            guarded_command(path, ["/bin/launchctl", "enable", "system/" + GUARD_LABEL])
            guarded_command(path, ["/bin/launchctl", "bootstrap", "system", str(GUARD_PLIST)])
            from tailscale_us_exit_lease import guard_alive
            guard_deadline = time.time() + 5
            while not guard_alive(CACHE):
                verify_transaction(path)
                if time.time() >= guard_deadline:
                    raise RuntimeError("独立租约守卫未握手，拒绝启用业务")
                time.sleep(0.05)
            guarded_command(path, ["/bin/launchctl", "enable", "system/" + LABEL])
            guarded_command(path, ["/bin/launchctl", "bootstrap", "system", str(PLIST)])
            print(json.dumps({"status": "armed", "transaction": str(path), "deadline": state["deadline"]}))
    except BaseException:
        rollback(path)
        raise


def confirm(args):
    path, _ = read_transaction(args.transaction)
    with locked(path):
        path, state = verify_transaction(path)
        evidence = json.loads(Path(args.evidence).read_text())
        source_ip = os.environ.get("SSH_CONNECTION", "").split(" ")[0]
        if not source_ip or source_ip in ("127.0.0.1", "::1", "100.86.57.69", "100.88.166.55"):
            raise RuntimeError("确认必须从另一台机器 SSH 进入")
        if (evidence.get("observer_ssh_ip") != source_ip
                or evidence.get("candidate_sha256") != state["candidate_sha256"]
                or not 0 <= time.time() - evidence.get("observed_at", 0) <= 120
                or evidence.get("us_exit_verified") is not True
                or len(set(evidence.get("adb_serials_verified", []))) != 2
                or not evidence.get("actor")):
            raise RuntimeError("缺 fresh 的同候选远程 SSH、美国出口和双 ADB 验收事实")
        from tailscale_us_exit_lease import guard_alive, valid_lease
        from tailscale_us_exit_policy import read_map_cache
        if not guard_alive(CACHE) or not valid_lease(read_map_cache(CACHE.with_name("business-lease.json"), max_age=15), time.time()):
            raise RuntimeError("验收时租约守卫及健康授权必须真实存活")
        rules = command(["/sbin/pfctl", "-a", ANCHOR, "-sr"])
        if re.search(r"\b(user|group)\b|log\s*\([^)]*user", rules) or "block drop out quick" not in rules:
            raise RuntimeError("当前专用 anchor 未保持新策略")
        state.update(status="confirmed", confirmed_at=time.time(), evidence=evidence)
        save_transaction(path, state)
    command(["/bin/launchctl", "bootout", "system/" + state["rollback_label"]])
    print(json.dumps({"status": "confirmed", "transaction": str(path)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "activate", "verify-transaction", "watchdog", "rollback", "confirm"))
    parser.add_argument("--transaction")
    parser.add_argument("--candidate")
    parser.add_argument("--home")
    parser.add_argument("--actor")
    parser.add_argument("--approve-scope")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--evidence")
    args = parser.parse_args()
    if args.action == "preflight":
        print(json.dumps(preflight(), ensure_ascii=False))
    elif args.action == "activate":
        if not all((args.transaction, args.candidate, args.home, args.actor)) or not 60 <= args.timeout <= 600:
            parser.error("切换需事务目录、候选、home、actor 和 60–600 秒期限")
        activate(args)
    elif args.action == "confirm":
        confirm(args)
    else:
        {"verify-transaction": verify_transaction, "watchdog": watchdog, "rollback": rollback}[args.action](args.transaction)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
