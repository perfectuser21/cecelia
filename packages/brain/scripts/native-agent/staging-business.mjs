import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fixed candidate integration: the native CLI/worker, PostgreSQL and artifact are real.
// Notion, SSH and the model remain isolated boundaries; no production credentials are used.
export async function verifyStagingBusiness(env=process.env,{progress=()=>{},promptMarker=''}={}){
 let interrupted;const interrupt=()=>{interrupted='SIGTERM';};
 const previousHandoff=process.env.HANDOFF_DOCS_DIR;
 let phase='guard';const mark=(value,details={})=>{phase=value;progress({phase,...details});};
 const nightly=env.CI==='true'&&env.POSTGRES_INTEGRATION==='1'&&env.GITHUB_ACTIONS==='true'&&env.GITHUB_JOB==='brain-integration'&&env.GITHUB_WORKFLOW==='Deep Regression'&&env.DB_NAME==='cecelia_test';
 const scratch=env.CI==='true'&&(env.DB_NAME==='cecelia_scratch'||nightly)&&['127.0.0.1','localhost'].includes(env.DB_HOST);
 assert.equal(env.BRAIN_PREVIEW,'1','candidate isolation required');
 assert.equal(env.CECELIA_TICK_HARD_OFF,'1','candidate automation must be sealed');
 assert.ok(scratch||(env.DB_NAME==='cecelia_staging'&&env.DB_HOST==='stage-db'),'candidate database required');
 assert.match(env.EXPECTED_SHA??'',/^[a-f0-9]{40}$/);
 assert.equal(env.GIT_SHA,env.EXPECTED_SHA,'candidate source mismatch');
 for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','NOTION_API_KEY','NOTION_TOKEN','CECELIA_INTERNAL_TOKEN'])assert.ok(!env[key],'production credential inherited: '+key);
 assert.ok(env===process.env,'candidate runtime env must be process.env');
 process.once('SIGTERM',interrupt);
 const {default:pg}=await import('pg');
 const connections=new Map();
 const tracked=pool=>{const clients=new Set();connections.set(pool,clients);pool.on('connect',client=>clients.add(client));pool.on('remove',client=>clients.delete(client));pool.on('error',error=>progress({phase:'pool-error',message:error.message}));return pool;};
 const bounded=async(promise,ms,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timeout')),ms);})]);}finally{clearTimeout(timer);}};
 const closePool=async pool=>{if(!pool)return;progress({phase:'pool-shutdown',tracked_clients:connections.get(pool)?.size,total:pool.totalCount,waiting:pool.waitingCount});const ending=pool.end();try{await bounded(ending,1500,'pool shutdown');}catch(error){await bounded(Promise.allSettled([...(connections.get(pool)??[])].map(client=>client.end())),500,'owned client shutdown');throw error;}};
 const admin=tracked(new pg.Pool({host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD||'',max:2,connectionTimeoutMillis:3000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=3000'}));
 const schema='release_business_'+randomUUID().replaceAll('-','');
 const previousOptions=process.env.PGOPTIONS;
 let owned=false,pool,host,defaultPool,failure,taskId,deps,trigger,cancelNative;
 const checkInterrupted=()=>{if(interrupted)throw Error('candidate interrupted '+interrupted);};
 try{
  mark('database-connect');
  assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,env.DB_NAME);
  mark('create-schema',{schema});
  await admin.query(`CREATE SCHEMA ${schema}`);owned=true;
  pool=tracked(new pg.Pool({...admin.options,options:`-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=3000`,max:3}));
  for(const name of ['tasks','task_runs','workflows','task_events','device_locks','task_leases','working_memory','ops_agents','phone_registry','pending_actions','cecelia_events','initiative_runs']){
   mark('clone-table',{table:name});
   await admin.query(`CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
  }
  // Imports with a default pool are confined to this same owned schema, never public.
  process.env.PGOPTIONS=`-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=3000`;
  mark('import-runtime');
  const {createNativeAgentHostFixture}=await import('../../src/__tests__/helpers/native-agent-host-fixture.js');
  const {triggerNativeAgent,requestNativeAgentCancellation}=await import('../../src/native-agent-executor.js');trigger=triggerNativeAgent;cancelNative=requestNativeAgentCancellation;
  ({default:defaultPool}=await import('../../src/db.js'));tracked(defaultPool);
  checkInterrupted();mark('create-host');
  host=createNativeAgentHostFixture({accountRef:'candidate-integration'});
  mark('host-created',{root:host.root,schema});
  const id=randomUUID(),marker='CANDIDATE_BUSINESS_'+id+' '+promptMarker;taskId=id;
  const payload={native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['isolated-candidate']},qiumi_source:{body:marker}};
  await pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'Isolated candidate integration '+id,payload]);
  const read=async()=>(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
  deps={pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport};
  const deadline=Date.now()+30000;
  checkInterrupted();mark('start-native');
  const first=await triggerNativeAgent(await read(),deps);
  assert.ok(first.runId,'candidate native run was not reserved: '+JSON.stringify(first));
  mark('observe-native',{run_id:first.runId,reason:first.reason});
  let task,lastStatus;
  for(let i=0;i<100&&Date.now()<deadline&&!interrupted;i++){
   const statePath=join(host.root,'state',first.runId,'state.json');if(existsSync(statePath)){const nativeState=JSON.parse(readFileSync(statePath,'utf8'));if(nativeState.child&&nativeState.worker)mark('native-running',{run_id:first.runId,worker:nativeState.worker,child:nativeState.child});}
   task=await read();if(task.status!==lastStatus){lastStatus=task.status;mark('observe-native',{status:task.status,run_id:first.runId});}if(!['queued','in_progress'].includes(task.status))break;
   await triggerNativeAgent(task,deps);await new Promise(done=>setTimeout(done,50));
  }
  checkInterrupted();task=await read();assert.equal(task.status,'completed_no_pr',JSON.stringify({status:task.status,binding:task.result?.native_agent?.receipt}));
  mark('read-evidence');
  assert.equal(task.payload.run_id,first.runId);
  const receipt=task.result?.native_agent?.receipt;
  assert.equal(receipt?.execution_stopped,true);assert.equal(receipt?.result?.child_exited,true);
  assert.equal(receipt?.result?.exit_code,0);assert.equal(receipt?.result?.signal,null);
  const runs=(await pool.query('SELECT * FROM task_runs WHERE task_id=$1',[id])).rows;
  assert.equal(runs.length,1);assert.equal(runs[0].run_id,first.runId);assert.equal(runs[0].status,'success');
  assert.ok(runs[0].ended_at);assert.equal(runs[0].context.source,'native-agent');
  const file=join(host.root,'state',first.runId,'final.txt');
  assert.equal(realpathSync(file),file);assert.ok(lstatSync(file).isFile());
  const bytes=readFileSync(file);assert.equal(bytes.toString(),'实际fixture执行结果：完整输入已处理');
  assert.equal(task.result.receipt.text,bytes.toString());
  assert.equal(host.launches().filter(entry=>entry.text.includes(marker)).length,1);
  // Re-observation after a terminal result must not create a second execution.
  await triggerNativeAgent(task,deps);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM task_runs WHERE task_id=$1',[id])).rows[0].n,1);
  assert.equal(host.launches().filter(entry=>entry.text.includes(marker)).length,1);
  return {protocol:'brain-staging-business/v1',status:'passed',git_sha:env.EXPECTED_SHA,task_id:id,run_id:first.runId,task_status:task.status,run_status:runs[0].status,
   artifact_verified:true,artifact_sha256:createHash('sha256').update(bytes).digest('hex'),execution_stopped:true,external_services:'not_evaluated'};
 }catch(error){error.message='['+phase+'] '+error.message;failure=error;throw error;}
 finally{
  const errors=[];let safe=true;
  // 取消始终走原绑定CLI；未独立确认detached进程消失时保留其目录和schema。
  if(host&&taskId&&deps){try{
   const {groupMembers}=await import('./process.mjs');
   const {observeProcess}=await import('./store.mjs');
   let task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0];
   const runId=task?.result?.native_agent?.request?.run_id;
   if(runId){
    if(task.result.native_agent.receipt?.execution_stopped!==true){
     mark('cancel-native',{task_id:taskId,run_id:runId});
     await cancelNative(pool,taskId);
     for(let n=0;n<3;n++){await trigger(task,deps);task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0];if(task.result?.native_agent?.receipt?.execution_stopped===true)break;}
    }
    assert.equal(task.result?.native_agent?.receipt?.execution_stopped,true,'native stop receipt missing');
    assert.equal(task.result.native_agent.request.run_id,runId);
    const run=(await pool.query('SELECT status,ended_at FROM task_runs WHERE task_id=$1 AND run_id=$2',[taskId,runId])).rows;
    assert.equal(run.length,1);assert.ok(run[0].ended_at);
    const state=JSON.parse(readFileSync(join(host.root,'state',runId,'state.json'),'utf8'));
    const gone=identity=>{if(!identity)return true;const status=observeProcess(identity.pid,identity.birth);return ['absent','reused'].includes(status)||(status==='matching'&&groupMembers(identity.pid)?.length===0);};
    let stopped=false;for(let n=0;n<30;n++){if(gone(state.worker)&&gone(state.child)){stopped=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.ok(stopped,'native worker/child stop not independently confirmed');
    mark('execution-stopped',{task_id:taskId,run_id:runId,task_status:task.status,run_status:run[0].status,worker:state.worker,child:state.child});
   }
  }catch(error){safe=false;errors.push(error);progress({phase:'resources-preserved',schema,root:host.root,task_id:taskId,message:error.message});}}
  if(safe)mark('cleanup-safe',{schema});
  for(const [name,cleanup] of [['host',()=>{if(host&&safe)rmSync(host.root,{recursive:true,force:true});}],['default-pool',()=>closePool(defaultPool)],['owned-pool',()=>closePool(pool)],['schema',()=>owned&&safe?admin.query(`DROP SCHEMA ${schema} CASCADE`):undefined],['admin-pool',()=>closePool(admin)]]){
   try{mark('cleanup',{resource:name});await cleanup();}catch(error){errors.push(error);progress({phase:'cleanup-failed',resource:name,message:error.message});}
  }
  if(host&&process.env.HANDOFF_DOCS_DIR===join(host.root,'handoffs')){if(previousHandoff===undefined)delete process.env.HANDOFF_DOCS_DIR;else process.env.HANDOFF_DOCS_DIR=previousHandoff;}
  process.removeListener('SIGTERM',interrupt);
  if(previousOptions===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=previousOptions;
  if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'candidate owned-resource cleanup failed');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 verifyStagingBusiness(process.env,{progress:value=>process.stderr.write('STAGING_BUSINESS_PROGRESS '+JSON.stringify(value)+'\n')}).then(receipt=>process.stdout.write('STAGING_BUSINESS_RECEIPT '+JSON.stringify(receipt)+'\n')).catch(error=>{process.stderr.write('Candidate business verification failed: '+error.message+'\n');process.exitCode=1;});
}
