"""固定只读物理探针；安装字节和OS事实，不启动daemon/业务/自修复。"""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import uuid
from journal import Journal, safe_open
from process_identity import boot_id
from runner import Runner, Config
from drain_marker import marker_identity

SOURCE_FILES=('runner.py','worker.py','journal.py','phone_lease.py','process_identity.py','adb_socket.py','probe.py','drain_marker.py','http_physical.py','admission.py','activation.py')
SCHEMA='phone-physical-probe/v1'

def private_json(path):
    fd=safe_open(path,os.O_RDONLY)
    with os.fdopen(fd) as handle:
        raw=handle.read(65537)
    if len(raw)>65536:
        raise ValueError('phone_probe_unconfirmed')
    value=json.loads(raw)
    if not isinstance(value,dict):raise ValueError('phone_probe_unconfirmed')
    return value

def hash_bytes(path):
    fd=os.open(str(path),os.O_RDONLY|os.O_NOFOLLOW)
    try:
        value=os.fstat(fd)
        if not stat.S_ISREG(value.st_mode) or value.st_uid!=os.getuid() or value.st_mode&0o022 or value.st_size>1024*1024:
            raise ValueError('phone_probe_untrusted')
        with os.fdopen(fd,'rb') as handle:
            fd=None
            return hashlib.sha256(handle.read(1024*1024+1)).hexdigest()
    finally:
        if fd is not None:os.close(fd)

def real_resources(data_root):
    def command(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=1).stdout.strip()
    if sys.platform=='darwin':
        cpu=int(command(['/usr/sbin/sysctl','-n','hw.ncpu']))
        total=int(command(['/usr/sbin/sysctl','-n','hw.memsize']))
        vm=command(['/usr/bin/vm_stat'])
        page=int(re.search(r'page size of (\d+) bytes',vm).group(1))
        free=int(re.search(r'Pages free:\s+(\d+)',vm).group(1))*page
    elif sys.platform.startswith('linux'):
        cpu=os.cpu_count()
        text=Path('/proc/meminfo').read_text()
        total=int(re.search(r'MemTotal:\s+(\d+)',text).group(1))*1024
        free=int(re.search(r'MemAvailable:\s+(\d+)',text).group(1))*1024
    else:raise ValueError('phone_probe_platform_unavailable')
    return {'cpu_count':cpu,'memory_total_bytes':total,'memory_free_bytes':free,
            'load_1m':os.getloadavg()[0],'data_free_bytes':shutil.disk_usage(data_root).free}

def daemon_observation():
    # 仅观察既有固定本机socket，绝不执行ADB或补启动daemon。
    try:
        with socket.create_connection(('127.0.0.1',5037),timeout=0.3):
            return {'reachable':True}
    except ConnectionRefusedError:return {'reachable':False}
    except OSError as error:raise ValueError('phone_adb_observation_unknown') from error

def external_locks(root):
    root=Path(root);info=root.lstat()
    if not stat.S_ISDIR(info.st_mode):raise ValueError('phone_lock_observation_unknown')
    occupied=set()
    for path in root.iterdir():
        mode=path.lstat().st_mode
        name=path.name.rsplit('.',1)[0]
        if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',name):raise ValueError('phone_lock_observation_unknown')
        if path.name.endswith('.lock') and stat.S_ISDIR(mode):occupied.add(name)
        elif path.name.endswith('.guard') and stat.S_ISREG(mode):
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:occupied.add(name)
            finally:os.close(fd)
        else:raise ValueError('phone_lock_observation_unknown')
    return {'occupied':len(occupied)}

