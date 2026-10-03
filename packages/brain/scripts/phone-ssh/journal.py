"""私有、拒绝symlink、fsync原子持久journal与跨进程fcntl互斥。"""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import stat
import threading
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


class _ActivityHeld:
    def __init__(self, journal, fd):
        self.journal, self.fd, self.pid = journal, fd, os.getpid()
        self.thread = threading.get_ident()
        value = os.fstat(fd); self.inode = (value.st_dev, value.st_ino)

    def verify(self):
        if self.pid != os.getpid() or self.thread != threading.get_ident() or self.journal._held_activity is not self:
            raise ValueError('phone_activity_context_unknown')
        now = os.fstat(self.fd)
        path = self.journal.root / '.activity.guard'
        current = path.lstat()
        if (now.st_dev, now.st_ino) != self.inode or (current.st_dev, current.st_ino) != self.inode:
            raise ValueError('phone_activity_inode_changed')


class Journal:
    def after_detach(self):
        # detach已关闭非E FD；只丢弃fork复制的元数据，不close可复用数字FD。
        if self._held_activity is not None and self._held_activity.pid != os.getpid():
            self._held_activity = None
        if self._held_dispatch is not None and self._held_dispatch[0] != os.getpid():
            self._held_dispatch = None

    def __init__(self, root):
        self.root = private_dir(root)
        self._held_activity = None
        self._held_dispatch = None
        with self.activity_locked():
            if not (self.root / '.activity.json').exists():
                if any(p.name != '.activity.guard' for p in self.root.iterdir()):
                    raise ValueError('phone_activity_unconfirmed')
                atomic_json(self.root / '.activity.json', {'schema': 1, 'revision': 0, 'activities': {}})
            self._activity()

    @contextmanager
    def activity_locked(self):
        from admission import journal_guard
        with journal_guard(self.root):
            with self._activity_locked() as held: yield held

    @contextmanager
    def _activity_locked(self):
        if self._held_activity is not None: raise ValueError('phone_activity_lock_nested')
        fd = safe_open(self.root / '.activity.guard', os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            held = _ActivityHeld(self, fd)
            self._held_activity = held
            yield held
        finally:
            self._held_activity = None
            os.close(fd)

    def _activity(self):
        fd = safe_open(self.root / '.activity.json', os.O_RDONLY)
        with os.fdopen(fd) as handle:
            raw = handle.read(65537)
        try:
            value = json.loads(raw)
            if len(raw) > 65536 or set(value) != {'schema', 'revision', 'activities'} or value['schema'] != 1 or type(value['revision']) is not int or value['revision'] < 0 or not isinstance(value['activities'], dict):
                raise ValueError('invalid')
            for token, activity in value['activities'].items():
                if str(uuid.UUID(token)) != token or set(activity) != {'kind', 'owner'} or activity['kind'] not in ('capabilities', 'maintenance') or not isinstance(activity['owner'], dict):
                    raise ValueError('invalid')
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError('phone_activity_unconfirmed') from error
        return value

    def activity_snapshot(self):
        with self.activity_locked():
            value = self._activity()
            return {'revision': value['revision'], 'in_flight': len(value['activities'])}

    def begin_activity(self, kind, owner=None):
        from process_identity import process_identity
        if kind not in ('capabilities', 'maintenance'):
            raise ValueError('phone_activity_invalid')
        owner = owner or process_identity(os.getpid())
        token = str(uuid.uuid4())
        with self.activity_locked():
            value = self._activity()
            value['activities'][token] = {'kind': kind, 'owner': owner}
            value['revision'] += 1
            atomic_json(self.root / '.activity.json', value)
        return token

    def end_activity(self, token, owner=None):
        from process_identity import process_identity
        owner = owner or process_identity(os.getpid())
        with self.activity_locked():
            value = self._activity()
            record = value['activities'].get(token)
            if not record or any(record['owner'].get(k) != owner.get(k) for k in ('pid', 'boot_id', 'start_time', 'pgid')):
                raise ValueError('phone_activity_owner_mismatch')
            del value['activities'][token]
            value['revision'] += 1
            atomic_json(self.root / '.activity.json', value)

    @contextmanager
    def locked(self, key):
        from admission import journal_guard
        with journal_guard(self.root):
            with self._dispatch_locked(key): yield

    @contextmanager
    def _dispatch_locked(self, key):
        if self._held_dispatch is not None: raise ValueError('phone_dispatch_lock_nested')
        fd = safe_open(self.root / (key + '.guard'), os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            self._held_dispatch = (os.getpid(), threading.get_ident(), key, fd)
            yield
        finally:
            self._held_dispatch = None
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
        from admission import installed_for_journal
        if installed_for_journal(self.root) and self._held_dispatch is None:
            with self.locked(key): self.write(key, state)
            return
        with self.activity_locked() as held:
            self.write_under_activity(key, state, held)

    def write_under_activity(self, key, state, held):
        if held is not self._held_activity or not isinstance(held, _ActivityHeld):
            raise ValueError('phone_activity_context_unknown')
        held.verify()
        from admission import assert_journal_guard, installed_for_journal
        assert_journal_guard(self.root)
        if installed_for_journal(self.root):
            dispatch = self._held_dispatch
            if dispatch is None or dispatch[:3] != (os.getpid(), threading.get_ident(), key):
                raise ValueError('phone_dispatch_context_unknown')
        activity = self._activity()
        activity['revision'] += 1
        # 全局revision先持久化；崩溃不能出现状态已变而revision未变。
        atomic_json(self.root / '.activity.json', activity)
        directory = private_dir(self.root / key)
        state['revision'] = state.get('revision', 0) + 1
        atomic_json(directory / 'state.json', state)
        fsync_dir(self.root)

    def keys(self):
        for path in self.root.iterdir():
            if path.name in ('.activity.guard', '.activity.json'):
                fd = safe_open(path, os.O_RDONLY)
                os.close(fd)
                continue
            name = path.name[:-6] if path.name.endswith('.guard') else path.name
            try:
                if str(uuid.UUID(name)) != name:
                    raise ValueError('invalid')
            except ValueError as error:
                raise ValueError('phone_journal_unconfirmed') from error
            if path.name.endswith('.guard'):
                fd = safe_open(path, os.O_RDONLY)
                os.close(fd)
                continue
            yield path.name
