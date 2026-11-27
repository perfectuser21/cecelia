import {afterAll,afterEach,it,expect,vi} from 'vitest';

// 深度回归有两座隔离库。API 的私有 schema 与 DBOS 宿主必须使用同一座 scratch。
vi.hoisted(() => {
 if (process.env.CI !== 'true' || !process.env.TEST_DB_URL) return;
 const target = new URL(process.env.TEST_DB_URL);
 if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
     !['localhost', '127.0.0.1'].includes(target.hostname) ||
     target.pathname !== '/cecelia_scratch' || target.search || target.hash) {
   throw Error('foundation_fixture_requires_local_scratch');
 }
 vi.stubEnv('DB_NAME', 'cecelia_scratch');
 vi.stubEnv('DB_HOST', target.hostname);
 vi.stubEnv('DB_PORT', target.port || '5432');
 vi.stubEnv('DB_USER', decodeURIComponent(target.username));
 vi.stubEnv('DB_PASSWORD', decodeURIComponent(target.password));
});
afterAll(() => vi.unstubAllEnvs());
import {workflowFoundationDatabase} from '../fixtures/workflow-foundation-db.js';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runStandaloneWorkerOnce} from '../../../scripts/standalone-skill/worker.mjs';
import {digest} from '../../orchestrator/commander-decision.js';
import {createFoundationTask} from '../../workflow-foundation/registry.js';
import {dispatchNotionLeadgen,ENGLISH_TASKS_DB} from '../../notion-leadgen-dispatch.js';
import path from 'node:path';
import {foundationHttpFixture,until} from '../fixtures/workflow-foundation-http.js';
import processState from '../../orchestrator/activity-supervisor-state.cjs';
import {unblockTask} from '../../task-updater.js';
import {recoverPausedFoundationTasks} from '../../workflow-foundation/claim.js';
import {buildPauseLowPriorityQuery} from '../../alertness/escalation.js';
let fixture;
afterEach(async()=>{await fixture?.close();fixture=null;});

it('新底座Workflow使用既有冻结登记，重复登记复用同一身份和版本',async()=>{
 fixture=await workflowFoundationDatabase();
 const first=await fixture.register(),second=await fixture.register();
 expect(first.registration_protocol).toBe('definition-freeze-v1');
 expect(second.workflow_id).toBe(first.workflow_id);
 expect(second.current_definition_version_id).toBe(first.current_definition_version_id);
 expect(second.replayed).toBe(true);
 const count=await fixture.pool.query('SELECT count(*)::integer AS n FROM workflows WHERE key=$1',[fixture.key]);
 expect(count.rows[0].n).toBe(1);
 expect((await fixture.pool.query('SELECT * FROM task_runs')).rows).toHaveLength(0);
 await fixture.pool.query("UPDATE tasks SET status='blocked' WHERE id=$1",[fixture.task]);
 expect((await unblockTask(fixture.task,{db:fixture.pool})).success).toBe(true);
 expect((await fixture.pool.query('SELECT status FROM tasks WHERE id=$1',[fixture.task])).rows[0].status).toBe('queued');
},30000);

it('认证API登记→冻结Release→幂等Task→真实Worker/DBOS/产物→原Task及Run闭环',async()=>{
 fixture=await foundationHttpFixture();
 expect((await fixture.request('/workflow-foundation/catalog',undefined,{auth:false})).status).toBe(401);
 const {registration,release}=await fixture.publish();
 const input={workflow_id:registration.workflow_id,release_id:release.id,input:{label:'真实协议验收'},idempotency_key:'same-request'};
 const pair=await Promise.all([fixture.request('/workflow-foundation/tasks',input),fixture.request('/workflow-foundation/tasks',input)]);
 expect(pair.map(r=>r.status).sort()).toEqual([200,201]);
 const taskId=pair[0].body.task.id;expect(pair[1].body.task.id).toBe(taskId);
 expect((await fixture.request('/workflow-foundation/claim',{machine_id:'other-host',task_id:taskId})).body).toEqual({job:null});
 expect((await fixture.request('/workflow-foundation/tasks',{...input,input:{label:'冲突'}})).status).toBe(409);
 const execution=await fixture.worker(taskId).done;
 expect(execution,JSON.stringify(execution)).toMatchObject({code:0});
 const task=(await fixture.pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])).rows[0];
 expect(task.status,JSON.stringify(task.result.foundation_reconciliation)).toBe('completed');
 const run=task.result.foundation_runner.run_id,workspace=path.join(fixture.stateRoot,run,'bundle');
 expect(JSON.parse(fs.readFileSync(path.join(workspace,'double.json'),'utf8')).result.outputs.answer).toBe(42);
 for(const name of ['prepare','double'])expect(fs.readFileSync(path.join(workspace,`${name}.effects`),'utf8')).toBe('x');
 const rows=(await fixture.pool.query('SELECT run_id,status,ended_at FROM task_runs WHERE task_id=$1',[taskId])).rows;
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({run_id:run,status:'success'});expect(rows[0].ended_at).toBeTruthy();
 expect((await fixture.pool.query(`SELECT status FROM ${fixture.dbosSchema}.workflow_status WHERE workflow_uuid=$1`,[`commander-foundation:${run}`])).rows[0].status).toBe('SUCCESS');
 expect((await fixture.request(`/workflow-foundation/tasks/${taskId}/reconcile`,{machine_id:'fixture-host',run_id:run})).body.status).toBe('completed');
 expect((await fixture.request(`/workflow-foundation/tasks/${taskId}/reconcile`,{machine_id:'fixture-host',run_id:run,status:'completed'})).status).toBe(400);
},90000);

