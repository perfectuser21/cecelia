/** OpenClaw 运行记录采集的游标与 upsert（真 Postgres）。每个用例在事务里跑，结束回滚。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { readCursorMs, upsertRuns } from '../../openclaw-run-ingest.js';

let pool, client, workflow;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const vs = randomUUID(), cap = randomUUID();
  workflow = randomUUID();
  await client.query("INSERT INTO value_streams(id,name) VALUES($1,'采集验收')", [vs]);
  await client.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'采集能力',$2)", [cap, vs]);
  await client.query("INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,$3,'采集流程','test')", [workflow, cap, `ingest-test-${workflow}`]);
});
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

const T = new Date('2026-10-07T01:00:00Z');
const mk = (id, extra = {}) => ({
  run_id: `openclaw:${id}`,
  trigger_ref: 'OPC 午前班会（11:50）',
  executor_kind: 'agent',
  executor_id: 'openclaw:main',
  started_at: T,
  ended_at: new Date(T.getTime() + 5000),
  outcome: 'pass',
  error: null,
  detail: { source: 'openclaw', job_id: 'j1', task_id: id, summary: 's', status: 'succeeded' },
  ...extra,
});
const one = async (sql, params) => (await client.query(sql, params)).rows[0];

describe('readCursorMs', () => {
  it('无 openclaw 运行 → null；有则返回最大 started_at 减 1 小时', async () => {
    expect(await readCursorMs(client)).toBeNull();
    await client.query(`INSERT INTO runs(run_id,trigger_kind,started_at) VALUES('sched:x','schedule','2026-10-08T00:00:00Z')`);
    expect(await readCursorMs(client)).toBeNull();
    await upsertRuns(client, [mk('a'), mk('b', { started_at: new Date(T.getTime() - 60000), ended_at: null, outcome: 'running' })]);
    expect(await readCursorMs(client)).toBe(T.getTime() - 3600_000);
  });
});

describe('upsertRuns', () => {
  it('同一批写两次：仍 2 行，第二次 written 为 0', async () => {
    const rows = [mk('a'), mk('b')];
    expect(await upsertRuns(client, rows)).toEqual({ written: 2 });
    expect(await upsertRuns(client, rows)).toEqual({ written: 0 });
    expect((await one("SELECT count(*)::int AS n FROM runs WHERE run_id LIKE 'openclaw:%'")).n).toBe(2);
  });

  it('先写 running 再写 pass：同一行更新结果与结束时间', async () => {
    await upsertRuns(client, [mk('a', { outcome: 'running', ended_at: null })]);
    const r = await upsertRuns(client, [mk('a')]);
    expect(r).toEqual({ written: 1 });
    const run = await one("SELECT outcome, ended_at, duration_ms FROM runs WHERE run_id='openclaw:a'");
    expect(run.outcome).toBe('pass');
    expect(run.ended_at.getTime()).toBe(T.getTime() + 5000);
    expect(run.duration_ms).toBe(5000);
    expect((await one("SELECT count(*)::int AS n FROM runs WHERE run_id='openclaw:a'")).n).toBe(1);
  });

  it('固定补列：trigger_kind=schedule、header_source=owner，错误与详情落库', async () => {
    await upsertRuns(client, [mk('a', { outcome: 'fail', error: '炸了' })]);
    expect(await one("SELECT * FROM runs WHERE run_id='openclaw:a'")).toMatchObject({
      trigger_kind: 'schedule', header_source: 'owner', trigger_ref: 'OPC 午前班会（11:50）',
      executor_kind: 'agent', executor_id: 'openclaw:main', outcome: 'fail', error: '炸了',
      detail: { source: 'openclaw', task_id: 'a', status: 'succeeded' },
    });
  });

  it('任务名对上闹钟总账 → 带出 schedule_entry_id 与 workflow_id；对不上 → 两列为空', async () => {
    const entry = await one(`INSERT INTO ops_schedule_entries(source,host_alias,label,kind,active,workflow_id)
      VALUES('openclaw','mmv','OPC 午前班会（11:50）','openclaw_cron',true,$1) RETURNING id`, [workflow]);
    await upsertRuns(client, [mk('a'), mk('b', { trigger_ref: '没登记的任务' })]);
    expect(await one("SELECT schedule_entry_id, workflow_id FROM runs WHERE run_id='openclaw:a'"))
      .toEqual({ schedule_entry_id: entry.id, workflow_id: workflow });
    expect(await one("SELECT schedule_entry_id, workflow_id FROM runs WHERE run_id='openclaw:b'"))
      .toEqual({ schedule_entry_id: null, workflow_id: null });
  });

  it('空数组 → written 为 0', async () => {
    expect(await upsertRuns(client, [])).toEqual({ written: 0 });
  });
});
