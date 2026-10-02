"""固定SSH控制面入口；由Brain拼接同版bootstrap，复用其有界进程执行与安装事务。"""
import fcntl
import hashlib
import hmac
import stat
from datetime import datetime, timezone

_UUID = r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}'
_HEX = r'[a-f0-9]{64}'
_BASE = '/var/lib/cecelia/onboarding'
_NODE = '/usr/local/libexec/cecelia/toolchain/bin/node'
_WORKER = '/usr/local/libexec/cecelia/fleet-worker/'

def _deny(): raise ValueError('linux_pool_onboarding_unconfirmed')
def _json(value): return json.dumps(value, separators=(',', ':'), ensure_ascii=False)
def _now(): return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def dispatch(p, deps=None):
 deps = deps or {}
 root = pathlib.Path(deps.get('root', '/')); owner = deps.get('owner', 0)
 run = deps.get('run', run_command); install = deps.get('bootstrap', bootstrap)
 if deps.get('platform', platform.system()) != 'Linux' or deps.get('uid', os.geteuid()) != 0: _deny()
 if not isinstance(p, dict) or not re.fullmatch(_UUID, p.get('machine_registry_id', '')) or not re.fullmatch(_HEX, p.get('nonce', '')): _deny()
 action = p.get('action')
 common = {'action', 'machine_registry_id', 'nonce'}
 keys = {'probe': {'image'}, 'bootstrap': {'intent_id', 'pool', 'revision', 'sources', 'worker_token', 'execution_key'},
         'installation': {'intent_id', 'pool', 'revision'}, 'runtime': {'configuration'}, 'pool_canary': set(), 'script_canary': set()}
 upgrade = p.get('upgrade'); previous = p.get('previous_attempt')
 extra = {'upgrade','previous_attempt'} if action == 'bootstrap' and upgrade is not None else set()
 if action not in keys or set(p) != common | keys[action] | extra: _deny()
 if extra and (not isinstance(upgrade,dict) or not isinstance(previous,dict) or set(previous)!={'intent_id','binding'}
  or not re.fullmatch(_UUID,previous.get('intent_id','')) or not re.fullmatch(_HEX,previous.get('binding',''))
  or previous['intent_id']==p['intent_id'] or upgrade.get('intent_id')!=p['intent_id']): _deny()
 def real(name): return root / name.lstrip('/')
 def parents(directory, create=False):
  chain = []; current = directory
  while current != root:
   if root not in current.parents: _deny()
   chain.insert(0, current); current = current.parent
  for part in [root, *chain]:
   if create and not part.exists(): part.mkdir(mode=0o700)
   s = part.lstat()
   if not stat.S_ISDIR(s.st_mode) or s.st_uid != owner or s.st_mode & 0o022: _deny()
 def read(name, limit=65536, mode=None):
  target = real(name); parents(target.parent)
  fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
  try:
   s = os.fstat(fd)
   if not stat.S_ISREG(s.st_mode) or s.st_uid != owner or s.st_size > limit or s.st_mode & 0o022 or (mode is not None and stat.S_IMODE(s.st_mode) != mode): _deny()
   value = os.read(fd, limit + 1)
   if len(value) > limit: _deny()
   return value.decode()
  finally: os.close(fd)
 def write(target, value):
  parents(target.parent)
  if target.is_symlink(): _deny()
  temp = target.with_name(target.name + '.' + str(uuid.uuid4()))
  fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
  try:
   with os.fdopen(fd, 'w') as stream: stream.write(value); stream.flush(); os.fsync(stream.fileno())
   os.replace(temp, target)
   directory = os.open(target.parent, os.O_RDONLY)
   try: os.fsync(directory)
   finally: os.close(directory)
  finally:
   if temp.exists(): temp.unlink()
 def probe(image):
  if not re.fullmatch(r'[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}', image or ''): _deny()
  if not deps.get('skip_host_check'):
   if os.readlink('/proc/1/exe') not in ['/usr/lib/systemd/systemd', '/lib/systemd/systemd']: _deny()
   for ns in ['pid', 'mnt', 'cgroup']:
    if os.readlink('/proc/1/ns/' + ns) != os.readlink('/proc/self/ns/' + ns): _deny()
  info = json.loads(run('/usr/bin/docker', ['info', '--format', '{{json .}}']))
  if info.get('CgroupDriver') != 'systemd' or info.get('CgroupVersion') != '2' or not info.get('ID'): _deny()
  image_id = json.loads(run('/usr/bin/docker', ['image', 'inspect', image, '--format', '{{json .Id}}']))
  if not re.fullmatch(r'sha256:' + _HEX, image_id): _deny()
  memory = re.search(r'^MemTotal:\s+(\d+) kB$', read('/proc/meminfo'), re.M)
  cpus = deps.get('cpu_cores', os.cpu_count())
  if not memory or not isinstance(cpus, int) or cpus < 1: _deny()
  return {'schema_version':'linux-onboarding-host/v1', 'nonce':p['nonce'], 'machine_registry_id':p['machine_registry_id'],
          'host_boot_id':read('/proc/sys/kernel/random/boot_id').strip(), 'daemon_id':info['ID'], 'image_id':image_id, 'image':image, 'observed_at':_now(),
          'os':'linux', 'resources':{'cpu_cores':cpus, 'memory_total_bytes':int(memory.group(1))*1024}}
 if action == 'probe': return probe(p['image'])
 base = real(_BASE); parents(base, True)
 lock = os.open(base / 'control.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600); credential_stage = None
 try:
  s = os.fstat(lock)
  if not stat.S_ISREG(s.st_mode) or s.st_uid != owner or s.st_nlink != 1 or stat.S_IMODE(s.st_mode) != 0o600: _deny()
  fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
  if action in ['bootstrap', 'installation']:
   if not re.fullmatch(_UUID, p['intent_id']) or not re.fullmatch('[a-f0-9]{40}', p['revision']): _deny()
   if p['pool'].get('machine_registry_id') != p['machine_registry_id']: _deny()
   if action == 'bootstrap':
    if not re.fullmatch(_HEX, p['worker_token']) or not re.fullmatch(_HEX, p['execution_key']) or p['worker_token'] == p['execution_key']: _deny()
    if set(p['sources']) != set(FILES + SCRIPT_FILES) or any(not isinstance(v, str) or len(v.encode()) > 262144 for v in p['sources'].values()): _deny()
    # 先核实完整宿主与固定镜像；不安装Docker、不改daemon或网络。
    fact = probe(p['pool'].get('canary_image'))
    if upgrade is not None:
     old = json.loads(read(_BASE+'/'+previous['intent_id']+'/intent.json', mode=0o600))
     if old.get('binding')!=previous['binding'] or old.get('phase')!='started': _deny()
    directory = base / p['intent_id']; parents(directory, True); credential_stage = directory
    marker = directory / 'intent.json'
    bound = {k:p[k] for k in ['machine_registry_id','pool','revision','sources']}
    if upgrade is not None: bound.update({'upgrade':upgrade,'previous_attempt':previous})
    binding = hashlib.sha256(_json(bound).encode()).hexdigest()
    existed = marker.exists()
    if existed:
     state = json.loads(read(str(marker.relative_to(root))))
     if state.get('binding') != binding or state.get('phase') not in ['started','installed']: _deny()
    # 新旧intent都保留；仅首次新intent允许安装，已有未知结果只能完整只读核目标。
    if not existed or upgrade is not None:
     for name, source in p['sources'].items(): write(directory / name, source)
     write(directory / 'pool.json', _json(p['pool'])); write(directory / 'worker.token', p['worker_token']); write(directory / 'execution.key', p['execution_key'])
     options = {'source_dir':str(directory), 'profile_file':str(directory / 'pool.json'), 'token_file':str(directory / 'worker.token'),
                'execution_key_file':str(directory / 'execution.key'), 'revision':p['revision']}
     if upgrade is not None:
      expected = dict(upgrade)
      if existed:
       expected.update({'revision':p['revision'], 'worker_boot_id':read('/run/cecelia-script/worker-boot-id').strip(),
        'source_sha256':{name:hashlib.sha256(value.encode()).hexdigest() for name,value in p['sources'].items() if name!='linux-pool-installer.cjs'}})
       options['verify_only'] = True
      write(directory / 'upgrade.json', _json(expected)); options['upgrade_file']=str(directory / 'upgrade.json')
     state = {'binding':binding,'phase':'started'}
     if upgrade is not None: state['previous_attempt']=previous
     if not existed: write(marker, _json(state))
     result = install(options)
     if existed:
      if result.get('verified') is not True or result.get('execution') is not False or result.get('revision')!=p['revision'] or result.get('config_digest')!=upgrade['config_digest']: _deny()
     elif result.get('installed') is not True: _deny()
   if json.loads(read('/etc/cecelia/script-pool.json')) != p['pool'] or read(_WORKER + 'revision').strip() != p['revision']: _deny()
   key = read('/etc/cecelia/script-execution.key', 64, 0o600).strip()
   if action == 'bootstrap' and key != p['execution_key']: _deny()
   for service in ['cecelia-linux-script.service', 'cecelia-linux-pool.service']:
    if run('/usr/bin/systemctl', ['is-active', service]).strip() != 'active': _deny()
   fact = probe(p['pool']['canary_image'])
   fact.update({'schema_version':'linux-onboarding-install/v1', 'intent_id':p['intent_id'], 'revision':p['revision'],
                'worker_boot_id':read('/run/cecelia-script/worker-boot-id').strip(), 'pool':p['pool'], 'installed':True, 'execution':False})
   if action == 'bootstrap':
    completed={'binding':binding, 'phase':'installed'}
    if upgrade is not None: completed['previous_attempt']=previous
    write(marker, _json(completed))
   return {'receipt':fact, 'signature':hmac.new(key.encode(), _json(fact).encode(), hashlib.sha256).hexdigest()}
  if action == 'runtime':
   c = p['configuration']; pool = json.loads(read('/etc/cecelia/script-pool.json'))
   if c.get('pool') != pool or pool.get('machine_registry_id') != p['machine_registry_id'] or c.get('worker_boot_id') != read('/run/cecelia-script/worker-boot-id').strip(): _deny()
   if c.get('host_boot_id') != read('/proc/sys/kernel/random/boot_id').strip() or c.get('revision') != read(_WORKER + 'revision').strip(): _deny()
   write(real('/etc/cecelia/script-runtime.json'), _json(c))
   return {'written':True, 'execution':False, 'nonce':p['nonce']}
  # 只准调用已安装的两个固定canary；回执由原CLI按本机凭据签名。
  if json.loads(read('/etc/cecelia/script-pool.json')).get('machine_registry_id') != p['machine_registry_id']: _deny()
  filename = 'linux-pool-canary.cjs' if action == 'pool_canary' else 'linux-script-canary.cjs'
  return json.loads(run(_NODE, [_WORKER + filename, '--nonce', p['nonce'], '--cleanup-receipt']))
 finally:
  try:
   # 1Password仍是真身；正式安装文件自有600，失败路径也清理传输落点。
   if credential_stage:
    for name in ['worker.token', 'execution.key']:
     target = credential_stage / name
     if target.exists(): target.unlink()
  finally: os.close(lock)
