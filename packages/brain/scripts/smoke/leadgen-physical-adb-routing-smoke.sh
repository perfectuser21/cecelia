#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 0 ]]; then
  for smoke_case in 5042 legacy closed wrong-serial offline invalid-port cloud no-phone outreach dispatch-5042 dispatch-reject; do
    bash "$0" --case "$smoke_case"
  done
  exit 0
fi
case_name="${2:-}"
if [[ "${1:-}" != --case || ! "$case_name" =~ ^(5042|legacy|closed|wrong-serial|offline|invalid-port|cloud|no-phone|outreach|dispatch-5042|dispatch-reject)$ ]]; then
  echo 'usage: leadgen-physical-adb-routing-smoke.sh --case 5042|legacy|closed|wrong-serial|offline|invalid-port|cloud|no-phone|outreach|dispatch-5042|dispatch-reject' >&2
  exit 2
fi
node --input-type=module - "$case_name" <<'NODE'
import assert from 'node:assert/strict';
import {resolveLeadgenInput} from './packages/brain/src/lib/leadgen-dispatch-contract.js';
import {buildLeadgenLaunch,buildLeadgenProbe,buildLeadgenAdbPreflight} from './packages/brain/src/lib/leadgen-controller.js';
import {dispatchLeadgenTask} from './packages/brain/src/lib/leadgen-dispatch.js';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
const kind=process.argv[2], id='11111111-1111-4111-8111-111111111111';
const key='douyin_video_discovery', company='22222222-2222-4222-8222-222222222222';
const make=(flow=key,extra={})=>({id,payload:{workflow_key:flow,leadgen:{line:'yuesheng',company_id:company,profile:'physical',serial:'ANGYVB4402004137',limit:1,...(flow==='douyin_video_processing'?{source_run:'source101',source_binding_run_id:'douyin_video_discovery-source101__a1'}:{}),...extra}}});
const full=p=>({...p,release_id:'33333333-3333-4333-8333-333333333333',observation_id:'44444444-4444-4444-8444-444444444444',workflow_definition_version_id:'55555555-5555-4555-8555-555555555555',snapshot_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)});
const reject=(task,pattern)=>assert.throws(()=>resolveLeadgenInput(task),pattern);
const out={case:kind,fixture:'isolated subprocess and in-memory dispatch ledger',claims:0,locks:0,launches:0};
async function runController(p,state='device'){
  const root=mkdtempSync(join(tmpdir(),'leadgen-smoke-')),m4=join(root,'m4'),local=join(root,'local');
  let server;const protocol='isolated-random-port-tcp';
  try{
  mkdirSync(join(m4,'bin-harvest'),{recursive:true});mkdirSync(join(local,'test-bin'),{recursive:true});
  writeFileSync(join(m4,'bin-harvest/deployment-manifest.json'),JSON.stringify({release_id:p.release_id,observation_id:p.observation_id,source_commit:p.source_commit}));
  writeFileSync(join(m4,'bin-harvest/leadgen-run.sh'),`#!/bin/sh\npython3 -c 'import json,os,pathlib;h=pathlib.Path.home();(h/"observed.json").write_text(json.dumps({k:os.environ.get(k) for k in ["DOUYIN_ADB_PORT","ADB_SERVER_SOCKET","ADB_SERVER_PORT"]}));(h/"calls").write_text("x")'\nexit 7\n`,{mode:0o700});
  const port=p.env.DOUYIN_ADB_PORT??'5037';
  // 只有fixture适配器看到批准端口；真实TCP仅连接内核分配的临时端口。
  // closed仍保留一个已bind但未listen的socket，避免随机端口释放后被别人抢占。
  const ready=join(root,'ready'),error=join(root,'error'),serverFile=join(root,'adb-server.py'),requests=join(root,'requests.jsonl');
  writeFileSync(serverFile,`import socket,pathlib,time\ntry:\n s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1]\n assert port not in (5037,5041,5042)\n if ${JSON.stringify(state)}!='closed':s.listen()\n pathlib.Path(${JSON.stringify(ready)}).write_text(str(port))\nexcept Exception as e:\n pathlib.Path(${JSON.stringify(error)}).write_text(str(e));raise\nif ${JSON.stringify(state)}=='closed':\n while True:time.sleep(1)\nwhile True:\n c,_=s.accept()\n try:\n  h=c.recv(4);n=int(h,16);req=b''\n  while len(req)<n:\n   chunk=c.recv(n-len(req))\n   if not chunk:raise ValueError('fixture request truncated')\n   req+=chunk\n  reply=${JSON.stringify(state)}.encode()\n  c.sendall(b'OKAY'+('%04x'%len(reply)).encode()+reply if req==('host-serial:'+${JSON.stringify(state==='wrong-serial'?'other':p.serial)}+':get-state').encode() else b'FAIL0000')\n finally:c.close()\n`);
  server=spawn('python3',[serverFile],{stdio:'ignore'});
  for(let i=0;i<100&&!existsSync(ready)&&!existsSync(error);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(existsSync(error),false,existsSync(error)?readFileSync(error,'utf8'):'');
  assert.equal(existsSync(ready),true,'isolated ADB fixture did not start');
  const fixturePort=Number(readFileSync(ready,'utf8'));assert.ok(fixturePort>1024&&![5037,5041,5042].includes(fixturePort));
  writeFileSync(join(m4,'socket.py'),`import _socket,json\nclass Conn(_socket.socket):\n def __enter__(self):return self\n def __exit__(self,*args):self.close()\ndef create_connection(address,timeout=None):\n if address!=('127.0.0.1',${port}):raise OSError('fixture rejected unexpected approved address')\n with open(${JSON.stringify(requests)},'a') as log:log.write(json.dumps({'requested':address,'actual':['127.0.0.1',${fixturePort}]})+'\\n')\n conn=Conn(_socket.AF_INET,_socket.SOCK_STREAM);conn.settimeout(timeout)\n try:conn.connect(('127.0.0.1',${fixturePort}))\n except BaseException:conn.close();raise\n return conn\n`);
  writeFileSync(join(local,'test-bin/ssh'),`#!/usr/bin/env python3\nimport os,sys,subprocess\nassert '-J' in sys.argv and 'xian-m1' in sys.argv and 'StrictHostKeyChecking=yes' in sys.argv\ne=dict(os.environ);e['HOME']=e['FAKE_M4_HOME'];e['PYTHONPATH']=e['FAKE_M4_HOME']\nr=subprocess.run(['/bin/sh','-c',sys.argv[-1]],input=sys.stdin.buffer.read(),env=e);sys.exit(r.returncode)\n`,{mode:0o700});
  const env={...process.env,HOME:local,PATH:join(local,'test-bin')+':'+process.env.PATH,FAKE_M4_HOME:m4,ADB_SERVER_SOCKET:'tcp:evil:9',ADB_SERVER_PORT:'9999'};
  const execute=(command,input='')=>JSON.parse(execFileSync('sh',['-c',command],{input,env,encoding:'utf8',timeout:10000}));
    const preflight=buildLeadgenAdbPreflight(p),before=execute(preflight.remote,preflight.input);
    assert.equal(before.state,state==='device'?'device':'rejected');
    const command=buildLeadgenLaunch(p);execute(command.remote,command.input);
    let result;
    for(let i=0;i<60;i++){result=execute(buildLeadgenProbe(p));if(result.state==='terminal')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(result?.state,'terminal');assert.equal(result.execution_started,state==='device');
    const calls=existsSync(join(m4,'calls'))?readFileSync(join(m4,'calls'),'utf8'):'';
    assert.equal(calls,state==='device'?'x':'');
    const seen=existsSync(join(m4,'observed.json'))?JSON.parse(readFileSync(join(m4,'observed.json'),'utf8')):null;
    if(seen){assert.equal(seen.DOUYIN_ADB_PORT,p.env.DOUYIN_ADB_PORT??null);assert.equal(seen.ADB_SERVER_SOCKET,p.env.ADB_SERVER_SOCKET??null);assert.equal(seen.ADB_SERVER_PORT,null);}
    const routes=readFileSync(requests,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(routes.length,2,'preclaim与worker均须经过隔离路由');
    for(const route of routes){assert.deepEqual(route.requested,['127.0.0.1',Number(port)]);assert.deepEqual(route.actual,['127.0.0.1',fixturePort]);}
    return {protocol,fixture_port:fixturePort,preflight_checks:routes.length,execution_started:result.execution_started,calls:calls.length,env:seen};
  }finally{if(server)server.kill();const pid=join(local,'brain-runs',p.controller_run_id+'.pid');if(existsSync(pid)){try{process.kill(-Number(readFileSync(pid,'utf8')),'SIGTERM');}catch{}}rmSync(root,{recursive:true,force:true});}
}
if(kind==='5042'||kind==='legacy'){
  for(const flow of ['douyin_video_discovery','douyin_video_processing']){
    const p=full(resolveLeadgenInput(make(flow,kind==='5042'?{adb_port:5042}:{})));
    assert.equal(p.machine,'xian-m4');assert.equal(p.env.DOUYIN_ADB_PORT,kind==='5042'?'5042':undefined);
    assert.match(buildLeadgenLaunch(p).remote,/^python3 -c /);
    assert.match(buildLeadgenProbe(p),/ probe /);
    assert.match(buildLeadgenAdbPreflight(p).remote,/^python3 -c /);
    const observed=await runController(p);assert.equal(observed.calls,1);out[flow]=observed;
  }
  out.port=kind==='5042'?5042:5037;out.plans=2;
}else if(kind==='invalid-port'){
  for(const adb_port of [5043,0,65536,'5042',true])reject(make(key,{adb_port}),/端口无效/);
  out.rejected=5;
}else if(kind==='cloud'){
  const cloud={device_host:'mmv',serial:'47.100.213.173:10001',profile:'cloud-phone-test',device_instance_id:'acp-f6utus34dgnghc1oc',adb_port:5041,registry:'cloud-phone-test-profiles.tsv'};
  for(const flow of ['douyin_video_discovery','douyin_video_processing']){
    const p=resolveLeadgenInput(make(flow,cloud));assert.equal(p.machine,'mmv');assert.equal(p.env.ADB_SERVER_SOCKET,'tcp:127.0.0.1:5041');
    reject(make(flow,{...cloud,registry:undefined}),/完整登记路由/);
  }
  out.plans=2;out.rejected=2;
}else if(kind==='no-phone'){
  const t=make('douyin_comment_scoring',{profile:undefined,serial:undefined,source_run:'source102',source_binding_run_id:'douyin_video_processing-source102__a1'});
  assert.equal(resolveLeadgenInput(t).serial,'none');reject(make('douyin_comment_scoring',{...t.payload.leadgen,adb_port:5042}),/端口无效/);out.rejected=1;
}else if(kind==='outreach'){
  const t=make('douyin_lead_outreach');reject(t,/授权/);reject(make('douyin_lead_outreach',{send_authorized:true,limit:2}),/数量越界/);
  const p=full(resolveLeadgenInput(make('douyin_lead_outreach',{send_authorized:true,adb_port:5042})));assert.equal(p.send_authorized,true);assert.match(buildLeadgenLaunch(p).remote,/^python3 -c /);out.authorized=true;out.rejected=2;
}else if(['closed','wrong-serial','offline'].includes(kind)){
  const p=full(resolveLeadgenInput(make(key,{adb_port:5042})));
  const observed=await runController(p,kind);assert.equal(observed.calls,0);out.observed=observed;
}else{
  const states=kind==='dispatch-reject'?['closed','wrong-serial','offline','invalid-port']:[kind];
  for(const state of states){
    const t=make(key,{adb_port:state==='invalid-port'?5043:5042});
    const db={query:async sql=>{if(sql.startsWith('UPDATE tasks SET claimed_by'))out.claims++;return {rows:[{id}]};}};
    const deps={prepareLeadgenPlan:async()=>full(resolveLeadgenInput(t)),batchProof:async()=>({company_id:company,eligible:1}),adbPreflight:async p=>JSON.stringify({state:state==='dispatch-5042'?'device':state==='wrong-serial'?'device':state,serial:state==='wrong-serial'?'other':p.serial,port:5042}),lockGate:async()=>{out.locks++;return {pass:true};},setLease:async()=>{},startRun:async()=>({id:'run',run_id:'wfd-'+id}),launch:async()=>{out.launches++;return JSON.stringify({state:'running'});},recordEvent:async()=>{},finalizeTask:async()=>{}};
    const result=await dispatchLeadgenTask(db,t,deps);
    assert.equal(result,state==='dispatch-5042'?'dispatched':'failed');
  }
  if(kind!=='dispatch-5042'){assert.equal(out.claims,0);assert.equal(out.locks,0);assert.equal(out.launches,0);}else{assert.equal(out.claims,1);assert.equal(out.locks,1);assert.equal(out.launches,1);}
  out.states=states;
}
console.log(JSON.stringify(out));
NODE
