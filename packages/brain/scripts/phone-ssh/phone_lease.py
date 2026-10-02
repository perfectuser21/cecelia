"""仅兼容旧helper的serial.guard与free-only锁协议；无APP操作或stale回收。"""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat
import time
from journal import safe_open, fsync_dir


class PhoneLease:
    def __init__(self, root, identity):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        s = self.root.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid():
            raise ValueError('phone_lock_root_untrusted')
        self.identity = identity
        self.path = self.root / (identity['serial'] + '.lock')

    @contextmanager
    def guarded(self):
        fd = safe_open(self.root / (self.identity['serial'] + '.guard'), os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def acquire(self, pid):
        with self.guarded():
            # 任意已存在目录（包括旧stale）都不能接管。
            self.path.mkdir(mode=0o700)
            try:
                for name, value in [('owner', self.identity['lease_token']), ('pid', str(pid)),
                                    ('acquired_at', str(int(time.time())))]:
                    fd = safe_open(self.path / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    with os.fdopen(fd, 'w') as handle:
                        handle.write(value + '\n')
                        handle.flush()
                        os.fsync(handle.fileno())
                fsync_dir(self.path)
                fsync_dir(self.root)
            except Exception:
                # 不完整锁也保留；只有强身份恢复能处理自己的残留。
                raise

    def own_absent(self):
        try:
            s = self.path.lstat()
        except FileNotFoundError:
            return True
        if not stat.S_ISDIR(s.st_mode):
            return False
        try:
            return (self.path / 'owner').read_text().strip() != self.identity['lease_token']
        except OSError:
            return False

    def release(self, pid):
        with self.guarded():
            try:
                s = self.path.lstat()
            except FileNotFoundError:
                return True
            if not stat.S_ISDIR(s.st_mode):
                return False
            try:
                owner = (self.path / 'owner').read_text().strip()
                recorded_pid = (self.path / 'pid').read_text().strip()
            except OSError:
                return False
            if owner != self.identity['lease_token'] or recorded_pid != str(pid):
                return False
            # 不递归删除未知文件或子目录。
            if {p.name for p in self.path.iterdir()} != {'owner', 'pid', 'acquired_at'}:
                return False
            for name in ('owner', 'pid', 'acquired_at'):
                (self.path / name).unlink()
            self.path.rmdir()
            fsync_dir(self.root)
            return True
