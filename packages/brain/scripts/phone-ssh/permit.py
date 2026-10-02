"""C4纯库：自产固定socket孩子、持久GO与唯一permit；无生产入口/授权安装。"""
import fcntl
import json
import os
from pathlib import Path
import select
import signal
import stat
import threading
import uuid
import weakref
import admission
from activation import _TrustedReads, _json, _keys, _identity, validate_activation, _plain
from adb_socket import get_state
from journal import Journal, atomic_json
from process_identity import boot_id, process_identity, process_matches

_PORT = 5037
_DATA_ROOT = Path('/var/lib/cecelia')
_FLEET_DRAIN = Path('/var/run/cecelia/fleet-worker.drain')
_CHILDREN = weakref.WeakKeyDictionary()
_CONTROL_FIELDS = ('schema', 'revision', 'control_epoch', 'draining', 'writer_contract', 'host_gate_contract')


def _control():
    with _TrustedReads() as reads:
        value = _json(reads.read(admission._ROOT / 'control.json'))
        _keys(value, _CONTROL_FIELDS)
        if value['schema'] != 'phone-admission-control/v1' or type(value['revision']) is not int or value['revision'] < 0 or type(value['draining']) is not bool:
            raise ValueError('phone_control_unknown')
        if str(uuid.UUID(value['control_epoch'])) != value['control_epoch'] or value['writer_contract'] != 'phone-admission-writers/v1' or value['host_gate_contract'] != 'managed-phone-host/v1':
            raise ValueError('phone_control_unknown')
        reads.verify(); return value


def _publish(path, value):
    """固定目标，逐层受信dirfd内replace+fsync；不经可被换父目录的绝对路径写。"""
    from activation import _INSTALL_ROOT
    path = Path(path)
    if path.parent == admission._ROOT and path.name in ('control.json','admission-state.json','phone.drain'):
        anchor = admission._ROOT / 'admission.guard'
    elif path == _INSTALL_ROOT / 'activation.json': anchor = path
    else: raise ValueError('phone_control_path_unknown')
    with _TrustedReads() as reads:
        reads.read(anchor); parent = reads.files[-1][0]; reads.verify()
        try:
            old = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError: old = None
        if old is not None and (not stat.S_ISREG(old.st_mode) or old.st_uid != os.getuid() or stat.S_IMODE(old.st_mode) != 0o600 or old.st_nlink != 1):
            raise ValueError('phone_control_file_unknown')
        temp = '.' + path.name + '.' + str(uuid.uuid4())
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
            with os.fdopen(fd, 'wb') as handle:
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            os.replace(temp, path.name, src_dir_fd=parent, dst_dir_fd=parent); os.fsync(parent)
            if anchor == path: reads.files.clear()  # 自己替换目标；仍核全部祖先edge。
            reads.verify()
        finally:
            try: os.unlink(temp, dir_fd=parent)
            except FileNotFoundError: pass


def _drained():
    for path in (admission._ROOT / 'phone.drain', _FLEET_DRAIN):
        try: value = path.lstat()
        except FileNotFoundError: continue
        if not stat.S_ISREG(value.st_mode): raise ValueError('phone_drain_unknown')
        return True
    return False


def _host_fd(host):
    if type(host) is not admission.HostExclusive: raise ValueError('phone_host_handle_unknown')
    host.verify()
    with admission._HostReads() as reads:
        reads.read(admission._HOST_ROOT / 'host.guard')
        probe = reads.files[-1][2]
        try: fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError: pass
        else: raise ValueError('phone_host_exclusive_unknown')
        reads.verify()
    return host.fd


def _close_except(keep):
    names = os.listdir('/proc/self/fd' if Path('/proc/self/fd').exists() else '/dev/fd')
    for name in names:
        try:
            fd = int(name)
            if fd > 2 and fd not in keep: os.close(fd)
        except (ValueError, OSError): pass


