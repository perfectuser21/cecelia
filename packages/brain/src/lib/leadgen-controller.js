/** 确定性控制器：Brain只传批准输入，263业务字节仍由正式入口冻结/ACK。 */
const FLOWS = { douyin_video_discovery: '101', douyin_video_processing: '102', douyin_comment_scoring: '103', douyin_lead_outreach: '104' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,120}$/;
function checked(plan) {
  if (!plan || !UUID.test(plan.task_id) || plan.controller_run_id !== `wfd-${plan.task_id}`
    || plan.business_tag !== `brain${plan.task_id.replaceAll('-', '')}` || !FLOWS[plan.workflow_key]
    || plan.business_run_id !== `${plan.workflow_key}-${plan.business_tag}__a1`) throw Error('leadgen controller identity invalid');
  for (const key of ['company_id', 'release_id', 'observation_id', 'workflow_id', 'workflow_definition_version_id']) {
    if (!UUID.test(plan[key])) throw Error(`leadgen ${key} invalid`);
  }
  if (plan.timeout_sec !== (['douyin_video_discovery', 'douyin_video_processing'].includes(plan.workflow_key) ? 2400 : 1800)) throw Error('leadgen timeout invalid');
  if (typeof plan.source_commit !== 'string' || !/^[a-f0-9]{40}$/.test(plan.source_commit)) throw Error('leadgen source invalid');
  if (plan.workflow_id !== `b1000000-0000-4000-8000-000000000${FLOWS[plan.workflow_key]}` || !/^[a-f0-9]{64}$/.test(plan.snapshot_sha256)) throw Error('leadgen workflow freeze invalid');
  if ([plan.profile, plan.serial, plan.line].some(v => typeof v !== 'string' || !TOKEN.test(v))) throw Error('leadgen resources invalid');
  if (plan.workflow_key === 'douyin_comment_scoring') {
    if (plan.machine !== 'mmv' || plan.profile !== 'mmv-scoring' || plan.serial !== 'none') throw Error('103 is MMV only');
  } else if (plan.machine !== 'xian-m4' || plan.serial === 'none') throw Error('phone flow is M4 only');
  if (plan.workflow_key === 'douyin_lead_outreach' ? plan.send_authorized !== true : plan.send_authorized !== undefined) throw Error('send authorization invalid');
  if (!plan.env || typeof plan.env !== 'object' || Array.isArray(plan.env)) throw Error('leadgen env invalid');
  for (const [key, value] of Object.entries(plan.env)) {
    if (key === 'QUEUED_VIDEO_COLLECTION_SECONDS') {
      if (plan.workflow_key !== 'douyin_video_processing' || !/^[1-9][0-9]{0,3}$/.test(String(value)) || Number(value) > 1920) throw Error('102 collection budget invalid');
      continue;
    }
    if (!['LEADGEN_SOURCE_RUN', 'LEADGEN_LIMIT', 'LEADGEN_COMMENT_LIMIT', 'WF_MMV_SSH_ROUTE'].includes(key)) throw Error('leadgen env not allowed');
    if (key === 'WF_MMV_SSH_ROUTE' ? value !== 'public' : key === 'LEADGEN_SOURCE_RUN' ? !TOKEN.test(value) : !/^[1-9][0-9]?$/.test(String(value)) || Number(value) > 50) throw Error('leadgen env value invalid');
  }
  if (plan.env.WF_MMV_SSH_ROUTE !== 'public' || plan.workflow_key === 'douyin_comment_scoring' && (typeof plan.env.LEADGEN_SOURCE_RUN !== 'string' || !TOKEN.test(plan.env.LEADGEN_SOURCE_RUN) || /commentbench/i.test(plan.env.LEADGEN_SOURCE_RUN))) throw Error('leadgen source/routing missing');
  return JSON.parse(JSON.stringify(plan));
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
// 同一程序用于MMV控制器和M4独立子进程；probe分支只读，不修文件、不重启业务。
const CORE = String.raw`
import os,sys,json,pathlib,subprocess,time,base64,shlex
os.umask(0o077)
H=pathlib.Path.home()
def dump(v): print(json.dumps(v,ensure_ascii=False),flush=True)
def atom(p,v):
    t=p.with_name(p.name+'.tmp');t.write_text(v);os.chmod(t,0o600);os.replace(t,p)
def paths(p):
    base=H/'brain-runs';return base,base/(p['controller_run_id']+'.dispatch')
def readjson(p):
    if p.is_symlink() or not p.is_file() or p.stat().st_size>2000000: raise ValueError('artifact unavailable')
    return json.loads(p.read_text())
def script(): return 'CORE='+repr(CORE)+'\nexec(CORE)\n'
def remote(p,action):
    command=shlex.join(['python3','-c',script(),action,base64.b64encode(json.dumps(p).encode()).decode()])
    r=subprocess.run(['ssh','-J','xian-m1','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','xian-m4',command],capture_output=True,text=True,timeout=25)
    if r.returncode: raise ValueError('remote transport unknown')
    return json.loads(r.stdout)
def alive(root):
    try:
        pid=int((root/'pid').read_text());os.kill(pid,0)
        r=subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True,timeout=3)
        return str(root/'worker.py') in r.stdout
    except Exception:return False
def receipt(p):
    d=H/'.config/zenithjoy/ledger'/(p['workflow_key']+'-'+p['business_tag'])
    # 读取本次冻结runtime中原有reader；它们重验manifest与固定ACK，不拼造字段。
    node=r'''import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const d=process.argv[1],{readFrozen}=await import(pathToFileURL(d+'/runtime/runtime-definition.mjs')),{readBinding}=await import(pathToFileURL(d+'/runtime/runtime-binding.mjs'));
const f=readFrozen(d),b=readBinding(d,'a1',f),s=JSON.parse(fs.readFileSync(d+'/split-result.json','utf8'));
console.log(JSON.stringify({split_result:s,binding_ack:b,frozen:{read_frozen_verified:true,snapshot_sha256:f.snapshot_sha256,run_identity:f.run_identity,deployment:f.deployment,workflow_version:{id:f.workflow_version.id,workflow_id:f.workflow_version.workflow_id||f.workflow_version.payload?.workflow_id,payload_sha256:f.workflow_version.payload_sha256,source_commit:f.workflow_version.source_commit},activities:(f.activities||[]).map(a=>({reference:a.reference,version_id:a.version.id}))}}));'''
    r=subprocess.run(['node','--input-type=module','-e',node,str(d)],capture_output=True,text=True,timeout=20)
    if r.returncode or len(r.stdout)>1800000:raise ValueError('runtime receipt unavailable')
    v=json.loads(r.stdout);s=v['split_result'];b=v['binding_ack'];f=v['frozen'];i=f['run_identity'];w=f['workflow_version']
    if s['run_id']!=p['business_run_id'] or b['run_id']!=p['business_run_id'] or s['workflow_key']!=p['workflow_key'] or s['profile']!=p['profile']:raise ValueError('business identity mismatch')
    if i['tag']!=p['business_tag'] or i['capability']!=p['workflow_key'] or i['profile']!=p['profile'] or i['serial']!=p['serial']:raise ValueError('frozen resource mismatch')
    for k in ['release_id','observation_id','workflow_id','workflow_definition_version_id','snapshot_sha256']:
        if b.get(k,b.get('payload',{}).get(k))!=p[k]:raise ValueError('binding plan mismatch')
    if w['id']!=p['workflow_definition_version_id'] or w['workflow_id']!=p['workflow_id'] or w['payload_sha256']!=p['snapshot_sha256']:raise ValueError('workflow plan mismatch')
    if b.get('payload',{}).get('runtime_snapshot_sha256',b.get('runtime_snapshot_sha256'))!=f['snapshot_sha256'] or s['source_commit']!=f['deployment']['source_commit'] or f['deployment']['source_commit']!=p['source_commit']:raise ValueError('runtime source mismatch')
    return v
def probe_local(p):
    base,root=paths(p);out={'state':'unknown','business_run_id':p['business_run_id'],'exit_code':None,'receipt':None}
    if not root.exists():return out
    if root.is_symlink() or readjson(root/'plan.json')!=p:raise ValueError('reservation plan mismatch')
    term=root/'terminal.json'
    if term.exists():
        t=readjson(term)
        if t['business_run_id']!=p['business_run_id'] or type(t['exit_code']) is not int:raise ValueError('terminal identity mismatch')
        out['exit_code']=t['exit_code'];out['execution_started']=t['execution_started']
        try:out['receipt']=receipt(p);out['state']='terminal'
        except Exception:
            out['reason']=t.get('reason','business_receipt_unverified')
            if t['exit_code']!=0:out['state']='terminal'
    elif alive(root):out['state']='running'
    else:out['state']='reserved' if not (root/'pid').exists() else 'unknown'
    return out
def launch(p,role):
    base,root=paths(p);base.mkdir(mode=0o700,parents=True,exist_ok=True)
    try:root.mkdir(mode=0o700)
    except FileExistsError:return probe_local(p) if role=='business' or p['machine']=='mmv' else probe(p)
    atom(root/'plan.json',json.dumps(p,sort_keys=True));atom(root/'worker.py',script())
    with open(base/(p['controller_run_id']+'.log'),'ab',buffering=0) as log:
        child=subprocess.Popen([sys.executable,str(root/'worker.py'),'worker',str(root),role],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,close_fds=True)
    atom(root/'pid',str(child.pid));atom(base/(p['controller_run_id']+'.pid'),str(child.pid))
    return {'state':'running','business_run_id':p['business_run_id'],'exit_code':None,'receipt':None}
def probe(p):
    if p['machine']=='mmv':return probe_local(p)
    base,root=paths(p)
    if not root.exists():return {'state':'unknown','business_run_id':p['business_run_id'],'exit_code':None,'receipt':None}
    if root.is_symlink() or readjson(root/'plan.json')!=p:raise ValueError('reservation plan mismatch')
    try:return remote(p,'probe_business')
    except Exception:return {'state':'unknown','business_run_id':p['business_run_id'],'exit_code':None,'receipt':None,'reason':'remote_transport_unknown'}
def terminal(p,root,code,started=True,reason=None):
    base,_=paths(p);atom(root/'terminal.json',json.dumps({'business_run_id':p['business_run_id'],'exit_code':code,'execution_started':started,'reason':reason}));atom(base/(p['controller_run_id']+'.exit'),str(code))
def worker(root,role):
    p=readjson(root/'plan.json')
    if role=='business' or p['machine']=='mmv':
        try:
            manifest=readjson(H/'bin-harvest/deployment-manifest.json')
            if any(manifest.get(k)!=p[k] for k in ['release_id','observation_id','source_commit']):raise ValueError('deployment changed')
            if (H/'.config/zenithjoy/ledger'/(p['workflow_key']+'-'+p['business_tag'])).exists():raise ValueError('business directory exists')
        except Exception:terminal(p,root,2,False,'preflight_rejected');return
        # 清除上一次执行遗留的控制变量；正常HOME/PATH/BRAIN_*与正式凭据加载仍保留。
        env={k:v for k,v in os.environ.items() if not k.startswith(('LEADGEN_','WF_','WFR_','QUEUED_'))}
        env.update({k:str(v) for k,v in p['env'].items()});env['WF_RELEASE_ID']=p['release_id'];env['WF_RUN_MAX_SECONDS']=str(p['timeout_sec'])
        if p['workflow_key']=='douyin_lead_outreach' and p.get('send_authorized') is True:env['LEADGEN_SEND']='1'
        # 可执行入口由部署合同固定，不接受调用者提供路径/任意命令。
        try:code=subprocess.call([str(H/'bin-harvest/leadgen-run.sh'),p['workflow_key'],p['profile'],p['serial'],p['line'],p['business_tag']],env=env)
        except OSError:terminal(p,root,2,False,'cli_not_started');return
        terminal(p,root,code if code>=0 else 128-code);return
    try:remote(p,'launch_business')
    except Exception:pass # 交付未知：后续只探测，永不再次launch。
    while True:
        try:
            r=remote(p,'probe_business')
            if r.get('state')=='terminal':terminal(p,root,r['exit_code'],r.get('execution_started',True),r.get('reason'));return
        except Exception:pass
        time.sleep(15)
if len(sys.argv)>1 and sys.argv[1]=='worker':worker(pathlib.Path(sys.argv[2]),sys.argv[3])
else:
    action=sys.argv[1] if len(sys.argv)>1 else 'launch'
    p=json.loads(base64.b64decode(sys.argv[2])) if len(sys.argv)>2 else json.load(sys.stdin)
    if action=='launch':dump(launch(p,'controller'))
    elif action=='launch_business':dump(launch(p,'business'))
    elif action=='probe_business':dump(probe_local(p))
    elif action=='probe':dump(probe(p))
    else:raise ValueError('unsupported controller action')
`;
const program = `import base64; CORE=base64.b64decode('${Buffer.from(CORE).toString('base64')}').decode(); exec(CORE)`;
export function buildLeadgenLaunch(plan) {
  const value = checked(plan);
  return { remote: `python3 -c ${quote(program)}`, input: JSON.stringify(value) };
}
export function buildLeadgenProbe(plan) {
  const value = checked(plan), payload = Buffer.from(JSON.stringify(value)).toString('base64');
  return `python3 -c ${quote(program)} probe ${quote(payload)}`;
}
