"""C4原子锁/未决账基础；不授grant，不是Journal完成回执，不自动安装。"""
from contextlib import contextmanager, nullcontext
import fcntl
import json
import os
import stat
from pathlib import Path
import threading
import uuid
from activation import _TrustedReads, _json, _keys, _identity, validate_activation, _plain
from process_identity import process_identity

_ROOT = Path('/private/etc/cecelia/phone-ssh' if os.uname().sysname == 'Darwin' else '/etc/cecelia/phone-ssh')
_JOURNAL_ROOT = Path('/var/lib/cecelia/phone-ssh')
_HOST_ROOT = Path('/private/tmp/openclaw-phone')
_LOCAL = threading.local()


class _HostReads(_TrustedReads):
    """只为host允许固定系统sticky tmp；不修改activation通用信任规则。"""
    def __init__(self):
        super().__init__()
        self.sticky_inode = None
        self.host_inode = None

    def _directory(self, value):
        inode = (value.st_dev, value.st_ino)
        if inode == self.sticky_inode:
            if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or stat.S_IMODE(value.st_mode) != 0o1777:
                raise ValueError('phone_host_tmp_untrusted')
            return
        _TrustedReads._directory(value)
        if inode == self.host_inode and (value.st_uid != os.getuid() or stat.S_IMODE(value.st_mode) != 0o700):
            raise ValueError('phone_host_directory_untrusted')

    def _prepare(self):
        native = Path('/private/tmp' if os.uname().sysname == 'Darwin' else '/tmp')
        # 逐层固定系统路径，保留实际FD；任意其它sticky/world-write目录不获例外。
        parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.fds.append(parent); _TrustedReads._directory(os.fstat(parent))
        for name in native.parts[1:]:
            before = os.stat(name, dir_fd=parent, follow_symlinks=False)
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            self.fds.append(child); after = os.fstat(child)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise ValueError('phone_host_tmp_changed')
            if name == native.name: self.sticky_inode = (after.st_dev, after.st_ino)
            self._directory(before); self._directory(after)
            self.edges.append((parent, name, child, after.st_dev, after.st_ino)); parent = child
        value = _HOST_ROOT.lstat()
        self.host_inode = (value.st_dev, value.st_ino)
        self._directory(value)

    def read(self, path, *, private=True):
        path = Path(path)
        if path.parent != _HOST_ROOT or path.name not in ('host.guard', '.host-activity.json') or not private:
            raise ValueError('phone_host_path_untrusted')
        if self.host_inode is None: self._prepare()
        raw = super().read(path, private=True)
        parent = os.fstat(self.files[-1][0])
        if (parent.st_dev, parent.st_ino) != self.host_inode:
            raise ValueError('phone_host_directory_changed')
        self._directory(parent)
        return raw

    def verify(self):
        super().verify()
        value = _HOST_ROOT.lstat(); self._directory(value)
        if (value.st_dev, value.st_ino) != self.host_inode:
            raise ValueError('phone_host_directory_changed')


class _Held:
    def __init__(self, reads, fd):
        self.reads, self.fd = reads, fd
        self.pid, self.thread = os.getpid(), threading.get_ident()
        value = os.fstat(fd); self.inode = (value.st_dev, value.st_ino)
        self.active = True

    def verify(self):
        if not self.active or self.pid != os.getpid() or self.thread != threading.get_ident():
            raise ValueError('phone_admission_context_unknown')
        value = os.fstat(self.fd)
        if (value.st_dev, value.st_ino) != self.inode: raise ValueError('phone_admission_inode_changed')
        self.reads.verify()


@contextmanager
def locked():
    held = getattr(_LOCAL, 'held', None)
    if held is not None:
        # fork继承上下文不是新进程的授权；看护detach须关闭非E继承FD后清上下文。
        held.verify()
        yield held
        held.verify()
        return
    with _TrustedReads() as reads:
        reads.read(_ROOT / 'admission.guard')
        fd = reads.files[-1][2]
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        held = _Held(reads, fd); _LOCAL.held = held
        try:
            held.verify(); yield held; held.verify()
        finally:
            held.active = False; _LOCAL.held = None


def installed_for_journal(root):
    return Path(root) == _JOURNAL_ROOT and any(((_ROOT / name).exists() or (_ROOT / name).is_symlink())
               for name in ('admission.guard', 'admission-state.json'))


def assert_journal_guard(root):
    if installed_for_journal(root):
        held = getattr(_LOCAL, 'held', None)
        if held is None: raise ValueError('phone_admission_context_unknown')
        held.verify()


