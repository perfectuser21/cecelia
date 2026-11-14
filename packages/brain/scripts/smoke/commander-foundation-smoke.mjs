#!/usr/bin/env node
// 真实PG/DBOS/宿主与活动进程；故障位置用确定性Commander夹具，真模型另行显式运行。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const here=path.dirname(fileURLToPath(import.meta.url)), brain=path.resolve(here,'../..');
const url=new URL(process.env.TEST_DB_URL??'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/cecelia_scratch');
const pool=new pg.Pool({connectionString:url.href}), suffix=randomUUID().slice(0,8);
const schema=`commander_actions_${suffix}`,dbosSchema=`commander_history_${suffix}`;
const artifactRoot=fs.mkdtempSync(path.join(process.env.COMMANDER_SMOKE_ARTIFACT_ROOT??os.tmpdir(),'commander-foundation-'));
const real=process.env.COMMANDER_SMOKE_REAL_CODEX==='1';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=data=>createHash('sha256').update(data).digest('hex');
const until=async(check,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await wait(30);}throw Error('smoke_deadline_exceeded');};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const lines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const activity=(key,order,kind)=>({key,order,budget:{max_duration_s:real?180:30,heartbeat_s:1},
  acceptance:{description:key==='prepare'?'真实产物base=21':'读取base后真实产物answer=42'},
  failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['unknown']}},
  runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs',argv:[key],executor_kind:kind}});
