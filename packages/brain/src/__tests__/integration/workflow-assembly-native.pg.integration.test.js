import {nativeMaintenanceDatabase,readSource} from '../fixtures/workflow-assembly-native-db.test.js';
import {it,expect,afterEach} from 'vitest';
import {startPureAuthoring,settleInvocation} from '../fixtures/authoring-execution-db.test.js';
import {nativeSpec as s,prepareNativeSource} from '../../lib/workflow-assembly-native-source.js';
import {registerNativeReconcile} from '../../lib/workflow-assembly-native-registration.js';
import {runNativeReconcile} from '../../lib/workflow-assembly-native.js';
import {listSystemRuns,readSystemRunEvidence} from '../../lib/capability-system-evidence.js';
let f;
afterEach(async()=>{await f?.close();f=null;});
async function fixture(){f=await nativeMaintenanceDatabase();return f;}
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
it('真实PG升级原生版本后，目录运行列表和证据保持旧run固定版本，同key不重新执行',async()=>{
  const {db,source,services}=await fixture();const first=await registerNativeReconcile(db,source);
  const run=await runNativeReconcile(db,{request_key:'history'},services);
  const next=await registerNativeReconcile(db,await prepareNativeSource({revision:'b'.repeat(40),readFile:readSource}));
  expect(next.workflow_definition_version_id).not.toBe(first.workflow_definition_version_id);
  const list=await listSystemRuns(db,{workflowId:s.id});
  expect(list.total).toBe(1);expect(list.runs[0].workflow_definition_version_id).toBe(first.workflow_definition_version_id);
  const evidence=await readSystemRunEvidence(db,run.native_run_id);
  expect(evidence.workflow_definition_version_id).toBe(first.workflow_definition_version_id);
  expect(evidence).toMatchObject({native_maintenance:true,formal_release:false,business_outcome:'not_evaluated',evidence_status:'native_observation'});
  await expect(runNativeReconcile(db,{request_key:'history'},services)).rejects.toMatchObject({status:409});
  expect((await db.query('SELECT count(*)::int n FROM runs')).rows[0].n).toBe(1);
});
it('真实PG首轮自动登记和已部署源码续版，不靠HTTP逐条补目录',async()=>{
  const {db,services}=await fixture();const first=await runNativeReconcile(db,{request_key:'auto-first'},services);
  expect(first.run.workflow_id).toBe(s.id);
  const oldVersion=first.run.detail.workflow_definition_version_id;
  const updatedServices={...services,revision:'b'.repeat(40),readSource:async(revision,path)=>revision==='a'.repeat(40)?'outdated bytes':readSource(revision,path)};
  const second=await runNativeReconcile(db,{request_key:'auto-next'},updatedServices);
  expect(second.run.detail.source.commit).toBe('b'.repeat(40));
  expect(second.run.detail.workflow_definition_version_id).not.toBe(oldVersion);
  expect((await db.query('SELECT active FROM ops_workflows')).rows[0].active).toBe(false);
});
it('真实PG清理连接失败不假成功；下轮取原锁后将遗留owner收unknown，不重发旧key或补PASS span',async()=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);
  const poison={query:db.query.bind(db),connect:async()=>{
    const client=await db.connect();return {release:e=>client.release(e),query:(sql,...values)=>{
      if(sql?.text==='RESET statement_timeout')throw Error('fixture_reset_failure');return client.query(sql,...values);
    }};
  }};
  await expect(runNativeReconcile(poison,{request_key:'interrupted'},services)).rejects.toMatchObject({status:503});
  expect((await db.query('SELECT outcome FROM runs')).rows[0].outcome).toBe('running');
  const second=await runNativeReconcile(db,{request_key:'recover'},services);expect(second.run.outcome).toBe('pass');
  const old=(await db.query("SELECT * FROM runs WHERE trigger_ref='interrupted'")).rows[0];
  expect(old.outcome).toBe('unknown');expect(old.detail.reason).toBe('owner_interrupted');
  expect((await db.query('SELECT count(*)::int n FROM spans WHERE run_id=$1',[old.run_id])).rows[0].n).toBe(0);
  expect((await runNativeReconcile(db,{request_key:'interrupted'},services)).run.outcome).toBe('unknown');
});
it('真实PG原锁竞争零新run；同key运行中只读回，不二次执行或抢旧终态',async()=>{
  const {db,source,services}=await fixture();await registerNativeReconcile(db,source);await startPureAuthoring(f);
  let begin,release;const began=new Promise(r=>begin=r),wait=new Promise(r=>release=r);
  const first=runNativeReconcile(db,{request_key:'concurrent'},{...services,runnerOptions:{readReadiness:async()=>{begin();await wait;return {};}}});
  try{
    await began;
    const replay=await runNativeReconcile(db,{request_key:'concurrent'},services);expect(replay.replayed).toBe(true);expect(replay.run.outcome).toBe('running');
    const locked=await runNativeReconcile(db,{request_key:'other'},services);expect(locked.report.skipped).toBe('locked');expect(locked.native_run_id).toBeNull();
    expect((await db.query('SELECT count(*)::int n FROM runs')).rows[0].n).toBe(1);
  }finally{release();await first;}
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
