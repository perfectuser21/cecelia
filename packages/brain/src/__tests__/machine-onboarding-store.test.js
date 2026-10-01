import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createOnboardingService } from '../node-onboarding/service.js';

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
      updated_at timestamptz DEFAULT now(), completed_at timestamptz
    ); CREATE TABLE system_registry (
      id uuid PRIMARY KEY, type text, name text, description text, status text, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE(type,name)
    )`);
    const createTask = async args => {
      const { rows } = await args.db.query(
        `INSERT INTO tasks(id,title,task_type,status,payload) VALUES($1,$2,$3,'queued',$4) RETURNING *`,
        [randomUUID(), args.title, args.task_type, JSON.stringify(args.payload)]);
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
