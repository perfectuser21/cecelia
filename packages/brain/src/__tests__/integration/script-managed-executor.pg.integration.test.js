import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { prepareScriptDispatch,triggerScriptRun,reapScriptRuns } from '../../script-executor.js';
// 仅放开注入到本机fixture HTTP 的外部执行闸；被测入口、数据库、client、worker均真实。
vi.mock('../../runtime-safety.js',()=>({assertExternalExecutionAllowed(){}}));
const require=createRequire(import.meta.url),exec=promisify(execFile);
const {createScriptRunner}=require('../../../scripts/fleet-worker/script-runner.cjs');
const {createFleetWorkerServer}=require('../../../scripts/fleet-worker/fleet-worker.cjs');
const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname.slice(1):DB_DEFAULTS.database;
if(!/_(scratch|test)$/.test(database))throw new Error('scratch/test required');
const schema=`managed_${process.pid}_${randomUUID().replaceAll('-','')}`;
const pool=new pg.Pool({...options,options:`-c search_path=${schema},public`});
const admin=new pg.Client(options);
const root=mkdtempSync(path.join(tmpdir(),'managed-protocol-'));
const containers=new Map();let starts=0,server,runner,deps,rejectStart=false;
const token='test-worker-secret-'.repeat(4),machine='us-mac-m4';
beforeAll(async()=>{
  await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);
    CREATE TABLE tasks(id UUID PRIMARY KEY,title TEXT DEFAULT 'fixture',task_type TEXT DEFAULT 'script_run',status TEXT,
      priority TEXT DEFAULT 'P2',executor_kind TEXT DEFAULT 'script',payload JSONB DEFAULT '{}',result JSONB DEFAULT '{"handoff":{"schema_version":"v1","next_steps":[]}}',
      claimed_by TEXT,claimed_at TIMESTAMPTZ,started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),error_message TEXT,parent_task_id UUID,project_id UUID,summary TEXT);
    CREATE TABLE task_runs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),task_id UUID,run_id TEXT UNIQUE,status TEXT,
      context JSONB,result JSONB,started_at TIMESTAMPTZ DEFAULT NOW(),ended_at TIMESTAMPTZ,error_message TEXT,updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE task_events(task_id UUID,event_type TEXT,payload JSONB,created_at TIMESTAMPTZ);
    CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',orchestrator_version TEXT DEFAULT 'v2');`);
  for(const file of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile',
    '363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations']) {
    await pool.query(readFileSync(new URL(`../../../migrations/${file}.sql`,import.meta.url),'utf8'));
  }
  runner=createScriptRunner({assertLocalResources:async()=>{if(rejectStart)throw Object.assign(new Error('attempt_local_resources_unavailable'),{statusCode:429});},stateRoot:root,machineId:machine,workerId:machine,bootId:'boot-fixture',
    profiles:{harmless:{image:`alpine@sha256:${'b'.repeat(64)}`,cpus:1,memoryBytes:67108864,pidsLimit:16,user:'1000:1000',cwd:'/job'}},
    docker:{async create({name,command,identity}){const id=randomUUID().replaceAll('-','').repeat(2);
      containers.set(id,{id,name,command,status:'created',labels:Object.fromEntries(Object.entries(identity).map(([k,v])=>[`cecelia.script.${k}`,String(v)]))});return id;},
      async inspect(id){return [...containers.values()].find(c=>c.id===id||c.name===id)??null;},
      async start(id){starts++;const c=containers.get(id);const r=await exec('/bin/sh',['-c',c.command]);Object.assign(c,{status:'exited',exit_code:0,stdout:r.stdout,stderr:''});},
      async remove(id){containers.delete(id);}}});
  server=createFleetWorkerServer({machineId:machine,attemptToken:token,scriptRunner:runner});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const api=await import('../../script-worker-client.js').catch(()=>({}));
  expect(api.createScriptWorkerClient,'必须通过实际认证client调用worker').toBeTypeOf('function');
  deps={pool,env:{SCRIPT_MANAGED_MACHINES:machine},managed:{client:api.createScriptWorkerClient({
    urls:{[machine]:`http://127.0.0.1:${server.address().port}`},token}),
    collectSnapshot:async()=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+60_000,
      capacity:{ok:true,physical_base_slots:6,effective_base_slots:6}})}};
});
beforeEach(async()=>{await pool.query('TRUNCATE capacity_reservations,tasks,task_runs,task_events CASCADE');starts=0;rejectStart=false;containers.clear();});
afterAll(async()=>{runner?.close();if(server)await new Promise(r=>server.close(r));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();rmSync(root,{recursive:true,force:true});});
async function task(extra={}) {
  const id=randomUUID();const payload={host:machine,cmd:'printf actual-managed-output',timeout_sec:30,managed_script:{profile:'harmless'},...extra};
  return (await pool.query("INSERT INTO tasks(id,status,payload,claimed_by) VALUES($1,'queued',$2,'fixture') RETURNING *",[id,payload])).rows[0];
}
it('实际prepare→trigger→worker→reap产生输出，强清理后释放预约，下一脚本才可执行',async()=>{
  const first=await task(),second=await task();
  expect(await prepareScriptDispatch(first,deps)).toMatchObject({outcome:'proceed'});
  expect(await prepareScriptDispatch(second,deps)).toMatchObject({outcome:'skip'});
  expect((await pool.query('SELECT claimed_by FROM tasks WHERE id=$1',[second.id])).rows[0].claimed_by).toBeNull();
  expect(await triggerScriptRun(first,deps)).toMatchObject({success:true,executor:'script'});
  expect(await triggerScriptRun(first,deps)).toMatchObject({success:true});expect(starts).toBe(1);
  const out=await reapScriptRuns(pool,deps);expect(out.completed).toBe(1);
  expect((await pool.query('SELECT status,result FROM tasks WHERE id=$1',[first.id])).rows[0]).toMatchObject({status:'completed',result:{script:{stdout:'actual-managed-output'}}});
  expect((await pool.query('SELECT status,confirmed_receipt FROM capacity_reservations')).rows[0]).toMatchObject({status:'released',confirmed_receipt:{status:'cleaned',tombstoned:true}});
  expect((await pool.query('SELECT status FROM task_runs')).rows).toEqual([{status:'success'}]);
  expect(await prepareScriptDispatch(second,deps)).toMatchObject({outcome:'proceed'});
});
it('启动响应丢失不消耗重试、不重复start；任务取消后仍从预约扫描清理',async()=>{
  const first=await task();let lost=true;
  const real=deps.managed.client;
  const client={...real,start:async(...args)=>{const r=await real.start(...args);if(lost){lost=false;throw new Error('response_lost');}return r;}};
  expect(await triggerScriptRun(first,{...deps,managed:{...deps.managed,client}})).toMatchObject({success:true,pending:true});
  expect(await triggerScriptRun(first,deps)).toMatchObject({success:true});expect(starts).toBe(1);
  await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[first.id]);
  await reapScriptRuns(pool,deps);
  expect((await pool.query('SELECT status FROM capacity_reservations')).rows).toEqual([{status:'released'}]);
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[first.id])).rows[0].status).toBe('cancelled');
});
it('受管机器的旧宿主cwd任务明确blocked，绝不发SSH',async()=>{
  const first=await task({managed_script:undefined,cwd:'/Users/administrator/project'});
  const out=await prepareScriptDispatch(first,deps);
  expect(out).toMatchObject({outcome:'return',result:{reason:'script_managed_spec_required'}});
  expect((await pool.query('SELECT id FROM capacity_reservations')).rows).toHaveLength(0);expect(starts).toBe(0);
});

