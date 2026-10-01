import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createOnboardingService } from '../service.js';

const database = process.env.NODE_ONBOARDING_TEST_DB;
const suite = database ? describe : describe.skip;
suite('机器接入真实数据库闭环（隔离 schema）', () => {
  let admin, db, service, schema;
  const input = { name: 'new-node', address: '192.0.2.42', ssh_user: 'operator', ssh_port: 22,
    credential_ref: 'op://CS/node/private key', host_key_fingerprint: `SHA256:${'b'.repeat(43)}`,
    role: 'observer', region: 'HK' };
  const key = '64c5b5a5-6074-483b-a884-58d292cf200f';
  beforeAll(async () => {
    if (new URL(database).pathname !== '/cecelia_scratch') throw new Error('本地集成验收只允许 cecelia_scratch');
    schema = `onboarding_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: database });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: database, options: `-c search_path=${schema},public` });
    await db.query(`CREATE TABLE tasks (
      id uuid PRIMARY KEY, title text, task_type text, status text, payload jsonb,
      result jsonb, error_message text, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(), completed_at timestamptz,
      parent_task_id uuid,claimed_by text,claimed_at timestamptz,started_at timestamptz
    ); CREATE TABLE system_registry (
      id uuid PRIMARY KEY, type text, name text, description text, status text, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(type,name)
    ); CREATE TABLE execution_nodes(machine_registry_id uuid PRIMARY KEY,current_version_id uuid)`);
    const createTask = async args => {
      const { rows } = await args.db.query(
        `INSERT INTO tasks(id,title,task_type,status,payload,parent_task_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [randomUUID(), args.title, args.task_type, args.status??'queued',JSON.stringify(args.payload),args.parent_task_id??null]);
      return { success: true, task: rows[0] };
    };
    service = createOnboardingService({ pool: db, createTask });
  });
  beforeEach(async () => { await db.query('TRUNCATE tasks, system_registry'); });
  afterAll(async () => {
    await db?.end();
    if (admin) { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  async function finish(view, patch = {}) {
    const report = {
      type: 'node_onboarding_receipt', id: view.id, mode: 'enroll', name: input.name,
      verified: true, service: { enabled: true, active: true }, health: {
        schema_version: 1, node_id: view.id, agent_version: '1', observed_at: new Date().toISOString(),
        boot_id: view.id, janitor: { mode: 'observe', policy: 'owned-cache-only' },
        sequence: 2, hostname: input.name, os: 'linux',
        resources: { memory_total_bytes: 8e9, memory_available_bytes: 4e9,
          cpu_load_1m: 0.2, cpu_cores: 4, disk_free_bytes: 10e9, disk_total_bytes: 40e9 },
        capabilities: { collector: true, janitor: true, execution: false },
      }, ...patch,
    };
    await db.query(`UPDATE tasks SET status='completed',completed_at=now(),result=$2 WHERE id=$1`,
      [view.task_id, JSON.stringify({ script: { exit_code: 0, stdout: JSON.stringify(report) } })]);
  }
  it('并发重复提交只创建一项脚本任务，并且验收前没有active设备', async () => {
    const [a, b] = await Promise.all([service.create(input, key), service.create(input, key)]);
    expect(a.id).toBe(b.id); expect(a.task_id).toBe(b.task_id);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM system_registry')).rows).toHaveLength(0);
    const task = (await db.query('SELECT * FROM tasks')).rows[0];
    expect(task.task_type).toBe('script_run');
    expect(task.payload.host).toBe('us-mac-m4');
  });
  it('相同幂等键不能改变目标，不同键也不能并发接入同一地址', async () => {
    await service.create(input, key);
    await expect(service.create({ ...input, address: '192.0.2.43' }, key)).rejects.toMatchObject({ status: 409 });
    await expect(service.create({ ...input, name: 'other-node' }, randomUUID())).rejects.toMatchObject({ status: 409 });
  });
  it('只有真实连续采样回执才登记设备，并保留未启用执行能力', async () => {
    const v = await service.create(input, key);
    await finish(v);
    expect((await service.get(v.id)).status).toBe('completed');
    const row = (await db.query('SELECT * FROM system_registry')).rows[0];
    expect(row).toMatchObject({ id: v.id, name: input.name, type: 'machine', status: 'active' });
    expect(row.metadata.executors).toEqual([]);
    expect(row.metadata.node_health.node_id).toBe(v.id);
    await service.get(v.id);
    expect((await db.query('SELECT * FROM system_registry')).rows).toHaveLength(1);
  });
  it('同一Web登记入口在Linux worker观测成功后自动登记执行验收子任务，监控不冒充可执行',async()=>{
    const v=await service.create({...input,role:'worker'},key);await finish(v);await service.reconcile();
    const current=await service.get(v.id);expect(current).toMatchObject({status:'in_progress',automatic:true,stage:'execution_probe',capabilities:{execution:false}});
    const tasks=(await db.query("SELECT * FROM tasks WHERE payload ? 'linux_onboarding'")).rows;expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({status:'in_progress',parent_task_id:v.task_id,claimed_by:'linux-pool-onboarding'});
    expect(tasks[0].payload.linux_onboarding.nonce).toMatch(/^[a-f0-9]{64}$/);await service.get(v.id);await service.reconcile();
    expect((await db.query("SELECT id FROM tasks WHERE payload ? 'linux_onboarding'")).rows).toHaveLength(1);
  });
  it('exit=0或伪造服务成功不能激活设备，且允许针对失败回执重试', async () => {
    const v = await service.create(input, key); await finish(v, { verified: false });
    expect((await service.get(v.id)).status).toBe('failed');
    expect((await db.query('SELECT * FROM system_registry')).rows).toHaveLength(0);
    const retried = await service.retry(v.id);
    expect(retried.id).toBe(v.id); expect(retried.task_id).not.toBe(v.task_id);
    expect(retried.status).toBe('queued');
  });
  it('重复重试进行中的接入不能启动第二个安装器', async () => {
    const v = await service.create(input, key);
    await expect(service.retry(v.id)).rejects.toMatchObject({ status: 409 });
    await db.query("UPDATE tasks SET status='failed' WHERE id=$1", [v.task_id]);
    const results = await Promise.allSettled([service.retry(v.id), service.retry(v.id)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT * FROM tasks')).rows).toHaveLength(2);
  });
  it('验收后名称发生冲突不会覆盖台账，也不阻塞其他接入', async () => {
    const v = await service.create(input, key); await finish(v);
    await db.query(`INSERT INTO system_registry(id,type,name,status,metadata) VALUES($1,'machine',$2,'active','{}')`, [randomUUID(), input.name]);
    await service.reconcile();
    expect((await service.get(v.id)).status).toBe('failed');
    expect((await db.query('SELECT * FROM system_registry')).rows[0].id).not.toBe(v.id);
  });
  it('采集器重启后接受新时间戳的低序号，拒绝旧时间戳回放', async () => {
    const v = await service.create(input, key); await finish(v); await service.reconcile();
    await db.query(`UPDATE system_registry SET metadata=jsonb_set(jsonb_set(metadata,'{onboarding,next_probe_at}','"2020-01-01T00:00:00Z"'),'{node_health,sequence}','1000')`);
    await service.scheduleProbes();
    const probe = (await db.query("SELECT * FROM tasks WHERE payload->'node_onboarding'->>'mode'='sample'")).rows[0];
    await finish({ id: v.id, task_id: probe.id }, { mode: 'sample' });
    await service.reconcile();
    expect((await db.query('SELECT * FROM system_registry')).rows[0].metadata.node_health.sequence).toBe(2);
    const old = new Date(Date.now()-30000).toISOString();
    const report = JSON.parse((await db.query('SELECT * FROM tasks WHERE id=$1',[probe.id])).rows[0].result.script.stdout);
    report.health.observed_at = old; report.health.sequence = 5000;
    await db.query(`UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,reconciled}','false'),result=$2 WHERE id=$1`, [probe.id, JSON.stringify({script:{exit_code:0,stdout:JSON.stringify(report)}})]);
    await service.reconcile();
    expect((await db.query('SELECT * FROM system_registry')).rows[0].metadata.node_health.sequence).toBe(2);
  });
  it('已失败接入允许修正连接字段，保留节点身份与原任务证据', async () => {
    const v = await service.create(input, key);
    await db.query("UPDATE tasks SET status='failed' WHERE id=$1", [v.task_id]);
    const corrected = await service.create({ ...input, ssh_user: 'correct-user' }, randomUUID());
    expect(corrected.id).toBe(v.id); expect(corrected.task_id).not.toBe(v.task_id);
    const old = (await db.query('SELECT * FROM tasks WHERE id=$1', [v.task_id])).rows[0];
    expect(old.payload.node_onboarding.request.ssh_user).toBe(input.ssh_user);
  });
  it('前三台采样被阻塞不应饿死后续节点', async () => {
    for (let i = 0; i < 4; i++) {
      const name = `node-${i}`;
      const v = await service.create({ ...input, name, address: `192.0.2.${10+i}` }, randomUUID());
      await finish(v, { name }); await service.reconcile();
    }
    await db.query(`UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,next_probe_at}','"2020-01-01T00:00:00Z"')`);
    expect((await service.scheduleProbes()).scheduled).toBe(3);
    await db.query("UPDATE tasks SET status='blocked' WHERE payload->'node_onboarding'->>'mode'='sample'");
    await db.query(`UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,next_probe_at}','"2020-01-01T00:00:00Z"')`);
    expect((await service.scheduleProbes()).scheduled).toBe(1);
  });
  it('完成脚本后重复提交返回成功前必须登记设备', async () => {
    const v = await service.create(input, key); await finish(v);
    expect((await service.create(input, key)).status).toBe('completed');
    expect((await db.query('SELECT * FROM system_registry')).rows).toHaveLength(1);
  });
  it('后台对账无需用户打开页面，并为已接入节点建立受限健康采样任务', async () => {
    const v = await service.create(input, key); await finish(v);
    await service.reconcile();
    expect((await db.query('SELECT * FROM system_registry')).rows).toHaveLength(1);
    await db.query(`UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,next_probe_at}','"2020-01-01T00:00:00Z"')`);
    await service.scheduleProbes(); await service.scheduleProbes();
    const tasks = (await db.query("SELECT * FROM tasks WHERE payload->'node_onboarding'->>'mode'='sample'")).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].payload.node_onboarding.id).toBe(v.id);
    expect((await service.list()).items).toHaveLength(1);
  });
});