def installed_identity(*,manifest_path='/etc/cecelia/phone-ssh/probe.json',source_root='/opt/cecelia/phone-ssh',config_path='/etc/cecelia/phone-ssh/worker.json'):
    manifest=private_json(manifest_path);identity=private_json(config_path)
    if set(identity)!={'machine_id','worker_id','host'} or set(manifest)!={'schema','machine_id','worker_id','host','source_hashes'} or manifest['schema']!=1 or any(manifest[k]!=identity[k] for k in identity):
        raise ValueError('phone_probe_manifest_invalid')
    expected=manifest['source_hashes']
    if not isinstance(expected,dict) or set(expected)!=set(SOURCE_FILES):raise ValueError('phone_probe_manifest_invalid')
    actual={name:hash_bytes(Path(source_root)/name) for name in SOURCE_FILES}
    if actual!=expected:raise ValueError('phone_probe_build_mismatch')
    build=hashlib.sha256(json.dumps(actual,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    config=hashlib.sha256(json.dumps({'manifest':manifest,'worker_identity':identity,'actual_hashes':actual},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {**identity,'physical_boot_id':boot_id(),'config_digest':config,'build_digest':build,'action_digest':actual['adb_socket.py']}

def collect(*,manifest_path='/etc/cecelia/phone-ssh/probe.json',source_root='/opt/cecelia/phone-ssh',
            config_path='/etc/cecelia/phone-ssh/worker.json',journal_root='/var/lib/cecelia/phone-ssh',
            lock_root='/private/tmp/openclaw-phone/locks',drain_path='/var/run/cecelia/fleet-worker.drain'):
    installed=installed_identity(manifest_path=manifest_path,source_root=source_root,config_path=config_path)
    identity={k:installed[k] for k in ('machine_id','worker_id','host')}
    # 缺失物理账不得初始化空账后谎称零；probe完全不创建journal。
    if not Path(journal_root).is_dir() or not (Path(journal_root)/'.activity.json').is_file():raise ValueError('phone_probe_journal_unknown')
    runner=Runner(Config(journal_root=str(journal_root),**identity))
    before_marker=marker_identity(drain_path);before=runner.journal.activity_snapshot()
    before_locks=external_locks(lock_root)
    maintenance=runner.maintenance()
    after_locks=external_locks(lock_root)
    after=runner.journal.activity_snapshot();after_marker=marker_identity(drain_path)
    occupied=max(before_locks['occupied'],after_locks['occupied'])
    maintenance['journal_pending']=maintenance['pending']
    maintenance['external_occupied']=occupied
    maintenance['pending']+=occupied
    maintenance['marker_identity']=after_marker
    maintenance['draining']=before_marker is not None and after_marker is not None
    maintenance['stable']=maintenance['stable'] and before['revision']==after['revision'] and before_marker==after_marker and before_locks==after_locks
    maintenance['quiescent']=maintenance['draining'] and maintenance['stable'] and maintenance['pending']==0 and maintenance['in_flight']==0
    return {'machine_id':identity['machine_id'],'worker_id':identity['worker_id'],'physical_boot_id':boot_id(),
            'config_digest':installed['config_digest'],'build_digest':installed['build_digest'],'action':'adb_get_state','action_digest':installed['action_digest'],
            'resources':real_resources(journal_root),'adb_daemon':daemon_observation(),'external_locks':{'occupied':occupied},
            'maintenance':maintenance,'observed_at':datetime.now(timezone.utc).isoformat()}

def validate_request(request):
    if not isinstance(request,dict) or set(request)!={'schema','request_nonce'} or request['schema']!=SCHEMA:
        raise ValueError('phone_probe_request_invalid')
    try:
        nonce=uuid.UUID(request['request_nonce'])
        if nonce.version!=4 or str(nonce)!=request['request_nonce']:raise ValueError('nonce')
    except (ValueError,TypeError,AttributeError) as error:raise ValueError('phone_probe_request_invalid') from error

def main():
    # 整轮5秒硬上限，stdin读取/固定OS命令/文件扫描均受同一限制。
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(ValueError('phone_probe_timeout')))
    signal.alarm(5)
    raw=sys.stdin.buffer.read(16385)
    if len(sys.argv)!=1 or len(raw)>16384:raise ValueError('phone_probe_request_invalid')
    request=json.loads(raw);validate_request(request)
    value=collect();sys.stdout.write(json.dumps({'schema':SCHEMA,'request_nonce':request['request_nonce'],**value},separators=(',',':'))+'\n')
if __name__=='__main__':
    try:main()
    except Exception:sys.stderr.write('phone_probe_unconfirmed\n');sys.exit(1)
