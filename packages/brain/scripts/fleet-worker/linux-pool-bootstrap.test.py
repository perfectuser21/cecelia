import fcntl, hashlib, importlib.util, io, json, os, pathlib, tarfile, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('linux_bootstrap',HERE/'linux-pool-bootstrap.py')
bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)

class BootstrapTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.calls=[];self.account=False;self.group=False
  self.profile={'schema_version':1,'machine_registry_id':'71d632df-252a-4991-ad6b-3647fbbea9f7','machine_id':'hk-vps','role':'worker','endpoint_host':'100.90.1.4','docker_host':'unix:///var/run/docker.sock','pool':{'cpu_cores':1,'memory_bytes':1073741824,'pids_limit':128},'canary_image':'test/image@sha256:'+'a'*64}
  self.put('/staging/profile.json',json.dumps(self.profile).encode());self.put('/staging/token',b'b'*64)
  for name in ['linux-pool-installer.cjs','linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-pool-canary.cjs','linux-resource-probe.cjs','linux-cgroup.cjs']:self.put('/staging/src/'+name,b'fixture-module',0o644)
  data=io.BytesIO()
  with tarfile.open(fileobj=data,mode='w:xz') as archive:
   entry=tarfile.TarInfo('node-v24.21.0-linux-x64/bin/node');entry.size=12;entry.mode=0o755;archive.addfile(entry,io.BytesIO(b'fixture-node'))
  self.archive=data.getvalue();self.put('/staging/node.tar.xz',self.archive)
  self.options={'source_dir':'/staging/src','profile_file':'/staging/profile.json','token_file':'/staging/token','revision':'c'*40,'node_archive':'/staging/node.tar.xz'}
  self.deps={'root':str(self.root),'root_uid':os.getuid(),'platform':'Linux','machine':'x86_64','getuid':lambda:0,'readlink':lambda p:'/usr/lib/systemd/systemd','run':self.fake_run,
    'pins':{'x64':hashlib.sha256(self.archive).hexdigest()},'download':lambda url:self.archive}
 def tearDown(self):self.temp.cleanup()
 def put(self,name,data,mode=0o600):
  dest=self.root/name.lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);dest.chmod(mode);return dest
 def fake_run(self,command,args,**kwargs):
  self.calls.append((command,args,kwargs))
  if command.endswith('systemd-detect-virt'):raise bootstrap.CommandFailure(1,'none\n')
  if command.endswith('docker'):return json.dumps({'ID':'daemon','CgroupDriver':'systemd','CgroupVersion':'2'})
  if command.endswith('systemctl'):return 'inactive\n'
  if command.endswith('/id'):return '991\n'
  if command.endswith('getent'):
   if args==['passwd','_cecelia'] and self.account:return '_cecelia:x:991:991::/var/lib/cecelia/fleet-worker:/usr/sbin/nologin\n'
   if args==['group','_cecelia'] and self.group:return '_cecelia:x:991:\n'
   raise bootstrap.CommandFailure(2,'')
  if command.endswith('groupadd'):self.group=True;return ''
  if command.endswith('useradd'):self.account=True;return ''
  if command.endswith('/node'):
   if args==['--version']:return 'v24.21.0\n'
   if args[0]=='--input-type=commonjs':return ''
   assert args[0].endswith('linux-pool-installer.cjs')
   values=dict(zip(args[1::2],args[2::2]));token=pathlib.Path(values['--token-file']);self.assertEqual(token.read_bytes(),b'b'*64);self.assertEqual(token.stat().st_mode&0o777,0o600)
   self.assertEqual(pathlib.Path(values['--node-path']).read_bytes(),b'fixture-node')
   return json.dumps({'installed':True,'execution':False,'revision':'c'*40,'config_digest':'d'*64})
  raise AssertionError((command,args))
 def call(self):return bootstrap.bootstrap(self.options,self.deps)
 def test_missing_account_and_old_host_node_need_no_manual_setup(self):
  result=self.call();self.assertTrue(result['installed']);self.assertFalse(result['execution']);self.assertTrue(self.account);self.assertTrue(self.group)
  self.assertFalse(any(command in ['node','/usr/bin/node','npm'] for command,_,_ in self.calls));self.assertFalse(any('docker' in args for command,args,_ in self.calls if command.endswith('useradd')))
  self.assertNotIn('b'*64,json.dumps(self.calls));self.assertNotIn('b'*64,json.dumps(result))
 def test_existing_account_is_not_modified_and_no_docker_group_added(self):
  self.account=True;self.group=True;self.call();self.assertFalse(any(c.endswith(('useradd','groupadd','usermod')) for c,_,_ in self.calls))
 def test_checksum_mismatch_precedes_account_and_install_mutation(self):
  self.put('/staging/node.tar.xz',b'corrupt')
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_archive_unverified'):self.call()
  self.assertFalse(self.account);self.assertFalse(self.group)
 def test_us_scheduler_and_zero_budget_have_zero_commands(self):
  for changes in [{'machine_registry_id':'1a379d80-ad36-47d3-88ba-e545ab299a54'},{'role':'scheduler'},{'pool':{'cpu_cores':0,'memory_bytes':0,'pids_limit':128}}]:
   self.put('/staging/profile.json',json.dumps({**self.profile,**changes}).encode())
   with self.assertRaises(bootstrap.BootstrapError):self.call()
   self.assertEqual(self.calls,[])
 def test_active_pool_and_container_host_refuse_before_account_creation(self):
  original=self.fake_run
  for kind in ['pool','container']:
   def run(command,args,**kwargs):
    if kind=='pool' and command.endswith('systemctl'):return 'active\n'
    if kind=='container' and command.endswith('systemd-detect-virt'):return 'docker\n'
    return original(command,args,**kwargs)
   self.deps['run']=run
   with self.assertRaises(bootstrap.BootstrapError):self.call()
   self.assertFalse(self.account)
 def test_protected_file_symlinks_and_permissions_rejected(self):
  token=self.root/'staging/token';token.chmod(0o644)
  with self.assertRaises(bootstrap.BootstrapError):self.call()
  token.unlink();token.symlink_to(self.root/'staging/profile.json')
  with self.assertRaises(bootstrap.BootstrapError):self.call()
  self.assertEqual(self.calls,[])
 def test_install_failure_keeps_only_safe_account_and_private_failure_receipt(self):
  original=self.fake_run
  def run(command,args,**kwargs):
   if command.endswith('/node') and args[0].endswith('linux-pool-installer.cjs'):raise bootstrap.CommandFailure(1,'secret-output','secret-stderr')
   return original(command,args,**kwargs)
  self.deps['run']=run
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_install_failed'):self.call()
  self.assertTrue(self.account);self.assertFalse(any(c.endswith(('userdel','groupdel')) for c,_,_ in self.calls))
  receipts=list((self.root/'var/lib/cecelia/fleet-bootstrap').glob('*.json'));self.assertEqual(len(receipts),1)
  text=receipts[0].read_text();self.assertNotIn('secret',text);self.assertNotIn('b'*64,text);self.assertIn('account_prepared',text);self.assertEqual(receipts[0].stat().st_mode&0o777,0o600)
 def test_automatic_download_uses_only_fixed_official_url(self):
  self.options.pop('node_archive');seen=[];self.deps['download']=lambda url:(seen.append(url) or self.archive);self.call()
  self.assertEqual(seen,['https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz'])

 def test_another_bootstrap_lock_is_preserved(self):
  lock=self.put('/run/cecelia/linux-pool.bootstrap.lock',b'other-owner')
  with lock.open('r+b') as stream:
   fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_locked'):self.call()
  self.assertEqual(lock.read_bytes(),b'other-owner');self.assertFalse(self.account)
 def test_archive_node_must_be_regular_not_symlink(self):
  data=io.BytesIO()
  with tarfile.open(fileobj=data,mode='w:xz') as archive:
   entry=tarfile.TarInfo('node-v24.21.0-linux-x64/bin/node');entry.type=tarfile.SYMTYPE;entry.linkname='/bin/sh';archive.addfile(entry)
  payload=data.getvalue();self.put('/staging/node.tar.xz',payload);self.deps['pins']={'x64':hashlib.sha256(payload).hexdigest()}
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_archive_unverified'):self.call()
  self.assertFalse(self.account)
 def test_old_or_wrong_node_artifact_cannot_mutate_account(self):
  original=self.fake_run
  self.deps['run']=lambda c,a,**k:'v20.19.0\n' if a==['--version'] else original(c,a,**k)
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_toolchain_unavailable'):self.call()
  self.assertFalse(self.account)
 def test_mismatched_existing_account_is_not_modified(self):
  self.account=True;self.group=True;original=self.fake_run
  self.deps['run']=lambda c,a,**k:'_cecelia:x:0:991::/root:/bin/bash\n' if a==['passwd','_cecelia'] else original(c,a,**k)
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_account_unavailable'):self.call()
  self.assertFalse(any(c.endswith(('useradd','usermod','userdel')) for c,_,_ in self.calls))
 def test_existing_account_with_privileged_supplementary_group_is_rejected(self):
  self.account=True;self.group=True;original=self.fake_run
  self.deps['run']=lambda c,a,**k:'991 998\n' if c.endswith('/id') else original(c,a,**k)
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_account_unavailable'):self.call()
  self.assertFalse(any(c.endswith(('usermod','userdel')) or (c.endswith('/node') and a[0].endswith('linux-pool-installer.cjs')) for c,a,_ in self.calls))
 def test_command_output_is_bounded_without_echoing_child_data(self):
  with self.assertRaises(bootstrap.CommandFailure) as caught:bootstrap.run_command('/bin/sh',['-c','head -c 70000 /dev/zero'])
  self.assertEqual(caught.exception.stdout,'');self.assertEqual(caught.exception.stderr,'')
 def test_pool_becomes_active_after_lock_and_stops_bootstrap(self):
  original=self.fake_run;reads=[0]
  def run(command,args,**kwargs):
   if command.endswith('systemctl'):
    reads[0]+=1
    return 'active\n' if reads[0]>1 else 'inactive\n'
   return original(command,args,**kwargs)
  self.deps['run']=run
  with self.assertRaisesRegex(bootstrap.BootstrapError,'linux_pool_bootstrap_pool_busy'):self.call()
  self.assertFalse(self.account)

 def test_unknown_account_creation_preserves_recovery_receipt(self):
  original=self.fake_run
  def run(command,args,**kwargs):
   if command.endswith('groupadd'):
    self.group=True
    raise bootstrap.CommandFailure(1,'unknown result')
   return original(command,args,**kwargs)
  self.deps['run']=run
  with self.assertRaises(bootstrap.BootstrapError):self.call()
  receipts=list((self.root/'var/lib/cecelia/fleet-bootstrap').glob('*.json'));self.assertEqual(len(receipts),1)
  record=json.loads(receipts[0].read_text());self.assertEqual(record['account_state'],'unconfirmed');self.assertFalse(record['installed'])

if __name__=='__main__':unittest.main()
