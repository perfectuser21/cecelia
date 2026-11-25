"""固定远端目录的备份核验与回收；仅由固定 SSH stdin 程序调用。"""
import base64
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import time

CANONICAL = '/mnt/openclaw_data/cecelia-backups-offsite'
ALIAS = '/root/cecelia-backups-offsite'
TRUST_ROOT = '/'
DIRECTORY_UID = 0
FILE_UID = 501
NOFOLLOW = os.O_NOFOLLOW
NAME = re.compile(r'^cecelia-studio-(\d{8}T\d{6}Z)\.dump$')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def stamp(name):
    match = NAME.fullmatch(name) if isinstance(name, str) else None
    if not match:
        return None
    try:
        parsed = datetime.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ')
        return parsed.replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def identity(s):
    # 纳秒时间戳大于JS安全整数，作为十进制字符串跨SSH往返。
    return [str(value) for value in (s.st_dev, s.st_ino, s.st_uid, s.st_mode,
            s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)]


def directory(s):
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == DIRECTORY_UID
            and s.st_mode & 0o022 == 0, 'untrusted_directory')


def trusted_dir(target):
    # 每个祖先都经 dirfd/O_NOFOLLOW 打开，不跟随新目标。
    relative = os.path.relpath(target, TRUST_ROOT)
    require(relative != '..' and not relative.startswith('../'), 'outside_root')
    fd = os.open(TRUST_ROOT, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW)
    try:
        directory(os.fstat(fd))
        for component in relative.split('/'):
            if component == '.':
                continue
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            directory(os.fstat(fd))
        return fd
    except Exception:
        os.close(fd)
        raise


def root_fd():
    require(os.path.realpath(ALIAS) == CANONICAL, 'alias_changed')
    parent = trusted_dir(os.path.dirname(ALIAS))
    os.close(parent)
    fd = trusted_dir(CANONICAL)
    try:
        current = os.stat(ALIAS)
        require((current.st_dev, current.st_ino) == (os.fstat(fd).st_dev, os.fstat(fd).st_ino),
                'alias_changed')
        return fd
    except Exception:
        os.close(fd)
        raise


def file_info(fd, name, deadline):
    require(stamp(name) is not None, 'invalid_name')
    item = os.open(name, os.O_RDONLY | NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        before = os.fstat(item)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == FILE_UID
                and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
                and before.st_dev == os.fstat(fd).st_dev, 'untrusted_file')
        sha = hashlib.sha256()
        while True:
            require(time.monotonic() < deadline, 'budget_exceeded')
            block = os.read(item, 1024 * 1024)
            if not block:
                break
            sha.update(block)
        require(identity(before) == identity(os.fstat(item)), 'file_changed')
        require(identity(before) == identity(os.stat(name, dir_fd=fd, follow_symlinks=False)),
                'path_changed')
        return {'name': name, 'bytes': before.st_size, 'sha256': sha.hexdigest(),
                'identity': identity(before)}
    finally:
        os.close(item)


def matches(actual, expected, with_identity=False):
    require(actual['name'] == expected['name'] and actual['bytes'] == expected['bytes']
            and actual['sha256'] == expected['sha256'], 'checksum_mismatch')
    if with_identity:
        require(actual['identity'] == expected['identity'], 'identity_changed')


