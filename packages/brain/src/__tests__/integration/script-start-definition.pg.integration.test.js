import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {scriptDefinitionDatabase} from '../fixtures/script-definition-db.js';
import {versionsDatabase,seedWorkflows} from '../fixtures/definition-versions-db.js';
import {migrationSql,withLegacyNames} from '../fixtures/minimum-definition-schema.js';
import {triggerScriptRun} from '../../script-executor.js';
import {recordReleaseObservation} from '../../lib/release-index.js';
import {PATROL_CAPABILITY} from '../../lib/device-patrol-admission.js';
vi.mock('../../runtime-safety.js',()=>({assertExternalExecutionAllowed(){}}));
let fixture,db,workflow,calls;
beforeEach(async()=>{
  fixture=await versionsDatabase();await fixture.migrate();db=fixture.db;
  await withLegacyNames(db,()=>db.query(migrationSql('515_release_definition_evidence.sql')));
  await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text, ADD COLUMN IF NOT EXISTS executor_kind text, ADD COLUMN IF NOT EXISTS error_message text, ADD COLUMN IF NOT EXISTS claimed_by text, ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}';
    CREATE TABLE task_events(task_id uuid,event_type text,payload jsonb,created_at timestamptz)`);
  const ids=await seedWorkflows(db,{keywordCapability:PATROL_CAPABILITY});workflow=ids.keyword;
  await db.query("UPDATE workflows SET key='single-phone-account-patrol',current_definition_version_id=NULL WHERE id=$1",[workflow]);
  calls=[];
});
afterEach(async()=>{await fixture?.close();fixture=null;});
function transport(){
  calls.push('ssh');
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.end('DISPATCHED\n');child.emit('close',0);}));
  return child;
}
async function task(payload={}){
  return (await db.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'起跑前定义验收','queued','script_run',$2) RETURNING *",
    [randomUUID(),{host:'mmv',cmd:'printf no-device-fixture',timeout_sec:30,workflow_id:workflow,source_revision:'b'.repeat(40),...payload}])).rows[0];
}
it('正式巡查current定义缺失时不退回无绑定SSH启动，数据库不留假Run',async()=>{
  const t=await task();const result=await triggerScriptRun(t,{pool:db,spawnFn:transport});
  expect(calls,'定义无法核验时必须零业务SSH启动').toEqual([]);
  expect(result).toMatchObject({success:false,reason:'script_definition_unverified'});
  expect((await db.query('SELECT * FROM task_runs WHERE task_id=$1',[t.id])).rows).toHaveLength(0);
});
it('无workflow的一般脚本保留既有执行行为',async()=>{
  const t=await task({workflow_id:undefined});
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:true});
  expect(calls).toEqual(['ssh']);
});
it('真实freeze-v1及已部署release在首次业务SSH之前原子绑定完整Activity与Step',async()=>{
  await fixture.close();fixture=await scriptDefinitionDatabase();db=fixture.db;workflow=fixture.workflow.workflow_id;
  const t=await task({cmd:fixture.command,source_revision:fixture.definition.source.revision});
  const atLaunch=[];
  const spawn=()=>{
    atLaunch.push(db.query('SELECT * FROM run_definition_bindings WHERE task_run_id IN(SELECT id FROM task_runs WHERE task_id=$1)',[t.id]));
    return transport();
  };
  const result=await triggerScriptRun(t,{pool:db,spawnFn:spawn});
  const bindings=(await atLaunch[0]).rows;
  expect(bindings,'外部执行开始前必须已提交真实binding').toHaveLength(1);
  expect(result).toMatchObject({success:true});
  expect(bindings[0]).toMatchObject({workflow_id:workflow,release_id:fixture.release.id,workflow_definition_version_id:fixture.workflow.id});
  expect(bindings[0].expected_path).toHaveLength(2);
  expect(bindings[0].expected_path[1].step_id).toBe(fixture.activities[0].payload.steps[0].step_id);
});
async function managedDependencies(){
  await db.query(`CREATE TABLE harness_attempts(id uuid,status text,machine_id text,actual_machine_id text,requested_machine_id text);
    CREATE TABLE harness_attempt_cleanup_outbox(attempt_id uuid,status text,target_machine_id text)`);
  await db.query(migrationSql('501_capacity_reservations.sql'));
  const observed=[];
  const client={capabilities:async()=>({worker_id:'private-worker',worker_boot_id:'private-boot',profiles:{harmless:'c'.repeat(64)}}),
    start:async(host,body)=>{
      calls.push('worker.start');observed.push((await db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[body.owner_key])).rows);
      return {receipt:{status:'running',container_id:'d'.repeat(64),worker_id:'private-worker',worker_boot_id:'private-boot'}};
    }};
  return {observed,deps:{pool:db,env:{SCRIPT_MANAGED_MACHINES:'us-mac-m4'},managed:{executionDirectory:false,client,
    collectSnapshot:async()=>({verified:true,machine:'us-mac-m4',captured_at:Date.now(),expires_at:Date.now()+60000,capacity:{ok:true,physical_base_slots:6,effective_base_slots:6}})}}};
}
it('正式定义缺失时managed预约也不得绕过绑定调用worker.start',async()=>{
  const t=await task({managed_script:{profile:'harmless'}});const {deps}=await managedDependencies();
  const result=await triggerScriptRun(t,deps);
  expect(calls).toEqual([]);expect(result).toMatchObject({success:false,reason:'script_definition_unverified'});
});
it('managed首次worker.start前真实Run和完整definition binding已经提交',async()=>{
  await fixture.close();fixture=await scriptDefinitionDatabase();db=fixture.db;workflow=fixture.workflow.workflow_id;
  const t=await task({cmd:fixture.command,source_revision:fixture.definition.source.revision,managed_script:{profile:'harmless'}});
  const {deps,observed}=await managedDependencies();const result=await triggerScriptRun(t,deps);
  expect(calls).toEqual(['worker.start']);expect(observed[0]).toHaveLength(1);
  expect(observed[0][0]).toMatchObject({workflow_id:workflow,release_id:fixture.release.id});
  expect(result).toMatchObject({success:true});
});
async function frozenTask(payload={}){
  await fixture.close();fixture=await scriptDefinitionDatabase();db=fixture.db;workflow=fixture.workflow.workflow_id;
  return task({cmd:fixture.command,source_revision:fixture.definition.source.revision,...payload});
}
it('同Run重复请求读原binding；current移除也不能退回旧路径绕过运行范围校验',async()=>{
  const t=await frozenTask();await triggerScriptRun(t,{pool:db,spawnFn:transport});
  const original=(await db.query('SELECT * FROM run_definition_bindings')).rows[0];
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:true});
  expect((await db.query('SELECT * FROM run_definition_bindings')).rows).toEqual([original]);
  await db.query('UPDATE workflows SET current_definition_version_id=NULL WHERE id=$1',[workflow]);
  const changed={...t,payload:{...t.payload,cmd:t.payload.cmd+' --changed'}};
  await db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[t.id,changed.payload]);calls=[];
  expect(await triggerScriptRun(changed,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});
  expect(calls).toEqual([]);expect((await db.query('SELECT * FROM run_definition_bindings')).rows).toEqual([original]);
});
it('已存在的未绑定历史Run不能在重放时补挂新定义',async()=>{
  const t=await frozenTask(),runId='script-'+t.id+'-a1';
  await db.query("INSERT INTO task_runs(task_id,run_id,status,workflow_id) VALUES($1,$2,'running',$3)",[t.id,runId,workflow]);
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});
  expect(calls).toEqual([]);expect((await db.query('SELECT * FROM run_definition_bindings')).rows).toHaveLength(0);
});
it.each(['source_revision','cmd','cwd','env'])('实际%s与冻结来源不符时零启动，不靠payload自报摘要放行',async field=>{
  const t=await frozenTask(),bad={source_revision:'f'.repeat(40),cmd:fixture.command+' --unexpected',cwd:'/tmp',env:{APP_TEST:'mismatch'}};
  t.payload[field]=bad[field];await db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[t.id,t.payload]);
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});
  expect(calls).toEqual([]);expect((await db.query('SELECT * FROM run_definition_bindings')).rows).toHaveLength(0);
});
it('已有运行的显式观测或runtime摘要不可被任务自报值冒领',async()=>{
  const t=await frozenTask();const launched=await triggerScriptRun(t,{pool:db,spawnFn:transport});
  const binding=(await db.query('SELECT * FROM run_definition_bindings WHERE run_id=$1',[launched.runId])).rows[0];
  t.payload.workflow_definition={release_id:binding.release_id,workflow_definition_version_id:binding.workflow_definition_version_id,snapshot_sha256:binding.snapshot_sha256,
    observation_id:randomUUID(),runtime_snapshot_sha256:'f'.repeat(64)};
  await db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[t.id,t.payload]);calls=[];
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});
  expect(calls).toEqual([]);
});
it('部署漂移不能凭曾部署成功观测起跑',async()=>{
  const t=await frozenTask();await recordReleaseObservation(db,fixture.release.id,{event_key:'drift',attempt_key:'drift',environment:fixture.release.environment,target:fixture.release.target,
    components:[],collector:'fixture-collector',observed_at:new Date(Date.now()+1000).toISOString(),evidence_ref:'scratch:actual-drift'},{trustedCollector:'fixture-collector'});
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});expect(calls).toEqual([]);
});
it('binding真实INSERT失败时Run与binding共同回滚，零外部启动',async()=>{
  const t=await frozenTask();await db.query("CREATE FUNCTION reject_script_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture binding insert rejected'; END $$;CREATE TRIGGER reject_script_binding BEFORE INSERT ON run_definition_bindings FOR EACH ROW EXECUTE FUNCTION reject_script_binding()");
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});expect(calls).toEqual([]);
  expect((await db.query('SELECT * FROM task_runs WHERE task_id=$1',[t.id])).rows).toHaveLength(0);
});
it('起跑前取消任务保持人值，不能创建Run或发SSH',async()=>{
  const t=await frozenTask();await db.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[t.id]);
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false});expect(calls).toEqual([]);
  expect((await db.query('SELECT status FROM tasks WHERE id=$1',[t.id])).rows[0].status).toBe('cancelled');
});
it('首次显式声明不能冒用其他Workflow或省略固定Step路径',async()=>{
  const t=await frozenTask();
  t.payload.workflow_definition={release_id:fixture.release.id,workflow_definition_version_id:fixture.workflow.id,snapshot_sha256:fixture.workflow.payload_sha256,
    workflow_id:randomUUID(),expected_path:[]};
  await db.query('UPDATE tasks SET payload=$2 WHERE id=$1',[t.id,t.payload]);
  expect(await triggerScriptRun(t,{pool:db,spawnFn:transport})).toMatchObject({success:false,reason:'script_definition_unverified'});expect(calls).toEqual([]);
});
it('两次SSH交付失败后同一未知尝试仍可由原ALREADY协议恢复，不改绑定或重开终态',async()=>{
  const t=await frozenTask();
  const failed=()=>{
    const child=transport();child.stdin.removeAllListeners('finish');
    child.stdin.on('finish',()=>queueMicrotask(()=>{child.stderr.end('fixture transport unavailable');child.emit('close',255);}));return child;
  };
  expect(await triggerScriptRun(t,{pool:db,spawnFn:failed})).toMatchObject({success:false,reason:'script_spawn_failed'});
  const original=(await db.query('SELECT * FROM run_definition_bindings')).rows[0];
  const already=()=>{
    const child=transport();child.stdin.removeAllListeners('finish');
    child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.end('ALREADY\n');child.emit('close',0);}));return child;
  };
  expect(await triggerScriptRun(t,{pool:db,spawnFn:already})).toMatchObject({success:true,alreadyRunning:true});
  expect((await db.query('SELECT * FROM run_definition_bindings')).rows).toEqual([original]);
  expect((await db.query('SELECT status FROM task_runs WHERE task_id=$1',[t.id])).rows).toEqual([{status:'running'}]);
});
