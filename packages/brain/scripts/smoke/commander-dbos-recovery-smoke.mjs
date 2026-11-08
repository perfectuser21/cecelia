#!/usr/bin/env node
// 隔离集成：真实 DBOS/PG + 公共 Fleet Runner + 被 SIGKILL 的 Commander。
// HTTP dispatcher/中央验收是测试夹具；不声称生产 Brain/手机业务通过。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const self=fileURLToPath(import.meta.url),mode=process.argv[2];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hash=s=>createHash('sha256').update(s).digest('hex');
const root=process.env.RECOVERY_SMOKE_ROOT;
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value),{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function until(check){for(let i=0;i<400;i++){const value=await check();if(value)return value;await wait(50);}throw Error('smoke_deadline_exceeded');}
if(mode==='worker'){
 const {createWorkflowRunner,profileDigest}=createRequire(import.meta.url)('../fleet-worker/workflow-runner.cjs');
 const work=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('effects','x');while(!fs.existsSync('release'))await new Promise(r=>setTimeout(r,50));console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:'completed',outputs:{answer:42},metrics:{},evidence:['effects']}));`;
 const check=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({verdict:fs.readFileSync('effects','utf8')==='x'?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{file:'effects'}]}));`;
 const commander=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('commander-trace',JSON.stringify({pid:process.pid,run_id:x.run_id,phase:x.phase})+'\\n');if(!fs.existsSync('commander-died')){fs.writeFileSync('commander-died',String(process.pid));process.kill(process.pid,'SIGKILL');}console.log('{"action":"none"}');`;
 const files={'work.mjs':work,'check.mjs':check,'commander.mjs':commander,'commander.md':'只观察，不执行业务动作。'};
 for(const [name,content]of Object.entries(files))fs.writeFileSync(path.join(root,name),content);
 const profile={cwd:root,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,hash(v)])),contract:{workflow:'generic-recovery-smoke',activities:[{key:'work',order:1,budget:{max_duration_s:30,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}},runtime:{protocol:'json-stdio-v1',phase:'source',entry:'work.mjs'}}]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code',questions:{A4:{ref:'actual-effect'}}}},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'actual-effect'}}},commander:{entry:'commander.mjs',skill:{entry:'commander.md',version:'1'},timeout_s:2}};
 const runner=createWorkflowRunner({stateRoot:path.join(root,'worker-state'),machineId:'isolated-smoke',profiles:{fixture:profile},assertCanLaunch:()=>{},assertLocalResources:async()=>{},createRecorder:()=>({onEvent:async e=>fs.appendFileSync(path.join(root,'events.jsonl'),JSON.stringify(e)+'\n'),recordValidation:async()=>{},finalize:async()=>{},flush:async()=>({pending:0,blocked:0})})});
 const server=http.createServer(async(req,res)=>{try{let text='';for await(const c of req)text+=c;const body=JSON.parse(text);const action=req.url.slice(1);fs.appendFileSync(path.join(root,'dispatch.jsonl'),JSON.stringify({action,run_id:body.run_id})+'\n');const receipt=await runner[action]({...body,...(action==='start'?{profile_sha256:profileDigest(profile)}:{})});res.setHeader('content-type','application/json');res.end(JSON.stringify(receipt));}catch(e){res.writeHead(409).end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));write('worker.json',{url:`http://127.0.0.1:${server.address().port}`,pid:process.pid});
 process.on('SIGTERM',()=>{runner.close();server.close(()=>process.exit(0));});
}else if(mode==='coordinator'){
 const {DBOS}=await import('@dbos-inc/dbos-sdk');
 const {configureCommonRunnerDurableDeps,startDurableCommonRunner}=await import('../../src/durable/common-runner-durable.js');
 const manifest=read('manifest.json'),endpoint=read('worker.json').url;
 configureCommonRunnerDurableDeps({dispatcher:{dispatch:async(action,id,body)=>{
  const response=await fetch(endpoint+'/'+action,{method:'POST',body:JSON.stringify({...body,run_id:id})});if(!response.ok)throw Error('fixture_transport_unknown');
  const receipt=await response.json();
  if(action==='start'&&!fs.existsSync(path.join(root,'start-ack-window'))){
   write('start-ack-window',{pid:process.pid,run_id:id});
   while(!fs.existsSync(path.join(root,'release')))await wait(50);
  }
  const verified=receipt.status==='completed'&&receipt.validation?.workflow?.verdict==='pass'&&fs.readFileSync(path.join(root,'effects'),'utf8')==='x';
  return {authenticated:true,receipt,central_run:{status:verified?'success':'running',recording_status:verified?'confirmed':'pending'}};
 }}});
 DBOS.setConfig({name:'commander-recovery-smoke',applicationVersion:'generic-recovery-smoke-v1',executorID:'generic-recovery-smoke',systemDatabaseUrl:process.env.TEST_DB_URL,systemDatabaseSchemaName:'commander_smoke_dbos'});
 await DBOS.launch();
 const handle=process.env.RECOVER_ONLY==='1'?DBOS.retrieveWorkflow('common-runner:'+manifest.run_id):(await startDurableCommonRunner(manifest)).handle;
 const result=await handle.getResult();write('result.json',result);await DBOS.shutdown();
}else{
 const url=new URL(process.env.TEST_DB_URL??'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/cecelia_scratch');
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:url.href});assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db,'cecelia_scratch');
 const {buildTerminalUpdate}=await import('../../src/lib/task-terminal.js');
 const sqlClient=await pool.connect();
 try{
  await sqlClient.query('BEGIN');
  await sqlClient.query(`CREATE TEMP TABLE tasks(id uuid,status text,payload jsonb,result jsonb,claimed_by text,claimed_at timestamptz,updated_at timestamptz,completed_at timestamptz);
   CREATE TEMP TABLE task_runs(task_id uuid,run_id uuid,status text,ended_at timestamptz,context jsonb);`);
  const task=randomUUID(),run=randomUUID(),source={workflow_common_runner:{task_id:task,run_id:run}};
  await sqlClient.query("INSERT INTO tasks(id,status,payload,result,claimed_by) VALUES($1,'in_progress','{}',$2,'common-runner')",[task,JSON.stringify(source)]);
  const proof={runId:run,workflowId:'common-runner:'+run,workflowStatus:'SUCCESS'};
  const apply=async(status,proofValue)=>{const q=buildTerminalUpdate(task,status,{onlyIfStatus:'in_progress',commonRunnerNoLaunchReconciliation:proofValue});return (await sqlClient.query(q.sql,q.params)).rowCount;};
  const wrongRun=randomUUID();assert.equal(await apply('failed',{...proof,runId:wrongRun,workflowId:'common-runner:'+wrongRun}),0);
  await assert.rejects(apply('completed',proof),/commonRunnerNoLaunchReconciliation/);
  await sqlClient.query("UPDATE tasks SET result=result||$1::jsonb",[JSON.stringify({common_runner:{run_id:run}})]);
  assert.equal(await apply('failed',proof),0);
  await sqlClient.query("UPDATE tasks SET result=result-'common_runner'");
  assert.equal(await apply('failed',proof),1);
 }finally{await sqlClient.query('ROLLBACK');sqlClient.release();}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commander-dbos-smoke-'));
 process.env.RECOVERY_SMOKE_ROOT=dir;process.env.DBOS_DURABLE_ENABLED='true';
 const manifest={run_id:randomUUID(),body:{task_id:randomUUID(),profile:'fixture',input:{run_tag:'generic-recovery-smoke'},mode:'exploration'},deadline_ms:Date.now()+45000,poll_interval_ms:100};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
 const launch=(kind,env={})=>{const fd=fs.openSync(path.join(dir,kind+'-'+Date.now()+'.log'),'a',0o600);const child=spawn(process.execPath,[self,kind],{env:{...process.env,...env},stdio:['ignore',fd,fd]});fs.closeSync(fd);return child;};
 let worker,first,recovered;
 try{
  worker=launch('worker');await until(()=>fs.existsSync(path.join(dir,'worker.json')));
  first=launch('coordinator');await until(()=>fs.existsSync(path.join(dir,'effects'))&&fs.existsSync(path.join(dir,'start-ack-window')));
  const exited=new Promise(r=>first.once('exit',(code,signal)=>r({code,signal})));first.kill('SIGKILL');const death=await exited;assert.equal(death.signal,'SIGKILL');
  recovered=launch('coordinator',{RECOVER_ONLY:'1'});await wait(500);fs.writeFileSync(path.join(dir,'release'),'continue original activity');
  await until(()=>fs.existsSync(path.join(dir,'result.json')));
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(result.status,'completed');assert.equal(result.run_id,manifest.run_id);
  assert.equal(fs.readFileSync(path.join(dir,'effects'),'utf8'),'x');
  const calls=fs.readFileSync(path.join(dir,'dispatch.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(calls.filter(x=>x.action==='start').length>=1);
  const events=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(x=>x.event_type==='ACTIVITY_STARTED').length,1);
  const turns=fs.readFileSync(path.join(dir,'commander-trace'),'utf8').trim().split('\n').map(JSON.parse);assert(turns.length>1);assert(turns.every(x=>x.run_id===manifest.run_id));
  const state=JSON.parse(fs.readFileSync(path.join(dir,'worker-state',manifest.run_id+'.json')));assert.equal(state.commander_status,'available');
  const checkpoints=(await pool.query('SELECT workflow_uuid,status,recovery_attempts FROM commander_smoke_dbos.workflow_status WHERE workflow_uuid=$1',['common-runner:'+manifest.run_id])).rows;
  assert.equal(checkpoints[0].status,'SUCCESS');assert(checkpoints[0].recovery_attempts>=2);
  const proof={verdict:'pass',no_launch_terminal_sql:'真实PG：无绑定失败出口通过；错run、有绑定、成功出口均拒绝',scope:'真实PG/DBOS与公共Fleet Runner；HTTP调度及中央读回为隔离夹具，未访问生产Brain或云手机',artifact_root:dir,run_id:manifest.run_id,coordinator_death:death,worker_pid:worker.pid,fault_window:'首次start已到Worker但DBOS step尚未checkpoint',effect_count:1,activity_launch_count:1,start_request_count:calls.filter(x=>x.action==='start').length,commander_turns:turns.length,checkpoints};
  fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }finally{first?.kill('SIGTERM');recovered?.kill('SIGTERM');worker?.kill('SIGTERM');await pool.end();}
}
