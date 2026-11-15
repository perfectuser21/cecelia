import {afterEach,it,expect} from 'vitest';
import {workflowFoundationDatabase} from '../fixtures/workflow-foundation-db.js';
import fs from 'node:fs';
import path from 'node:path';
import {foundationHttpFixture,until} from '../fixtures/workflow-foundation-http.js';
import processState from '../../orchestrator/activity-supervisor-state.cjs';
import {unblockTask} from '../../task-updater.js';
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
 fixture=await foundationHttpFixture({scenario});const {registration,release}=await fixture.publish();
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
