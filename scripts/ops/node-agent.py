#!/usr/bin/env python3
"""节点本地观察器：只采样资源及专属缓存，不删除数据。"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import platform
import re
import socket
import stat
import subprocess
import tempfile
import time
import uuid


def private_dir(path):
    path = Path(path)
    # 检查所有已有父级，避免专用目录被软链引向业务目录。
    for parent in [*reversed(path.parents), path]:
        if parent.is_symlink():
            raise ValueError('路径不允许软链')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_uid != os.getuid():
        raise ValueError('目录归属不匹配')
    os.chmod(path, 0o700)
    return path


def atomic_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False).encode())


def atomic_write(path, data):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('文件不允许软链')
    fd, tmp = tempfile.mkstemp(prefix='.write-', dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def prepare_identity(home, node_id):
    if str(uuid.UUID(node_id)) != node_id:
        raise ValueError('节点身份非法')
    home = Path(home).resolve()
    root = private_dir(home / '.local/share/cecelia-node')
    identity = root / 'identity.json'
    lock_fd = os.open(str(root / 'identity.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if identity.is_symlink():
            raise ValueError('节点身份文件非法')
        if identity.exists():
            if json.loads(identity.read_text()).get('node_id') != node_id:
                raise ValueError('已有其他节点身份')
        else:
            atomic_json(identity, {'node_id': node_id})
    private_dir(root / node_id)
    state = private_dir(Path(home) / '.local/state/cecelia-node' / node_id)
    private_dir(state / 'cache')
    return state


def inspect_cache(state, now=None):
    """仅统计本节点缓存；活动或无法解析的租约均保护，绝不删除。"""
    now = time.time() if now is None else now
    cache = Path(state) / 'cache'
    result = {'policy': 'owned-cache-only', 'mode': 'observe', 'reclaimable_files': 0,
              'reclaimable_bytes': 0, 'expiry_seconds': 86400, 'protected_files': 0}
    if cache.is_symlink() or not cache.is_dir():
        return result
    # 只检查直属普通文件，不遍历子目录，硬链接也不计为可回收。
    for entry in cache.iterdir():
        info = entry.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or entry.name.endswith('.lease'):
            result['protected_files'] += 1
            continue
        lease = entry.with_name(entry.name + '.lease')
        protected = lease.is_symlink()
        if lease.exists():
            try:
                protected = protected or float(json.loads(lease.read_text())['expires_at']) > now
            except (ValueError, KeyError, OSError, TypeError):
                protected = True
        if protected:
            result['protected_files'] += 1
        elif now - info.st_mtime >= result['expiry_seconds']:
            result['reclaimable_files'] += 1
            result['reclaimable_bytes'] += info.st_size
    return result


def command(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, timeout=5).stdout.strip()


def resources(state):
    result = {'memory_total_bytes': None, 'memory_available_bytes': None,
              'cpu_load_1m': os.getloadavg()[0], 'cpu_cores': os.cpu_count(),
              'disk_free_bytes': None, 'disk_total_bytes': None}
    disk = os.statvfs(state)
    result.update(disk_free_bytes=disk.f_bavail * disk.f_frsize,
                  disk_total_bytes=disk.f_blocks * disk.f_frsize)
    try:
        if platform.system() == 'Linux':
            fields = dict(re.findall(r'^(\w+):\s+(\d+) kB', Path('/proc/meminfo').read_text(), re.M))
            result['memory_total_bytes'] = int(fields['MemTotal']) * 1024
            result['memory_available_bytes'] = int(fields['MemAvailable']) * 1024
            result['memory_method'] = 'linux-proc-memavailable'
        elif platform.system() == 'Darwin':
            result['memory_total_bytes'] = int(command(['/usr/sbin/sysctl', '-n', 'hw.memsize']))
            vm = command(['/usr/bin/vm_stat'])
            page_size = int(re.search(r'page size of (\d+) bytes', vm).group(1))
            pages = dict(re.findall(r'^([^:]+):\s+(\d+)\.', vm, re.M))
            result['memory_available_bytes'] = sum(int(pages[k]) for k in ['Pages free', 'Pages inactive', 'Pages speculative']) * page_size
            result['memory_method'] = 'darwin-free-inactive-speculative-estimate'
    except (OSError, ValueError, KeyError, AttributeError, subprocess.SubprocessError):
        result['memory_method'] = 'unavailable'
    return result


def collect(state, node_id, sequence):
    return {'schema_version': 1, 'node_id': node_id, 'agent_version': '1',
            'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sequence': sequence, 'hostname': socket.gethostname(), 'os': platform.system().lower(),
            'resources': resources(state),
            'capabilities': {'collector': True, 'janitor': True, 'execution': False},
            'janitor': inspect_cache(state)}


def serve(home, node_id):
    state = prepare_identity(home, node_id)
    fd = os.open(str(state / 'collector.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sequence = 0
        health = state / 'health.json'
        if health.is_symlink():
            raise ValueError('健康文件不允许软链')
        if health.exists():
            previous = json.loads(health.read_text())
            if previous.get('node_id') != node_id:
                raise ValueError('健康记录身份冲突')
            sequence = int(previous.get('sequence', 0))
        while True:
            sequence += 1
            atomic_json(health, collect(state, node_id, sequence))
            time.sleep(10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--node-id', required=True)
    parser.add_argument('--home', default=str(Path.home()))
    args = parser.parse_args()
    try:
        serve(Path(args.home), args.node_id)
    except Exception:
        # 不泄露路径、环境或远端命令原始错误。
        raise SystemExit(1)
