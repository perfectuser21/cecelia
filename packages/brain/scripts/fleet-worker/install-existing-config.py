#!/usr/bin/env python3
"""安装器内部配置快照；原环境只进入受保护文件，stdout 仅公开设置。"""
import hashlib
import ipaddress
import json
import os
import plistlib
import re
import stat
import sys

SETTINGS = {
    'PATH': 'WORKER_COMMAND_PATH',
    'CECELIA_FLEET_WORKER_HOST': 'WORKER_BIND_HOST',
    'CECELIA_FLEET_WORKER_PORT': 'WORKER_PORT',
    'CECELIA_FLEET_WORKER_TOKEN_FILE': 'WORKER_TOKEN_FILE',
    'CECELIA_FLEET_DATA_ROOT': 'FLEET_DATA_ROOT',
    'CECELIA_REPO_ROOT': 'WORKTREE_ROOT',
    'CECELIA_ORBSTACK_HOME': 'ORBSTACK_HOME',
    'CECELIA_CALLBACK_URL': 'BRAIN_HEALTH_URL',
    'CECELIA_RUNNER_DIGEST': 'RUNNER_DIGEST',
    'CECELIA_POSTGRES_IMAGE': 'POSTGRES_IMAGE',
    'CECELIA_DRAIN_MARKER': 'DRAIN_MARKER',
    'TMPDIR': 'SHARED_TMPDIR',
    'DOCKER_HOST': 'WORKER_DOCKER_HOST',
}
CANONICAL_RUNNER = 'sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033'


def protected_read(filename):
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        # installer --apply 先验证真实有效UID为root；单测进程无提升权限。
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022 or info.st_size > 1048576:
            raise ValueError('untrusted')
        with os.fdopen(fd, 'rb', closefd=False) as source:
            return source.read(), info
    finally:
        os.close(fd)


def save_private(filename, value):
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb', closefd=False) as dest:
            dest.write(value)
            dest.flush()
        os.fsync(fd)
    finally:
        os.close(fd)


def snapshot(filename, machine, runtime, output):
    raw, info = protected_read(filename)
    document = plistlib.loads(raw)
    env = document.get('EnvironmentVariables', {})
    argv = document.get('ProgramArguments')
    if document.get('Label') != 'com.perfect21.fleet-worker' or document.get('UserName') != '_cecelia':
        raise ValueError('identity')
    if not isinstance(env, dict) or env.get('CECELIA_MACHINE_ID') != machine:
        raise ValueError('machine')
    if not isinstance(argv, list) or len(argv) != 2 or argv[1] != runtime + '/fleet-worker.cjs':
        raise ValueError('program')
    if not isinstance(argv[0], str) or not os.path.isabs(argv[0]) or not os.path.isfile(argv[0]) or not os.access(argv[0], os.X_OK):
        raise ValueError('node')
    for key, value in env.items():
        if not isinstance(key, str) or not isinstance(value, str) or '\0' in key + value:
            raise ValueError('environment')
    settings = {target: env[key] for key, target in SETTINGS.items() if key in env}
    settings['NODE_EXECUTABLE'] = argv[0]
    if any(not value or any(char in value for char in '\n\r\t\0') for value in settings.values()):
        raise ValueError('settings')
    if 'WORKER_BIND_HOST' in settings:
        ipaddress.ip_address(settings['WORKER_BIND_HOST'])
    if 'WORKER_PORT' in settings and not 1 <= int(settings['WORKER_PORT']) <= 65535:
        raise ValueError('port')
    if settings.get('WORKER_DOCKER_HOST', 'unix:///var/run/docker.sock') != 'unix:///var/run/docker.sock':
        raise ValueError('docker socket')
    for key in ['WORKER_TOKEN_FILE', 'FLEET_DATA_ROOT', 'WORKTREE_ROOT', 'ORBSTACK_HOME', 'DRAIN_MARKER', 'SHARED_TMPDIR']:
        if key in settings and (not os.path.isabs(settings[key]) or '..' in settings[key].split('/')):
            raise ValueError('path')
    value = {'document': document, 'sha256': hashlib.sha256(raw).hexdigest(), 'dev': info.st_dev, 'ino': info.st_ino}
    save_private(output, json.dumps(value).encode())
    for key, val in settings.items():
        print(key + '\t' + val)


def load_snapshot(filename):
    raw, info = protected_read(filename)
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('snapshot permissions')
    return json.loads(raw)


