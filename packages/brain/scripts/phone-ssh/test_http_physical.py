"""HTTP物理协议的永久真实安装字节、子进程、socket和持久回执回归。"""
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid
from adb_socket_fixture import SocketFixture
from runner import Config, Runner, BINDINGS
from process_identity import boot_id
import probe

class HttpPhysicalTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.daemon=SocketFixture(self.root,self.root/'launches')
        self.installation={'manifest_path':self.root/'manifest.json','config_path':self.root/'worker.json','source_root':Path(__file__).parent}
        worker={'machine_id':'fixture-machine','worker_id':'fixture-worker','host':'fixture-host'}
        hashes={name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in probe.SOURCE_FILES}
        for key,value in [('config_path',worker),('manifest_path',{'schema':1,**worker,'source_hashes':hashes})]:
            self.installation[key].write_text(json.dumps(value));self.installation[key].chmod(0o600)
        self.config=Config(**worker,journal_root=str(self.root/'journal'),lock_root=str(self.root/'locks'),drain_path=str(self.root/'drain'),adb_server_port=self.daemon.port,hard_cap_sec=0.7,assert_resources=lambda:None)
        self.runner=Runner(self.config)
        self.identity={k:str(uuid.uuid4()) for k in BINDINGS};self.identity.update(dispatch_id=str(uuid.uuid4()),**worker,serial='fixture-serial',profile='fixture-profile',account_id='fixture-account',action='adb_get_state',worker_boot_id=boot_id(),config_digest='f'*64)
    def tearDown(self):self.daemon.close();self.tmp.cleanup()
    def request(self,operation='inspect'):
        self.assertTrue(hasattr(probe,"installed_identity"),"缺少安装真身身份验证")
        physical=probe.installed_identity(**self.installation)
        return {'schema':'phone-physical-execution/v1','request_nonce':str(uuid.uuid4()),'operation':operation,'identity':self.identity,'physical':{k:physical[k] for k in ('machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest')}}
    def handle(self,request):return self.runner.handle_http(request,installation=self.installation)
    def test_real_socket_and_identity_reply_then_duplicate_start_does_not_repeat(self):
        self.config.assert_http_activation=lambda identity:None
        request=self.request('start');first=self.handle(request)
        self.assertIn(first['identity']['status'],('unknown','running'))
        deadline=time.monotonic()+4
        while time.monotonic()<deadline:
            reply=self.handle(self.request())
            if reply['identity']['status'] in ('completed','failed'):break
            time.sleep(0.03)
        self.assertEqual(reply['identity']['status'],'completed');self.assertEqual(reply['identity']['lock_owner'],self.identity['lease_token'])
        self.assertEqual(reply['physical'],request['physical']);self.assertEqual(reply['schema'],'phone-physical-execution/v1')
        self.assertEqual(self.handle(request)['identity'],reply['identity']);self.assertEqual(len((self.root/'launches').read_text().splitlines()),1)
    def test_production_default_activation_denies_before_intent_and_no_socket(self):
        with self.assertRaisesRegex(ValueError,'phone_activation_unconfigured'):self.handle(self.request('start'))
        self.assertEqual(list(self.runner.journal.keys()),[]);self.assertFalse((self.root/'launches').exists())
    def test_public_fields_wrong_physical_or_lease_identity_never_reflected(self):
        for key in ('route','argv','env','installation','activation'):
            request=self.request();request[key]='caller'
            with self.assertRaises(ValueError):self.handle(request)
        for key in self.request()['physical']:
            request=self.request();request['physical'][key]='caller'
            with self.assertRaises(ValueError):self.handle(request)
        request=self.request();request['identity']={**self.identity,'host':'caller'}
        with self.assertRaises(ValueError):self.handle(request)
    def test_existing_cancelled_lease_rejects_every_changed_identity_field(self):
        self.handle(self.request('cancel'))
        for key in ['dispatch_id',*BINDINGS]:
            request=self.request();request['identity']={**self.identity,key:str(uuid.uuid4())}
            if key=='config_digest':request['identity'][key]='0'*64
            if key=='dispatch_id':
                # 新dispatch只inspect为unknown，不会把旧取消回执借给新lease。
                self.assertEqual(self.handle(request)['identity']['status'],'unknown')
            else:
                with self.assertRaises(ValueError):self.handle(request)
    def test_installed_version_changed_during_operation_cannot_sign_reply(self):
        original=self.runner.inspect
        def changed(identity):
            value=original(identity)
            self.installation['manifest_path'].write_text('{}')
            return value
        self.runner.inspect=changed
        with self.assertRaises(ValueError):self.handle(self.request())
    def test_cancel_tombstone_is_real_and_manifest_change_cannot_sign(self):
        request=self.request('cancel');reply=self.handle(request)
        self.assertEqual(reply['identity']['status'],'failed');self.assertTrue(reply['identity']['execution_exited'])
        self.installation['manifest_path'].write_text('{}')
        with self.assertRaises(ValueError):self.handle(request)

if __name__=='__main__':unittest.main()