class FixedSocketChild:
    """构造器只自产fork；不接受PID/FD/verified，私有登记不可由public属性mint。"""
    def __init__(self, identity, host):
        _identity(identity); host_fd = _host_fd(host)
        owned = []
        try:
            ready_r, ready_w = os.pipe(); owned.extend((ready_r, ready_w))
            go_r, go_w = os.pipe(); owned.extend((go_r, go_w))
            out_r, out_w = os.pipe(); owned.extend((out_r, out_w))
            nonce = str(uuid.uuid4()); inherited = os.dup(host_fd); owned.append(inherited)
            pid = os.fork()
        except BaseException:
            for fd in owned: os.close(fd)
            raise
        if pid == 0:
            try:
                os.setsid(); _close_except({inherited, ready_w, go_r, out_w})
                value = os.fstat(inherited)
                mine = process_identity(os.getpid())
                os.write(ready_w, json.dumps({'identity':mine, 'nonce':nonce,
                         'host_inode':[value.st_dev,value.st_ino], 'host_fd':inherited}).encode())
                os.close(ready_w)
                if not select.select([go_r], [], [], 5)[0] or os.read(go_r, 1) != b'1': os._exit(125)
                os.close(go_r)
                signal.signal(signal.SIGTERM, signal.SIG_DFL)
                result = get_state(identity['serial'], 5, _port=_PORT)
                os.write(out_w, result.encode('ascii')); os._exit(0)
            except BaseException: os._exit(126)
        for fd in (ready_w, go_r, out_w, inherited): os.close(fd)
        pipe = os.fstat(go_w)
        data = {'pid':pid,'owner':os.getpid(),'thread':threading.get_ident(),'go':go_w,'out':out_r,'closed':False,'sent':False,
                'go_inode':(pipe.st_dev,pipe.st_ino)}
        _CHILDREN[self] = data
        try:
            if not select.select([ready_r], [], [], 1)[0]: raise ValueError('phone_child_ready_unknown')
            ready = _json(os.read(ready_r, 4097))
            _keys(ready, ('identity','nonce','host_inode','host_fd'))
            actual = process_identity(pid); expected = os.fstat(host_fd)
            if ready['nonce'] != nonce or ready['host_fd'] != inherited or ready['host_inode'] != [expected.st_dev,expected.st_ino] or ready['identity']['pid'] != pid or not process_matches(ready['identity']):
                raise ValueError('phone_child_ready_unknown')
            if any(actual[k] != ready['identity'][k] for k in ('pid','boot_id','start_time','pgid')):
                raise ValueError('phone_child_ready_unknown')
            data.update(identity=dict(identity), child=ready['identity'], host_inode=ready['host_inode'])
        except BaseException:
            self.close(); raise
        finally: os.close(ready_r)

    @property
    def pid(self): return self._owned()['pid']

    def _owned(self):
        data = _CHILDREN.get(self)
        if not data or data['owner'] != os.getpid() or data['thread'] != threading.get_ident() or data['closed']:
            raise ValueError('phone_child_handle_unknown')
        return data

    def wait(self):
        data = self._owned()
        if not select.select([data['out']], [], [], 6)[0]: raise ValueError('phone_child_reply_unknown')
        raw = os.read(data['out'], 65); got, status = os.waitpid(data['pid'], 0)
        data['waited'] = True
        if got != data['pid'] or status != 0 or not raw or len(raw) > 64:
            raise ValueError('phone_child_reply_unknown')
        return raw.decode('ascii')

    def close(self):
        data = _CHILDREN.get(self)
        if not data or data['closed'] or data['owner'] != os.getpid(): return
        if data['thread'] != threading.get_ident(): raise ValueError('phone_child_handle_unknown')
        data['closed'] = True
        for name in ('go','out'):
            if data[name] is not None: os.close(data[name]); data[name] = None
        if not data.get('waited'):
            os.waitpid(data['pid'], 0); data['waited'] = True


