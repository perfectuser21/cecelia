import { afterEach,beforeEach,expect,it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import * as releases from '../../release-index.js';
import * as service from '../../run-definition-binding.js';
import * as routes from '../../../routes/run-definitions.js';
let fixture,release,observation,app;
beforeEach(async()=>{
  expect(service.bindRunDefinition,'运行定义绑定服务必须存在').toBeTypeOf('function');
  fixture=await releaseEvidenceDatabase();release=(await releases.createRelease(fixture.db,fixture.releaseInput)).release;
  observation=(await releases.recordReleaseObservation(fixture.db,release.id,fixture.observationInput,{trustedCollector:'fixture-collector'})).observation;
  app=express();app.use(express.json());app.use('/runs',routes.createRunDefinitionsRouter({pool:fixture.db}));
});
afterEach(async()=>{await fixture?.close();fixture=null;});
const post=(id,body)=>request(app).post(`/runs/${id}/definition`).send(body);
it('旧服务曾放行的消费者历史release仍禁止起跑，零运行绑定写入', async()=>{
  // 重放旧服务接受的release形状，不能通过新release入口造出它。
  const payload=structuredClone(release.payload);
  payload.workflows[0].payload.definition_scope='consumer_evidence';
  const legacy=(await fixture.db.query(`INSERT INTO release_versions(release_key,manifest_sha256,request_sha256,environment,target,actor,payload)
    VALUES('legacy-consumer',$1,$2,$3,$4,'legacy-fixture',$5) RETURNING *`,[releases.evidenceHash(payload),'e'.repeat(64),release.environment,release.target,payload])).rows[0];
  const seen=(await releases.recordReleaseObservation(fixture.db,legacy.id,{...fixture.observationInput,event_key:'legacy-consumer',observed_at:new Date(Date.now()+1000).toISOString()},{trustedCollector:'fixture-collector'})).observation;
  const response=await post('consumer-cannot-run',fixture.runInput(legacy,seen,fixture.workflows[0]));
  expect(response.status,response.body).toBe(422);
  expect(response.body.error.code).toBe('RELEASE_CONSUMER_EVIDENCE_NOT_EXECUTABLE');
  expect((await fixture.db.query('SELECT count(*)::int n FROM run_definition_bindings')).rows[0].n).toBe(0);
});
it('两个共享Activity Workflow各自冻结，外部run不产生task_runs；幂等和不可变',async()=>{
  for(const [i,workflow] of fixture.workflows.entries()){
    const input=fixture.runInput(release,observation,workflow);let r=await post(`external-${i}`,input);expect(r.status,r.body).toBe(201);
    const binding=r.body.binding;r=await post(`external-${i}`,input);expect(r.status).toBe(200);expect(r.body.binding.id).toBe(binding.id);
    const frozen=await service.getRunDefinitionBinding(fixture.db,`external-${i}`);expect(frozen.workflow.id).toBe(workflow.id);expect(frozen.binding.workflow_id).toBe(workflow.workflow_id);expect(frozen.activities.map(a=>a.id).sort()).toEqual(workflow.payload.activities.map(a=>a.activity_version_id).sort());
    await expect(fixture.db.query('DELETE FROM run_definition_bindings WHERE id=$1',[binding.id])).rejects.toMatchObject({code:'P0001'});
  }
  expect((await fixture.db.query('SELECT count(*)::int n FROM task_runs')).rows[0].n).toBe(0);
  expect(await service.getRunDefinitionBinding(fixture.db,'unknown-old-run')).toBeNull();
});
it('同run并发异Workflow只有一个赢家，失败批次无残留',async()=>{
  const result=await Promise.all(fixture.workflows.map(w=>post('race',fixture.runInput(release,observation,w))));
  expect(result.map(r=>r.status).sort()).toEqual([201,409]);expect((await fixture.db.query('SELECT count(*)::int n FROM run_definition_bindings')).rows[0].n).toBe(1);
  const bad=fixture.runInput(release,observation);bad.expected_path[0].activity_id=fixture.workflows[1].workflow_id;
  expect((await post('wrong-identity',bad)).status).toBe(422);expect((await fixture.db.query("SELECT count(*)::int n FROM run_definition_bindings WHERE run_id='wrong-identity'")).rows[0].n).toBe(0);
});
it('运行绑定不接受错版本/错观测，当前定义变化不改冻结历史',async()=>{
  const input=fixture.runInput(release,observation);expect((await post('stable',input)).status).toBe(201);
  const before=await service.getRunDefinitionBinding(fixture.db,'stable');
  await fixture.db.query('UPDATE workflows SET current_definition_version_id=NULL WHERE id=$1',[input.workflow_id]);await fixture.db.query('UPDATE enablers SET active=false WHERE id=$1',[fixture.enabler]);
  expect(await service.getRunDefinitionBinding(fixture.db,'stable')).toEqual(before);
  expect((await post('bad-sha',{...input,snapshot_sha256:'0'.repeat(64)})).status).toBe(422);
  const wrong=(await releases.recordReleaseObservation(fixture.db,release.id,{...fixture.observationInput,event_key:'drift',components:[]},{trustedCollector:'fixture-collector'})).observation;
  expect((await post('bad-observation',{...input,observation_id:wrong.id})).status).toBe(409);
});
it('内部run只绑定既有task_run且必须run/workflow一致',async()=>{
  const input=fixture.runInput(release,observation);delete input.external_origin;input.source_kind='internal';
  input.task_run_id='11111111-1111-4111-8111-111111111111';expect((await post('internal',input)).status).toBe(422);
});
it('固定契约没有optional声明时不能将必经路径降为可选',async()=>{
  const input=fixture.runInput(release,observation);input.expected_path[0].required=false;
  expect((await post('false-optional',input)).status).toBe(422);
});
it('真实内部task_run身份匹配才可绑定，绑定服务不改既有执行行',async()=>{
  const input=fixture.runInput(release,observation);delete input.external_origin;input.source_kind='internal';
  const task=(await fixture.db.query("INSERT INTO tasks(title,status) VALUES('fixture','queued') RETURNING id")).rows[0];
  const declaration=Object.fromEntries(['release_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','attempt_key'].map(k=>[k,input[k]]));
  const taskRun=(await fixture.db.query("INSERT INTO task_runs(task_id,run_id,workflow_id,status,context) VALUES($1,'internal-real',$2,'running',$3) RETURNING *",[task.id,input.workflow_id,{definition_preflight:declaration}])).rows[0];
  input.task_run_id=taskRun.id;
  expect((await post('internal-real',input)).status).toBe(201);
  expect((await fixture.db.query('SELECT * FROM task_runs WHERE id=$1',[taskRun.id])).rows[0]).toEqual(taskRun);
  expect((await post('wrong-run',input)).status).toBe(422);
});
it('外部运行必须固定本机完整快照摘要，异摘要重传冲突',async()=>{
  const input=fixture.runInput(release,observation);delete input.runtime_snapshot_sha256;
  expect((await post('missing-runtime-digest',input)).status).toBe(422);
  input.runtime_snapshot_sha256='f'.repeat(64);
  expect((await post('fixed-runtime',input)).status).toBe(201);
  expect((await post('fixed-runtime',{...input,runtime_snapshot_sha256:'0'.repeat(64)})).status).toBe(409);
  expect((await service.getRunDefinitionBinding(fixture.db,'fixed-runtime')).binding.payload.runtime_snapshot_sha256).toBe(input.runtime_snapshot_sha256);
});
it('首次绑定须当前部署仍匹配，同release观测更新可用原good，已绑定历史重放不重判',async()=>{
  const input=fixture.runInput(release,observation);expect((await post('historical',input)).status).toBe(201);
  const at=Date.now();
  await releases.recordReleaseObservation(fixture.db,release.id,{...fixture.observationInput,event_key:'new-drift',components:[],observed_at:new Date(at+1000).toISOString()},{trustedCollector:'fixture-collector'});
  expect((await post('historical',input)).status).toBe(200);expect((await post('new-after-drift',input)).status).toBe(409);
  await releases.recordReleaseObservation(fixture.db,release.id,{...fixture.observationInput,event_key:'new-good',observed_at:new Date(at+2000).toISOString()},{trustedCollector:'fixture-collector'});
  expect((await post('new-after-good',input)).status).toBe(201);
  const other=(await releases.createRelease(fixture.db,{...fixture.releaseInput,release_key:'replacement'})).release;
  await releases.recordReleaseObservation(fixture.db,other.id,{...fixture.observationInput,event_key:'replacement',observed_at:new Date(at+3000).toISOString()},{trustedCollector:'fixture-collector'});
  expect((await releases.getReleaseGate(fixture.db,release.id)).deployed).toBe(false);
  expect((await post('new-after-replacement',input)).status).toBe(409);
  expect((await post('historical',input)).status).toBe(200);
});
it('调用方事务内绑定回滚时不残留运行身份',async()=>{
  expect(service.bindRunDefinitionInTransaction).toBeTypeOf('function');
  const db=await fixture.db.connect();
  try{await db.query('BEGIN');await service.bindRunDefinitionInTransaction(db,'rolled-back',fixture.runInput(release,observation));await db.query('ROLLBACK');}
  finally{db.release();}
  expect(await service.getRunDefinitionBinding(fixture.db,'rolled-back')).toBeNull();
});
it('完整路径同时包含Activity与其全部规范Step，不能通过省略必经层级缩小验收',async()=>{
  const input=fixture.runInput(release,observation);const step=input.expected_path.find(p=>p.step_id),activity=input.expected_path.find(p=>!p.step_id);
  expect((await post('missing-step',{...input,expected_path:input.expected_path.filter(p=>p!==step)})).status).toBe(422);
  expect((await post('missing-activity',{...input,expected_path:input.expected_path.filter(p=>p!==activity)})).status).toBe(422);
});
it('外部run不能占用真实内部task_run的run_id，即使Workflow相同',async()=>{
  const task=(await fixture.db.query("INSERT INTO tasks(title,status) VALUES('internal-owner','queued') RETURNING id")).rows[0];
  for(const [index,workflow] of fixture.workflows.entries()){
    const runId=`already-internal-${index}`;
    await fixture.db.query("INSERT INTO task_runs(task_id,run_id,workflow_id,status) VALUES($1,$2,$3,'running')",[task.id,runId,workflow.workflow_id]);
    expect((await post(runId,fixture.runInput(release,observation,fixture.workflows[0]))).status).toBe(409);
    expect(await service.getRunDefinitionBinding(fixture.db,runId)).toBeNull();
  }
});

it.each(['terminal','ended','undeclared','different-preflight'])('内部首次绑定禁止运行后追认：%s',async kind=>{
  const input=fixture.runInput(release,observation);delete input.external_origin;input.source_kind='internal';
  const declaration=Object.fromEntries(['release_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','attempt_key'].map(k=>[k,input[k]]));
  if(kind==='different-preflight')declaration.attempt_key='other-attempt';
  const task=(await fixture.db.query("INSERT INTO tasks(title,status) VALUES('unbound-history','queued') RETURNING id")).rows[0];
  const row=(await fixture.db.query("INSERT INTO task_runs(task_id,run_id,workflow_id,status,ended_at,context) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[task.id,kind,input.workflow_id,kind==='terminal'?'success':'running',kind==='ended'?'2026-01-02T00:00:00Z':null,kind==='undeclared'?{}:{definition_preflight:declaration}])).rows[0];
  input.task_run_id=row.id;
  expect((await post(kind,input)).status).toBe(409);expect(await service.getRunDefinitionBinding(fixture.db,kind)).toBeNull();
});
it('起跑前已固定内部绑定在完成后仍可幂等回读',async()=>{
  const input=fixture.runInput(release,observation);delete input.external_origin;input.source_kind='internal';
  const declaration=Object.fromEntries(['release_id','workflow_definition_version_id','snapshot_sha256','runtime_snapshot_sha256','attempt_key'].map(k=>[k,input[k]]));
  const task=(await fixture.db.query("INSERT INTO tasks(title,status) VALUES('declared-start','queued') RETURNING id")).rows[0];
  const row=(await fixture.db.query("INSERT INTO task_runs(task_id,run_id,workflow_id,status,context) VALUES($1,'completed-bound',$2,'running',$3) RETURNING id",[task.id,input.workflow_id,{definition_preflight:declaration}])).rows[0];input.task_run_id=row.id;
  expect((await post('completed-bound',input)).status).toBe(201);
  await fixture.db.query("UPDATE task_runs SET status='success',ended_at=now() WHERE id=$1",[row.id]);
  expect((await post('completed-bound',input)).status).toBe(200);
});