it('确认清理后任务写入失败，重启收割released预约补结算且不重新占位',async()=>{
  const first=await task();await triggerScriptRun(first,deps);
  let fail=true;
  const faulty={connect:pool.connect.bind(pool),query:async(sql,args)=>{
    if(fail&&sql.startsWith("UPDATE tasks SET status = 'completed'")){fail=false;throw new Error('crash_before_settle');}
    return pool.query(sql,args);
  }};
  await reapScriptRuns(faulty,{...deps,pool:faulty});
  expect((await pool.query('SELECT status FROM capacity_reservations')).rows).toEqual([{status:'released'}]);
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[first.id])).rows[0].status).toBe('in_progress');
  await reapScriptRuns(pool,deps);
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[first.id])).rows[0].status).toBe('completed');
  expect(starts).toBe(1);
});
it('cleanup_pending时发现丢失的exact容器ID仍可补绑并最终清理',async()=>{
  const first=await task();await triggerScriptRun(first,{...deps,managed:{...deps.managed,client:{...deps.managed.client,
    start:async(...args)=>{await deps.managed.client.start(...args);throw new Error('lost_response');}}}});
  await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[first.id]);
  await pool.query("UPDATE capacity_reservations SET status='cleanup_pending'");
  await reapScriptRuns(pool,deps);
  expect((await pool.query('SELECT status,container_id FROM capacity_reservations')).rows[0]).toMatchObject({status:'released',container_id:expect.any(String)});
  expect(containers.size).toBe(0);
});

