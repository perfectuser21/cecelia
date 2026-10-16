import {it,expect,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {authoringExecutionDatabase,startPureAuthoring,settleInvocation} from '../fixtures/authoring-execution-db.test.js';
import {nativeSpec as s,prepareNativeSource} from '../../lib/workflow-assembly-native-source.js';
import {registerNativeReconcile} from '../../lib/workflow-assembly-native-registration.js';
import {runNativeReconcile} from '../../lib/workflow-assembly-native.js';
let f;
afterEach(async()=>{await f?.close();f=null;});
const readSource=async(_revision,path)=>readFileSync(new URL('../../../../../'+path,import.meta.url),'utf8');
async function fixture(){
  f=await authoringExecutionDatabase();const db=f.pool;
  await db.query('CREATE TABLE ops_schedule_entries(LIKE public.ops_schedule_entries INCLUDING ALL);CREATE TABLE ops_workflows(LIKE public.ops_workflows INCLUDING ALL);CREATE TABLE working_memory(LIKE public.working_memory INCLUDING ALL)');
  await db.query("INSERT INTO capabilities(id,name,parent_journey_id,status) SELECT $1,'系统看护 · 业务线健康巡检',parent_journey_id,'active' FROM capabilities LIMIT 1",[s.capability_id]);
  await db.query("INSERT INTO ops_workflows(id,source,wf_id,name,machine,active) VALUES($1,'scheduler',$2,'真实维护作业','us-vps',false)",[s.schedule.ops_workflow_id,s.schedule.label]);
  await db.query(`INSERT INTO ops_schedule_entries(id,source,host_alias,label,kind,ops_workflow_id,active,enabled,registered_via,ledger_status)
    VALUES($1,'brain','us-vps',$2,'brain_job',$3,true,true,'brain-job','registered')`,[s.schedule.id,s.schedule.label,s.schedule.ops_workflow_id]);
  const source=await prepareNativeSource({revision:'a'.repeat(40),readFile:readSource});
  return {db,source,services:{revision:source.commit,readSource}};
}
it('真实PG登记幂等固定版本，镜子状态不变，无生产release指针；单轮一run一span，同key只读回',async()=>{
  const {db,source,services}=await fixture();
  const first=await registerNativeReconcile(db,source),second=await registerNativeReconcile(db,source);
  expect(second).toEqual(first);
  expect((await db.query('SELECT active FROM ops_workflows')).rows[0].active).toBe(false);
  expect((await db.query('SELECT count(*)::int n FROM activity_release_state')).rows[0].n).toBe(0);
  const r=await runNativeReconcile(db,{request_key:'one',trigger:'manual'},services);
  expect(r.run.outcome).toBe('pass');expect(r.run.detail.reason).toBe('empty');
  const again=await runNativeReconcile(db,{request_key:'one',trigger:'manual'},services);
  expect(again.replayed).toBe(true);
  expect((await db.query('SELECT count(*)::int n FROM runs')).rows[0].n).toBe(1);
  const spans=(await db.query('SELECT * FROM spans')).rows;
  expect(spans).toHaveLength(1);expect(spans[0].activity_id).toBe(s.activities[0].id);
  expect(r.run.header_source).toBe('owner');expect(r.run.detail.formal_release).toBe(false);
});
it.each(['source','kind','host_alias','label','ops_workflow_id'])('真实PG镜子身份%s冲突全事务零登记',async field=>{
  const {db,source}=await fixture();
  await db.query(`UPDATE ops_schedule_entries SET ${field}=$1`,[field==='ops_workflow_id'?999:'other']);
  await expect(registerNativeReconcile(db,source)).rejects.toThrow();
  expect((await db.query('SELECT count(*)::int n FROM workflows WHERE id=$1',[s.id])).rows[0].n).toBe(0);
  expect((await db.query('SELECT count(*)::int n FROM workflow_definition_versions')).rows[0].n).toBe(0);
});
it('真实PG owner落账失败不写业务游标，不造span',async()=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);
  await db.query("ALTER TABLE runs ADD CONSTRAINT reject_native CHECK (executor_id IS DISTINCT FROM 'brain-native-maintenance')");
  await expect(runNativeReconcile(db,{request_key:'fail-ledger'},services)).rejects.toThrow();
  expect((await db.query('SELECT count(*)::int n FROM working_memory WHERE key=$1',['workflow_assembly_reconcile_cursor:v1'])).rows[0].n).toBe(0);
  expect((await db.query('SELECT count(*)::int n FROM spans')).rows[0].n).toBe(0);
});
it('真实PG已登记Activity被人工停用后，原生入口不能继续写游标或成功span',async()=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);
  await db.query("UPDATE activities SET status='paused' WHERE id=$1",[s.activities[0].id]);
  await expect(runNativeReconcile(db,{request_key:'inactive'},services)).rejects.toThrow();
  expect((await db.query('SELECT count(*)::int n FROM working_memory')).rows[0].n).toBe(0);
});
it.each(['cancelled','budget'])('真实runner%s停止不能被通用error分支误记fail',async stopped=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);await startPureAuthoring(f);
  const controller=new AbortController();let now=Date.now();services.signal=controller.signal;
  services.runnerOptions={now:()=>now,readReadiness:async()=>{if(stopped==='cancelled')controller.abort();else now+=30000;return {};}};
  const result=await runNativeReconcile(db,{request_key:'stop-'+stopped},services);
  expect(result.run.outcome).toBe(stopped==='budget'?'timeout':'unknown');
  expect(result.run.detail.reason).toBe(stopped);
  expect((await db.query('SELECT outcome FROM spans WHERE activity_id=$1',[s.activities[0].id])).rows[0].outcome).toBe('unknown');
});
it('真实默认native入口驱动候选、损坏修复、新run复验到closed，每轮只记同一meta的一run一span',async()=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);
  const authoring=await startPureAuthoring(f);
  services.runnerOptions={authoringOptions:{freezeOptions:{readFile:f.reader},invocationOptions:{readFile:f.reader,probeRuntime:async()=>({ready:true})},readFile:f.reader,probeRuntime:async()=>({ready:true})}};
  let rounds=0;
  const current=async()=>(await db.query('SELECT result FROM tasks WHERE id=$1',[authoring.id])).rows[0].result;
  const round=async()=>{
    const r=await runNativeReconcile(db,{request_key:'closure-'+(++rounds)},services);expect(r.run.outcome).toBe('pass');
    const queued=(await db.query("SELECT id FROM tasks WHERE payload->'invocation' IS NOT NULL AND status='queued'")).rows;
    for(const t of queued)await settleInvocation(f,t.id);
    return current();
  };
  let state;
  for(let i=0;i<12;i++){state=await round();if(state.workflow_assembly_reconcile?.status==='verified')break;}
  expect(state.workflow_assembly_reconcile?.status).toBe('verified');
  const owner=state.workflow_authoring_candidate;
  const old=(await db.query('SELECT run_id FROM task_runs')).rows.map(r=>r.run_id);
  await db.query('DELETE FROM workflow_activity_refs WHERE workflow_id=$1',[owner.workflow_id]);
  state=await round();expect(state.workflow_assembly_reconcile.revalidation_request).toBeTruthy();
  expect(state.workflow_assembly_reconcile.status).not.toBe('verified');
  for(let i=0;i<12;i++){state=await round();if(state.workflow_assembly_reconcile?.status==='verified')break;}
  expect(state.workflow_assembly_reconcile.status).toBe('verified');
  expect(Object.values(state.workflow_assembly_reconcile.issues).every(i=>i.status==='closed')).toBe(true);
  expect((await db.query('SELECT count(*)::int n FROM task_runs WHERE run_id<>ALL($1::text[])',[old])).rows[0].n).toBeGreaterThan(0);
  expect((await db.query('SELECT count(*)::int n FROM runs WHERE workflow_id=$1',[s.id])).rows[0].n).toBe(rounds);
  expect((await db.query('SELECT count(*)::int n FROM spans WHERE activity_id=$1',[s.activities[0].id])).rows[0].n).toBe(rounds);
},30000);
