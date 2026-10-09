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
  self.write('/proc/meminfo', 'MemTotal: 8388608 kB\n')
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
  self.assertEqual(self.calls[-1][1],['/usr/local/libexec/cecelia/fleet-worker/linux-script-canary.cjs','--nonce','a'*64,'--cleanup-receipt'])
 def test_renewal_reads_current_boot_without_install_or_secret_transport(self):
  self.call();self.worker=str(uuid.uuid4());self.write('/run/cecelia-script/worker-boot-id',self.worker)
  request={k:self.request[k] for k in ['machine_registry_id','nonce','intent_id','pool','revision']};request['action']='installation'
  self.assertEqual(self.call(request)['receipt']['worker_boot_id'],self.worker);self.assertEqual(self.installs,1)
 def upgrade_request(self):
  self.call()
  old=self.root/'var/lib/cecelia/onboarding'/self.request['intent_id']/'intent.json'
  state=json.loads(old.read_text());state['phase']='started';old.write_text(json.dumps(state));self.old_marker=old;self.old_bytes=old.read_bytes()
  request={**self.request,'intent_id':str(uuid.uuid4())}
  request['upgrade']={'schema_version':1,'machine_registry_id':self.machine,'config_digest':'e'*64,'revision':'a'*40,
   'host_boot_id':self.boot,'daemon_id':'daemon','worker_boot_id':self.worker,
   'source_sha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in request['sources'].items() if k!='linux-pool-installer.cjs'},'intent_id':request['intent_id']}
  request['previous_attempt']={'intent_id':self.request['intent_id'],'binding':state['binding']}
  original=self.deps['bootstrap'];self.verifications=[]
  def install(options):
   upgrade=json.loads(pathlib.Path(options['upgrade_file']).read_text())
   self.assertEqual(upgrade['intent_id'],request['intent_id'])
   if options.get('verify_only'):
    self.verifications.append(upgrade)
    if (self.root/'usr/local/libexec/cecelia/fleet-worker/revision').read_text()!=options['revision']:raise ValueError('partial_target')
    return {'verified':True,'execution':False,'revision':options['revision'],'config_digest':'e'*64}
   return original(options)
  self.deps['bootstrap']=install
  return request
 def test_upgrade_links_started_attempt_without_changing_its_bytes(self):
  request=self.upgrade_request();self.call(request)
  self.assertEqual(self.installs,2);self.assertEqual(self.old_marker.read_bytes(),self.old_bytes)
  marker=self.root/'var/lib/cecelia/onboarding'/request['intent_id']/'intent.json'
  self.assertEqual(json.loads(marker.read_text())['previous_attempt'],request['previous_attempt'])
 def test_upgrade_links_installed_attempt_and_preserves_prior_upgrade_chain(self):
  request=self.upgrade_request();self.call(request)
  previous=self.root/'var/lib/cecelia/onboarding'/request['intent_id']/'intent.json'
  old_bytes=previous.read_bytes();old=json.loads(old_bytes)
  self.assertEqual(old['phase'],'installed')
  next_request={**request,'intent_id':str(uuid.uuid4()),'upgrade':dict(request['upgrade']),
   'previous_attempt':{'intent_id':request['intent_id'],'binding':old['binding']}}
  next_request['upgrade']['intent_id']=next_request['intent_id']
  def install(options):
   self.assertEqual(json.loads(pathlib.Path(options['upgrade_file']).read_text())['intent_id'],next_request['intent_id'])
   self.installs+=1
   return {'installed':True}
  self.deps['bootstrap']=install
  self.call(next_request)
  self.assertEqual(self.installs,3);self.assertEqual(previous.read_bytes(),old_bytes)
  self.assertEqual(self.old_marker.read_bytes(),self.old_bytes)
 def test_unknown_prior_phase_never_installs(self):
  request=self.upgrade_request();old=json.loads(self.old_bytes);old['phase']='unknown';self.old_marker.write_text(json.dumps(old))
  with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.installs,1)
 def test_upgrade_previous_binding_must_match_before_install(self):
  request=self.upgrade_request();request['previous_attempt']['binding']='f'*64
  with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.installs,1);self.assertEqual(self.old_marker.read_bytes(),self.old_bytes)
 def test_upgrade_target_lost_response_revalidates_all_files_without_install(self):
  request=self.upgrade_request();self.call(request)
  marker=self.root/'var/lib/cecelia/onboarding'/request['intent_id']/'intent.json'
  state=json.loads(marker.read_text());state['phase']='started';marker.write_text(json.dumps(state))
  response=self.call(request)
  self.assertTrue(response['receipt']['installed']);self.assertEqual(self.installs,2);self.assertEqual(len(self.verifications),1)
  self.assertEqual(self.verifications[0]['source_sha256'],request['upgrade']['source_sha256'])
  self.assertEqual(self.verifications[0]['revision'],request['revision'])
  for name in ['worker.token','execution.key']:self.assertFalse((marker.parent/name).exists())
 def test_partial_upgrade_refuses_without_reinstall(self):
  request=self.upgrade_request();self.call(request)
  self.write('/usr/local/libexec/cecelia/fleet-worker/revision','d'*40)
  with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.installs,2);self.assertEqual(len(self.verifications),1)
 def test_upgrade_authority_change_cannot_reuse_intent(self):
  request=self.upgrade_request();self.call(request);request['upgrade']['worker_boot_id']=str(uuid.uuid4())
  with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.installs,2);self.assertEqual(self.verifications,[])
 def test_failed_upgrade_preserves_both_intents_and_never_reinstalls(self):
  request=self.upgrade_request()
  def lost(options):
   if options.get('verify_only'):raise ValueError('target_unconfirmed')
   self.installs+=1;raise ValueError('installation_lost')
  self.deps['bootstrap']=lost
  for _ in range(2):
   with self.assertRaises(ValueError):self.call(request)
  self.assertEqual(self.installs,2);self.assertEqual(self.old_marker.read_bytes(),self.old_bytes)
  marker=self.root/'var/lib/cecelia/onboarding'/request['intent_id']/'intent.json'
  self.assertEqual(json.loads(marker.read_text())['phase'],'started')
 def test_untrusted_stage_path_refuses(self):
  target=self.root/'var/lib/cecelia/onboarding';target.parent.mkdir(parents=True);target.symlink_to(self.root)
  with self.assertRaises(ValueError):self.call()
  self.assertEqual(self.installs,0)

if __name__=='__main__':unittest.main()