it('预约后本机压力升高返回wait并放队列claim，恢复后同一意图只启动一次',async()=>{
  const first=await task();rejectStart=true;
  expect(await triggerScriptRun(first,deps)).toMatchObject({success:false,wait:true});
  const waiting=(await pool.query('SELECT status,claimed_by,payload FROM tasks WHERE id=$1',[first.id])).rows[0];
  expect(waiting).toMatchObject({status:'queued',claimed_by:null});expect(waiting.payload.script_attempts).toBeUndefined();
  rejectStart=false;
  expect(await triggerScriptRun(first,deps)).toMatchObject({success:true});expect(starts).toBe(1);
  await reapScriptRuns(pool,deps);
  expect((await pool.query('SELECT status FROM tasks WHERE id=$1',[first.id])).rows[0].status).toBe('completed');
});
it('旧released扫描暂停后新代已启动，旧结算CAS不得终结新代任务',async()=>{
  const first=await task();await triggerScriptRun(first,deps);
  const failSettle={connect:pool.connect.bind(pool),query:async(sql,args)=>{
    if(sql.startsWith("UPDATE tasks SET status = 'completed'"))throw new Error('defer_settle');
    return pool.query(sql,args);
  }};
  await reapScriptRuns(failSettle,{...deps,pool:failSettle});
  let release,arrived;const paused=new Promise(r=>{arrived=r;}),gate=new Promise(r=>{release=r;});
  let intercept=true;
  const delayed={connect:pool.connect.bind(pool),query:async(sql,args)=>{
    const value=await pool.query(sql,args);
    if(intercept&&sql==='SELECT * FROM tasks WHERE id=$1'){intercept=false;arrived();await gate;}
    return value;
  }};
  const stale=reapScriptRuns(delayed,{...deps,pool:delayed});await paused;
  await reapScriptRuns(pool,deps);
  const next=(await pool.query(`UPDATE tasks SET status='queued',payload=(payload-'script_run_id'-'script_reservation_id')
    ||'{"script_attempts":[{"attempt":1}]}'::jsonb WHERE id=$1 RETURNING *`,[first.id])).rows[0];
  await triggerScriptRun(next,deps);
  const before=(await pool.query('SELECT status,payload,result FROM tasks WHERE id=$1',[first.id])).rows[0];
  release();await stale;
  expect((await pool.query('SELECT status,payload,result FROM tasks WHERE id=$1',[first.id])).rows[0]).toEqual(before);
  expect(before.status).toBe('in_progress');expect(starts).toBe(2);
});
it.each(['a','"','汉字'])('真实HTTP传递大输出 %s 后仍能清理结算，并明确截断',async(text)=>{
  const first=await task({cmd:`node -e 'process.stdout.write(${JSON.stringify(text)}.repeat(70000))'`});
  await triggerScriptRun(first,deps);await reapScriptRuns(pool,deps);
  const row=(await pool.query('SELECT status,result FROM tasks WHERE id=$1',[first.id])).rows[0];
  expect(row.status).toBe('completed');expect(Buffer.byteLength(JSON.stringify(row.result.script.stdout))).toBeLessThanOrEqual(48000);
  expect(row.result.script.logs_truncated).toBe(true);expect(containers.size).toBe(0);
});
it.each(['worker_id','worker_boot_id'])('认证HTTP错 %s cancel 不删除、不释放预算',async(field)=>{
  const first=await task();await triggerScriptRun(first,deps);
  const row=(await pool.query('SELECT * FROM capacity_reservations')).rows[0];
  const input={reservation_id:row.id,machine_id:row.machine_id,owner_key:row.owner_key,intent_id:row.intent_id,
    launch_generation:row.launch_generation,config_digest:row.config_digest,worker_id:row.worker_id,
    worker_boot_id:row.worker_boot_id,container_id:row.container_id,challenge:randomUUID(),[field]:'wrong'};
  await expect(deps.managed.client.cancel(machine,input)).rejects.toThrow('http_409');
  expect(containers.size).toBe(1);
  expect((await pool.query('SELECT status FROM capacity_reservations')).rows[0].status).toBe('running');
});
it('启动请求未抵达worker时，先认证cancel持久墓碑才释放并允许下一次尝试',async()=>{
  const first=await task();
  expect(await triggerScriptRun(first,{...deps,managed:{...deps.managed,client:{...deps.managed.client,
    start:async()=>{throw new Error('request_never_arrived');}}}})).toMatchObject({success:true,pending:true});
  await reapScriptRuns(pool,deps);
  const reservation=(await pool.query('SELECT * FROM capacity_reservations')).rows[0];
  expect(reservation).toMatchObject({status:'released',confirmed_receipt:{tombstoned:true,container_id:null}});
  const next=(await pool.query('SELECT * FROM tasks WHERE id=$1',[first.id])).rows[0];
  expect(next.status).toBe('queued');expect(next.payload.script_attempts).toHaveLength(1);expect(starts).toBe(0);
  await triggerScriptRun(next,deps);expect(starts).toBe(1);
});