it('同一 Notion 页并发仅登记一个轻量任务并保留租户与原页，改输入须拒绝',async()=>{
 fixture=await foundationHttpFixture({workflowKey:'douyin_video_discovery',releaseTarget:'mmv'});
 const {registration,release}=await fixture.publish();
 const page=randomUUID();
 const input={workflow_id:registration.workflow_id,release_id:release.id,input:{binding_key:'test_phone',business:{keyword:'验收',max_candidates:1}},idempotency_key:'notion-101:'+page};
 const source={notionPageId:page,notionTenantId:'tenant-fixture'};
 const submit=(body=input,authority=source)=>createFoundationTask(fixture.pool,body,authority);
 const results=await Promise.all([submit(),submit()]);
 const taskId=results[0].task.id;
 expect(results.map(x=>x.created).sort()).toEqual([false,true]);
 expect(results[1].task.id).toBe(taskId);
 expect((await fixture.pool.query("SELECT id,tenant_id,payload FROM tasks WHERE payload->>'notion_page_id'=$1",[page])).rows).toEqual([
  expect.objectContaining({id:taskId,tenant_id:'tenant-fixture',payload:expect.objectContaining({source:'notion_leadgen_101',notion_page_id:page})})
 ]);
 await expect(submit({...input,input:{binding_key:'test_phone',business:{keyword:'输入漂移',max_candidates:1}}})).rejects.toMatchObject({code:'foundation_idempotency_conflict'});
 await expect(submit(input,{...source,notionTenantId:'other'})).rejects.toMatchObject({code:'foundation_idempotency_conflict'});
},30000);

it('B站只读任务只认固定作品和实装发布，通过原 worker 状态账保留一次原生证据',async()=>{
 const source='android_bilibili_verify_existing',machine_id='xian-m4',bvid='BV1cLpG6cEHH';
 fixture=await foundationHttpFixture({workflowKey:source,releaseTarget:machine_id,readonlyVerification:true});
 const {registration,release}=await fixture.publish({environment:'production'});
 const gate=(await fixture.request('/releases/'+release.id+'/gate')).body;
 const request={workflow_id:registration.workflow_id,release_id:release.id,observation_id:gate.current_observation_id,bvid};
 const path='/workflow-foundation/standalone';
 const admit=(body=request,options)=>fixture.request(path+'/bilibili-verify-existing',body,options);
 expect((await admit(request,{auth:false})).status).toBe(401);
 expect((await admit({...request,bvid:'BV1cLpG6cEHJ'})).status).toBe(400);
 expect((await admit({...request,action:'publish'})).status).toBe(400);
 expect((await admit({...request,observation_id:randomUUID()})).status).toBe(409);
 const pair=await Promise.all([admit(),admit()]);
 expect(pair.map(r=>r.status).sort()).toEqual([200,201]);
 const task=pair[0].body.task;
 expect(pair[1].body.task.id).toBe(task.id);
 expect(task.payload).toMatchObject({source,workflow_key:source,scope:{workflow_key:source,bvid,operation:'verify_existing'}});
 expect((await fixture.request('/workflow-foundation/claim',{machine_id,task_id:task.id})).body).toEqual({job:null});
 const claim=(machine_id,sources)=>fixture.request(path+'/claim',{machine_id,...(sources?{sources}:{})});
 expect((await claim(machine_id)).body).toEqual({job:null});
 expect((await claim('mmv',[source])).body).toEqual({job:null});
 const claims=await Promise.all([claim(machine_id,[source]),claim(machine_id,[source])]);
 const job=claims.find(value=>value.body.job)?.body.job;
 expect(claims.filter(value=>value.body.job)).toHaveLength(1);
 expect(job).toMatchObject({task_id:task.id,workflow_key:source,release_id:release.id,input:{scope:task.payload.scope,skill:task.payload.skill}});
 const definition={...job.definition,actor:job.claimer,attempt_key:task.id+':1'};
 const startBody={task_id:task.id,claimer:job.claimer,claimed_at:job.claimed_at,definition,standalone:job.input};
 const start=body=>fixture.request('/runs/'+job.run_id+'/start-skill',body);
 expect((await start({...startBody,standalone:{...job.input,scope:{...job.input.scope,bvid:'BV1cLpG6cEHJ'}}})).status).toBe(409);
 const started=await start(startBody);
 expect(started.status,JSON.stringify(started.body)).toBe(201);
 const finish=receipt=>fixture.request(path+'/finish',{machine_id,receipt});
 const receipt={task_id:task.id,run_id:job.run_id,status:'completed',summary:'原生确认本人私密作品正常播放',evidence:[]};
 const manifest={observation:{protocol:'bilibili-verify-existing/v1',run_id:job.run_id,source_run_id:'rpa-white-bili-uid-693d858279ad',
  owner:job.run_id,profile:'yueshengyun-work',serial:'e6c7ef34',bvid,owner_uid:'3546824935738234',
  title:'傍晚的颜色，慢一点也很好',visibility:'private',duration_seconds:10,outward_actions:0},
  files:Object.fromEntries(['account','author','detail','editor','settings','player'].map(key=>[key,{path:key+(key==='player'?'.png':'.xml'),sha256:'c'.repeat(64)}]))};
 receipt.evidence=['sha256:'+digest(manifest)];
 expect((await finish(receipt)).status).toBe(409);
 const observedAt=new Date().toISOString();
 const attest=proof=>fixture.request(path+'/attest-bilibili-verify-existing',{machine_id,task_id:task.id,run_id:job.run_id,
  started_at:observedAt,ended_at:observedAt,manifest:proof});
 expect((await attest({...manifest,observation:{...manifest.observation,outward_actions:1}})).status).toBe(400);
 let ran=0,closed=0;
 const saved=[],sent=[];
 const execution=await runStandaloneWorkerOnce({machineId:machine_id,sources:[source],
  request:async(action,body)=>action==='claim'?{job}:(await fixture.request(path+'/'+action,body)).body,
  receipts:{pending:async()=>null,save:async value=>saved.push(value),sent:async value=>sent.push(value)},
  provider:async()=>({
   startHost:async()=>({connectionPath:'/scratch/provider.sock',close:async()=>{
    closed++;
    return {task_id:task.id,run_id:job.run_id,local_released:true,central_released:true,native_return_unknown:false};
   }}),
   runAgent:async()=>{ran++;},
   verifyBusiness:async()=>{
    expect((await attest(manifest)).body).toEqual({attested:true,evidence:receipt.evidence[0]});
    expect((await attest(manifest)).body).toEqual({attested:true,evidence:receipt.evidence[0]});
    expect((await finish({...receipt,evidence:['sha256:'+'0'.repeat(64)]})).status).toBe(409);
    return {summary:receipt.summary,evidence:receipt.evidence};
   },
  }),
 });
 expect(execution).toEqual({status:'completed'});
 expect([ran,closed]).toEqual([1,1]);
 expect(saved).toEqual([receipt]);
 expect(sent).toEqual([receipt]);
 expect((await finish(receipt)).body).toEqual({status:'completed'});
 const tasks=(await fixture.pool.query('SELECT status,result FROM tasks WHERE id=$1',[task.id])).rows;
 expect(tasks).toMatchObject([{status:'completed',result:{bilibili_verification:{manifest},standalone_receipt:receipt}}]);
 expect(tasks[0].result.handoff).toBeUndefined();
 const runs=(await fixture.pool.query('SELECT status,ended_at,run_id FROM task_runs WHERE task_id=$1',[task.id])).rows;
 expect(runs).toMatchObject([{status:'success',run_id:job.run_id,ended_at:expect.any(Date)}]);
 const reconciliation=await fixture.request('/runs/'+job.run_id+'/reconciliation');
 expect(reconciliation.body).toMatchObject({business_outcome:'pass',evidence_status:'verified',span_count:1,gaps:[]});
},30000);