def check(filename, saved):
    snapshot_value = load_snapshot(saved)
    raw, info = protected_read(filename)
    if snapshot_value['sha256'] != hashlib.sha256(raw).hexdigest() or (info.st_dev, info.st_ino) != (snapshot_value['dev'], snapshot_value['ino']):
        raise ValueError('configuration changed')


def canonical_runner(saved, expected):
    value = load_snapshot(saved)
    env = value['document'].get('EnvironmentVariables', {})
    if (not re.fullmatch('[0-9a-f]{64}', expected)
            or value['sha256'] != expected
            or env.get('CECELIA_MACHINE_ID') != 'xian-mac-m4'
            or not re.fullmatch('sha256:[0-9a-f]{64}', env.get('CECELIA_RUNNER_DIGEST', ''))):
        raise ValueError('canonical runner CAS')
    value['canonical_runner'] = {'expected_sha256': expected}
    save_private(saved, json.dumps(value).encode())
    print('RUNNER_DIGEST\t' + CANONICAL_RUNNER)


def canonical_install_guard(machine):
    if machine != 'xian-mac-m4':
        raise ValueError('machine')
    marker = '/var/run/cecelia/fleet-worker.drain'
    if os.environ.get('NODE_ENV') == 'test':
        marker = os.environ.get('FLEET_NODECTL_DRAIN_MARKER', marker)
    owner = os.environ.get('FLEET_NODECTL_DRAIN_OWNER', '')
    if not re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', owner):
        raise ValueError('owner')
    root = os.path.dirname(marker)
    lock = os.path.join(root, '.fleet-worker.drain.lock')
    for fd, filename, directory in [(3, marker, False), (4, lock, True)]:
        held, current = os.fstat(fd), os.lstat(filename)
        if (stat.S_ISLNK(current.st_mode) or held.st_uid != os.geteuid()
                or held.st_mode & 0o077 or (held.st_dev, held.st_ino) != (current.st_dev, current.st_ino)
                or (not stat.S_ISDIR(held.st_mode) if directory else not stat.S_ISREG(held.st_mode))):
            raise ValueError('lease')
    os.lseek(3, 0, os.SEEK_SET)
    body = os.read(3, 4097)
    content = json.loads(body)
    if len(body) > 4096 or content != {'schema': 'fleet-drain-owner/v1', 'machine': machine, 'owner': owner}:
        raise ValueError('marker')
    raw, _ = protected_read(os.path.join(root, '.fleet-worker.drain-owner-' + owner + '.json'))
    receipt = json.loads(raw)
    held = os.fstat(3)
    if receipt != {'machine': machine, 'owner': owner, 'inode': held.st_ino, 'device': held.st_dev, 'content': body.decode()}:
        raise ValueError('journal')


def merge(filename, saved):
    snapshot_value = load_snapshot(saved)
    original = snapshot_value['document']
    raw, _ = protected_read(filename)
    rendered = plistlib.loads(raw)
    merged = dict(original)
    merged['ProgramArguments'] = rendered['ProgramArguments']
    merged['EnvironmentVariables'] = {**rendered.get('EnvironmentVariables', {}), **original.get('EnvironmentVariables', {})}
    if 'canonical_runner' in snapshot_value:
        intent = snapshot_value['canonical_runner']
        if (intent != {'expected_sha256': snapshot_value['sha256']}
                or original['EnvironmentVariables'].get('CECELIA_MACHINE_ID') != 'xian-mac-m4'
                or rendered.get('ProgramArguments') != original.get('ProgramArguments')):
            raise ValueError('canonical runner intent')
        merged['EnvironmentVariables'] = {**original['EnvironmentVariables'], 'CECELIA_RUNNER_DIGEST': CANONICAL_RUNNER}
    save_private(filename, plistlib.dumps(merged))


if __name__ == '__main__':
    try:
        action, *args = sys.argv[1:]
        if action == 'snapshot' and len(args) == 4:
            snapshot(*args)
        elif action == 'merge' and len(args) == 2:
            merge(*args)
        elif action == 'check' and len(args) == 2:
            check(*args)
        elif action == 'canonical-runner' and len(args) == 2:
            canonical_runner(*args)
        elif action == 'canonical-install-guard' and len(args) == 1:
            canonical_install_guard(*args)
        else:
            raise ValueError('action')
    except Exception:
        print('existing_configuration_untrusted', file=sys.stderr)
        sys.exit(1)
