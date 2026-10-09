/** 迁移 531 的行为：runs 运行总记录 + spans 自动挂总记录并加总 + 汇总视图 + 定时任务写运行记录。每个用例在事务里跑，结束回滚。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { recordSchedulerRun } from '../../lib/workflow-runs.js';

let pool, client, workflow, activity;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const vs = randomUUID(), cap = randomUUID();
  workflow = randomUUID(); activity = randomUUID();
  await client.query("INSERT INTO value_streams(id,name) VALUES($1,'运行表验收')", [vs]);
  await client.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'运行表能力',$2)", [cap, vs]);
  await client.query("INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,$3,'运行表流程','test')", [workflow, cap, `runs-test-${workflow}`]);
  await client.query("INSERT INTO activities(id,name) VALUES($1,'运行表活动')", [activity]);
});
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const span = (runId, extra = {}) => client.query(
  `INSERT INTO spans(run_id,workflow_id,activity_id,started_at,ended_at,executor_kind,outcome,tokens_in,tokens_out,cost_usd)
   VALUES($1,$2,$3,$4,$5,'agent',$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
  [runId, workflow, activity, extra.started_at ?? '2026-10-07T01:00:00Z', extra.ended_at ?? '2026-10-07T01:00:05Z',
    extra.outcome ?? 'pass', extra.tokens_in ?? null, extra.tokens_out ?? null, extra.cost_usd ?? null]);

describe('迁移 531：runs + spans', () => {
  it('首条 span 自动建运行总记录：流程、起止取最早/最晚、结果 fail 优先、token/费用加总', async () => {
    await span('r1', { started_at: '2026-10-07T01:00:00Z', ended_at: '2026-10-07T01:00:05Z', tokens_in: 100, tokens_out: 10, cost_usd: 0.01 });
    await span('r1', { started_at: '2026-10-07T01:00:06Z', ended_at: '2026-10-07T01:00:20Z', outcome: 'fail', tokens_in: 50, tokens_out: 5, cost_usd: 0.02 });
    const run = await one("SELECT * FROM runs WHERE run_id='r1'");
    expect(run).toMatchObject({ workflow_id: workflow, header_source: 'spans', trigger_kind: 'external', outcome: 'fail',
      tokens_in: '150', tokens_out: '15', duration_ms: 20000 });
    expect(Number(run.cost_usd)).toBeCloseTo(0.03);
  });

  it('重复上报的 span（冲突被跳过）不重复加总', async () => {
    await span('r2', { tokens_in: 100 });
    await span('r2', { tokens_in: 100 });
    expect((await one("SELECT count(*)::int AS n FROM spans WHERE run_id='r2'")).n).toBe(1);
    expect((await one("SELECT tokens_in FROM runs WHERE run_id='r2'")).tokens_in).toBe('100');
  });

  it('运行方自己写的总记录：span 只加 token，不改结果与起止', async () => {
    await client.query(`INSERT INTO runs(run_id,workflow_id,trigger_kind,executor_kind,started_at,ended_at,outcome,header_source)
      VALUES('r3',$1,'manual','human','2026-10-07T00:00:00Z','2026-10-07T02:00:00Z','pass','owner')`, [workflow]);
    await span('r3', { outcome: 'fail', tokens_in: 7 });
    expect(await one("SELECT outcome, tokens_in, duration_ms FROM runs WHERE run_id='r3'")).toEqual({ outcome: 'pass', tokens_in: '7', duration_ms: 7200000 });
  });

  it('span 层级列自动算，上级记录可自关联；删运行总记录级联删 span', async () => {
    await span('r4');
    const parent = await one("SELECT id, span_level FROM spans WHERE run_id='r4'");
    expect(parent.span_level).toBe('activity');
    const child = await one(`INSERT INTO spans(run_id,workflow_id,activity_id,parent_span_id,started_at,executor_kind,outcome,attempts)
      VALUES('r4',$1,$2,$3,'2026-10-07T01:00:01Z','code','pass',2) RETURNING parent_span_id`, [workflow, activity, parent.id]);
    expect(child.parent_span_id).toBe(parent.id);
    await client.query("DELETE FROM runs WHERE run_id='r4'");
    expect((await one("SELECT count(*)::int AS n FROM spans WHERE run_id='r4'")).n).toBe(0);
  });

  it('定时任务运行经闹钟总账解析到流程；汇总视图按窗口给次数/成功率/时长', async () => {
    const entry = await one(`INSERT INTO ops_schedule_entries(source,host_alias,label,kind,workflow_id)
      VALUES('brain','us-vps','runs-test-job','brain_job',$1) RETURNING id`, [workflow]);
    const now = Date.now();
    await recordSchedulerRun(client, { jobName: 'runs-test-job', startedAt: new Date(now - 3000), endedAt: new Date(now - 1000), outcome: 'pass' });
    await recordSchedulerRun(client, { jobName: 'runs-test-job', startedAt: new Date(now - 900), endedAt: new Date(now), outcome: 'fail', error: '炸了' });
    const runs = (await client.query("SELECT * FROM runs WHERE trigger_ref='runs-test-job' ORDER BY started_at")).rows;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ workflow_id: workflow, schedule_entry_id: entry.id, trigger_kind: 'schedule', executor_id: 'brain-scheduler', header_source: 'owner', duration_ms: 2000 });
    expect(runs[1]).toMatchObject({ outcome: 'fail', error: '炸了' });
    const stat = await one("SELECT * FROM v_workflow_run_stats WHERE workflow_id=$1 AND time_window='24h'", [workflow]);
    expect(stat).toMatchObject({ runs: 2, passed: 1, failed: 1, last_outcome: 'fail' });
    expect(Number(stat.success_rate)).toBeCloseTo(0.5);
  });

  it('总账里找不到的定时任务也照记（流程留空），不抛错', async () => {
    await recordSchedulerRun(client, { jobName: 'no-such-job', startedAt: new Date(), endedAt: new Date(), outcome: 'pass' });
    expect(await one("SELECT workflow_id, schedule_entry_id FROM runs WHERE trigger_ref='no-such-job'")).toEqual({ workflow_id: null, schedule_entry_id: null });
  });
});
