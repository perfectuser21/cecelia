"""本地凭据互斥锁；父进程结束后管道关闭，内核锁随之释放。"""
import fcntl
import json
import os
import stat
import sys
import time


def main():
    fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise ValueError('锁文件不安全')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.fchmod(lock.fileno(), 0o600)
        lock.seek(0)
        lock.truncate()
        json.dump({'pid': int(sys.argv[2]), 'holder_pid': os.getpid(), 'acquired_at': time.time()}, lock)
        lock.flush()
        print('READY', flush=True)
        sys.stdin.buffer.read()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit(1)
