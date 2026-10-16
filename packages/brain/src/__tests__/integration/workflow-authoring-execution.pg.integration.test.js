import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {invocationTaskPrompt} from '../../invocations/runtime.js';
import {randomUUID} from 'node:crypto';
import express from 'express';
import request from 'supertest';
import {authoringExecutionDatabase} from '../fixtures/authoring-execution-db.test.js';
import {createWorkflowAuthoringRouter} from '../../routes/workflow-authoring.js';
import {prepareInvocationDispatch,guardInvocationCallback} from '../../invocations/runtime.js';
import {finishRun} from '../../lib/task-run.js';
import {finalizeTask} from '../../lib/task-terminal.js';
let f;afterEach(async()=>{await f?.close();f=null;});
export async function startPureAuthoring(f,invocationOptions={},tenantId='default'){
 const id=randomUUID();
 if(tenantId!=='default')f.definition.tenant_id=tenantId;
 await f.pool.query("INSERT INTO tasks(id,title,status,task_type,claimed_by,payload) VALUES($1,$2,'in_progress','research','fixture',$3)",[id,`自动装配${id}`,{workflow_authoring:true,tenant_id:tenantId}]);
 const app=express();app.use(express.json());app.use('/api/brain/workflow-authoring',createWorkflowAuthoringRouter({db:f.pool,freezeOptions:{readFile:f.reader},invocationOptions:{readFile:f.reader,probeRuntime:async()=>({ready:true}),...invocationOptions}}));
 const post=(path,body)=>request(app).post(`/api/brain/workflow-authoring/runs/${id}${path}`).set('x-tenant-id',tenantId).send(body);
 let initialized=await post('/init',{operation:'create',goal:'无副作用纯Skill自动装配',actor:'fixture',assembly_mode:true,registration_protocol:'definition-freeze-v1',execution_protocol:'workflow-authoring-execution-v1',validation_input:{text:'abc'}});
 expect(initialized.status).toBe(200);
 const submit=async(stage,output,revision)=>{const r=await post('/submit',{stage,output,revision,submission_id:`${stage}-one`});expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;};
 await submit('intake',{goal:'纯Skill产物验真',inputs:['text'],outputs:['text'],acceptance:['ABC'],capability_id:f.definition.capability_id},0);
 await submit('reuse',{search_terms:['pure'],candidates:[{kind:'skill',id:f.skill,decision:'reuse',reason:'已有固定纯Skill'}]},1);
 const compose=await submit('compose',{definition:f.definition},2);
 return {id,app,post,compose};
}
it('实际HTTP compose入口自动冻结候选并幂等排队，无需人工提交build或抄验证任务ID',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 expect(run.compose.automatic?.status).toBe('awaiting_execution');
 const owner=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0].result.workflow_authoring_candidate;
 expect(owner.authoring_task_id).toBe(run.id);
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
 const resumed=await run.post('/advance',{});expect(resumed.status).toBe(200);
 expect(resumed.body.status).toBe('awaiting_execution');
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
 expect((await f.pool.query('SELECT status FROM workflows WHERE id=$1',[owner.workflow_id])).rows[0].status).toBe('paused');
});
export async function settleInvocation(f,taskId,actualOutput){
 const task=(await f.pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0],runId=`authoring-${randomUUID()}`;
 const options={readFile:f.reader,probeRuntime:async()=>({ready:true})};
 const {envelope:e}=await prepareInvocationDispatch(f.pool,task,runId,options);
 const result=typeof actualOutput==='function'?await actualOutput(task,runId):actualOutput??{protocol:'skill-invocation-result-v1',task_id:taskId,run_id:runId,tenant_id:e.tenant_id,target:e.target,input_sha256:e.input_sha256,
  activities:e.activities.map(a=>({key:a.key,skill_sha256:a.skill_sha256,outputs:{text:'ABC'}})),outputs:{text:'ABC'}};
 await guardInvocationCallback(f.pool,{task_id:taskId,run_id:runId,status:'AI Done',result});
 await finishRun({runId,status:'success',exitCode:0,result:{source:actualOutput?'actual-codex-cli':'callback-contract-regression'}},{pool:f.pool});
 await finalizeTask(f.pool,taskId,'completed',{relay:false});
 return runId;
}
it('默认driver在真实账本回读齐备后自动verify和测试资格登记，paused不冒充正式启用',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 const first=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation'")).rows[0];
 await settleInvocation(f,first.id);
 const next=await run.post('/advance',{});expect(next.body.status).toBe('awaiting_execution');
 const pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;
 expect(pending).toHaveLength(1);await settleInvocation(f,pending[0].id);
 const final=await run.post('/advance',{});expect(final.status).toBe(200);expect(final.body.status).toBe('completed');
 const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0];
 expect(row.result.workflow_authoring.stage).toBe('completed');
 expect(row.result.workflow_authoring.outputs.register.test_qualification).toMatchObject({status:'verified',formal_release:false});
 expect((await f.pool.query('SELECT status FROM workflows')).rows.map(w=>w.status)).toEqual(['paused']);
 expect((await f.pool.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
});
it('目录真实实体ID映射可信owner并在request_key去重前canonicalize',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0];
 const owner=row.result.workflow_authoring_candidate,digest=row.result.workflow_authoring.outputs.compose.definition_sha256;
 const {resolveInvocation}=await import('../../invocations/resolve.js');const {invoke}=await import('../../invocations/store.js');
 const options={readFile:f.reader,probeRuntime:async()=>({ready:true})};
 for(const target of [{kind:'workflow',id:owner.workflow_id},{kind:'activity',id:owner.slots[0].activity_id}]){
  const body={mode:'candidate',authoring_task_id:run.id,compose_sha256:digest,input:{text:'abc'},target,request_key:`catalog-${target.kind}`};
  const resolution=await resolveInvocation(f.pool,body,'default',options);expect(resolution.readiness).toBe('ready');
  const first=await invoke(f.pool,body,'default',options),again=await invoke(f.pool,{...body,target:resolution.target},'default',options);
  expect(again.task_id).toBe(first.task_id);expect(again.deduplicated).toBe(true);
 }
});
it('失败执行和compose后撤权结构化停止，不新增调用或自动重发',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 const inv=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation'")).rows[0];
 await f.pool.query("UPDATE tasks SET status='failed' WHERE id=$1",[inv.id]);
 let response=await run.post('/advance',{});expect(response.body.status).toBe('blocked');
 expect(response.body.gaps).toContainEqual(expect.objectContaining({code:'candidate_execution_failed'}));
 await f.pool.query("UPDATE tasks SET claimed_by=NULL WHERE id=$1",[run.id]);
 response=await run.post('/advance',{});expect(response.body.status).toBe('blocked');
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
});