it.each([
 ['101','douyin_video_discovery','关键词：真实事务验收\n候选上限：1'],
 ['102','douyin_video_processing','来源运行：accepted-discovery-101'],
 ['103','douyin_comment_scoring','来源运行：accepted-collection-102'],
])('真实英语 Tasks %s 授权来源与目标租户分离，同页并发仍只有一个目标 task',async(stage,workflowKey,fields)=>{
 fixture=await foundationHttpFixture({workflowKey,releaseTarget:'mmv',directInput:true});
 const {registration,release}=await fixture.publish();
 const pageId=randomUUID(), tenantId=randomUUID();
 const opts={stage,pageId,title:'隔离悦升'+stage,body:'公司：悦升\n'+fields,
  tenantId:'default',sourceDatabaseId:ENGLISH_TASKS_DB,bindings:{悦升:{source_tenant_id:'default',tenant_id:tenantId,
   ...(stage==='101'?{}:{source_tenant_stage:stage}),
   workflow_id:registration.workflow_id,release_id:release.id,binding_key:'approved-'+stage}}};
 const submit=(request=opts)=>dispatchNotionLeadgen(fixture.pool,request);
 const [first,second]=await Promise.all([submit(),submit()]);
 expect(second.taskId).toBe(first.taskId);
 await expect(submit({...opts,bindings:{悦升:{...opts.bindings.悦升,tenant_id:randomUUID()}}}))
  .rejects.toMatchObject({code:'foundation_idempotency_conflict'});
 const rows=(await fixture.pool.query("SELECT id,tenant_id,status,payload FROM tasks WHERE payload->>'notion_page_id'=$1",[pageId])).rows;
 expect(rows).toEqual([expect.objectContaining({id:first.taskId,tenant_id:tenantId,status:'queued',
  payload:expect.objectContaining({source:'notion_leadgen_'+stage,notion_page_id:pageId})})]);
 expect((await fixture.pool.query('SELECT count(*)::int AS count FROM task_runs WHERE task_id=$1',[first.taskId])).rows[0].count).toBe(0);
},30000);

