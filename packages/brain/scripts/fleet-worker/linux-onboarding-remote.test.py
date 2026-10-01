import unittest
import pathlib
import tempfile
import os
import json
import uuid
import hashlib
import hmac

HERE = pathlib.Path(__file__).parent
namespace = {'__name__':'cecelia_onboarding'}
exec(compile((HERE/'linux-pool-bootstrap.py').read_text(), 'bootstrap.py', 'exec'), namespace)
exec(compile((HERE/'linux-onboarding-remote.py').read_text(), 'remote.py', 'exec'), namespace)

class RemoteTests(unittest.TestCase):
 def setUp(self):
  self.tmp = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.tmp.name)
  self.machine = str(uuid.uuid4()); self.boot = str(uuid.uuid4()); self.worker = str(uuid.uuid4()); self.calls = []; self.installs = 0
  self.pool = {'machine_registry_id':self.machine, 'canary_image':'alpine@sha256:'+'a'*64, 'pool':{'cpu_cores':1}}
  self.request = {'action':'bootstrap', 'machine_registry_id':self.machine, 'nonce':'a'*64, 'intent_id':str(uuid.uuid4()),
   'revision':'a'*40, 'pool':self.pool, 'sources':{name:'source' for name in namespace['FILES']+namespace['SCRIPT_FILES']}, 'worker_token':'b'*64,'execution_key':'c'*64}
  self.write('/proc/sys/kernel/random/boot_id', self.boot)
  def install(options):
   self.installs += 1
   self.write('/etc/cecelia/script-pool.json',json.dumps(self.pool)); self.write('/etc/cecelia/script-execution.key','c'*64)
   self.write('/usr/local/libexec/cecelia/fleet-worker/revision','a'*40); self.write('/run/cecelia-script/worker-boot-id',self.worker)
   return {'installed':True}
  def run(command,args):
   self.calls.append((command,args))
   if args[0]=='info':return json.dumps({'ID':'daemon','CgroupDriver':'systemd','CgroupVersion':'2'})
   if args[:2]==['image','inspect']:return json.dumps('sha256:'+'a'*64)
   if args[0]=='is-active':
    self.assertIn(args[1],['cecelia-linux-script.service','cecelia-linux-pool.service']);return 'active'
   if args[0].endswith('canary.cjs'):return '{"signature":"existing-canary"}'
   raise ValueError('unexpected')
  self.deps = {'root':str(self.root),'owner':os.getuid(),'platform':'Linux','uid':0,'skip_host_check':True,'run':run,'bootstrap':install}
 def tearDown(self): self.tmp.cleanup()
 def write(self,p,value):
  target=self.root/p.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);target.write_text(value);target.chmod(0o600)
 def call(self,p=None):return namespace['dispatch'](p or self.request,self.deps)
 def test_install_signed_facts_and_lost_response_recovery(self):
  first=self.call();self.assertEqual(self.installs,1);self.assertFalse(first['receipt']['execution'])
  self.assertEqual(first['receipt']['worker_boot_id'],self.worker)
  raw=json.dumps(first['receipt'],separators=(',',':'),ensure_ascii=False).encode()
  self.assertEqual(first['signature'],hmac.new(('c'*64).encode(),raw,hashlib.sha256).hexdigest())
  self.call();self.assertEqual(self.installs,1)
  directory=self.root/'var/lib/cecelia/onboarding'/self.request['intent_id']
  self.assertFalse((directory/'worker.token').exists());self.assertFalse((directory/'execution.key').exists())
  changed={**self.request,'revision':'d'*40}
  with self.assertRaises(ValueError):self.call(changed)
 def test_unknown_install_never_repeats_side_effect(self):
  def lost(options):self.installs+=1;raise ValueError('lost')
  self.deps['bootstrap']=lost
  for _ in range(2):
   with self.assertRaises((ValueError,FileNotFoundError)):self.call()
  self.assertEqual(self.installs,1)
 def test_no_docker_or_unknown_field_before_install(self):
  self.deps['run']=lambda *_: (_ for _ in ()).throw(ValueError('docker absent'))
  with self.assertRaises(ValueError):self.call()
  self.assertEqual(self.installs,0)
  with self.assertRaises(ValueError):self.call({**self.request,'command':'anything'})
 def test_runtime_same_boot_only_and_fixed_canary(self):
  self.call();runtime={'pool':self.pool,'worker_boot_id':self.worker,'host_boot_id':self.boot,'revision':'a'*40}
  request={'action':'runtime','machine_registry_id':self.machine,'nonce':'a'*64,'configuration':runtime}
  self.assertTrue(self.call(request)['written'])
  runtime['worker_boot_id']=str(uuid.uuid4())
  with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.call({'action':'script_canary','machine_registry_id':self.machine,'nonce':'a'*64}),{'signature':'existing-canary'})
  self.assertEqual(self.calls[-1][1],['/usr/local/libexec/cecelia/fleet-worker/linux-script-canary.cjs','--nonce','a'*64])
 def test_untrusted_stage_path_refuses(self):
  target=self.root/'var/lib/cecelia/onboarding';target.parent.mkdir(parents=True);target.symlink_to(self.root)
  with self.assertRaises(ValueError):self.call()
  self.assertEqual(self.installs,0)

if __name__=='__main__':unittest.main()
