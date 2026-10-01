#!/usr/bin/env python3
"""受信root接入入口；不依赖宿主Node，不改全局工具链、Docker或网络配置。"""
import argparse
import fcntl
import hashlib
import io
import json
import os
import pathlib
import platform
import re
import selectors
import shutil
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import uuid

VERSION='24.21.0'
# 真身：https://nodejs.org/dist/v24.21.0/SHASUMS256.txt；运行时不接受外来URL/期望hash。
PINS={'x64':'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
      'arm64':'6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2'}
FILES=('linux-pool-installer.cjs','linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs',
       'linux-pool-canary.cjs','linux-resource-probe.cjs','linux-cgroup.cjs')
US_ID='1a379d80-ad36-47d3-88ba-e545ab299a54'
MAX_ARCHIVE=64*1024*1024
MAX_NODE=128*1024*1024

class BootstrapError(Exception):pass
class CommandFailure(Exception):
 def __init__(self,code,stdout='',stderr=''):
  super().__init__('command_failed');self.code=code;self.stdout=stdout;self.stderr=stderr

def fail(code):raise BootstrapError('linux_pool_bootstrap_'+code)

def run_command(command,args,input=None):
 """子进程输出和时间均有界；原始输出不得进入对外错误。"""
 process=subprocess.Popen([command,*args],stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
  stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
  env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':'/','DOCKER_HOST':'unix:///var/run/docker.sock'})
 selector=selectors.DefaultSelector();output={process.stdout:bytearray(),process.stderr:bytearray()};deadline=time.monotonic()+120
 try:
  pending=memoryview(input.encode()) if input is not None else None
  if process.stdin:
   os.set_blocking(process.stdin.fileno(),False)
   if pending:selector.register(process.stdin,selectors.EVENT_WRITE)
   else:process.stdin.close()
  for stream in output:selector.register(stream,selectors.EVENT_READ)
  while selector.get_map():
   if time.monotonic()>deadline:raise CommandFailure(-1)
   for key,_ in selector.select(timeout=0.25):
    if key.fileobj is process.stdin:
     try:written=os.write(process.stdin.fileno(),pending[:4096])
     except BlockingIOError:continue
     except BrokenPipeError:raise CommandFailure(-1)
     pending=pending[written:]
     if not pending:selector.unregister(process.stdin);process.stdin.close()
     continue
    data=os.read(key.fileobj.fileno(),4096)
    if not data:selector.unregister(key.fileobj);continue
    output[key.fileobj].extend(data)
    if sum(map(len,output.values()))>65536:raise CommandFailure(-1)
  code=process.wait(timeout=max(0.01,deadline-time.monotonic()))
  stdout=bytes(output[process.stdout]).decode('utf8',errors='replace');stderr=bytes(output[process.stderr]).decode('utf8',errors='replace')
  if code:raise CommandFailure(code,stdout,stderr)
  return stdout
 finally:
  if process.poll() is None:
   try:os.killpg(process.pid,signal.SIGKILL)
   except (ProcessLookupError,PermissionError):
    try:process.kill()
    except ProcessLookupError:pass
   process.wait(timeout=5)
  selector.close();process.stdout.close();process.stderr.close()
  if process.stdin and not process.stdin.closed:process.stdin.close()

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def download_archive(url):
 start=time.monotonic();data=bytearray()
 try:
  opener=urllib.request.build_opener(NoRedirect)
  with opener.open(url,timeout=20) as response:
   if response.status!=200:fail('download_unavailable')
   while True:
    chunk=response.read(1024*1024)
    if not chunk:break
    data.extend(chunk)
    if len(data)>MAX_ARCHIVE or time.monotonic()-start>90:fail('download_unavailable')
  return bytes(data)
 except Exception:fail('download_unavailable')

def bootstrap(options,deps=None):
 # deps仅单测调用，CLI既不解析也不接受它。
 deps=deps or {};root=pathlib.Path(deps.get('root','/'));owner=deps.get('root_uid',0)
 run=deps.get('run',run_command);readlink=deps.get('readlink',os.readlink)
 if deps.get('platform',platform.system())!='Linux' or deps.get('getuid',os.geteuid)()!=0:fail('root_linux_required')
 required={'source_dir','profile_file','token_file','revision'}
 if not isinstance(options,dict) or not required<=options.keys() or options.keys()-required-{'node_archive'}:fail('input_invalid')
 if not isinstance(options['revision'],str) or not re.fullmatch('[a-f0-9]{40}',options['revision']):fail('input_invalid')
 def real(value):
  if not isinstance(value,str) or not value.startswith('/') or '\0' in value or os.path.normpath(value)!=value:fail('input_invalid')
  return root/value.lstrip('/')
 def parents(filename):
  current=filename.parent
  while True:
   value=current.lstat()
   if not stat.S_ISDIR(value.st_mode) or value.st_uid!=owner or value.st_mode&0o022:fail('untrusted_path')
   if current==root:break
   if current==current.parent:fail('untrusted_path')
   current=current.parent
 def read(filename,mode=None,maximum=1048576):
  parents(filename);fd=None
  try:
   fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW);before=os.fstat(fd)
   if not stat.S_ISREG(before.st_mode) or before.st_uid!=owner or before.st_nlink!=1 or before.st_size>maximum:fail('untrusted_file')
   if (stat.S_IMODE(before.st_mode)!=mode if mode is not None else before.st_mode&0o022):fail('untrusted_file')
   with os.fdopen(fd,'rb',closefd=False) as stream:data=stream.read(maximum+1)
   after=os.fstat(fd);current=filename.lstat()
   if len(data)!=before.st_size or (before.st_ino,before.st_dev,before.st_ctime_ns,before.st_size)!=(current.st_ino,current.st_dev,current.st_ctime_ns,current.st_size) or before.st_ctime_ns!=after.st_ctime_ns:fail('untrusted_file')
   return data
  except BootstrapError:raise
  except Exception:fail('untrusted_file')
  finally:
   if fd is not None:os.close(fd)
 def mkdir(filename):
  if not filename.exists():
   if filename!=root:mkdir(filename.parent)
   filename.mkdir(mode=0o755)
  value=filename.lstat()
  if not stat.S_ISDIR(value.st_mode) or value.st_uid!=owner or value.st_mode&0o022:fail('untrusted_path')
 def write(filename,data,mode=0o600):
  fd=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
  try:
   with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(data);stream.flush();os.fsync(fd)
  finally:os.close(fd)
 try:
  raw_profile=read(real(options['profile_file']),0o600,65536);profile=json.loads(raw_profile)
  if profile.get('machine_registry_id')==US_ID or profile.get('role')!='worker' or profile.get('pool',{}).get('cpu_cores',0)<=0 or profile.get('pool',{}).get('memory_bytes',0)<=0:fail('machine_forbidden')
  token=read(real(options['token_file']),0o600,65).strip()
  if not re.fullmatch(b'[a-f0-9]{64}',token):fail('token_invalid')
  source={name:read(real(options['source_dir'])/name) for name in FILES}
  if readlink('/proc/1/exe') not in ['/usr/lib/systemd/systemd','/lib/systemd/systemd']:fail('host_unavailable')
  try:run('/usr/bin/systemd-detect-virt',['--container']);fail('host_unavailable')
  except CommandFailure as error:
   if error.code!=1 or error.stdout.strip()!='none':fail('host_unavailable')
  info=json.loads(run('/usr/bin/docker',['info','--format','{{json .}}']))
  if info.get('CgroupDriver')!='systemd' or info.get('CgroupVersion')!='2' or not info.get('ID'):fail('daemon_unavailable')
  def idle():
   if run('/usr/bin/systemctl',['show','--property=ActiveState','--value','cecelia-workloads.slice']).strip()!='inactive':fail('pool_busy')
  idle()
  arch={'x86_64':'x64','aarch64':'arm64'}.get(deps.get('machine',platform.machine()))
  if not arch:fail('architecture_unsupported')
 except BootstrapError:raise
 except Exception:fail('preflight_failed')
 lock=None;stage=None;receipt_path=None;account_prepared=False;account_attempted=False
 try:
  lockpath=real('/run/cecelia/linux-pool.bootstrap.lock');mkdir(lockpath.parent)
  lock=os.open(lockpath,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);value=os.fstat(lock)
  if not stat.S_ISREG(value.st_mode) or value.st_uid!=owner or stat.S_IMODE(value.st_mode)!=0o600 or value.st_nlink!=1:fail('locked')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:fail('locked')
  idle()
  base=real('/var/lib/cecelia/fleet-bootstrap');mkdir(base)
  stage=pathlib.Path(tempfile.mkdtemp(prefix='stage-',dir=base));stage.chmod(0o700)
  if options.get('node_archive'):archive=read(real(options['node_archive']),maximum=MAX_ARCHIVE)
  else:archive=deps.get('download',download_archive)(f'https://nodejs.org/dist/v{VERSION}/node-v{VERSION}-linux-{arch}.tar.xz')
  if not isinstance(archive,bytes) or len(archive)>MAX_ARCHIVE or hashlib.sha256(archive).hexdigest()!=deps.get('pins',PINS)[arch]:fail('archive_unverified')
  try:
   with tarfile.open(fileobj=io.BytesIO(archive),mode='r:xz') as bundle:
    member=bundle.getmember(f'node-v{VERSION}-linux-{arch}/bin/node')
    if not member.isfile() or member.size<=0 or member.size>MAX_NODE:fail('archive_unverified')
    binary=bundle.extractfile(member).read(MAX_NODE+1)
    if len(binary)!=member.size:fail('archive_unverified')
  except Exception:fail('archive_unverified')
  node=stage/'node';write(node,binary,0o755)
  if run(str(node),['--version']).strip()!=f'v{VERSION}':fail('toolchain_unavailable')
  sources=stage/'fleet-worker';sources.mkdir(mode=0o700)
  for name,data in source.items():write(sources/name,data,0o644)
  validate="const p=require(process.argv[1]);p.renderLinuxUnits(p.validateLinuxPoolProfile(JSON.parse(require('fs').readFileSync(0,'utf8'))));"
  run(str(node),['--input-type=commonjs','-e',validate,str(sources/'linux-pool-profile.cjs')],input=raw_profile.decode())
  write(stage/'profile.json',raw_profile);write(stage/'worker.token',token)
  def lookup(kind):
   try:return run('/usr/bin/getent',[kind,'_cecelia']).strip().split(':')
   except CommandFailure as error:
    if error.code==2:return None
    fail('account_unavailable')
  receipt_path=base/(str(uuid.uuid4())+'.json')
  def receipt(account_state,installed=False):
   record={'schema_version':'linux-pool-bootstrap/v1','account':'_cecelia','account_prepared':account_prepared,'account_state':account_state,
    'node_version':VERSION,'revision':options['revision'],'installed':installed,'execution':False}
   temporary=receipt_path.with_suffix('.'+str(uuid.uuid4()))
   write(temporary,json.dumps(record).encode());os.replace(temporary,receipt_path)
   directory=os.open(base,os.O_RDONLY)
   try:os.fsync(directory)
   finally:os.close(directory)
  group=lookup('group');account=lookup('passwd')
  if group is None and account is not None:fail('account_unavailable')
  if group is None:
   account_attempted=True;receipt('group_requested')
   run('/usr/sbin/groupadd',['--system','_cecelia']);group=lookup('group')
  if not group or len(group)!=4 or group[0]!='_cecelia' or not group[2].isdigit() or int(group[2])<=0:fail('account_unavailable')
  if account is None:
   account_attempted=True;receipt('user_requested')
   run('/usr/sbin/useradd',['--system','--gid','_cecelia','--home-dir','/var/lib/cecelia/fleet-worker','--no-create-home','--shell','/usr/sbin/nologin','_cecelia']);account=lookup('passwd')
  if not account or len(account)!=7 or account[0]!='_cecelia' or not account[2].isdigit() or int(account[2])<=0 or account[3]!=group[2] or account[6] not in ['/usr/sbin/nologin','/sbin/nologin','/bin/false']:fail('account_unavailable')
  # 专用服务账号不能继承docker/sudo等补充组；不自行剥夺既有权限。
  if set(run('/usr/bin/id',['-G','_cecelia']).split())!={group[2]}:fail('account_unavailable')
  account_prepared=True;receipt('prepared')
  # 非登录账号是幂等前置；失败不删除可能已被系统使用的uid/gid，不声称整体回滚。
  raw=run(str(node),[str(sources/'linux-pool-installer.cjs'),'--source-dir',str(sources),'--profile-file',str(stage/'profile.json'),
   '--token-file',str(stage/'worker.token'),'--node-path',str(node),'--revision',options['revision']])
  result=json.loads(raw)
  if result.get('installed') is not True or result.get('execution') is not False or result.get('revision')!=options['revision'] or not re.fullmatch('[a-f0-9]{64}',result.get('config_digest','')):fail('install_failed')
  receipt('prepared',installed=True)
  return {**result,'account_prepared':True,'node_version':VERSION}
 except Exception as error:
  if (account_prepared or account_attempted) and receipt_path:
   receipt('prepared' if account_prepared else 'unconfirmed')
  if isinstance(error,BootstrapError):raise
  fail('install_failed')
 finally:
  if stage is not None:shutil.rmtree(stage)
  # flock随fd释放；不删除持久锁文件，避免另一个进程锁住旧inode。
  if lock is not None:os.close(lock)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description='Cecelia Linux pool trusted bootstrap')
 for name in ['source-dir','profile-file','token-file','revision']:parser.add_argument('--'+name,required=True)
 parser.add_argument('--node-archive')
 try:
  options=vars(parser.parse_args());options={k:v for k,v in options.items() if v is not None}
  print(json.dumps(bootstrap(options)))
 except Exception as error:
  import sys
  sys.stderr.write((str(error) if isinstance(error,BootstrapError) else 'linux_pool_bootstrap_failed')+'\n');sys.exit(1)
