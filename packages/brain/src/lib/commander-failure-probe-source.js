/** 固定只读远端探针源码；静态代码依赖，不安装或信任执行机 helper。 */
export const FAILURE_PROBE_SOURCE = String.raw`"""Brain-owned read-only probe. Existing lock FDs held until coordinator ACK/EOF.
No device command, status wrapper, run write, worker launch or terminal synthesis.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import time

LIMIT = 16 * 1024 * 1024
TOTAL = 32 * 1024 * 1024
used = 0
fds = []
controller_state = None


def regular(path, limit=LIMIT):
    global used
    path = Path(path)
    for ancestor in [*reversed(path.parents), path]:
        if stat.S_ISLNK(ancestor.lstat().st_mode):
            raise ValueError('symlink path refused')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError('nonregular or oversized evidence')
        data = os.read(fd, limit + 1)
        after = os.fstat(fd)
        used += len(data)
        if len(data) != before.st_size or (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or used > TOTAL:
            raise ValueError('evidence changed or budget exceeded')
        return data
    finally:
        os.close(fd)


def read(path):
    return json.loads(regular(path, 1024 * 1024))


def lock(path):
    regular(path, 4096)  # Existing regular lock only; never create it.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    observed = os.fstat(fd)
    named = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(observed.st_mode) or (observed.st_dev, observed.st_ino) != (named.st_dev, named.st_ino):
        os.close(fd)
        raise ValueError('lock is not the named regular file')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fds.append(fd)
    return fd


def rpc(method, params):
    cli = Path('/opt/homebrew/bin/openclaw')
    env = {'HOME': str(Path.home()), 'PATH': str(Path.home() / '.local/bin') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'}
    result = subprocess.run([str(cli), 'gateway', 'call', method, '--json', '--timeout', '5000', '--params', json.dumps(params)],
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=7, env=env)
    if result.returncode or len(result.stdout) > 1024 * 1024:
        raise ValueError('official read-only RPC failed or oversized')
    return json.loads(result.stdout)


def worker(data, held=False):
    e = data['envelope']
    run = e['run_id']
    if not re.fullmatch(r'wfd-[a-f0-9-]{36}', run):
        raise ValueError('invalid run id')
    root = Path.home() / 'wf-agent-runs' / run
    if not held:
        lock(root / '.worker.lock')
    if time.time() * 1000 < data['cleanup_deadline_ms']:
        raise ValueError('original cleanup budget still active')
    envelope, binding, request = (read(root / name) for name in ('envelope.json', 'agent-binding.json', 'agent-request.json'))
    if envelope != e or binding['task_id'] != e['task_id'] or binding['run_id'] != run:
        raise ValueError('frozen run identity changed')
    original_input, original_contract = read(root / 'input.json'), read(root / 'contract.json')
    if original_input != e['input'] or original_contract != e['contract']:
        raise ValueError('original input or contract changed')
    closed = read(root / 'handoff-closed.json')
    if (isinstance(closed.get('at'), bool) or not isinstance(closed.get('at'), (int, float))
            or not 0 < closed['at'] <= time.time()):
        raise ValueError('original nonce not closed')
    claimed = read(root / 'spawn-claimed.json')
    if claimed.get('nonce') != binding.get('nonce') or request.get('nonce') != binding.get('nonce'):
        raise ValueError('nonce binding mismatch')
    forbidden = ['agent-completion.json', 'agent-terminal.json', 'child-stop-readback.json',
                 'agent-delivery.json', 'delivery.json', 'execution-failure.json']
    if any((root / name).exists() or (root / name).is_symlink() for name in forbidden):
        raise ValueError('legacy pre-deadline branch present; not this reconciliation lane')
    preflight = read(root / 'preflight.json')
    preflight_state = read(root / 'shell-preflight.json')
    cleanup_state = read(root / 'shell-cleanup.json')
    runtime_root = Path.home() / '.openclaw/commander'
    if (runtime_root / '.deploying').exists() or (runtime_root / '.deploying').is_symlink():
        raise ValueError('runtime deployment in progress')
    manifest = read(runtime_root / 'runtime-manifest.json')
    names = manifest.get('files')
    if not isinstance(names, dict) or not 1 <= len(names) <= 300:
        raise ValueError('runtime closure missing or unbounded')
    runtime_files = {}
    for name in names:
        relative = Path(name)
        if relative.is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
            raise ValueError('runtime path escapes registered root')
        runtime_files[name] = hashlib.sha256(regular(runtime_root / relative)).hexdigest()
    if runtime_files != names:
        raise ValueError('runtime bytes drifted')
    cleanup_raw = regular(root / 'cleanup.json', 1024 * 1024)
    cleanup = json.loads(cleanup_raw)
    files = cleanup['_shell']['files']
    if not isinstance(files, list) or not 1 <= len(files) <= 200:
        raise ValueError('unbounded cleanup closure')
    actual = []
    for entry in files:
        path = Path(entry['path'])
        if root not in path.parents or '..' in path.parts or str(path) != entry['path']:
            raise ValueError('evidence outside original run')
        raw = regular(path)
        actual.append({'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest()})
    roots = read(root / 'root-identity.json')
    current = {}
    for name, path in [('run', root), ('evidence', root / 'evidence'), ('commander', Path.home() / '.openclaw/commander')]:
        if path.resolve(strict=True) != path or not path.is_dir():
            raise ValueError('root moved or symlinked')
        s = path.stat()
        current[name] = {'realpath': str(path), 'st_dev': s.st_dev, 'st_ino': s.st_ino}
    terminal = rpc('tools.invoke', {'name': 'subagents', 'sessionKey': binding['parent_session_key'],
                                  'args': {'action': 'wait', 'runIds': [binding['child_run_id']], 'timeoutSeconds': 0}})
    sessions = rpc('sessions.list', {'agentId': 'skill-factory', 'search': binding['child_session_key'].split(':')[-1],
                                    'limit': 5, 'archived': 'all', 'includeLastMessage': False,
                                    'includeDerivedTitles': False, 'includeActivitySummary': False})
    matches = [s for s in sessions.get('sessions', []) if s.get('key') == binding['child_session_key']]
    if len(matches) != 1:
        raise ValueError('original session missing or ambiguous')
    s = matches[0]
    session = {key: s.get(key) for key in ('key', 'hasActiveRun', 'activeRunIds', 'hasActiveSubagentRun')}
    # Before response all original identities re-read; no caller-supplied state flags.
    for name, value in [('envelope.json', envelope), ('agent-binding.json', binding), ('agent-request.json', request), ('input.json', original_input), ('contract.json', original_contract), ('cleanup.json', cleanup)]:
        if read(root / name) != value:
            raise ValueError('original evidence changed during probe')
    return {'run_directory': str(root), 'envelope': envelope, 'original_input': original_input,
            'original_contract': original_contract, 'binding': binding, 'request': request,
            'worker_exclusive': True, 'nonce_closed': True, 'cleanup': cleanup,
            'legacy_branches_absent': True, 'preflight': preflight, 'preflight_state': preflight_state,
            'cleanup_state': cleanup_state, 'runtime_manifest': manifest, 'runtime_files': runtime_files,
            'cleanup_sha256': hashlib.sha256(cleanup_raw).hexdigest(), 'files': actual, 'roots': roots,
            'current_roots': current, 'root_start': read(root / 'cleanup-root-start.json'),
            'root_end': read(root / 'cleanup-root-end.json'), 'terminal': terminal, 'session': session}


def directory_identity(path):
    for ancestor in [*reversed(path.parents), path]:
        if stat.S_ISLNK(ancestor.lstat().st_mode):
            raise ValueError('symlink controller root refused')
    s = path.stat()
    if not stat.S_ISDIR(s.st_mode):
        raise ValueError('controller root is not a directory')
    return {'path': str(path), 'device': s.st_dev, 'inode': s.st_ino}


def controller_paths(data):
    alias = Path('/private/tmp/openclaw-phone')
    directory_identity(alias.parent)
    a = alias.lstat()
    target = None
    if stat.S_ISLNK(a.st_mode):
        trusted = Path.home() / 'Library/Application Support/ZenithJoy/phone-runtime-20261011'
        target = os.readlink(alias)
        if (data['host'], data['profile'], data['serial']) != ('xian-m4', 'legacy', 'ANGYVB4402004137') or target != str(trusted):
            raise ValueError('untrusted controller alias identity or target')
        root = trusted
    else:
        root = alias
    locks = root / 'locks'
    root_id, locks_id = directory_identity(root), directory_identity(locks)
    guard = locks / (data['serial'] + '.guard')
    regular(guard, 4096)
    g = guard.lstat()
    if not stat.S_ISREG(g.st_mode):
        raise ValueError('controller guard is not a regular file')
    return {'alias': {'path': str(alias), 'device': a.st_dev, 'inode': a.st_ino,
                      'ctime_ns': a.st_ctime_ns, 'target': target},
            'root': root_id, 'locks': locks_id,
            'guard': {'path': str(guard), 'device': g.st_dev, 'inode': g.st_ino}}


def controller(data, held=False):
    global controller_state
    serial, profile, host = (data[k] for k in ('serial', 'profile', 'host'))
    if not re.fullmatch('[A-Za-z0-9]+', serial) or not re.fullmatch('[-A-Za-z0-9_.]+', profile) or host not in ('xian-m4', 'xian-m1'):
        raise ValueError('unregistered controller resource')
    before = controller_paths(data)
    if not held:
        fd = lock(Path(before['guard']['path']))
        if controller_paths(data) != before:
            raise ValueError('controller root changed while acquiring guard')
        controller_state = {'identity': before, 'fd': fd}
    if controller_state is None or controller_state['identity'] != before:
        raise ValueError('controller root or guard identity changed')
    observed = os.fstat(controller_state['fd'])
    if not stat.S_ISREG(observed.st_mode) or (observed.st_dev, observed.st_ino) != (before['guard']['device'], before['guard']['inode']):
        raise ValueError('controller guard is not held at original inode')
    directory = Path(before['locks']['path']) / (serial + '.lock')
    # A leftover empty/unknown lock directory is not free. No TTL expiry inference.
    if directory.exists() or directory.is_symlink():
        raise ValueError('controller owner lock is not free')
    if controller_paths(data) != before:
        raise ValueError('controller root changed during owner readback')
    return {'host': host, 'serial': serial, 'profile': profile, 'owner': 'free', 'guard_exclusive': True}


def main():
    line = sys.stdin.readline(200001)
    if len(line) > 200000:
        raise ValueError('input too large')
    data = json.loads(line)
    result = worker(data) if data['mode'] == 'worker' else controller(data)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    if not select.select([sys.stdin], [], [], 20)[0]:
        raise ValueError('coordinator acknowledgement timeout')
    ack = sys.stdin.readline(32).strip()
    if ack == 'validate':
        result = worker(data, True) if data['mode'] == 'worker' else controller(data, True)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if not select.select([sys.stdin], [], [], 20)[0]:
            raise ValueError('commit acknowledgement timeout')
        ack = sys.stdin.readline(32).strip()
    if ack not in ('committed', 'abort'):
        raise ValueError('coordinator disconnected')


if __name__ == '__main__':
    try:
        main()
    finally:
        for fd in fds:
            os.close(fd)
`;