it.each([
 ['101','douyin_video_discovery',{keyword:'验收',max_candidates:1},['验收']],
 ['102','douyin_video_processing',{source_run:'discovery-source-1'},[]],
 ['103','douyin_comment_scoring',{source_run:'comment-source-1'},[]],
 ['104','douyin_lead_outreach',{order_id:'recFixtureOrder'},[]],
])('Notion %s 单只可由登记该流程的直执行宿主领取，可信终态回原页',async(stage,workflowKey,business,approvedKeywords)=>{
 fixture=await foundationHttpFixture({workflowKey,releaseTarget:'mmv',directInput:true});
 const {registration,release}=await fixture.publish();
 const notionPageId=randomUUID();
 const {task}=await createFoundationTask(fixture.pool,{
  workflow_id:registration.workflow_id,release_id:release.id,input:{binding_key:'test_phone',business},
  idempotency_key:`notion-${stage}:${notionPageId}`
 },{notionPageId,notionTenantId:'tenant-fixture',notionWorkflowKey:workflowKey});
 if(stage==='103')await fixture.pool.query(`UPDATE tasks SET task_type='workflow_dispatch',status='blocked',
  payload=jsonb_build_object('source','notion_leadgen_101'),result=jsonb_build_object('standalone_claim',jsonb_build_object('machine_id','us-mac-m4'))
  WHERE id=(SELECT id FROM tasks WHERE id<>$1 ORDER BY created_at LIMIT 1)`,[task.id]);
 expect((await fixture.request('/workflow-foundation/claim',{machine_id:'us-mac-m4',task_id:task.id})).body).toEqual({job:null});
 expect((await fixture.request('/workflow-foundation/standalone/claim',{machine_id:'other'})).body).toEqual({job:null});
 if(stage!=='101')expect((await fixture.request('/workflow-foundation/standalone/claim',{machine_id:'us-mac-m4'})).body).toEqual({job:null});
 const take=()=>fixture.request('/workflow-foundation/standalone/claim',{machine_id:'us-mac-m4',sources:[`notion_leadgen_${stage}`]});
 const pair=await Promise.all([take(),take()]);
 const jobs=pair.map(value=>value.body.job).filter(Boolean);
 expect(jobs,JSON.stringify(pair)).toHaveLength(1);
 const job=jobs[0];
 expect(job).toMatchObject({task_id:task.id,machine_id:'us-mac-m4',release_id:release.id});
 const receipt={task_id:task.id,run_id:job.run_id,status:'completed',summary:'隔离读回成功',evidence:['fixture:readback']};
 const finish=()=>fixture.request('/workflow-foundation/standalone/finish',{machine_id:'us-mac-m4',receipt});
 expect((await finish()).body.error).toBe('standalone_run_unconfirmed');
 const sourceCommit='b'.repeat(40);
 const startBody={
  task_id:task.id,claimer:job.claimer,claimed_at:job.claimed_at,
  definition:{...job.definition,attempt_key:task.id+':1',actor:job.claimer},
  standalone:{
   scope:{workflow_key:workflowKey,source_commit:sourceCommit,approved_keywords:approvedKeywords,limit:1,...(stage==='101'?{}:business),company:{company_id:randomUUID(),tenant_id:randomUUID(),version:1,policy_id:'fixture'}},
   skill:{name:'douyin-leadgen-direct',version:'1.0.0',source_commit:sourceCommit,path:'skill/SKILL.md',sha256:'b'.repeat(64)},
  }
 };
 const start=body=>fixture.request('/runs/'+job.run_id+'/start-skill',body);
 expect((await start({...startBody,standalone:{...startBody.standalone,scope:{...startBody.standalone.scope,limit:2}}})).status).toBe(409);
 if(stage!=='101')expect((await start({...startBody,standalone:{...startBody.standalone,scope:{...startBody.standalone.scope,[Object.keys(business)[0]]:'drift'}}})).status).toBe(409);
 let localReceipt, modelCalls=0;
 const finished=await runStandaloneWorkerOnce({
  machineId:job.machine_id,
  request:async(action,body)=>action==='claim'?{job}:(await fixture.request('/workflow-foundation/standalone/finish',body)).body,
  provider:async incoming=>{
   expect(incoming).toEqual(job);
   return {
    startHost:async()=>{
     const started=await start(startBody);
     expect(started.status,JSON.stringify(started.body)).toBe(201);
     const binding=started.body.binding;
     const identity={
      protocol:'codex-exec-v1',task_id:task.id,run_id:job.run_id,machine_id:job.machine_id,claimer:job.claimer,
      claimed_at:job.claimed_at,profile_sha256:'a'.repeat(64),skill:startBody.standalone.skill,
      company:startBody.standalone.scope.company,approved_keywords:approvedKeywords,task_run_id:started.body.task_run_id,
      scope_sha256:digest({...startBody.standalone.scope,task_id:task.id}),
      run_binding:{run_binding_id:binding.id,workflow_id:binding.workflow_id,workflow_definition_version_id:binding.workflow_definition_version_id,attempt_key:binding.attempt_key,activities:Object.fromEntries(
       release.payload.workflows[0].payload.activities.map(a=>[a.slot_key,{reference_id:a.reference_id,activity_id:a.activity_id,activity_definition_version_id:a.activity_version_id}])
      )},
     };
     const attest=identity=>fixture.request('/workflow-foundation/standalone/attest',{machine_id:job.machine_id,identity});
     expect((await attest({...identity,scope_sha256:'0'.repeat(64)})).status).toBe(409);
     expect((await attest(identity)).body).toEqual({attested:true});
     return {connectionPath:'fixture:socket',close:async()=>({
      task_id:job.task_id,run_id:job.run_id,local_released:true,central_released:true,native_return_unknown:false
     })};
    },
    runAgent:async()=>{modelCalls++;},
    verifyBusiness:async()=>({summary:receipt.summary,evidence:receipt.evidence}),
   };
  },
  receipts:{pending:async()=>null,save:async value=>{localReceipt=value;},sent:async()=>{}},
 });
 expect(finished).toEqual({status:'completed'});
 expect(localReceipt).toEqual(receipt);
 expect(modelCalls).toBe(1);
 expect((await finish()).body).toEqual({status:'completed'});
 const row=(await fixture.pool.query('SELECT status,payload,result FROM tasks WHERE id=$1',[task.id])).rows[0];
 expect(row).toMatchObject({status:'completed',payload:{source:`notion_leadgen_${stage}`,notion_page_id:notionPageId},result:{standalone_receipt:receipt}});
},30000);

