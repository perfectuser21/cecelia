import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 接棒是既有独立合同；本夹具保留真实terminal SQL、收割与ensure，只隔离下游接棒。
vi.mock('../../lib/relay-baton.js', () => ({ relayOnComplete: async () => null }));
import { buildRunnerScript, reapLegacyScriptRuns } from '../../script-executor.js';
import { createOnboardingService } from '../service.js';

const url = process.env.NODE_ONBOARDING_TEST_DB;
const suite = url ? describe : describe.skip;
const execute = promisify(execFile);
suite('脚本收尾真实PG与runner闭环', () => {
  let admin, pool, schema, home, service;
  const input = { name: 'settlement-fixture', address: '192.0.2.81', ssh_user: 'operator', ssh_port: 22,
    credential_ref: 'op://CS/fixture/private key', host_key_fingerprint: `SHA256:${'b'.repeat(43)}`,
    role: 'worker', region: 'HK' };
  beforeAll(async () => {
    const database = new URL(url).pathname;
    if (database !== '/cecelia_scratch' && !(process.env.CI === 'true' && database === '/cecelia_test')) throw Error('scratch only');
    schema = `settlement_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,executor_kind text,
      payload jsonb,result jsonb,error_message text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      completed_at timestamptz,parent_task_id uuid,claimed_by text,claimed_at timestamptz,started_at timestamptz);
      CREATE TABLE system_registry(id uuid PRIMARY KEY,type text,name text,description text,status text,metadata jsonb,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(type,name));
      CREATE TABLE execution_nodes(machine_registry_id uuid PRIMARY KEY,current_version_id uuid);
      CREATE TABLE task_events(task_id uuid,event_type text,payload jsonb,created_at timestamptz);
      CREATE TABLE task_runs(id uuid PRIMARY KEY,task_id uuid,run_id text,status text,ended_at timestamptz,
      result jsonb,error_message text,updated_at timestamptz);`);
    const createTask = async args => ({ success: true, task: (await args.db.query(
      'INSERT INTO tasks(id,title,task_type,status,payload,parent_task_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [randomUUID(),args.title,args.task_type,args.status??'queued',args.payload,args.parent_task_id??null])).rows[0] });
    service = createOnboardingService({ pool, createTask });
    home = await mkdtemp(join(tmpdir(), 'script-settlement-'));
  });
  beforeEach(async () => { await pool.query('TRUNCATE tasks,system_registry,task_events,task_runs'); });
  afterAll(async () => {
    await pool?.end();
    if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
    if (home) await rm(home, { recursive: true, force: true });
  });
  const transport = (seen = []) => ({ execFileFn: (_bin,args,opts,cb) => {
    seen.push(args.at(-1));
    return execFile('sh', ['-c',args.at(-1)], { ...opts, env: { ...process.env,HOME:home } }, cb);
  } });
  function report(view, age = 0) {
    return { type:'node_onboarding_receipt',id:view.id,name:input.name,mode:'enroll',verified:true,
      service:{enabled:true,active:true},health:{schema_version:1,node_id:view.id,agent_version:'1',
        observed_at:new Date(Date.now()-age).toISOString(),boot_id:view.id,sequence:2,hostname:input.name,os:'linux',
        capabilities:{collector:true,janitor:true,execution:false},janitor:{mode:'observe',policy:'owned-cache-only'},
        resources:{memory_total_bytes:8e9,memory_available_bytes:4e9,cpu_load_1m:0.2,cpu_cores:4,disk_free_bytes:10e9,disk_total_bytes:40e9}} };
  }
  async function runner(view, receipt) {
    const runId = `script-${view.task_id}-a1`;
    await pool.query("UPDATE tasks SET status='in_progress',executor_kind='script',payload=payload||$2::jsonb WHERE id=$1",
      [view.task_id,JSON.stringify({host_id:'us-mac-m4',script_run_id:runId})]);
    const content=JSON.stringify(receipt).replaceAll("'", "'\\''");
    const script=buildRunnerScript({runId,timeoutSec:20,jobScript:`printf '%s\\n' '${content}'`});
    await execute('sh',['-c',script],{env:{...process.env,HOME:home},timeout:5000});
    for (let i=0;i<100;i++) {
      try { expect((await readFile(join(home,'brain-runs',runId+'.exit'),'utf8')).trim()).toBe('0'); return; }
      catch(error) { if(error.code!=='ENOENT')throw error; await new Promise(resolve=>setTimeout(resolve,20)); }
    }
    throw Error('fixture runner did not exit');
  }

  it('真实runner exit→terminal SQL→observer收账→Linux ensure唯一子任务；active不冒充执行授权', async () => {
    const view=await service.create(input,randomUUID());
    await runner(view,report(view));
    expect((await reapLegacyScriptRuns(pool,transport())).completed).toBe(1);
    await Promise.all([service.reconcile(),service.reconcile()]);
    const task=(await pool.query('SELECT * FROM tasks WHERE id=$1',[view.task_id])).rows[0];
    expect(task).toMatchObject({status:'completed',payload:{node_onboarding:{reconciled:true}},result:{script:{exit_code:0}}});
    const machine=(await pool.query('SELECT * FROM system_registry')).rows[0];
    expect(machine).toMatchObject({status:'active',metadata:{executors:[],node_health:{capabilities:{execution:false}}}});
    const children=(await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows;
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({status:'in_progress',parent_task_id:view.task_id,claimed_by:'linux-pool-onboarding',payload:{linux_onboarding:{phase:'probe'}}});
    expect(task.payload.node_onboarding.execution_task_id).toBe(children[0].id);
    expect((await pool.query("SELECT * FROM task_events WHERE event_type='script_reaped'")).rows).toHaveLength(1);
  });

  it('真实过期回执仍拒绝注册，不能因独立调度放宽90秒', async () => {
    const view=await service.create(input,randomUUID());
    await runner(view,report(view,100_000));
    await reapLegacyScriptRuns(pool,transport()); await service.reconcile();
    expect((await service.get(view.id)).status).toBe('failed');
    expect((await pool.query('SELECT * FROM system_registry')).rows).toHaveLength(0);
    expect((await pool.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(0);
  });

  it('真实SQL轮转跨11项，删除游标行/新任务到达/空批均不丢待收任务', async () => {
    const seen=[];
    const ids=Array.from({length:11},(_,i)=>`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`);
    for(const id of ids)await pool.query("INSERT INTO tasks(id,task_type,status,executor_kind,payload) VALUES($1,'script_run','in_progress','script',$2)",
      [id,{host_id:'us-mac-m4',script_run_id:`script-${id}-a1`}]);
    await reapLegacyScriptRuns(pool,transport(seen));
    const selected=seen.map(command=>ids.find(id=>command.includes(id)));expect(new Set(selected).size).toBe(10);
    const cursor=selected.at(-1);await pool.query('DELETE FROM tasks WHERE id=$1',[cursor]);
    seen.length=0;await reapLegacyScriptRuns(pool,transport(seen));
    expect(seen.some(command=>command.includes(ids[10]))).toBe(true);
    await pool.query('DELETE FROM tasks');
    expect((await reapLegacyScriptRuns(pool,transport())).reaped).toBe(0);
    const id='11111111-1111-4111-8111-000000000001';
    await pool.query("INSERT INTO tasks(id,task_type,status,executor_kind,payload) VALUES($1,'script_run','in_progress','script',$2)",
      [id,{host_id:'us-mac-m4',script_run_id:`script-${id}-a1`}]);
    seen.length=0;await reapLegacyScriptRuns(pool,transport(seen));
    expect(seen).toHaveLength(1);expect(seen[0]).toContain(id);
  });
});