def send(identity, host, child):
    """同锁最后重读与fsync；GO之后失败只能unknown，绝不清账或重发。"""
    if type(child) is not FixedSocketChild: raise ValueError('phone_child_handle_unknown')
    data = child._owned(); _identity(identity); _host_fd(host)
    if data.get('identity') != identity or data['sent'] or not process_matches(data['child']):
        raise ValueError('phone_child_handle_unknown')
    value = os.fstat(data['go'])
    if not stat.S_ISFIFO(value.st_mode) or (value.st_dev,value.st_ino) != data['go_inode']:
        raise ValueError('phone_permit_pipe_unknown')
    journal = Journal(admission._JOURNAL_ROOT); key = identity['dispatch_id']
    with admission.locked() as held:
        with journal.locked(key):
            with journal.activity_locked() as activity:
                pins = _plain(validate_activation(identity)); control = _control()
                state = admission.Admission()._read(); entry = state['pending'].get(key)
                if any(other != key for other in state['pending']): raise ValueError('phone_other_dispatch_unknown')
                if state['control_epoch'] != control['control_epoch'] or not entry or entry['phase'] != 'pre_intent' or entry['identity'] != identity or entry['pins'] != pins or entry['control_epoch'] != control['control_epoch']:
                    raise ValueError('phone_go_conflict')
                if control['draining'] or _drained():
                    raise ValueError('phone_worker_draining')
                free = os.statvfs(_DATA_ROOT)
                if free.f_bavail * free.f_frsize < 2 * 1024**3: raise ValueError('phone_disk_unavailable')
                if identity['worker_boot_id'] != boot_id() or not process_matches(data['child']):
                    raise ValueError('phone_process_identity_unknown')
                current_host = os.fstat(_host_fd(host))
                current_pipe = os.fstat(data['go'])
                if [current_host.st_dev,current_host.st_ino] != data['host_inode'] or not stat.S_ISFIFO(current_pipe.st_mode) or (current_pipe.st_dev,current_pipe.st_ino) != data['go_inode']:
                    raise ValueError('phone_permit_fd_unknown')
                held.verify(); activity.verify()
                entry.update(phase='go_committed', child=data['child'], worker=process_identity(os.getpid()),
                             control_revision=control['revision'])
                state['revision'] += 1
                value = journal._activity(); value['revision'] += 1
                atomic_json(journal.root / '.activity.json', value)
                _publish(admission._ROOT / 'admission-state.json', state)
                # durable GO已提交，哪怕随后write丢失也不允许另一轮发送。
                data['sent'] = True
                # fsync可能跨过grant/activation期限；跨过则保持GO unknown，不发byte。
                if _plain(validate_activation(identity)) != pins or _control() != control or _drained():
                    raise ValueError('phone_permit_unknown')
                held.verify(); activity.verify(); _host_fd(host)
                if not process_matches(data['child']): raise ValueError('phone_child_handle_unknown')
                if os.write(data['go'], b'1') != 1: raise ValueError('phone_permit_unknown')
                os.close(data['go']); data['go'] = None


def _replace_control(*, draining, activation_record=None):
    """仅可信installer内部写原语，无stdin/API入口；不能证明现场覆盖或授grant。"""
    if type(draining) is not bool: raise ValueError('phone_control_unknown')
    with admission.locked() as held:
        control = _control(); state = admission.Admission()._read()
        control.update(control_epoch=str(uuid.uuid4()), revision=control['revision'] + 1, draining=draining)
        marker = admission._ROOT / 'phone.drain'
        if activation_record is not None:
            from activation import _RECORD_FIELDS
            _keys(activation_record, _RECORD_FIELDS); _identity(activation_record['identity'])
            # 写入目标只能固定可信既有activation，权限/路径不能由caller指定。
            with _TrustedReads() as reads:
                from activation import _INSTALL_ROOT
                reads.read(_INSTALL_ROOT / 'activation.json'); reads.verify()
                held.verify(); _publish(_INSTALL_ROOT / 'activation.json', activation_record)
        if draining:
            _publish(marker, {'schema':'phone-admission-drain/v1', 'control_epoch':control['control_epoch'],
                                 'revision':control['revision']})
        else:
            try:
                with _TrustedReads() as reads: reads.read(marker); reads.verify()
            except FileNotFoundError: pass
            else:
                with _TrustedReads() as reads:
                    reads.read(marker); reads.verify(); parent = reads.files[-1][0]
                    os.unlink(marker.name, dir_fd=parent); os.fsync(parent)
                    reads.files.clear(); reads.verify()
        state.update(control_epoch=control['control_epoch'], revision=state['revision'] + 1)
        _publish(admission._ROOT / 'admission-state.json', state)
        _publish(admission._ROOT / 'control.json', control); held.verify()
