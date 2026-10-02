"""私有、拒绝symlink、fsync原子持久journal与跨进程fcntl互斥。"""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import uuid


def private_dir(path):
    path = Path(path)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    s = path.lstat()
    if not stat.S_ISDIR(s.st_mode) or stat.S_IMODE(s.st_mode) != 0o700 or s.st_uid != os.getuid():
        raise ValueError('phone_journal_untrusted')
    return path


def safe_open(path, flags, mode=0o600):
    fd = os.open(str(path), flags | os.O_NOFOLLOW, mode)
    s = os.fstat(fd)
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != mode:
        os.close(fd)
        raise ValueError('phone_file_untrusted')
    return fd


def fsync_dir(path):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    path = Path(path)
    temp = path.parent / ('.' + path.name + '.' + str(uuid.uuid4()))
    fd = safe_open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, sort_keys=True, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        fsync_dir(path.parent)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


class Journal:
    def __init__(self, root):
        self.root = private_dir(root)

    @contextmanager
    def locked(self, key):
        fd = safe_open(self.root / (key + '.guard'), os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def read(self, key):
        path = self.root / key
        try:
            private_dir_existing = path.lstat()
        except FileNotFoundError:
            return None
        if not stat.S_ISDIR(private_dir_existing.st_mode) or stat.S_IMODE(private_dir_existing.st_mode) != 0o700:
            raise ValueError('phone_journal_untrusted')
        try:
            fd = safe_open(path / 'state.json', os.O_RDONLY)
            with os.fdopen(fd) as handle:
                value = json.load(handle)
        except (OSError, ValueError) as error:
            raise ValueError('phone_journal_unconfirmed') from error
        if not isinstance(value, dict):
            raise ValueError('phone_journal_unconfirmed')
        return value

    def write(self, key, state):
        directory = private_dir(self.root / key)
        state['revision'] = state.get('revision', 0) + 1
        atomic_json(directory / 'state.json', state)
        fsync_dir(self.root)

    def keys(self):
        for path in self.root.iterdir():
            if path.name.endswith('.guard'):
                continue
            try:
                uuid.UUID(path.name)
            except ValueError as error:
                raise ValueError('phone_journal_unconfirmed') from error
            yield path.name
