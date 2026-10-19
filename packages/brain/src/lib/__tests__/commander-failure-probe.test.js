import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { FAILURE_PROBE_SOURCE } from '../commander-failure-probe-source.js';
const encodedProbe=Buffer.from(FAILURE_PROBE_SOURCE).toString('base64');

const run=body=>JSON.parse(execFileSync('python3',['-I','-c',`
import types,base64,json,tempfile,os,fcntl,pathlib,math
p=types.ModuleType('probe');exec(compile(base64.b64decode(${JSON.stringify(encodedProbe)}),'brain-failure-probe','exec'),p.__dict__)
${body}
`],{encoding:'utf8',timeout:10000,maxBuffer:100000}));
it('既存锁排他/忙拒绝且不创建缺失锁；真实原037 numeric closed形状',()=>{
 const r=run(`
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d).resolve(); path=root/'lock';path.write_bytes(b'');p.lock(path)
 blocked=False
 fd=os.open(path,os.O_RDONLY)
 try:
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:blocked=True
 finally:os.close(fd)
 missing=False
 try:p.lock(root/'missing')
 except FileNotFoundError:missing=True
 print(json.dumps({'blocked':blocked,'missing':missing,'notCreated':not (root/'missing').exists()}))
`);expect(r).toEqual({blocked:true,missing:true,notCreated:true});
});
it('正规原件能读，symlink/FIFO/越预算原件拒绝，不改原件',()=>{
 expect(run(`
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d).resolve();(root/'real').write_bytes(b'raw');(root/'link').symlink_to(root/'real');os.mkfifo(root/'fifo')
 rejected=[]
 for name,limit in [('link',100),('fifo',100),('real',2)]:
  try:p.regular(root/name,limit)
  except (ValueError,OSError):rejected.append(name)
 print(json.dumps({'raw':p.regular(root/'real').decode(),'rejected':rejected}))
`)).toEqual({raw:'raw',rejected:['link','fifo','real']});
});
it('原037 epoch closed及完整原件可读回；源码不执行status/手机/原件写入',()=>{
 const value=run(`
from unittest.mock import patch
with tempfile.TemporaryDirectory() as d:
 home=pathlib.Path(d).resolve(); rid='wfd-aaaaaaaa-1111-2222-3333-444444444444';root=home/'wf-agent-runs'/rid;root.mkdir(parents=True)
 (root/'evidence').mkdir();(home/'.openclaw/commander').mkdir(parents=True)
 e={'run_id':rid,'task_id':'task','input':{'title':'原输入'},'contract':{'resources':{}}};b={'run_id':rid,'task_id':'task','nonce':'actualnonce','child_run_id':'child','child_session_key':'agent:skill-factory:subagent:session','parent_session_key':'parent'}
 values={'envelope.json':e,'input.json':e['input'],'contract.json':e['contract'],'agent-binding.json':b,'agent-request.json':dict(b),'handoff-closed.json':{'at':1792398259.758255},'spawn-claimed.json':{'nonce':'actualnonce'},'cleanup-root-start.json':{},'cleanup-root-end.json':{},'root-identity.json':{},'preflight.json':{},'shell-preflight.json':{},'shell-cleanup.json':{}}
 runtime=home/'.openclaw/commander';raw=b'fixture runtime rehashed, never executed'
 (runtime/'wf-v2.py').write_bytes(raw)
 files={'wf-v2.py':p.hashlib.sha256(raw).hexdigest()};(runtime/'runtime-manifest.json').write_text(json.dumps({'files':files}))
 for name,value in values.items():(root/name).write_text(json.dumps(value))
 (root/'.worker.lock').touch();(root/'raw').write_bytes(b'cleanup evidence')
 (root/'cleanup.json').write_text(json.dumps({'_shell':{'files':[{'path':str(root/'raw'),'sha256':'unused-but-rehashed'}]}}))
 def rpc(method,args):return {'sessions':[{'key':b['child_session_key'],'hasActiveRun':False,'activeRunIds':[],'hasActiveSubagentRun':False}]} if method=='sessions.list' else {'durable':'fixture-only'}
 with patch.object(p.Path,'home',return_value=home),patch.object(p,'rpc',rpc):
  o=p.worker({'envelope':e,'cleanup_deadline_ms':0})
  # Recheck uses the same held inode, rather than creating or reacquiring the lock.
  again=p.worker({'envelope':e,'cleanup_deadline_ms':0},True)
  ok=o['nonce_closed'] and o['worker_exclusive'] and o['files']==again['files']
  rejected=[]
  for name in ['agent-completion.json','execution-failure.json','agent-terminal.json','child-stop-readback.json','delivery.json','agent-delivery.json']:
   (root/name).write_text('{}')
   try:p.worker({'envelope':e,'cleanup_deadline_ms':0},True)
   except ValueError:rejected.append(name)
   (root/name).unlink()
  (runtime/'wf-v2.py').write_bytes(b'changed runtime')
  try:p.worker({'envelope':e,'cleanup_deadline_ms':0},True)
  except ValueError:rejected.append('runtime')
  for fd in p.fds:os.close(fd)
 print(json.dumps({'valid':ok,'rawhash':o['files'][0]['sha256'],'rejected':rejected}))
`);expect(value.valid).toBe(true);expect(value.rawhash).toMatch(/^[a-f0-9]{64}$/);expect(value.rejected).toEqual(['agent-completion.json','execution-failure.json','agent-terminal.json','child-stop-readback.json','delivery.json','agent-delivery.json','runtime']);
});