it('alpha租户真实HTTP自动链固定实际租户，Activity停用后拒派发',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f,{},'alpha');
 const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0];
 expect(row.result.workflow_authoring_execution.tenant_id).toBe('alpha');
 await f.pool.query("UPDATE activities SET status='deprecated' WHERE id=$1",[row.result.workflow_authoring_candidate.slots[0].activity_id]);
 const response=await run.post('/advance',{});expect(response.body.status).toBe('blocked');
 expect(response.body.gaps).toContainEqual({code:'candidate_activity_authority_revoked'});
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
});

it.runIf(process.env.AUTHORING_REAL_CODEX==='1')('固定Git纯Skill经实际Codex与默认HTTPdriver完成资格，真实目录调用回读ABC',async()=>{
 f=await authoringExecutionDatabase();const dir=mkdtempSync(join(tmpdir(),'authoring-fixed-skill-'));
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  mkdirSync(join(dir,'skills/pure'),{recursive:true});mkdirSync(join(dir,'contracts'));
  writeFileSync(join(dir,'skills/pure/SKILL.md'),f.content);
  writeFileSync(join(dir,'contracts/pure.json'),JSON.stringify(Object.fromEntries(Object.entries(f.definition).filter(([key])=>key!=='source'))));
  git(['init','-b','cp-authoring-fixture']);git(['config','user.name','Authoring fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-m','test: fixed pure authoring skill']);
  f.definition.source.revision=git(['rev-parse','HEAD']);f.reader=source=>git(['show',`${source.revision}:${source.path}`]);
  const run=await startPureAuthoring(f),{executeCodex}=createRequire(import.meta.url)('../../../scripts/codex-bridge/codex-bridge.cjs');
  const actual=async(task,runId)=>{
   const prompt=invocationTaskPrompt(task,runId);expect(prompt).toContain(f.content);
   const value=await executeCodex(process.env.CODEX_HOME,prompt,{workDir:dir,sandbox:'read-only',timeoutMs:180000});return value.output;
  };
  for(let index=0;index<2;index++){
   const pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued' ORDER BY created_at")).rows;
   expect(pending).toHaveLength(1);await settleInvocation(f,pending[0].id,actual);
   const advanced=await run.post('/advance',{});expect(advanced.body.status).toBe(index===0?'awaiting_execution':'completed');
  }
  const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0],owner=row.result.workflow_authoring_candidate;
  const {invoke,invocationReadback}=await import('../../invocations/store.js');
  const accepted=await invoke(f.pool,{mode:'candidate',target:{kind:'workflow',id:owner.workflow_id},authoring_task_id:run.id,
   compose_sha256:owner.definition_sha256,input:{text:'abc'},request_key:'real-directory-call'},'default',{readFile:f.reader,probeRuntime:async()=>({ready:true})});
  const runId=await settleInvocation(f,accepted.task_id,actual),readback=await invocationReadback(f.pool,{taskId:accepted.task_id,tenantId:'default'});
  expect(readback.outputs).toEqual({text:'ABC'});expect(readback.status).toBe('completed');
  const {readAuthoringReadiness}=await import('../../workflow-authoring/execution-proof.js');
  const proof=await readAuthoringReadiness(f.pool,run.id,{readFile:f.reader,probeRuntime:async()=>({ready:true})});
  expect(proof.qualified).toBe(true);expect(proof.evidence.spans).toHaveLength(2);
  const evidence={actual_process:true,authoring_task_id:run.id,source_revision:f.definition.source.revision,owner,
   qualification:row.result.workflow_authoring.outputs.register,proof,registered_directory_call:{task_id:accepted.task_id,run_id:runId,readback},schema:f.schema};
  writeFileSync('/tmp/aa5ce7cb-real-authoring-evidence.json',JSON.stringify(evidence,null,2));
  process.stdout.write(JSON.stringify({actual_process:true,authoring_task_id:run.id,task_ids:proof.evidence.tasks,runs:proof.evidence.runs,
   spans:proof.evidence.spans.length,outputs:readback.outputs,qualified:proof.qualified,formal_release:false,source_revision:f.definition.source.revision})+'\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
},600000);
it('fresh准入后Skill撤权，最终事务拒登记资格；多slot单轮固定字节和runtime只读一次',async()=>{
 f=await authoringExecutionDatabase();f.definition.activities.push({...structuredClone(f.definition.activities[0]),key:'again',input_mapping:{text:'$activity.uppercase.text'}});f.definition.output_mapping={text:'$activity.again.text'};
 let armed=false;
 const probeRuntime=async()=>{
  if(armed){const row=(await f.pool.query("SELECT result FROM tasks WHERE payload->>'workflow_authoring'='true'")).rows[0];
   if(row?.result.workflow_authoring.stage==='register')await f.pool.query("UPDATE skill_registry SET status='deprecated' WHERE id=$1",[f.skill]);}
  return {ready:true};
 };
 const run=await startPureAuthoring(f,{probeRuntime});expect(run.compose.automatic.status,JSON.stringify(run.compose.automatic)).toBe('awaiting_execution');
 let pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;
 await settleInvocation(f,pending[0].id);await run.post('/advance',{});
 pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;expect(pending).toHaveLength(2);
 for(const item of pending)await settleInvocation(f,item.id);
 const {readAuthoringReadiness}=await import('../../workflow-authoring/execution-proof.js');let reads=0,probes=0;
 const proof=await readAuthoringReadiness(f.pool,run.id,{readFile:async source=>{reads++;return f.reader(source);},probeRuntime:async()=>{probes++;return {ready:true};}});
 expect(proof.status).toBe('verified');expect(proof.qualified).toBe(false);expect(reads).toBe(1);expect(probes).toBe(1);
 armed=true;const final=await run.post('/advance',{});expect(final.body.status).toBe('blocked');
 const state=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0].result.workflow_authoring;
 expect(state.stage).toBe('register');expect(state.outputs.register).toBeUndefined();
 expect((await f.pool.query('SELECT status FROM workflows')).rows.map(w=>w.status)).toEqual(['paused']);
});
it('服务器修复轮次撤销旧资格并真实新run复验，同轮未知不增单且保留历史证据',async()=>{
 f=await authoringExecutionDatabase();const run=await startPureAuthoring(f);
 for(let index=0;index<2;index++){
  const pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;await settleInvocation(f,pending[0].id);await run.post('/advance',{});
 }
 const {definitionDigest}=await import('../../workflow-authoring/contracts.js');
 const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0],owner=row.result.workflow_authoring_candidate;
 const repairedAt=(await f.pool.query('SELECT clock_timestamp() AS at')).rows[0].at.getTime(),gapKey='fixed-ref-one';
 const identity={protocol:'workflow-authoring-revalidation-v1',tenant_id:'default',authoring_task_id:run.id,definition_sha256:owner.definition_sha256,
  input_sha256:definitionDigest({text:'abc'}),candidate_owner:owner,gap_id:definitionDigest([gapKey])};
 const repair_id=definitionDigest({...identity,protocol:'workflow-assembly-repair-v1',sequence:1});
 const attempt={...identity,repair_id},request={...attempt,attempt_id:definitionDigest(attempt),requested_at:new Date(repairedAt).toISOString()};
 const reconcile={protocol:'workflow-assembly-reconcile-v1',repair_sequence:1,revalidation_request:request,
  issues:{[gapKey]:{key:gapKey,repaired_at:repairedAt,target_version:`candidate:${owner.definition_sha256}`,definition_sha256:owner.definition_sha256}}};
 await f.pool.query("UPDATE tasks SET status='completed',result=result||jsonb_build_object('workflow_assembly_reconcile',$2::jsonb) WHERE id=$1",[run.id,reconcile]);
 const {readAuthoringReadiness}=await import('../../workflow-authoring/execution-proof.js');
 const old=await readAuthoringReadiness(f.pool,run.id,{readFile:f.reader,probeRuntime:async()=>({ready:true})});expect(old.qualified).toBe(false);
 let advanced=await run.post('/advance',{});expect(advanced.body.status,JSON.stringify(advanced.body)).toBe('awaiting_execution');
 await run.post('/advance',{});expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(3);
 for(let index=0;index<2;index++){
  const pending=(await f.pool.query("SELECT id FROM tasks WHERE payload?'invocation' AND status='queued'")).rows;await settleInvocation(f,pending[0].id);
  advanced=await run.post('/advance',{});
 }
 expect(advanced.body.status,JSON.stringify(advanced.body)).toBe('completed');
 const proof=await readAuthoringReadiness(f.pool,run.id,{readFile:f.reader,probeRuntime:async()=>({ready:true})});expect(proof.qualified).toBe(true);
 expect(new Date(proof.verification_at).getTime()).toBeGreaterThan(repairedAt);
 expect((await f.pool.query("SELECT payload FROM task_events WHERE event_type='authoring_revalidation_started'")).rows[0].payload.previous_qualification.test_qualification.status).toBe('verified');
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(4);
});
it('受理调用与record之间attempt切换，旧任务保留原账但不得污染新manifest',async()=>{
 f=await authoringExecutionDatabase();const {createRoutedTask}=await import('../../work-routing-store.js');
 const run=await startPureAuthoring(f,{createTask:async(...args)=>{
  const routed=await createRoutedTask(...args),inv=args[1].task.payload.invocation;
  const execution={protocol:'workflow-authoring-execution-v1',tenant_id:'default',definition_sha256:inv.envelope.compose_sha256,
   input:{text:'abc'},input_sha256:inv.envelope.input_sha256,attempt_id:'b'.repeat(64),invocations:[]};
  await f.pool.query("UPDATE tasks SET result=result||jsonb_build_object('workflow_authoring_execution',$2::jsonb) WHERE id=$1",[inv.envelope.authoring_task_id,execution]);return routed;
 }});
 expect(run.compose.automatic).toMatchObject({status:'blocked',gaps:[{code:'revalidation_attempt_changed'}]});
 const row=(await f.pool.query('SELECT result FROM tasks WHERE id=$1',[run.id])).rows[0];
 expect(row.result.workflow_authoring_execution.invocations).toHaveLength(0);
 expect((await f.pool.query("SELECT count(*)::int n FROM tasks WHERE payload?'invocation'")).rows[0].n).toBe(1);
});