it('自动暂停的原工单恢复到相同冻结发布，只生成一个运行，人工暂停和在途任务保持原状',async()=>{
 fixture=await foundationHttpFixture();
 const {registration,release}=await fixture.publish();
 const submit=async(key)=>(await fixture.request('/workflow-foundation/tasks',{
  workflow_id:registration.workflow_id,release_id:release.id,input:{label:key},idempotency_key:key
 })).body.task.id;
 const taskId=await submit('recover-original'),manual=await submit('operator-paused'),running=await submit('already-claimed');
 const originalJob=(await fixture.request('/workflow-foundation/claim',{machine_id:'fixture-host',task_id:running})).body.job;
 expect(originalJob.run_id).toBeTruthy();
 await fixture.pool.query("UPDATE tasks SET status='paused',error_message='operator_pause' WHERE id=$1",[manual]);
 const original=(await fixture.pool.query('SELECT payload FROM tasks WHERE id=$1',[taskId])).rows[0].payload;
 expect((await fixture.pool.query(buildPauseLowPriorityQuery(),[['P0','P1','P2','P3'],['api'],'escalation_graceful_degrade',[]])).rows.map(r=>r.id)).toEqual([taskId]);
 const claim=()=>fixture.request('/workflow-foundation/claim',{machine_id:'fixture-host',task_id:taskId});
 expect((await claim()).body).toEqual({job:null});
 expect(await recoverPausedFoundationTasks(fixture.pool,'graceful_degrade')).toBe(0);
 const repeats=await Promise.all([
  recoverPausedFoundationTasks(fixture.pool,'auto_recovery'),
  recoverPausedFoundationTasks(fixture.pool,'auto_recovery')
 ]);
 expect(repeats.sort()).toEqual([0,1]);
 const rows=(await fixture.pool.query('SELECT id,status,payload,result,status_history FROM tasks WHERE id=ANY($1::uuid[])',[[taskId,manual,running]])).rows;
 const byId=Object.fromEntries(rows.map(row=>[row.id,row]));
 expect(byId[taskId]).toMatchObject({status:'queued',payload:original});
 expect(byId[taskId].status_history.at(-1)).toMatchObject({from:'paused',to:'queued',source:'foundation_preclaim_recovery'});
 expect(byId[manual].status).toBe('paused');
 expect(byId[running]).toMatchObject({status:'in_progress',result:{foundation_runner:{run_id:originalJob.run_id}}});
 const [a,b]=await Promise.all([claim(),claim()]);
 expect(a.body.job.definition.release_id).toBe(release.id);
 expect(a.body.job.task_id).toBe(taskId);
 expect(b.body.job.run_id).toBe(a.body.job.run_id);
 expect((await fixture.pool.query('SELECT run_id FROM task_runs WHERE task_id=$1',[taskId])).rows).toEqual([{run_id:a.body.job.run_id}]);
},30000);

it('无部署观测和暂停定义拒绝派单，同机其他Workflow发布不撤销现有版本',async()=>{
 fixture=await foundationHttpFixture();
 const {registration,release,spec}=await fixture.publish({observe:false});
 const input={workflow_id:registration.workflow_id,release_id:release.id,input:{label:'准入'},idempotency_key:'gate'};
 expect((await fixture.request('/workflow-foundation/tasks',input)).body.error).toBe('foundation_release_not_ready');
 const observation={event_key:'first',attempt_key:'first',environment:'scratch',target:spec.target,components:spec.components,collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'fixture:isolated-gate-protocol'};
 expect((await fixture.request(`/releases/${release.id}/observations`,observation)).status).toBe(201);
 await fixture.pool.query("UPDATE workflows SET status='paused' WHERE id=$1",[registration.workflow_id]);
 expect((await fixture.request('/workflow-foundation/tasks',input)).body.error).toBe('foundation_workflow_not_active');
 await fixture.pool.query("UPDATE workflows SET status='active' WHERE id=$1",[registration.workflow_id]);
 // 同一个真实数据库、同一machine，另一个Workflow目标的观测不能覆盖首目标。
 const other=await fixture.request('/releases',{...fixture.releaseInput,release_key:'other-workflow',target:'fixture-host/other_workflow'});
 expect(other.status,JSON.stringify(other.body)).toBe(201);
 expect((await fixture.request(`/releases/${other.body.release.id}/observations`,{...fixture.observationInput,target:'fixture-host/other_workflow'})).status).toBe(201);
 expect((await fixture.request(`/releases/${release.id}/gate`)).body.deployed).toBe(true);
 expect((await fixture.request('/workflow-foundation/tasks',input)).status).toBe(201);
},30000);

