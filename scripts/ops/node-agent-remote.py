"""经固定 SSH 通道执行的服务安装及读取入口。"""
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import socket
import subprocess
import sys
import uuid


def command(args):
    completed = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, timeout=15, text=True)
    if completed.returncode:
        raise ValueError('服务管理命令失败')
    return completed.stdout.strip()


def collector_module(source):
    namespace = {'__name__': 'cecelia_node_collector'}
    exec(compile(source, 'node-agent.py', 'exec'), namespace)
    return namespace


def service_spec(home, node_id, system, uid):
    name = 'cecelia-node-' + node_id
    if system == 'linux':
        directory = Path('/etc/systemd/system') if uid == 0 else Path(home) / '.config/systemd/user'
        prefix = ['systemctl'] + ([] if uid == 0 else ['--user'])
        return name + '.service', directory / (name + '.service'), prefix
    if system == 'darwin':
        return name, Path(home) / 'Library/LaunchAgents' / (name + '.plist'), ['launchctl']
    raise ValueError('系统不支持')


def service_status(home, node_id, system=None, uid=None, run=command):
    system = system or platform.system().lower()
    uid = os.getuid() if uid is None else uid
    name, path, prefix = service_spec(home, node_id, system, uid)
    try:
        if system == 'linux':
            enabled = run(prefix + ['is-enabled', name]) == 'enabled'
            active = run(prefix + ['is-active', name]) == 'active'
        else:
            output = run(['launchctl', 'print', f'gui/{uid}/{name}'])
            disabled = run(['launchctl', 'print-disabled', f'gui/{uid}'])
            enabled = path.is_file() and not re.search(r'"' + re.escape(name) + r'"\s*=>\s*true', disabled)
            active = bool(re.search(r'\bstate = running\b', output))
        return {'enabled': bool(enabled), 'active': bool(active)}
    except (ValueError, OSError, subprocess.SubprocessError):
        return {'enabled': False, 'active': False}


def install(home, node_id, source, system=None, uid=None, run=command):
    home = Path(home).resolve()
    system = system or platform.system().lower()
    uid = os.getuid() if uid is None else uid
    if str(uuid.UUID(node_id)) != node_id or system not in ('linux', 'darwin'):
        raise ValueError('节点身份或系统非法')
    # 先确定服务管理环境可用，失败不会留下伪安装状态。
    if system == 'linux':
        run(['systemctl'] + ([] if uid == 0 else ['--user']) + ['show-environment'])
        if uid != 0 and run(['loginctl', 'show-user', str(uid), '--property=Linger', '--value']) != 'yes':
            raise ValueError('用户服务需要已启用持久会话')
    else:
        run(['launchctl', 'print', f'gui/{uid}'])
    module = collector_module(source)
    module['prepare_identity'](home, node_id)
    app = home / '.local/share/cecelia-node' / node_id
    script = app / 'node-agent.py'
    changed = not script.exists() or script.read_text() != source
    module['atomic_write'](script, source.encode())
    name, path, prefix = service_spec(home, node_id, system, uid)
    if any(parent.is_symlink() for parent in [path.parent, *path.parent.parents]):
        raise ValueError('服务目录不允许软链')
    path.parent.mkdir(parents=True, exist_ok=True)
    python = str(Path(sys.executable).resolve())
    if any('\n' in str(v) or '\r' in str(v) for v in (home, script, python)):
        raise ValueError('安装路径非法')
    if system == 'linux':
        def quote(value):
            return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$') + '"'
        start = ' '.join(quote(v) for v in [python, script, '--node-id', node_id, '--home', home])
        target = 'multi-user.target' if uid == 0 else 'default.target'
        content = f'[Unit]\nDescription=Cecelia node observer\n[Service]\nType=simple\nExecStart={start}\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\n[Install]\nWantedBy={target}\n'.encode()
    else:
        content = plistlib.dumps({'Label': name, 'ProgramArguments': [python, str(script), '--node-id', node_id, '--home', str(home)], 'RunAtLoad': True, 'KeepAlive': True, 'Umask': 63, 'ThrottleInterval': 5})
    changed = changed or not path.exists() or path.read_bytes() != content
    module['atomic_write'](path, content)
    if system == 'linux':
        run(prefix + ['daemon-reload'])
        run(prefix + ['enable', name])
        run(prefix + [('restart' if changed else 'start'), name])
    else:
        target = f'gui/{uid}/{name}'
        run(['launchctl', 'enable', target])
        exists = True
        try:
            run(['launchctl', 'print', target])
        except (ValueError, OSError, subprocess.SubprocessError):
            exists = False
        if exists and changed:
            run(['launchctl', 'bootout', target])
            exists = False
        if not exists:
            run(['launchctl', 'bootstrap', f'gui/{uid}', str(path)])
        run(['launchctl', 'kickstart', target])
    return {'installed': True}


def dispatch(payload):
    node_id = payload['id']
    if str(uuid.UUID(node_id)) != node_id:
        raise ValueError('节点身份非法')
    home = Path.home().resolve()
    system = platform.system().lower()
    if system not in ('linux', 'darwin'):
        raise ValueError('系统不支持')
    if payload['action'] == 'probe':
        return {'os': system, 'hostname': socket.gethostname()}
    if payload['action'] == 'install':
        return install(home, node_id, payload['collector'])
    if payload['action'] == 'sample':
        identity = home / '.local/share/cecelia-node/identity.json'
        health = home / '.local/state/cecelia-node' / node_id / 'health.json'
        for path in [identity, health]:
            if any(parent.is_symlink() for parent in [path, *path.parents]):
                raise ValueError('状态路径不允许软链')
        if json.loads(identity.read_text()).get('node_id') != node_id:
            raise ValueError('节点身份冲突')
        return {'service': service_status(home, node_id), 'health': json.loads(health.read_text())}
    raise ValueError('操作不支持')
