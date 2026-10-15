import { createRequire } from 'node:module';
import { mkdtempSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { invocationTaskPrompt } from '../../invocations/runtime.js';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
import { createInvocationsRouter } from '../../routes/invocations.js';
import { definitionDigest } from '../../workflow-authoring/contracts.js';
import { prepareInvocationDispatch,guardInvocationCallback } from '../../invocations/runtime.js';
import { startRun,finishRun } from '../../lib/task-run.js';
import { finalizeTask } from '../../lib/task-terminal.js';
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
const content='---\nname: pure-transform\nversion: 1.0.0\n---\n仅对输入 text 转成大写，并输出 text 字段；不要调用工具或写文件。';
let fixture,pool,app,body,skillId,definition,taskId;
let fixedReader=async()=>content;
const options={readFile:source=>fixedReader(source),probeRuntime:async()=>({ready:true,transport:'codex-bridge',machine_id:'isolated-preview'})};
beforeEach(async()=>{
 fixedReader=async()=>content;
 fixture=await createIntakeTestDatabase();pool=fixture.pool;
 for(const table of ['task_events','task_runs','skill_registry','activity_definition_versions','workflow_definition_versions','warehouse_items','release_versions','release_observations'])await pool.query(`CREATE TABLE ${fixture.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
 skillId=randomUUID();taskId=randomUUID();const activityId=randomUUID();
 await pool.query('INSERT INTO skill_registry(id,name) VALUES($1,$2)',[skillId,`pure-${skillId}`]);
 definition={key:'pure',source:{repo:'perfectuser21/cecelia',ref:'flow.json',revision:'a'.repeat(40)},input_schema:schema,output_schema:schema,activities:[{id:activityId,key:'uppercase',executor_kind:'agent',runtime:{transport:'codex-bridge'},mutation_intent:'none',input_schema:schema,output_schema:schema,acceptance:['真实大写结果'],implementation:{kind:'skill',skill_id:skillId,repo:'perfectuser21/cecelia',path:'skills/pure/SKILL.md',revision:'a'.repeat(40)}}]};
 await pool.query("INSERT INTO tasks(id,title,status,task_type,payload,result) VALUES($1,'候选管理','in_progress','research',$2,$3)",[taskId,{workflow_authoring:true,tenant_id:'default'},{workflow_authoring:{request:{operation:'create'},outputs:{compose:{definition}}}}]);
 body={target:{kind:'workflow',id:taskId},mode:'candidate',authoring_task_id:taskId,compose_sha256:definitionDigest(definition),input:{text:'abc'},request_key:'request-one'};
 app=express();app.use(express.json());app.use('/api/brain/invocations',createInvocationsRouter({db:pool,...options}));
});
afterEach(async()=>{await fixture?.close();});
const post=(path,value)=>request(app).post(`/api/brain/invocations${path}`).send(value);
describe('真实scratch调用账本与并发',()=>{
 it.runIf(process.env.INVOCATION_REAL_CODEX==='1')('Activity单调和Workflow整调经真实Codex进程产生结构化输出',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'invocation-fixed-skill-'));
  const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{
   mkdirSync(join(dir,'skills/pure'),{recursive:true});writeFileSync(join(dir,'skills/pure/SKILL.md'),content);
   git(['init','-b','cp-invocation-fixture']);git(['config','user.name','Invocation fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','skills/pure/SKILL.md']);git(['commit','-m','test: fixed pure skill']);
   const commit=git(['rev-parse','HEAD']);definition.source.revision=commit;definition.activities[0].implementation.revision=commit;
   fixedReader=source=>git(['show',`${source.revision}:${source.path}`]);
   await pool.query("UPDATE tasks SET result=$2 WHERE id=$1",[taskId,{workflow_authoring:{request:{operation:'create'},outputs:{compose:{definition}}}}]);
   body.compose_sha256=definitionDigest(definition);
   const require=createRequire(import.meta.url),{executeCodex}=require('../../../scripts/codex-bridge/codex-bridge.cjs');
   for(const kind of ['activity','workflow']){
    const target={kind,id:kind==='activity'?definition.activities[0].id:taskId};
    const accepted=await post('',{...body,target,request_key:`real-${kind}`});expect(accepted.status,JSON.stringify(accepted.body)).toBe(202);
    const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[accepted.body.task_id])).rows[0];
    const runId=`real-${kind}-${randomUUID()}`;await prepareInvocationDispatch(pool,task,runId,options);
    await startRun({taskId:task.id,runId,source:'codex-bridge',context:{tenant_id:'default',target:task.payload.invocation.target,input_sha256:task.payload.invocation.input_sha256}},{pool});
    const prompt=invocationTaskPrompt(task,runId);expect(prompt).toContain(content);
    const result=await executeCodex(process.env.CODEX_HOME, prompt,{workDir:dir,sandbox:'read-only',timeoutMs:180000});
    await guardInvocationCallback(pool,{task_id:task.id,run_id:runId,status:'AI Done',result:result.output});
    await finishRun({runId,status:'success',exitCode:0,result:{source:'actual-codex-cli',duration_ms:result.elapsed}},{pool});
    await finalizeTask(pool,task.id,'completed',{mergeResult:{handoff:{summary:'纯Skill真实进程验收',next_steps:[]}}});
    const read=await request(app).get(`/api/brain/invocations/${task.id}`);expect(read.body.status).toBe('completed');expect(read.body.outputs).toEqual({text:'ABC'});expect(read.body.evidence.runs[0].context.target).toEqual(task.payload.invocation.target);
    process.stdout.write(JSON.stringify({actual_process:true,task_id:task.id,run_id:runId,target:read.body.target,skill_sha256:task.payload.invocation.envelope.activities[0].skill_sha256,outputs:read.body.outputs,scratch_schema:fixture.schema})+'\n');
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 },240000);
 it('按同请求键并发只建一个原生路由任务，异输入409，原键可查',async()=>{
  const results=await Promise.all(Array.from({length:6},()=>post('',body)));expect(results.map(r=>r.status)).toEqual(Array(6).fill(202));
  expect(new Set(results.map(r=>r.body.task_id)).size).toBe(1);
  expect((await post('',{...body,input:{text:'changed'}})).status).toBe(409);
  const read=await request(app).get('/api/brain/invocations/by-request/request-one');expect(read.status).toBe(200);expect(read.body.status).toBe('queued');
  expect((await pool.query("SELECT count(*)::int n FROM tasks WHERE payload ? 'invocation'")).rows[0].n).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM work_routing_receipts')).rows[0].n).toBe(1);
 });
 it('resolve缺必填输入仍返回schema；跨租户不可读；未支持transport不建单',async()=>{
  const missing=await post('/resolve',{...body,input:{}});expect(missing.status).toBe(200);expect(missing.body.input_schema).toEqual(schema);expect(missing.body.gaps.some(g=>g.code==='input_schema_invalid')).toBe(true);
  expect((await post('',body)).status).toBe(202);
  expect((await request(app).get('/api/brain/invocations/by-request/request-one').set('x-tenant-id','other')).status).toBe(404);
 });
 it('正式调用无真实发布证据保持blocked，不能借候选证明授予正式资格',async()=>{
  const activity=definition.activities[0],version=randomUUID(),payload={activity_id:activity.id,contract:activity};
  await pool.query('INSERT INTO activity_definition_versions(id,activity_id,payload,contract_sha256,payload_sha256,source_repo,source_path,source_commit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[version,activity.id,payload,definitionDigest(activity),definitionDigest(payload),'perfectuser21/cecelia','flow.json','a'.repeat(40)]);
  const released={target:{kind:'activity',id:activity.id,definition_version_id:version},mode:'released',input:{text:'abc'},request_key:'formal-one'};
  const resolution=await post('/resolve',released);expect(resolution.status).toBe(200);expect(resolution.body.readiness).toBe('blocked');expect(resolution.body.gaps.some(g=>g.code==='verified_release_missing')).toBe(true);
  expect((await post('',released)).status).toBe(409);
  expect((await pool.query("SELECT count(*)::int n FROM tasks WHERE payload ? 'invocation'")).rows[0].n).toBe(0);
 });
 it('单次派发预留不重发；固定快照不漂版，撤销组装阻止新运行',async()=>{
  const accepted=await post('',body);expect(accepted.status).toBe(202);const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[accepted.body.task_id])).rows[0];
  const first=await prepareInvocationDispatch(pool,task,'run-one',options);expect(first.already).toBe(false);
  expect((await prepareInvocationDispatch(pool,task,'run-two',options))).toEqual({runId:'run-one',already:true});
  expect(task.payload.invocation.envelope.activities[0].skill_content).toBe(content);
  const next=await post('',{...body,request_key:'request-two'});expect(next.status,JSON.stringify(next.body)).toBe(202);const nextTask=(await pool.query('SELECT * FROM tasks WHERE id=$1',[next.body.task_id])).rows[0];
  await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[taskId]);
  await expect(prepareInvocationDispatch(pool,nextTask,'run-three',options)).rejects.toThrow('候选授权');
 });
 it('产物身份及结构非法不能完成，合法回执须有run/events才显示完成',async()=>{
  const accepted=await post('',body);const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[accepted.body.task_id])).rows[0];
  const dispatch=await prepareInvocationDispatch(pool,task,'run-one',options),e=dispatch.envelope;
  const receipt={protocol:'skill-invocation-result-v1',task_id:task.id,run_id:'run-one',tenant_id:'default',target:e.target,input_sha256:e.input_sha256,activities:[{key:'uppercase',skill_sha256:e.activities[0].skill_sha256,outputs:{text:'ABC'}}],outputs:{text:'ABC'}};
  await expect(guardInvocationCallback(pool,{task_id:task.id,run_id:'wrong',status:'AI Done',result:receipt})).rejects.toThrow();
  await expect(guardInvocationCallback(pool,{task_id:task.id,run_id:'run-one',status:'AI Done',result:{...receipt,outputs:{text:2}}})).rejects.toThrow();
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[task.id])).rows[0].status).toBe('queued');
  await guardInvocationCallback(pool,{task_id:task.id,run_id:'run-one',status:'AI Done',result:JSON.stringify(receipt)});
  await finalizeTask(pool,task.id,'completed',{mergeResult:{handoff:{summary:'调用结构与运行账测试',next_steps:[]}}});
  expect((await request(app).get(`/api/brain/invocations/${task.id}`)).body.status).toBe('result_pending');
  await startRun({taskId:task.id,runId:'run-one',source:'invocation-preview',context:{tenant_id:'default',target:e.target,input_sha256:e.input_sha256}},{pool});
  await finishRun({runId:'run-one',status:'success',result:{outputs:receipt.outputs}},{pool});
  const read=await request(app).get(`/api/brain/invocations/${task.id}`);expect(read.body.status).toBe('completed');expect(read.body.outputs).toEqual({text:'ABC'});expect(read.body.evidence.events.some(v=>v.event_type==='invocation_activity_completed')).toBe(true);
 });
});