it('冻结Profile字节漂移在执行前失败，原Task/Run收口且无副作用',async()=>{
 fixture=await foundationHttpFixture();const {registration,release}=await fixture.publish();
 const created=await fixture.request('/workflow-foundation/tasks',{workflow_id:registration.workflow_id,release_id:release.id,input:{label:'漂移'},idempotency_key:'drift'});
 expect(created.status).toBe(201);const taskId=created.body.task.id;
 fs.appendFileSync(path.join(fixture.bundle,'profile.json'),' ');
 expect((await fixture.worker(taskId).done).code).toBe(0);
 const task=(await fixture.pool.query('SELECT status,result FROM tasks WHERE id=$1',[taskId])).rows[0];
 expect(task.status).toBe('failed');expect(task.result.foundation_reconciliation.dbos_status).toBe('NOT_STARTED');
 expect((await fixture.pool.query('SELECT status FROM task_runs WHERE task_id=$1',[taskId])).rows).toEqual([{status:'failed'}]);
 expect(fs.existsSync(path.join(fixture.stateRoot,task.result.foundation_runner.run_id,'bundle','prepare.effects'))).toBe(false);
},30000);

it.each([['host-kill','completed'],['unknown-readback','blocked']])('宿主中断%s：原Run恢复、业务副作用不重做，未知结果不得伪成功',async(scenario,status)=>{
 const playbook={schema_version:1,content:'先核对base=21，再交出answer=42；恢复只读回。'};
 fixture=await foundationHttpFixture({scenario,playbook});const {registration,release}=await fixture.publish();
 const created=await fixture.request('/workflow-foundation/tasks',{workflow_id:registration.workflow_id,release_id:release.id,input:{label:scenario},idempotency_key:scenario});
 expect(created.status).toBe(201);const taskId=created.body.task.id,worker=fixture.worker(taskId);
 const task=await until(async()=>(await fixture.pool.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0],row=>Boolean(row.result?.foundation_runner?.run_id));
 const run=task.result.foundation_runner.run_id,dir=path.join(fixture.stateRoot,run),workspace=path.join(dir,'bundle');
 await until(()=>fs.existsSync(path.join(workspace,'fault-window')),Boolean);
 const state=JSON.parse(fs.readFileSync(path.join(dir,'result.json.supervisor.json'),'utf8'));
 expect(processState.sameProcess(state.child.pid,state.child.birth)).toBe(true);
 process.kill(state.child.pid,'SIGKILL');
 const done=await worker.done;expect(done,JSON.stringify(done)).toMatchObject({code:0});
 const final=(await fixture.pool.query('SELECT status,result FROM tasks WHERE id=$1',[taskId])).rows[0];
 expect(final.status,JSON.stringify(final.result.foundation_reconciliation)).toBe(status);
 expect(final.result.foundation_runner.run_id).toBe(run);
 expect(final.result.foundation_runner.run.playbook).toEqual(playbook);
 const frozen=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')).run;
 expect(frozen).toEqual(final.result.foundation_runner.run);
 expect((await fixture.pool.query('SELECT run_id,status FROM task_runs WHERE task_id=$1',[taskId])).rows).toEqual([{run_id:run,status:status==='completed'?'success':'failed'}]);
 expect(fs.readFileSync(path.join(workspace,'prepare.effects'),'utf8')).toBe('x');
 expect(JSON.parse(fs.readFileSync(path.join(dir,'result.json.supervisor.json'),'utf8')).starts).toBe(2);
 if(status==='completed')expect(JSON.parse(fs.readFileSync(path.join(workspace,'double.json'),'utf8')).result.outputs.answer).toBe(42);
 else{
  expect(fs.existsSync(path.join(workspace,'double.effects'))).toBe(false);
  const before=(await fixture.pool.query('SELECT status,claimed_by,result FROM tasks WHERE id=$1',[taskId])).rows[0];
  expect((await unblockTask(taskId,{db:fixture.pool})).success).toBe(false);
  expect((await fixture.pool.query('SELECT status,claimed_by,result FROM tasks WHERE id=$1',[taskId])).rows[0]).toEqual(before);
 }
},90000);

it.each([['input',{label:7},null,'foundation_input_schema_mismatch'],['key',{label:'合法'},'forged_workflow','foundation_definition_changed']])('首次claim重验%s，通用建单旁路不能创建Run',async(kind,input,key,code)=>{
 fixture=await foundationHttpFixture();const {registration,release}=await fixture.publish();
 const created=await fixture.request('/workflow-foundation/tasks',{workflow_id:registration.workflow_id,release_id:release.id,input:{label:'合法'},idempotency_key:'claim-guard'});
 expect(created.status).toBe(201);const taskId=created.body.task.id;
 // 等价于通用建单metadata绕过专用入口；仅修改本夹具私有schema中的queued任务。
 await fixture.pool.query("UPDATE tasks SET payload=payload||$2::jsonb WHERE id=$1",[taskId,JSON.stringify({workflow_input:input,...(key?{workflow_key:key}:{})})]);
 const claimed=await fixture.request('/workflow-foundation/claim',{machine_id:'fixture-host',task_id:taskId});
 expect(claimed.body.error).toBe(code);
 expect(claimed.status).toBe(kind==='input'?400:409);
 expect((await fixture.pool.query('SELECT * FROM task_runs WHERE task_id=$1',[taskId])).rows).toHaveLength(0);
 expect((await fixture.pool.query('SELECT status,claimed_by FROM tasks WHERE id=$1',[taskId])).rows[0]).toEqual({status:'queued',claimed_by:null});
},30000);