def validate(request):
    require(isinstance(request, dict) and request.get('action') in ('inspect', 'prune'), 'bad_request')
    require(re.fullmatch(r'[a-f0-9-]{36}', request.get('run_id', '')) is not None, 'bad_run')
    now = request.get('now')
    require(type(now) in (int, float) and 0 < now < 4102444800, 'bad_clock')
    # 本机时钟跳到未来不可激进回收；较早时间的cutoff只会保全更多副本。
    require(now <= time.time() + 300, 'future_clock')
    require(request.get('cutoff') == now - 14 * 86400, 'bad_policy')
    new = request.get('new', {})
    require(stamp(new.get('name')) == now and type(new.get('bytes')) is int
            and new['bytes'] > 0 and re.fullmatch(r'[a-f0-9]{64}', new.get('sha256', '')),
            'bad_new_copy')
    approved = request.get('approved', [])
    require(isinstance(approved, list) and len(approved) <= 256, 'bad_candidates')
    for item in approved:
        when = stamp(item.get('name'))
        require(when is not None and when < request['cutoff']
                and isinstance(item.get('identity'), list) and len(item['identity']) == 8
                and type(item.get('bytes')) is int
                and re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')), 'bad_candidate')
    require(len({item['name'] for item in approved}) == len(approved), 'duplicate_candidate')


def transaction(request):
    validate(request)
    deadline = time.monotonic() + 180
    fd = root_fd()
    lock = None
    reservation = None
    try:
        lock = os.open('.studio-retention.lock', os.O_CREAT | os.O_RDWR | NOFOLLOW,
                       0o600, dir_fd=fd)
        locked = os.fstat(lock)
        require(stat.S_ISREG(locked.st_mode) and locked.st_uid == DIRECTORY_UID
                and stat.S_IMODE(locked.st_mode) == 0o600 and locked.st_nlink == 1,
                'untrusted_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(identity(locked) == identity(os.stat('.studio-retention.lock', dir_fd=fd,
                                                   follow_symlinks=False)), 'lock_changed')
        directory_id = identity(os.fstat(fd))[:4]
        matches(file_info(fd, request['new']['name'], deadline), request['new'])
        result = {'ok': True, 'directory': directory_id, 'candidates': [],
                  'deleted': [], 'unknown': []}
        if request['action'] == 'inspect':
            for name in sorted(os.listdir(fd)):
                when = stamp(name)
                if when is None or when >= request['cutoff']:
                    continue
                try:
                    require(len(result['candidates']) < 256, 'candidate_limit')
                    result['candidates'].append(file_info(fd, name, deadline))
                except (OSError, ValueError):
                    result['unknown'].append(name)
            return result
        require(request.get('directory') == directory_id, 'directory_changed')
        if not request.get('approved'):
            return result
        reservation_name = '.studio-retention-' + request['run_id']
        os.mkdir(reservation_name, 0o700, dir_fd=fd)
        reservation = os.open(reservation_name, os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW, dir_fd=fd)
        directory(os.fstat(reservation))
        require(stat.S_IMODE(os.fstat(reservation).st_mode) == 0o700, 'untrusted_reservation')
        for item in request['approved']:
            name = item['name']
            try:
                # 每项删除前再次核新副本、alias和精确目录身份。
                fresh = root_fd()
                try:
                    require(identity(os.fstat(fresh))[:4] == directory_id, 'directory_changed')
                finally:
                    os.close(fresh)
                matches(file_info(fd, request['new']['name'], deadline), request['new'])
                matches(file_info(fd, name, deadline), item, True)
                os.rename(name, name, src_dir_fd=fd, dst_dir_fd=reservation)
                # rename 会改变 ctime；绑定 dev/ino 和其余身份，随后再完整读hash。
                reserved = file_info(reservation, name, deadline)
                require(reserved['identity'][:7] == item['identity'][:7], 'reservation_changed')
                matches(reserved, item)
                # 依赖受信root命名空间/合作写入者；不声称能防恶意既有可写FD。
                os.unlink(name, dir_fd=reservation)
                result['deleted'].append({'name': name, 'bytes': item['bytes']})
            except (OSError, ValueError):
                # 不覆盖原位置、不清空未知保留区，也不把缺失视为成功。
                result['unknown'].append(name)
        os.close(reservation)
        reservation = None
        try:
            os.rmdir(reservation_name, dir_fd=fd)
        except OSError:
            pass
        return result
    finally:
        if reservation is not None:
            os.close(reservation)
        if lock is not None:
            os.close(lock)
        os.close(fd)


def main(request):
    try:
        result = transaction(request)
    except (OSError, ValueError, TypeError, KeyError):
        result = {'ok': False, 'code': 'remote_guard_failed'}
    print(json.dumps(result, separators=(',', ':')))