def journal_guard(root):
    if Path(root) != _JOURNAL_ROOT: return nullcontext()
    # legacy未安装保留原合同；一旦任意安装部件出现，缺失/损坏不能退回无闸。
    if not installed_for_journal(root): return nullcontext()
    return locked()


def discard_fork_context():
    held = getattr(_LOCAL, 'held', None)
    if held is not None and held.pid != os.getpid():
        # 仅清Python引用；实际FD由detach显式关闭，不能close可复用的旧数字FD。
        _LOCAL.held = None


class Admission:
    def _read(self):
        with _TrustedReads() as reads:
            value = _json(reads.read(_ROOT / 'admission-state.json'))
            _keys(value, ('schema', 'revision', 'control_epoch', 'pending'))
            if value['schema'] != 'phone-admission/v1' or type(value['revision']) is not int or value['revision'] < 0:
                raise ValueError('phone_admission_state_unknown')
            if str(uuid.UUID(value['control_epoch'])) != value['control_epoch'] or not isinstance(value['pending'], dict):
                raise ValueError('phone_admission_state_unknown')
            for key, entry in value['pending'].items():
                _keys(entry, ('identity', 'pins', 'phase', 'owner', 'control_epoch'))
                _identity(entry['identity'])
                if key != entry['identity']['dispatch_id'] or entry['phase'] != 'pre_intent' or not isinstance(entry['pins'], dict) or not isinstance(entry['owner'], dict):
                    raise ValueError('phone_admission_state_unknown')
            reads.verify(); return value

    def snapshot(self):
        with locked(): return self._read()

    def register(self, identity):
        # 只登记真实配置核验后的pre-intent；没有完成/释放/授权GO的含义。
        with locked() as held:
            pins = _plain(validate_activation(identity)); state = self._read()
            key = identity['dispatch_id']
            if key in state['pending']:
                if state['pending'][key]['identity'] != identity: raise ValueError('phone_admission_conflict')
                return state['pending'][key]
            state['pending'][key] = {'identity': dict(identity), 'pins': pins, 'phase': 'pre_intent',
                                     'owner': process_identity(os.getpid()), 'control_epoch': state['control_epoch']}
            state['revision'] += 1
            held.verify()
            from journal import atomic_json, Journal
            journal = Journal(_JOURNAL_ROOT)
            with journal.locked(key):
                with journal.activity_locked() as activity_held:
                    activity = journal._activity(); activity['revision'] += 1
                    activity_held.verify()
                    atomic_json(journal.root / '.activity.json', activity)
                    atomic_json(_ROOT / 'admission-state.json', state)
            held.verify(); return state['pending'][key]


class HostExclusive:
    """真实E FD生命周期原语；本身不证明旧业务已全受管或整机quiescent。"""
    def __init__(self): self.fd, self.reads = None, None

    def acquire(self):
        if self.fd is not None: raise ValueError('phone_host_already_held')
        reads = _HostReads(); reads.__enter__()
        try:
            reads.read(_HOST_ROOT / 'host.guard')
            fd = reads.files[-1][2]
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with _HostReads() as ledger:
                value = _json(ledger.read(_HOST_ROOT / '.host-activity.json'))
                _keys(value, ('schema', 'activities'))
                if type(value['schema']) is not int or value['schema'] != 1 or value['activities'] != {}:
                    raise ValueError('phone_host_activity_unknown')
                ledger.verify()
            reads.verify()
            os.set_inheritable(fd, True)
            self.fd, self.reads = fd, reads
            return self
        except BaseException:
            reads.__exit__(); raise

    def verify(self):
        if self.fd is None: raise ValueError('phone_host_not_held')
        with _HostReads() as current:
            current.read(_HOST_ROOT / 'host.guard')
            now, held = os.fstat(current.files[-1][2]), os.fstat(self.fd)
            if (now.st_dev, now.st_ino) != (held.st_dev, held.st_ino) or held.st_nlink != 1:
                raise ValueError('phone_host_inode_changed')
            current.verify()

    def transfer(self):
        self.verify()
        if self.reads is not None:
            # dup共享同一E open description；关闭metadata后保留这个真实FD。
            fd = os.dup(self.fd)
            self.reads.__exit__(); self.reads = None; self.fd = fd
        os.set_inheritable(self.fd, True)
        return self.fd

    def close(self):
        if self.reads is not None: self.reads.__exit__(); self.reads = None; self.fd = None
        elif self.fd is not None: os.close(self.fd); self.fd = None


def maintenance_snapshot(root):
    if not installed_for_journal(root): return {'revision': None, 'pending': 0}
    value = Admission().snapshot()
    return {'revision': value['revision'], 'pending': len(value['pending'])}