async function activationFixture(){
 fixture=await foundationHttpFixture();
 const {registration,release}=await fixture.publish({environment:'production'});
 const id=registration.workflow_id;
 expect(id.startsWith('b1000000')).toBe(false);
 expect(fixture.key.startsWith('foundation_')).toBe(true);
 const {migrationTable}=await import('../fixtures/minimum-definition-schema.js');
 await fixture.pool.query(migrationTable('553_task_leases_device_pools.sql','task_leases'));
 const actor='fixture:runtime-owner';
 await fixture.pool.query("UPDATE tasks SET claimed_by=$2,claimed_at=NOW(),payload=$3 WHERE id=$1",[fixture.task,actor,{actor,workflow_runtime_scope:[id]}]);
 await fixture.pool.query("INSERT INTO task_leases(task_id,claimer,claimed_at,lease_seconds,lease_until) SELECT id,claimed_by,claimed_at,3600,NOW()+interval '1 hour' FROM tasks WHERE id=$1",[fixture.task]);
 await fixture.pool.query("UPDATE workflows SET status='paused' WHERE id=$1",[id]);
 const gate=(await fixture.request(`/releases/${release.id}/gate`)).body;
 const input={status:'active',actor,task_id:fixture.task,reason:'隔离协议启用验收',release_id:release.id,observation_id:gate.current_observation_id,workflow_definition_version_id:registration.current_definition_version_id,snapshot_sha256:release.payload.workflows[0].payload_sha256};
 const route=`/workflow-foundation/workflows/${id}/runtime-status`;
 return {registration,release,id,actor,input,route};
}

it('通用Foundation正式API：受控启用暂停版本后catalog ready并正常登记Task',async()=>{
 const {registration,release,id,actor,input,route}=await activationFixture();
 const database=(await fixture.pool.query('SELECT current_database() AS name,current_schema() AS schema')).rows[0];
 expect(database.name).toBe('cecelia_scratch');expect(database.schema).toBe(fixture.schema);
 expect((await fixture.request(route,input,{auth:false})).status).toBe(401);
 const request={workflow_id:id,release_id:release.id,input:{label:'正式启用后派单'},idempotency_key:'activation'};
 expect((await fixture.request('/workflow-foundation/tasks',request)).body.error).toBe('foundation_workflow_not_active');
 const activated=await fixture.request(route,input);
 expect(activated,JSON.stringify(activated)).toMatchObject({status:200,body:{workflow:{id,status:'active'}}});
 expect((await fixture.request('/workflow-foundation/catalog')).body.workflows.find(w=>w.release_id===release.id).status).toBe('ready');
 expect((await fixture.request('/workflow-foundation/tasks',request)).status).toBe(201);
 const events=await fixture.pool.query("SELECT payload FROM task_events WHERE task_id=$1 AND event_type='foundation_runtime_status_changed'",[fixture.task]);
 expect(events.rows).toHaveLength(1);expect(events.rows[0].payload).toMatchObject({...input,workflow_id:id,prior_status:'paused'});
 expect((await fixture.request(route,{...input,status:'paused'})).body.workflow.status).toBe('paused');
},30000);


