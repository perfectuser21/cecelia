"""机器boot+PID+启动时刻判活；未知拒绝发信号。"""
import os
from pathlib import Path
import signal
import subprocess
import sys


def boot_id():
    if sys.platform.startswith('linux'):
        value = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    elif sys.platform == 'darwin':
        value = subprocess.run(['/usr/sbin/sysctl', '-n', 'kern.boottime'], check=True,
                               capture_output=True, text=True, timeout=1).stdout.strip()
    else:
        raise ValueError('phone_platform_unavailable')
    if not value:
        raise ValueError('phone_boot_unavailable')
    return value


def process_identity(pid):
    if not isinstance(pid, int) or pid <= 1:
        raise ValueError('phone_process_invalid')
    if sys.platform.startswith('linux'):
        text = Path('/proc/' + str(pid) + '/stat').read_text()
        fields = text[text.rfind(')') + 2:].split()
        return {'pid': pid, 'boot_id': boot_id(), 'start_time': fields[19],
                'pgid': int(fields[2]), 'state': fields[0]}
    result = subprocess.run(['/bin/ps', '-o', 'pgid=,lstart=,stat=', '-p', str(pid)],
                            capture_output=True, text=True, timeout=1)
    parts = result.stdout.strip().split()
    if result.returncode or len(parts) < 7:
        raise ProcessLookupError(pid)
    return {'pid': pid, 'boot_id': boot_id(), 'start_time': ' '.join(parts[1:6]),
            'pgid': int(parts[0]), 'state': parts[6]}


def process_matches(identity):
    try:
        current = process_identity(identity['pid'])
        return not current['state'].startswith('Z') and all(
            current[k] == identity[k] for k in ('pid', 'boot_id', 'start_time', 'pgid'))
    except (KeyError, ValueError, OSError, subprocess.SubprocessError, TypeError):
        return False


def process_absent(identity):
    """身份易主证明原进程退出；读取失败只能unknown，不能当作已死。"""
    try:
        if identity['boot_id'] != boot_id():
            return True
        current = process_identity(identity['pid'])
        return current['state'].startswith('Z') or current['start_time'] != identity['start_time']
    except (FileNotFoundError, ProcessLookupError):
        return True
    except (KeyError, ValueError, OSError, subprocess.SubprocessError, TypeError):
        return False


def stop_verified(identity):
    if not process_matches(identity):
        return False
    try:
        # 第一刀只杀被绑定的单个进程；不把已复用的PGID当作后代证据。
        os.kill(identity['pid'], signal.SIGTERM)
        return True
    except ProcessLookupError:
        return False
