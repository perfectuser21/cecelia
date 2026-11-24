import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fixed candidate integration: the native CLI/worker, PostgreSQL and artifact are real.
// Notion, SSH and the model remain isolated boundaries; no production credentials are used.
export async function verifyStagingBusiness(env=process.env){
 const scratch=env.CI==='true'&&env.DB_NAME==='cecelia_scratch'&&['127.0.0.1','localhost'].includes(env.DB_HOST);
 assert.equal(env.BRAIN_PREVIEW,'1','candidate isolation required');
 assert.equal(env.CECELIA_TICK_HARD_OFF,'1','candidate automation must be sealed');
 assert.ok(scratch||(env.DB_NAME==='cecelia_staging'&&env.DB_HOST==='stage-db'),'candidate database required');
 assert.match(env.EXPECTED_SHA??'',/^[a-f0-9]{40}$/);
 assert.equal(env.GIT_SHA,env.EXPECTED_SHA,'candidate source mismatch');
 for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','NOTION_API_KEY','NOTION_TOKEN','CECELIA_INTERNAL_TOKEN'])assert.ok(!env[key],'production credential inherited: '+key);
 const {default:pg}=await import('pg');
 const admin=new pg.Pool({host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD||'',max:2,connectionTimeoutMillis:5000,query_timeout:10000});
 const schema='release_business_'+randomUUID().replaceAll('-','');
 const previousOptions=process.env.PGOPTIONS;
 let owned=false,pool,host,defaultPool,failure;
 try{
  assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,env.DB_NAME);
  await admin.query(`CREATE SCHEMA ${schema}`);owned=true;
  pool=new pg.Pool({...admin.options,options:`-c search_path=${schema}`,max:3});
  for(const name of ['tasks','task_runs','workflows','task_events','device_locks','task_leases','working_memory','ops_agents','phone_registry','pending_actions','cecelia_events','initiative_runs']){
   await admin.query(`CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
  }
  // Imports with a default pool are confined to this same owned schema, never public.
  process.env.PGOPTIONS=`-c search_path=${schema}`;
  const {createNativeAgentHostFixture}=await import('../../src/__tests__/helpers/native-agent-host-fixture.js');
  const {triggerNativeAgent}=await import('../../src/native-agent-executor.js');
  ({default:defaultPool}=await import('../../src/db.js'));
  host=createNativeAgentHostFixture({accountRef:'candidate-integration'});
  const id=randomUUID(),marker='CANDIDATE_BUSINESS_'+id;
  const payload={native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['isolated-candidate']},qiumi_source:{body:marker}};
  await pool.query("INSERT INTO tasks(id,title,task_type,status,tenant_id,executor_kind,payload) VALUES($1,$2,'qiumi_task','queued','fixture-native','external-worker',$3)",[id,'Isolated candidate integration '+id,payload]);
  const read=async()=>(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];
  const deps={pool,env:host.env,resolveHost:async()=>host.host,transport:host.transport};
  const deadline=Date.now()+30000;
  const first=await triggerNativeAgent(await read(),deps);
  assert.ok(first.runId,'candidate native run was not reserved: '+JSON.stringify(first));
  let task;
  for(let i=0;i<100&&Date.now()<deadline;i++){
   task=await read();if(!['queued','in_progress'].includes(task.status))break;
   await triggerNativeAgent(task,deps);await new Promise(done=>setTimeout(done,50));
  }
  task=await read();assert.equal(task.status,'completed_no_pr');
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
 }catch(error){failure=error;throw error;}
 finally{
  const errors=[];
  for(const cleanup of [()=>host?.close(),()=>defaultPool?.end(),()=>pool?.end(),()=>owned?admin.query(`DROP SCHEMA ${schema} CASCADE`):undefined,()=>admin.end()]){
   try{await cleanup();}catch(error){errors.push(error);}
  }
  if(previousOptions===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=previousOptions;
  if(errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],'candidate owned-resource cleanup failed');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 verifyStagingBusiness().then(receipt=>process.stdout.write('STAGING_BUSINESS_RECEIPT '+JSON.stringify(receipt)+'\n')).catch(error=>{process.stderr.write('Candidate business verification failed: '+error.message+'\n');process.exitCode=1;});
}
