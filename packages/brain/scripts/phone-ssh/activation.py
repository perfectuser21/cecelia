"""C3固定预安装activation纯校验；不授grant、不启动、不代替C4最终GO。"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import MappingProxyType
import uuid
from process_identity import boot_id as _boot_id

_INSTALL_ROOT = Path('/private/etc/cecelia/phone-ssh' if sys.platform == 'darwin' else '/etc/cecelia/phone-ssh')
_SOURCE_ROOT = Path('/opt/cecelia/phone-ssh')
_SERVICE_UID = os.getuid()
_PHYSICAL_FILES = ('runner.py', 'worker.py', 'journal.py', 'phone_lease.py', 'process_identity.py',
                   'adb_socket.py', 'probe.py', 'drain_marker.py', 'http_physical.py', 'admission.py', 'activation.py', 'permit.py')
_SOURCE_FILES = tuple(dict.fromkeys((*_PHYSICAL_FILES, 'activation.py')))
_IDENTITY_FIELDS = ('dispatch_id', 'reservation_id', 'task_id', 'machine_id', 'host', 'serial', 'profile',
                    'account_id', 'execution_version_id', 'execution_grant_id', 'lease_token', 'execution_id',
                    'worker_id', 'worker_boot_id', 'action', 'config_digest')
_UUID_FIELDS = ('dispatch_id', 'reservation_id', 'task_id', 'execution_version_id',
                'execution_grant_id', 'lease_token', 'execution_id')
_HUB_FIELDS = ('http_endpoint', 'hub_id', 'hub_boot_id', 'hub_config_digest', 'hub_build_digest')
_PHYSICAL_FIELDS = ('machine_id', 'worker_id', 'physical_boot_id', 'config_digest', 'build_digest', 'action_digest')
_RECORD_FIELDS = ('schema', 'identity', 'phone_hub', 'activation_manifest_digest', 'activation_build_digest',
                  'issued_at', 'expires_at', 'grant_expires_at')


def _fail(): raise ValueError('phone_activation_unconfirmed')


def _keys(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields): _fail()


def _text(value):
    if not isinstance(value, str) or not value or len(value.encode()) > 256: _fail()


def _sha(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value): _fail()


def _json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value: _fail()
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: _fail())


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _identity(value):
    _keys(value, _IDENTITY_FIELDS)
    for item in value.values(): _text(item)
    for name in _UUID_FIELDS:
        if str(uuid.UUID(value[name])) != value[name]: _fail()
    if value['action'] != 'adb_get_state' or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', value['serial']): _fail()
    _sha(value['config_digest'])


def _hub(value):
    _keys(value, _HUB_FIELDS)
    for name in ('hub_id', 'hub_boot_id'): _text(value[name])
    for name in ('hub_config_digest', 'hub_build_digest'): _sha(value[name])
    if not isinstance(value['http_endpoint'], str) or not re.fullmatch(r'http://[a-z0-9][a-z0-9.-]*:3459/', value['http_endpoint']): _fail()


def _stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value): _fail()
    return datetime.fromisoformat(value[:-1] + '+00:00')


def _fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


class _TrustedReads:
    """持有逐层dirfd与文件FD，校验结束再核全部路径边和读取快照。"""
    def __init__(self): self.fds, self.edges, self.files = [], [], []

    def __enter__(self): return self

    def __exit__(self, *_):
        for fd in reversed(self.fds): os.close(fd)

    @staticmethod
    def _directory(value):
        if not stat.S_ISDIR(value.st_mode) or value.st_uid not in (0, _SERVICE_UID) or value.st_mode & 0o022: _fail()

    def read(self, path, *, private=True):
        path = Path(path)
        if not path.is_absolute() or '..' in path.parts: _fail()
        parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.fds.append(parent); self._directory(os.fstat(parent))
        for name in path.parts[1:-1]:
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
            self._directory(before)
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            self.fds.append(child)
            after = os.fstat(child); self._directory(after)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino): _fail()
            self.edges.append((parent, name, child, after.st_dev, after.st_ino))
            parent = child
        name = path.name
        before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        self.fds.append(fd); value = os.fstat(fd)
        limit = 65536 if private else 1048576
        if not stat.S_ISREG(value.st_mode) or value.st_uid != _SERVICE_UID or value.st_nlink != 1 or value.st_mode & 0o022 or value.st_size > limit:
            _fail()
        if private and stat.S_IMODE(value.st_mode) != 0o600: _fail()
        if _fingerprint(before) != _fingerprint(value): _fail()
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(65536, limit + 1 - size))
            if not chunk: break
            chunks.append(chunk); size += len(chunk)
            if size > limit: _fail()
        if _fingerprint(os.fstat(fd)) != _fingerprint(value): _fail()
        self.files.append((parent, name, fd, _fingerprint(value)))
        return b''.join(chunks)

    def verify(self):
        for parent, name, fd, dev, ino in self.edges:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            held = os.fstat(fd)
            self._directory(current); self._directory(held)
            if (current.st_dev, current.st_ino) != (dev, ino) or (held.st_dev, held.st_ino) != (dev, ino): _fail()
        for parent, name, fd, expected in self.files:
            if _fingerprint(os.stat(name, dir_fd=parent, follow_symlinks=False)) != expected or _fingerprint(os.fstat(fd)) != expected: _fail()


def _frozen(value):
    if isinstance(value, dict): return MappingProxyType({key: _frozen(item) for key, item in value.items()})
    if isinstance(value, list): return tuple(_frozen(item) for item in value)
    return value


def _load(reads):
    raw_manifest = reads.read(_INSTALL_ROOT / 'activation-manifest.json')
    manifest = _json(raw_manifest)
    _keys(manifest, ('schema', 'worker_identity', 'hub', 'source_hashes'))
    if type(manifest['schema']) is not int or manifest['schema'] != 1: _fail()
    _keys(manifest['worker_identity'], ('machine_id', 'worker_id', 'host'))
    for item in manifest['worker_identity'].values(): _text(item)
    _hub(manifest['hub']); _keys(manifest['source_hashes'], _SOURCE_FILES)
    for item in manifest['source_hashes'].values(): _sha(item)
    hashes = {name: hashlib.sha256(reads.read(_SOURCE_ROOT / name, private=False)).hexdigest() for name in _SOURCE_FILES}
    if hashes != manifest['source_hashes']: _fail()
    worker = _json(reads.read(_INSTALL_ROOT / 'worker.json'))
    if worker != manifest['worker_identity']: _fail()
    probe = _json(reads.read(_INSTALL_ROOT / 'probe.json'))
    _keys(probe, ('schema', 'machine_id', 'worker_id', 'host', 'source_hashes'))
    actual = {name: hashes[name] for name in _PHYSICAL_FILES}
    if type(probe['schema']) is not int or probe['schema'] != 1 or probe['source_hashes'] != actual or any(probe[name] != worker[name] for name in worker): _fail()
    record = _json(reads.read(_INSTALL_ROOT / 'activation.json'))
    return raw_manifest, manifest, hashes, worker, probe, actual, record


def validate_activation(identity):
    """固定安装authority，与caller identity核对；结果不代替C4锁内最终复核。"""
    _identity(identity)
    with _TrustedReads() as reads:
        raw_manifest, manifest, hashes, worker, probe, actual, record = _load(reads)
        _keys(record, _RECORD_FIELDS)
        if record['schema'] != 'phone-activation/v1': _fail()
        _identity(record['identity'])
        if record['identity'] != identity or any(identity[name] != worker[name] for name in worker): _fail()
        for name in ('activation_manifest_digest', 'activation_build_digest'): _sha(record[name])
        if record['activation_manifest_digest'] != hashlib.sha256(raw_manifest).hexdigest() or record['activation_build_digest'] != _digest(hashes): _fail()
        hub = record['phone_hub']; _keys(hub, (*_HUB_FIELDS, 'physical'))
        if {name: hub[name] for name in _HUB_FIELDS} != manifest['hub']: _fail()
        physical = hub['physical']; _keys(physical, _PHYSICAL_FIELDS)
        expected = {'machine_id': worker['machine_id'], 'worker_id': worker['worker_id'], 'physical_boot_id': _boot_id(),
                    'config_digest': _digest({'manifest': probe, 'worker_identity': worker, 'actual_hashes': actual}),
                    'build_digest': _digest(actual), 'action_digest': actual['adb_socket.py']}
        if physical != expected or identity['worker_boot_id'] != expected['physical_boot_id']: _fail()
        issued, expires, grant_expires = (_stamp(record[name]) for name in ('issued_at', 'expires_at', 'grant_expires_at'))
        now = datetime.now(timezone.utc)
        if not issued <= now < expires <= grant_expires: _fail()
        reads.verify()
        if not issued <= datetime.now(timezone.utc) < expires <= grant_expires: _fail()
        return _frozen(record)


def _plain(value):
    if isinstance(value, MappingProxyType): return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, tuple): return [_plain(item) for item in value]
    return value


def main():
    if len(sys.argv) != 1: _fail()
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384: _fail()
    result = validate_activation(_json(raw))
    sys.stdout.write(json.dumps({'schema': 'phone-activation-check/v1', 'status': 'validated',
                                'pins': _plain(result)}, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try: main()
    except Exception:
        sys.stderr.write('phone_activation_unconfirmed\n'); sys.exit(1)
