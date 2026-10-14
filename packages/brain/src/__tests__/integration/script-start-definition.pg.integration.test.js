import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {scriptDefinitionDatabase} from '../fixtures/script-definition-db.js';
import {versionsDatabase,seedWorkflows} from '../fixtures/definition-versions-db.js';
import {migrationSql,withLegacyNames} from '../fixtures/minimum-definition-schema.js';
import {triggerScriptRun} from '../../script-executor.js';
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