function launch(root,resultName='result.json'){
  const logPath=path.join(root,`host-${Date.now()}.log`);
  const fd=fs.openSync(logPath,'a',0o600);
  const child=spawn(process.execPath,[path.join(brain,root.endsWith('/auto-supervise')?'scripts/commander-workflow/supervise.mjs':'scripts/commander-workflow/host.mjs'),'--manifest',path.join(root,'manifest.json'),'--result',path.join(root,resultName)],
    {detached:true,stdio:['ignore',fd,fd],env:{...process.env,DBOS_DURABLE_ENABLED:'true',COMMANDER_DATABASE_URL:url.href,COMMANDER_DATABASE_SCHEMA:schema,COMMANDER_DBOS_SCHEMA:dbosSchema}});
  fs.closeSync(fd);child.logPath=logPath;return child;
}
async function killDomain(root,host){
  const pids=[host.pid,...fs.readdirSync(root).filter(f=>f.endsWith('.pid')).map(f=>Number(fs.readFileSync(path.join(root,f),'utf8')))];
  for(const pid of new Set(pids)){try{process.kill(-pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
  await until(()=>host.exitCode!==null||host.signalCode!==null);
  for(const pid of new Set(pids))await until(()=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}},5000);
  return [...new Set(pids)];
}
async function scenario(name){
  const root=path.join(artifactRoot,name);fs.mkdirSync(root,{mode:0o700});
  const files={};for(const name of ['adapter.mjs','work.mjs','commander.mjs','skill.txt']){
    const data=fs.readFileSync(path.join(here,'fixtures/commander-foundation',name));fs.writeFileSync(path.join(root,name),data);files[name]=hash(data);
  }
  const run={schema_version:1,task_id:randomUUID(),run_id:randomUUID(),deadline_ms:Date.now()+(real?600000:90000),commander_timeout_ms:real?90000:5000,
    input:{run_tag:randomUUID()},contract:{workflow:'commander-foundation-example',goal:'先生成base=21，再读取其产物并计算answer=42，每项都独立验收',activities:[activity('prepare',1,'code'),activity('double',2,'agent')]}};
  const commander=real?{provider:'codex',model:process.env.COMMANDER_CODEX_MODEL??'gpt-6-astra',codexHome:process.env.CODEX_HOME,codexBin:process.env.COMMANDER_CODEX_BIN??'codex',transcriptPath:path.join(root,'commander-native.jsonl')}:{provider:'adapter'};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({run,profile:{cwd:root,adapter:'adapter.mjs',files,commander,runtimeRoot:brain,scenario:name,realAgent:real}}));
  let host=launch(root),killed=[],duplicate,duplicateRejected=false,ownershipRevoked=false;
  try{
    if(name==='auto-supervise'){
      await until(()=>fs.existsSync(path.join(root,'fault-window')));
      duplicate=launch(root,'duplicate-result.json');
      await until(()=>duplicate.exitCode!==null||duplicate.signalCode!==null,10000);
      assert.match(fs.readFileSync(duplicate.logPath,'utf8'),/commander_supervisor_already_running/);duplicateRejected=true;
      const state=read(path.join(root,'result.json.supervisor.json'));
      process.kill(state.child.pid,'SIGKILL');killed=[state.child.pid];
    }
    if(['host-kill','effect-window','unknown-readback'].includes(name)){
      await until(()=>fs.existsSync(path.join(root,'fault-window')));
      if(name==='effect-window'){
        duplicate=launch(root,'duplicate-result.json');
        await until(()=>duplicate.exitCode!==null||duplicate.signalCode!==null,10000);
        assert(!fs.existsSync(path.join(root,'duplicate-result.json')),'second live host must not settle the running workflow');
        assert.match(fs.readFileSync(duplicate.logPath,'utf8'),/commander_host_already_running/);
        assert.equal(host.exitCode,null);assert.equal(host.signalCode,null);
        assert.equal(lines(path.join(root,'decisions.jsonl')).filter(d=>d.sequence===1).length,1);
        assert.equal(lines(path.join(root,'readbacks.jsonl')).length,0);
        duplicateRejected=true;
        const revoked=await pool.query('SELECT pg_terminate_backend(pid) AS revoked FROM pg_stat_activity WHERE application_name=$1',[`commander-owner-${run.run_id}`]);
        assert.equal(revoked.rows.length,1);assert.equal(revoked.rows[0].revoked,true);
        await until(()=>host.exitCode!==null||host.signalCode!==null,10000);
        assert.equal(host.exitCode,1);assert.match(fs.readFileSync(host.logPath,'utf8'),/commander_host_ownership_lost/);
        assert(!fs.existsSync(path.join(root,'result.json')),'lost owner must not publish a terminal result');
        ownershipRevoked=true;
      }
      killed=await killDomain(root,host);
      assert(!fs.existsSync(path.join(root,'result.json')));
      host=launch(root);
    }
    await until(()=>fs.existsSync(path.join(root,'result.json')),real?590000:45000);
    const result=read(path.join(root,'result.json'));
    if(name==='auto-supervise'){await until(()=>read(path.join(root,'result.json.supervisor.json')).terminal_status==='completed');assert.equal(read(path.join(root,'result.json.supervisor.json')).starts,2);await until(()=>host.exitCode!==null||host.signalCode!==null);const replay=launch(root);await until(()=>replay.exitCode!==null||replay.signalCode!==null);assert.equal(replay.exitCode,0);assert.equal(read(path.join(root,'result.json.supervisor.json')).starts,2);}
    assert.equal(result.run_id,run.run_id);assert.equal(result.task_id,run.task_id);
    assert.equal(result.status,name==='unknown-readback'?'needs_review':'completed');
    assert.equal(fs.readFileSync(path.join(root,'prepare.effects'),'utf8'),'x');
    if(name==='unknown-readback'){assert(!fs.existsSync(path.join(root,'double.effects')));}
    else{assert.equal(fs.readFileSync(path.join(root,'double.effects'),'utf8'),'x');assert.equal(read(path.join(root,'double.json')).result.outputs.answer,42);}
    const actions=(await pool.query(`SELECT activity_key,state,identity,result,deadline_ms FROM ${schema}.commander_activity_actions WHERE run_id=$1 ORDER BY activity_key`,[run.run_id])).rows;
    assert.equal(actions.length,name==='unknown-readback'?1:2);
    assert(actions.every(a=>a.identity.run_id===run.run_id&&a.identity.task_id===run.task_id));
    assert(actions.every(a=>a.state===(name==='unknown-readback'?'reserved':'settled')));
    const checkpoints=(await pool.query(`SELECT workflow_uuid,status,recovery_attempts FROM ${dbosSchema}.workflow_status WHERE workflow_uuid=$1`,[result.workflow_id])).rows;
    assert.equal(checkpoints[0].status,'SUCCESS');if(killed.length)assert(Number(checkpoints[0].recovery_attempts)>=2);
    const decisions=lines(path.join(root,'decisions.jsonl'));
    if(!real){assert(decisions.every(d=>d.run_id===run.run_id));if(name==='commander-kill')assert.equal(decisions.filter(d=>d.sequence===1).length,2);
      if(killed.length)assert.equal(decisions.filter(d=>d.sequence===1).length,1);}
    const readbacks=lines(path.join(root,'readbacks.jsonl'));
    if(['effect-window','unknown-readback'].includes(name))assert.equal(readbacks.length,1);
    const proof={scenario:name,verdict:'pass',scope:real?'真实Codex Commander + 真实Codex Skill + Code；真实PG/DBOS':'确定性Commander/Agent执行夹具；真实PG/DBOS及进程故障',run_id:run.run_id,task_id:run.task_id,status:result.status,
      output:result.outputs??null,prepare_effect_count:fs.readFileSync(path.join(root,'prepare.effects'),'utf8').length,killed_processes:killed,duplicate_host_rejected:duplicateRejected,ownership_loss_revoked:ownershipRevoked,decisions,readbacks,actions,checkpoints};
    fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(proof,null,2));return proof;
  }finally{if(duplicate?.exitCode===null&&duplicate?.signalCode===null)duplicate.kill('SIGKILL');await killDomain(root,host);}
}
try{
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db,'cecelia_scratch');
  await pool.query(`CREATE SCHEMA ${schema}`);
  const db=await pool.connect();try{await db.query(`SET search_path TO ${schema}`);await db.query(fs.readFileSync(path.join(brain,'migrations/558_commander_activity_actions.sql'),'utf8'));}finally{db.release();}
  const {createCommanderActionStore}=await import('../../src/durable/commander-action-store.js');
  const storePool=new pg.Pool({connectionString:url.href,options:`-c search_path=${schema}`});
  try{
    const store=createCommanderActionStore(storePool), identity={task_id:randomUUID(),run_id:randomUUID(),activity_key:'store_probe',action_id:hash(randomUUID()),definition_sha256:'a'.repeat(64),input_sha256:'b'.repeat(64)};
    const deadline_ms=Date.now()+20000;
    for(let round=0;round<50;round++){
      const candidate=round===0?identity:{...identity,run_id:randomUUID(),action_id:hash(randomUUID())};
      const reserved=await Promise.all(Array.from({length:8},()=>store.reserve(candidate,{deadline_ms})));
      assert.equal(reserved.filter(r=>r.created).length,1,`concurrent reservation round ${round}`);
    }
    await assert.rejects(store.reserve({...identity,run_id:randomUUID(),activity_key:'other_tuple'},{deadline_ms}),/identity_conflict/);
    assert.equal((await store.reserve(identity,{deadline_ms:deadline_ms+10000})).record.deadline_ms,deadline_ms);
    await assert.rejects(store.reserve({...identity,input_sha256:'c'.repeat(64)},{deadline_ms}),/identity_conflict/);
    await store.settle(identity,{proof:'original'});
    await assert.rejects(store.settle(identity,{proof:'changed'}),/settlement_conflict/);
    assert.deepEqual((await store.reserve(identity,{deadline_ms})).record.result,{proof:'original'});
    fs.writeFileSync(path.join(artifactRoot,'action-store-verification.json'),JSON.stringify({verdict:'pass',concurrent_rounds:50,concurrent_workers:8,new_reservations_per_round:1,primary_key_collision_rejected:true,identity_conflict_rejected:true,original_deadline_retained:true,settlement_immutable:true},null,2));
  }finally{await storePool.end();}
  const results=[];for(const name of real?['normal']:['normal','commander-kill','host-kill','effect-window','unknown-readback','auto-supervise'])results.push(await scenario(name));
  const proof={verdict:'pass',artifact_root:artifactRoot,schema,dbos_schema:dbosSchema,scenarios:results.map(r=>({scenario:r.scenario,status:r.status,verdict:r.verdict,run_id:r.run_id}))};
  fs.writeFileSync(path.join(artifactRoot,'verification.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await pool.end();}
