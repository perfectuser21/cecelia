"""C4原子锁/未决账基础；不授grant，不是Journal完成回执，不自动安装。"""
from contextlib import contextmanager, nullcontext
import fcntl
import json
import os
import stat
from pathlib import Path
import threading
import uuid
import weakref
from activation import _TrustedReads, _json, _keys, _identity, validate_activation, _plain
from process_identity import process_identity, process_matches

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
    def final_go(self, identity, host, child):
        from permit import send
        return send(identity, host, child)

    def _read(self):
        with _TrustedReads() as reads:
            value = _json(reads.read(_ROOT / 'admission-state.json'))
            _keys(value, ('schema', 'revision', 'control_epoch', 'pending'))
            if value['schema'] != 'phone-admission/v1' or type(value['revision']) is not int or value['revision'] < 0:
                raise ValueError('phone_admission_state_unknown')
            if str(uuid.UUID(value['control_epoch'])) != value['control_epoch'] or not isinstance(value['pending'], dict):
                raise ValueError('phone_admission_state_unknown')
            for key, entry in value['pending'].items():
                fields = ('identity', 'pins', 'phase', 'owner', 'control_epoch')
                if entry.get('phase') == 'go_committed': fields += ('child', 'worker', 'control_revision')
                _keys(entry, fields)
                _identity(entry['identity'])
                if key != entry['identity']['dispatch_id'] or entry['phase'] not in ('pre_intent', 'go_committed') or not isinstance(entry['pins'], dict) or not isinstance(entry['owner'], dict):
                    raise ValueError('phone_admission_state_unknown')
                if entry['phase'] == 'go_committed':
                    if type(entry['control_revision']) is not int or entry['control_revision'] < 0:
                        raise ValueError('phone_admission_state_unknown')
                    for name in ('child', 'worker'):
                        _keys(entry[name], ('pid', 'boot_id', 'start_time', 'pgid', 'state'))
                        if type(entry[name]['pid']) is not int or entry[name]['pid'] <= 1:
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


_HOSTS = weakref.WeakKeyDictionary()


class HostExclusive:
    """只有真实acquire铸造的私有E；不证明业务已全受管/整机quiescent。"""
    def _owned(self, *, closed=False):
        value = _HOSTS.get(self)
        if not value or value['owner']['pid'] != os.getpid() or value['thread'] != threading.get_ident() or not process_matches(value['owner']):
            raise ValueError('phone_host_handle_unknown')
        if value['closed'] and not closed: raise ValueError('phone_host_not_held')
        return value

    @property
    def fd(self):
        self.verify()
        return self._owned()['fd']

    def acquire(self):
        if self in _HOSTS: raise ValueError('phone_host_already_minted')
        reads = _HostReads(); reads.__enter__(); witness = None
        try:
            reads.read(_HOST_ROOT / 'host.guard'); fd = reads.files[-1][2]
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with _HostReads() as ledger:
                value = _json(ledger.read(_HOST_ROOT / '.host-activity.json'))
                _keys(value, ('schema', 'activities'))
                if type(value['schema']) is not int or value['schema'] != 1 or value['activities'] != {}:
                    raise ValueError('phone_host_activity_unknown')
                ledger.verify()
            reads.verify(); witness = os.dup(fd)
            os.set_inheritable(fd, True); os.set_inheritable(witness, True)
            value = os.fstat(fd)
            _HOSTS[self] = {'fd':fd, 'witness':witness, 'reads':reads, 'closed':False,
                           'inode':(value.st_dev,value.st_ino), 'owner':process_identity(os.getpid()),
                           'thread':threading.get_ident(), 'generation':str(uuid.uuid4())}
            return self
        except BaseException:
            if witness is not None: os.close(witness)
            reads.__exit__(); raise

    @staticmethod
    def _prove(value):
        with _HostReads() as current:
            current.read(_HOST_ROOT / 'host.guard'); probe = current.files[-1][2]
            for fd in (value['fd'], value['witness']):
                held = os.fstat(fd)
                if (held.st_dev,held.st_ino) != value['inode'] or held.st_nlink != 1 or not os.get_inheritable(fd):
                    raise ValueError('phone_host_fd_unknown')
            now = os.fstat(probe)
            if (now.st_dev,now.st_ino) != value['inode']: raise ValueError('phone_host_inode_changed')
            # 先证明实际EX。若SH probe成功，拒绝且绝不升级修复已掉锁/降级的OFD。
            try: fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError: pass
            else: raise ValueError('phone_host_exclusive_unknown')
            # 私有dup witness仍持同OFD的EX；独立open即便复用同inode/数字FD也被拒。
            try:
                fcntl.flock(value['fd'], fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(value['witness'], fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error: raise ValueError('phone_host_description_unknown') from error
            current.verify()

    def verify(self):
        value = self._owned(); self._prove(value)
        if value['reads'] is not None: value['reads'].verify()

    def fork(self):
        self.verify(); value = self._owned()
        # 一次token不暴露、不接受caller PID/FD；本方法自己执行唯一真实fork。
        token = {'parent':dict(value['owner']), 'generation':value['generation']}
        pid = os.fork()
        if pid == 0:
            if os.getppid() != token['parent']['pid'] or not process_matches(token['parent']) or value['generation'] != token['generation']:
                raise ValueError('phone_host_fork_unknown')
            self._prove(value)
            value.update(owner=process_identity(os.getpid()), thread=threading.get_ident(), generation=str(uuid.uuid4()))
        return pid

    def transfer(self):
        self.verify(); value = self._owned()
        if value['reads'] is not None:
            fd = os.dup(value['fd']); os.set_inheritable(fd, True)
            value['reads'].__exit__(); value.update(reads=None, fd=fd, generation=str(uuid.uuid4()))
        return value['fd']

    def _detach_fds(self):
        self.verify(); value = self._owned()
        return (value['fd'],value['witness'])

    def _after_detach(self):
        value = _HOSTS.get(self)
        if not value or value['closed'] or value['reads'] is not None or value['owner']['pid'] != os.getpid() or value['thread'] != threading.get_ident():
            raise ValueError('phone_host_detach_unknown')
        now = process_identity(os.getpid())
        if any(now[k] != value['owner'][k] for k in ('pid','boot_id','start_time')) or now['pgid'] != os.getpid() or os.getsid(0) != os.getpid():
            raise ValueError('phone_host_detach_unknown')
        self._prove(value)
        value.update(owner=now, generation=str(uuid.uuid4()))

    def close(self):
        value = self._owned(closed=True)
        if value['closed']: return
        self.verify()
        if value['reads'] is not None: value['reads'].__exit__(); value['reads'] = None
        else: os.close(value['fd'])
        os.close(value['witness']); value['closed'] = True


def maintenance_snapshot(root):
    if not installed_for_journal(root): return {'revision': None, 'pending': 0}
    value = Admission().snapshot()
    return {'revision': value['revision'], 'pending': len(value['pending'])}