it('Foundation激活逐项拒绝坏治理和发布身份，漂移时仍允许有权暂停',async()=>{
 const {release,id,input,route}=await activationFixture();
 const current=(await fixture.pool.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[input.workflow_definition_version_id])).rows[0];
 const originalTask=(await fixture.pool.query('SELECT * FROM tasks WHERE id=$1',[fixture.task])).rows[0];
 const deny=async (body=input)=>{
  const result=await fixture.request(route,body);
  expect(result.status,JSON.stringify(result)).toBeGreaterThanOrEqual(400);
  expect((await fixture.pool.query('SELECT status FROM workflows WHERE id=$1',[id])).rows[0].status).toBe('paused');
  expect((await fixture.pool.query("SELECT * FROM task_events WHERE event_type='foundation_runtime_status_changed'")).rows).toHaveLength(0);
  expect((await fixture.pool.query("SELECT * FROM tasks WHERE payload->>'commander_protocol'='commander-foundation-v1'")).rows).toHaveLength(0);
 };
 for(const bad of [{actor:'other'},{workflow_definition_version_id:fixture.task},{snapshot_sha256:'0'.repeat(64)},{observation_id:fixture.task},{release_id:fixture.task},{target:'other/key'},{profile:{}}])await deny({...input,...bad});
 for(const patch of [{actor:'other',workflow_runtime_scope:[id]},{actor:input.actor,workflow_runtime_scope:[]}]){
  await fixture.pool.query('UPDATE tasks SET payload=$2 WHERE id=$1',[fixture.task,patch]);await deny();
 }
 await fixture.pool.query('UPDATE tasks SET payload=$2 WHERE id=$1',[fixture.task,originalTask.payload]);
 for(const sql of ["UPDATE tasks SET claimed_by='other' WHERE id=$1","UPDATE tasks SET status='queued' WHERE id=$1","UPDATE task_leases SET lease_until=NOW()-interval '1 second' WHERE task_id=$1","UPDATE task_leases SET claimer='other' WHERE task_id=$1","UPDATE task_leases SET claimed_at=claimed_at-interval '1 second' WHERE task_id=$1","UPDATE task_leases SET released_at=NOW() WHERE task_id=$1"]){
  await fixture.pool.query(sql,[fixture.task]);await deny();
  await fixture.pool.query("UPDATE tasks SET claimed_by=$2,status='in_progress' WHERE id=$1",[fixture.task,input.actor]);
  await fixture.pool.query("UPDATE task_leases l SET claimer=t.claimed_by,claimed_at=t.claimed_at,lease_until=NOW()+interval '1 hour',released_at=NULL FROM tasks t WHERE l.task_id=t.id AND t.id=$1",[fixture.task]);
 }
 await fixture.pool.query("UPDATE workflows SET source_repo='other/repo' WHERE id=$1",[id]);await deny();
 await fixture.pool.query('UPDATE workflows SET source_repo=$2 WHERE id=$1',[id,current.source_repo]);
 await fixture.pool.query("UPDATE workflows SET current_definition_version_id=NULL WHERE id=$1",[id]);await deny();
 await fixture.pool.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[id,current.id]);
 // 身份不合法不能通过暂停逃逸；发布漂移则不应阻止安全停用。
 await fixture.pool.query("UPDATE workflows SET status='retired' WHERE id=$1",[id]);
 expect((await fixture.request(route,{...input,status:'paused'})).status).toBeGreaterThanOrEqual(400);
 await fixture.pool.query("UPDATE workflows SET status='paused' WHERE id=$1",[id]);
 const badPayload=structuredClone(current.payload);delete badPayload.contract.runtime;
 const badDefinition=(await fixture.pool.query(`INSERT INTO workflow_definition_versions(workflow_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit)
  SELECT workflow_id,$2,contract_sha256,$3,source_repo,source_path,source_commit FROM workflow_definition_versions WHERE id=$1 RETURNING id`,[current.id,badPayload,'d'.repeat(64)])).rows[0];
 await fixture.pool.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[id,badDefinition.id]);
 await deny();await deny({...input,status:'paused'});
 await fixture.pool.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[id,current.id]);
 const {randomUUID}=await import('node:crypto');
 async function clonedRelease(patch){
  const row=(await fixture.pool.query(`INSERT INTO release_versions(release_key,manifest_sha256,request_sha256,environment,target,actor,payload)
   SELECT $2,manifest_sha256,request_sha256,$3,$4,actor,$5 FROM release_versions WHERE id=$1 RETURNING *`,[release.id,randomUUID(),patch.environment??release.environment,patch.target??release.target,patch.payload??release.payload])).rows[0];
  const observed=await fixture.request(`/releases/${row.id}/observations`,{event_key:randomUUID(),attempt_key:randomUUID(),environment:row.environment,target:row.target,components:row.payload.components,collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'fixture:bounded-negative-release'});
  expect(observed.status).toBe(201);
  return {...input,release_id:row.id,observation_id:observed.body.observation.id};
 }
 for(const patch of [{environment:'scratch'},{target:'fixture-host/other'},{target:'fixture-host'}])await deny(await clonedRelease(patch));
 for(const mutate of [
  p=>{p.components=p.components.filter(c=>c.kind!=='repo');},
  p=>{p.components=p.components.filter(c=>c.path!=='profile.json');},
  p=>{p.components=p.components.filter(c=>c.path!=='work.mjs');},
  p=>{p.components.push({...p.components.find(c=>c.path==='work.mjs'),path:'unbound.mjs'});},
 ]){const payload=structuredClone(release.payload);mutate(payload);await deny(await clonedRelease({payload}));}
 // 真实release gate从新观测组件计算gaps/actual_matches；不改不可变旧证据。
 const drift=await fixture.request(`/releases/${release.id}/observations`,{event_key:randomUUID(),attempt_key:randomUUID(),environment:release.environment,target:release.target,components:release.payload.components.filter(c=>c.kind==='repo'),collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'fixture:actual-drift'});
 expect(drift.status).toBe(201);await deny();
 expect((await fixture.request(`/releases/${release.id}/gate`)).body).toMatchObject({deployed:false,actual_matches:false});
 expect((await fixture.request(route,{status:'paused',actor:input.actor,task_id:fixture.task,reason:'故障暂停'})).status).toBe(200);
},30000);


it('Foundation激活写事件或读回失败必须回滚状态及事件',async()=>{
 const {id,input,route}=await activationFixture();
 await fixture.pool.query(`CREATE FUNCTION deny_activation_event() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture-event-write-failed'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER deny_activation_event BEFORE INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION deny_activation_event()`);
 expect((await fixture.request(route,input)).status).toBe(500);
 expect((await fixture.pool.query('SELECT status FROM workflows WHERE id=$1',[id])).rows[0].status).toBe('paused');
 await fixture.pool.query('DROP TRIGGER deny_activation_event ON task_events');
 await fixture.pool.query(`CREATE FUNCTION deny_activation_readback() RETURNS trigger AS $$ BEGIN NEW.status='paused'; RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER deny_activation_readback BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION deny_activation_readback()`);
 expect((await fixture.request(route,input)).body.error).toBe('foundation_runtime_status_readback_failed');
 expect((await fixture.pool.query("SELECT * FROM task_events WHERE event_type='foundation_runtime_status_changed'")).rows).toHaveLength(0);
 expect((await fixture.pool.query('SELECT status FROM workflows WHERE id=$1',[id])).rows[0].status).toBe('paused');
},30000);
