"""一次性看护：固定socket查询前孩子强身份落盘，超时/取消只终止自己的孩子。"""
import json
import os
from pathlib import Path
import resource
import select
import signal
import time
from journal import safe_open
from adb_socket import get_state
from phone_lease import PhoneLease
from process_identity import process_identity, process_matches


def detach():
    os.setsid()
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
    null = os.open('/dev/null', os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    try:
        names = os.listdir('/proc/self/fd' if Path('/proc/self/fd').exists() else '/dev/fd')
        for name in names:
            try:
                fd = int(name)
                if fd > 2:
                    os.close(fd)
            except (ValueError, OSError):
                pass
    except OSError:
        os.closerange(3, resource.getrlimit(resource.RLIMIT_NOFILE)[0])


def terminate_child(pid, identity):
    """每次升级信号前重新核强身份，waitpid证明本直接孩子真正退出。"""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if not process_matches(identity):
            break
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            break
        deadline = time.monotonic() + 0.3
        while time.monotonic() < deadline:
            got, status = os.waitpid(pid, os.WNOHANG)
            if got:
                return status
            time.sleep(0.01)
    got, status = os.waitpid(pid, os.WNOHANG)
    if not got:
        raise ValueError('phone_child_exit_unconfirmed')
    return status


def launch_child(config, identity, journal, state):
    key = identity['dispatch_id']
    ready_r, ready_w = os.pipe()
    go_r, go_w = os.pipe()
    output = journal.root / key / 'adb.out'
    output_fd = safe_open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    pid = os.fork()
    if pid == 0:
        try:
            os.close(ready_r)
            os.close(go_w)
            os.setsid()
            # 独立孩子除了握手与输出不继承看护/journal/SSH fd。
            keep = {ready_w, go_r, output_fd}
            names = os.listdir('/proc/self/fd' if Path('/proc/self/fd').exists() else '/dev/fd')
            for name in names:
                try:
                    fd = int(name)
                    if fd > 2 and fd not in keep:
                        os.close(fd)
                except (ValueError, OSError):
                    pass
            mine = process_identity(os.getpid())
            os.write(ready_w, json.dumps(mine).encode())
            os.close(ready_w)
            permission = os.read(go_r, 1)
            os.close(go_r)
            if permission != b'1':
                os._exit(125)
            os.dup2(output_fd, 1)
            os.close(output_fd)
            signal.signal(signal.SIGTERM, signal.SIG_DFL)
            # 此孩子只运行固定socket函数；不调用任何配置hook、不exec外部ADB。
            result = get_state(identity['serial'], config.hard_cap_sec, _port=config.adb_server_port)
            os.write(1, result.encode('ascii'))
            os._exit(0)
        except Exception:
            os._exit(126)
    os.close(ready_w)
    os.close(go_r)
    os.close(output_fd)
    try:
        if not select.select([ready_r], [], [], 1)[0]:
            raise ValueError('phone_child_identity_unconfirmed')
        raw = os.read(ready_r, 4096)
        child_identity = json.loads(raw)
        if child_identity.get('pid') != pid or not process_matches(child_identity):
            raise ValueError('phone_child_identity_unconfirmed')
        state['child_identity'] = child_identity
        state['phase'] = 'running'
        journal.write(key, state)
        config.fault('after_child_identity')
        config.assert_can_launch()
        os.write(go_w, b'1')
        return pid, child_identity, output
    except Exception:
        # GO未获批准：先关闭握手让孩子退出，再waitpid证明退出；不能提前释放手机锁。
        os.close(go_w)
        go_w = None
        deadline = time.monotonic() + 0.5
        while time.monotonic() < deadline:
            got, _ = os.waitpid(pid, os.WNOHANG)
            if got:
                raise
            time.sleep(0.01)
        raise ValueError('phone_child_exit_unconfirmed')
    finally:
        os.close(ready_r)
        if go_w is not None:
            os.close(go_w)


def run(config, identity, journal):
    key = identity['dispatch_id']
    lease = PhoneLease(config.lock_root, identity)
    acquired = False
    child = None
    reason = 'phone_worker_failed'
    adb_state = None
    status = 'failed'
    try:
        with journal.locked(key):
            state = journal.read(key)
            state['worker_identity'] = process_identity(os.getpid())
            state['phase'] = 'worker_ready'
            journal.write(key, state)
            if state.get('tombstone'):
                raise ValueError('phone_cancelled')
        config.assert_can_launch()
        config.assert_resources()
        config.assert_can_launch()
        with journal.locked(key):
            state = journal.read(key)
            if state.get('tombstone'):
                raise ValueError('phone_cancelled')
            config.assert_can_launch()
            lease.acquire(os.getpid())
            acquired = True
            state['lease_acquired'] = True
            state['phase'] = 'child_preparing'
            journal.write(key, state)
            child = launch_child(config, identity, journal, state)
        pid, child_identity, output = child
        deadline = time.monotonic() + config.hard_cap_sec
        while True:
            got, rc = os.waitpid(pid, os.WNOHANG)
            if got:
                with journal.locked(key):
                    cancelled = journal.read(key).get('tombstone') is True
                if cancelled:
                    reason = 'phone_cancelled'
                    break
                if os.WIFEXITED(rc) and os.WEXITSTATUS(rc) == 0:
                    if output.stat().st_size <= 65536:
                        adb_state = output.read_text().strip()
                    if adb_state == 'device':
                        status, reason = 'completed', 'adb_device'
                    else:
                        reason = 'phone_adb_state_invalid'
                else:
                    reason = 'phone_adb_failed'
                break
            with journal.locked(key):
                cancelled = journal.read(key).get('tombstone') is True
            if cancelled or time.monotonic() >= deadline or output.stat().st_size > 65536:
                terminate_child(pid, child_identity)
                reason = 'phone_cancelled' if cancelled else 'phone_adb_timeout'
                break
            time.sleep(0.02)
    except Exception as error:
        reason = str(error) if str(error).startswith('phone_') else 'phone_launch_refused'
        if reason == 'phone_child_exit_unconfirmed':
            return
        if child:
            try:
                terminate_child(child[0], child[1])
            except Exception:
                return  # 孩子退出未证明：不释放锁、不签终态。
    with journal.locked(key):
        state = journal.read(key)
        try:
            released = lease.release(os.getpid()) if acquired else lease.own_absent()
        except (OSError, ValueError):
            released = False
        if not released:
            state['phase'] = 'unknown'
            journal.write(key, state)
            return
        state['phase'] = 'terminal'
        state['receipt'] = {**identity, 'status': status, 'reason': reason,
                            'execution_exited': True, 'lock_released': True,
                            'lock_owner': identity['lease_token'], 'adb_state': adb_state}
        journal.write(key, state)
