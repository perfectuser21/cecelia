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
