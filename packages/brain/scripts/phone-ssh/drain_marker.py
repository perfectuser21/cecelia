"""跨整轮维护比较的真实marker代际；大整数以十进制字符串避免JSON精度损失。"""
from pathlib import Path
import stat
from process_identity import boot_id

def marker_identity(path):
    try:
        value=Path(path).lstat()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ValueError('phone_maintenance_unconfirmed') from error
    if not stat.S_ISREG(value.st_mode):
        raise ValueError('phone_maintenance_unconfirmed')
    return {'boot_id':boot_id(),'dev':str(value.st_dev),'ino':str(value.st_ino),
            'size':str(value.st_size),'mtime_ns':str(value.st_mtime_ns),'ctime_ns':str(value.st_ctime_ns),
            'uid':str(value.st_uid),'gid':str(value.st_gid),'mode':str(stat.S_IMODE(value.st_mode))}
