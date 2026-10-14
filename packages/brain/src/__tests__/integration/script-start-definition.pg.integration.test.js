import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {versionsDatabase,seedWorkflows} from '../fixtures/definition-versions-db.js';
import {migrationSql,withLegacyNames} from '../fixtures/minimum-definition-schema.js';
import {triggerScriptRun} from '../../script-executor.js';
vi.mock('../../runtime-safety.js',()=>({assertExternalExecutionAllowed(){}}));
let fixture,db,workflow,calls;
beforeEach(async()=>{
  fixture=await versionsDatabase();await fixture.migrate();db=fixture.db;
  await withLegacyNames(db,()=>db.query(migrationSql('515_release_definition_evidence.sql')));
  await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text, ADD COLUMN IF NOT EXISTS executor_kind text,
    ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}';
    CREATE TABLE task_events(task_id uuid,event_type text,payload jsonb,created_at timestamptz)`);
  const ids=await seedWorkflows(db);workflow=ids.keyword;
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
