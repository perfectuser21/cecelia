import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startRun, finishRun } from '../../lib/task-run.js';
import { setBrainLease } from '../../lib/task-lease.js';
import { beginBrainLaunch, finishBrainLaunch } from '../../drain.js';
import { DB_DEFAULTS } from '../../db-config.js';
import { assertAutoPoolTestDatabase } from '../helpers/auto-pool-test-database.js';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';

// Only external resource observations are controlled; claim HTTP, SQL and budget are real.
const context = vi.hoisted(() => ({ pool: null, processes: [], registryError: false }));
vi.mock('../../db.js', () => ({ default: {
  query: (...args) => context.pool.query(...args),
  connect: (...args) => context.pool.connect(...args),
}, getPoolHealth: () => ({ total: 1, idle: 1, waiting: 0 }) }));
vi.mock('../../executor.js', () => ({
  MAX_SEATS: 11, PHYSICAL_CAPACITY: 11,
  getEffectiveMaxSeats: () => 11,
  getBudgetCap: () => ({ physical: 11, budget: 11, effective: 11 }),
  checkServerResources: () => ({ effectiveSlots: 11, metrics: { max_pressure: 0.1 } }),
  getActiveProcessCount: () => context.processes.length,
  getActiveProcesses: () => { if (context.registryError) throw Error('fixture registry unavailable'); return context.processes; },
}));
vi.mock('../../fleet-resource-cache.js', () => ({
  getFleetStatus: () => [], getRemoteCapacity: () => null, getTotalEffectiveSlots: () => 11,
}));
vi.mock('../../platform-utils.js', async importActual => ({
  ...await importActual(), listProcessesWithElapsed: () => [], listProcessesWithPpid: () => [],
  getBrainRssMB: () => 100,
}));

let fx, app, calculateSlotBudget, resetBudget;
beforeAll(async () => {
  assertAutoPoolTestDatabase(DB_DEFAULTS);
  fx = await taskLeaseFixture(); context.pool = fx.pool;
  const identity = (await fx.pool.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
  expect(identity.database).toBe(DB_DEFAULTS.database);
  expect(identity.schema).toBe(fx.schema);
  expect(identity.schema).toMatch(/^task_lease_[a-f0-9]{32}$/);
  await fx.pool.query(`CREATE TABLE workflows(id uuid PRIMARY KEY, status text);
    ALTER TABLE task_runs ADD COLUMN workflow_id uuid;
    ALTER TABLE tasks ADD COLUMN trigger_source text;
    CREATE TABLE alertness_escalations(id serial PRIMARY KEY, timestamp timestamptz, actions_taken jsonb)`);
  const router = (await import('../../routes/task-tasks.js')).default;
  app = express().use(express.json()).use('/api/brain/tasks', router);
  const budget = await import('../../slot-allocator.js');
  calculateSlotBudget = budget.calculateSlotBudget; resetBudget = budget._resetSlotBuffer;
});

describe.sequential('队列压力只计算现役tick归属需求', () => {
  async function queueMetric() {
    return (await (await import('../../alertness/metrics.js')).collectMetrics()).queueDepth;
  }

  async function queueDiagnosis(queueDepth) {
    const { diagnoseProblem } = await import('../../alertness/diagnosis.js');
    const sample = { queueDepth };
    return diagnoseProblem(sample, Array.from({ length: 3 }, () => ({ metrics: sample })));
  }

  it('超过60个人工记账加2条真实自动需求不误报队列阻塞', async () => {
    for (let i = 0; i < 72; i++) {
      await seedTask(fx.pool, { payload: { headed_manual: i % 2 ? true : 'true' } });
    }
    await seedTask(fx.pool, { task_type: 'research' });
    await seedTask(fx.pool, { task_type: 'script_run' });
    expect((await fx.pool.query("SELECT count(*)::int AS n FROM tasks WHERE status='queued'")).rows[0].n).toBe(74);
    const metric = await queueMetric();
    expect(metric.value).toBe(2);
    expect((await queueDiagnosis(metric)).issues).not.toContain('queue_blockage');
  });

  it('超过60条真正自动需求仍按原阈值触发队列保护，代码和原生任务也计入', async () => {
    const workflow = randomUUID();
    await fx.pool.query("INSERT INTO workflows(id,status) VALUES($1,'active')", [workflow]);
    for (let i = 0; i < 60; i++) {
      await seedTask(fx.pool, { task_type: i % 2 ? 'qiumi_task' : 'script_run',
        payload: i % 2 ? {} : { runtime_requires_llm: false, workflow_id: workflow } });
    }
    const boundary = await queueMetric();
    expect(boundary.value).toBe(60);
    expect((await queueDiagnosis(boundary)).issues).not.toContain('queue_blockage');
    await seedTask(fx.pool, { task_type: 'qiumi_task' });
    const metric = await queueMetric();
    expect(metric.value).toBe(61);
    expect((await queueDiagnosis(metric)).issues).toContain('queue_blockage');
  });

  it('明确非tick归属边界与原NULL认领语义一致，未知类型保守计入', async () => {
    for (const payload of [{ headed_manual: true }, { headed_manual: 'true' },
      { parallel_worker: true }, { parallel_worker: 'true' }, { common_runner: null }]) {
      await seedTask(fx.pool, { payload });
    }
    await seedTask(fx.pool, { task_type: 'project' });
    await seedTask(fx.pool, { claimed_by: 'fixture-owned' });
    await seedTask(fx.pool, { claimed_by: '' });
    await seedTask(fx.pool, { task_type: 'unknown-future-automatic' });
    await seedTask(fx.pool, { status: 'pending', task_type: 'research' });
    expect((await queueMetric()).value).toBe(2);
  });

  it('真实降级UPDATE不得暂停明确人工记账，普通自动任务仍暂停并留痕', async () => {
    const manual = await seedTask(fx.pool, { payload: { headed_manual: true } });
    const automatic = await seedTask(fx.pool, { task_type: 'research' });
    await fx.pool.query("UPDATE tasks SET priority='P2',trigger_source='api' WHERE id=ANY($1)", [[manual, automatic]]);
    const { executeResponse } = await import('../../alertness/escalation.js');
    await executeResponse({ actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }] });
    const rows = (await fx.pool.query('SELECT id,status,error_message,status_history FROM tasks ORDER BY id')).rows;
    expect(rows.find(row => row.id === manual).status).toBe('queued');
    expect(rows.find(row => row.id === automatic)).toMatchObject({ status: 'paused', error_message: 'escalation_graceful_degrade' });
    expect(rows.find(row => row.id === automatic).status_history.at(-1)).toMatchObject({
      from: 'queued', to: 'paused', source: 'escalation_graceful_degrade',
    });
  });
});
beforeEach(async () => {
  context.processes = []; context.registryError = false; resetBudget();
  await fx.pool.query('TRUNCATE tasks, task_runs, task_events, task_leases CASCADE');
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await fx?.close(); });

async function claim({ kind = 'headed-session', payload = {}, taskType = 'research', leaseSeconds } = {}) {
  const id = await seedTask(fx.pool, { status: 'in_progress', task_type: taskType, payload });
  const response = await request(app).post(`/api/brain/tasks/${id}/claim`)
    .send({ claimer: `fixture-${id}`, executor_kind: kind, lease_seconds: leaseSeconds });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.executor_kind).toBe(kind);
  return id;
}

describe.sequential('真实目录记账与自动执行池归属', () => {
  it('151条真实认领记录中144个有头记账不堵住正常自动池，未知与OpenClaw继续占位', async () => {
    for (let i = 0; i < 144; i++) await claim({ payload: i % 2 ? { headed_manual: true } : {} });
    for (let i = 0; i < 6; i++) await claim({ kind: 'openclaw-agent' });
    await claim({ kind: 'legacy-unknown' });
    const stored = (await fx.pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE executor_kind='headed-session' AND claimed_by IS NOT NULL
        AND claimed_at IS NOT NULL)::int AS headed FROM tasks WHERE status='in_progress'`)).rows[0];
    expect(stored).toEqual({ total: 151, headed: 144 });
    resetBudget();
    const budget = await calculateSlotBudget();
    expect(budget.taskPool.used).toBe(7);
    expect(budget.taskPool.available).toBe(4);
    expect(budget.dispatchAllowed).toBe(true);
  }, 30000);

  it('真实有头认领的同owner同epoch活租约也属于独立记账', async () => {
    await claim({ leaseSeconds: 120 });
    await claim({ payload: { headed_manual: true } });
    expect((await calculateSlotBudget()).taskPool.used).toBe(0);
  });

  it('原生进程已终态但资源清场未确认仍不可用有头标签豁免', async () => {
    const id = await claim(), runId = randomUUID();
    expect((await startRun({ taskId: id, runId, source: 'native-agent', context: { native_agent: { resource_bound: true } } }, { pool: fx.pool }))?.id).toBeTruthy();
    await finishRun({ runId, status: 'failed', result: { reason: 'fixture process exited without cleanup proof' } }, { pool: fx.pool });
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });

  it('真实外部worker的精确有效claim租约独立，不能仅按kind或类型放行', async () => {
    await claim({ kind: 'external-worker', taskType: 'content-pipeline', leaseSeconds: 120 });
    await claim({ kind: 'external-worker', taskType: 'content-pipeline' });
    await claim({ kind: 'external-worker', taskType: 'research', leaseSeconds: 120 });
    expect((await calculateSlotBudget()).taskPool.used).toBe(2);
  });

  it.each(['owner', 'microsecond', 'expired'])('不匹配或失效外部租约仍占位：%s', async mode => {
    const id = await claim({ kind: 'external-worker', taskType: 'content-pipeline', leaseSeconds: 120 });
    if (mode === 'owner') await fx.pool.query("UPDATE task_leases SET claimer='other-owner' WHERE task_id=$1", [id]);
    if (mode === 'expired') await fx.pool.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 second' WHERE task_id=$1", [id]);
    if (mode === 'microsecond') {
      const a = '2026-11-27 00:00:00.123001+00', b = '2026-11-27 00:00:00.123002+00';
      expect(new Date(a).getTime()).toBe(new Date(b).getTime());
      await fx.pool.query('UPDATE tasks SET claimed_at=$2::timestamptz WHERE id=$1', [id, a]);
      await fx.pool.query('UPDATE task_leases SET claimed_at=$2::timestamptz WHERE task_id=$1', [id, b]);
    }
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });

  it.each(['invocation', 'registry', 'launch', 'native', 'brain-lease'])('真实managed反证覆盖有头标签：%s', async evidence => {
    const id = await claim(); let token;
    if (evidence === 'invocation') await fx.pool.query('UPDATE tasks SET payload=$2 WHERE id=$1', [id, { invocation: { dispatch: { run_id: randomUUID() } } }]);
    if (evidence === 'registry') context.processes = [{ taskId: id, runId: randomUUID(), alive: true, source: 'shared-activity-runner' }];
    if (evidence === 'launch') token = beginBrainLaunch(id);
    if (evidence === 'native') {
      const run = await startRun({ taskId: id, runId: randomUUID(), source: 'native-agent', context: { native_agent: { resource_bound: true } } }, { pool: fx.pool });
      expect(run?.id).toBeTruthy();
      // No self-reported Task.result is needed to preserve server-side native ownership.
    }
    if (evidence === 'brain-lease') {
      await setBrainLease(fx.pool, id, 60);
      await fx.pool.query("UPDATE task_leases SET lease_until=NOW()-INTERVAL '1 hour' WHERE task_id=$1", [id]);
    }
    try { expect((await calculateSlotBudget()).taskPool.used).toBe(1); }
    finally { if (token) finishBrainLaunch(token); }
  });

  it('缺认领和未知执行体不获豁免，released历史租约不覆盖当前可信独立认领', async () => {
    await seedTask(fx.pool, { status: 'in_progress', executor_kind: 'headed-session' });
    await claim({ kind: 'legacy-unknown' });
    const id = await claim({ leaseSeconds: 120 });
    await fx.pool.query("UPDATE task_leases SET released_at=NOW(),claimer='historical-owner' WHERE task_id=$1", [id]);
    expect((await calculateSlotBudget()).taskPool.used).toBe(2);
  });

  it.each(['owner', 'microsecond'])('新记录不从旧基数多减，原candidate漂移保持占位：%s', async mode => {
    const id = await claim();
    if (mode === 'microsecond') await fx.pool.query("UPDATE tasks SET claimed_at='2026-11-27 00:00:00.123001+00'::timestamptz WHERE id=$1", [id]);
    const original = fx.pool.query.bind(fx.pool); let injected = false;
    vi.spyOn(fx.pool, 'query').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!injected && result.rows[0]?.independent_tasks?.length) {
        injected = true;
        if (mode === 'owner') await original("UPDATE tasks SET claimed_by='new-owner' WHERE id=$1", [id]);
        else await original("UPDATE tasks SET claimed_at='2026-11-27 00:00:00.123002+00'::timestamptz WHERE id=$1", [id]);
        await seedTask({ query: original }, { status: 'in_progress', executor_kind: 'headed-session', claimed_by: 'new-independent' });
      }
      return result;
    });
    // A same-snapshot base=1 can only subtract its original, still-identical candidate.
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
    expect(injected).toBe(true);
  });

  it('复核读取失败保原基数，不把未知当空闲', async () => {
    await claim();
    const original = fx.pool.query.bind(fx.pool); let failNext = false;
    vi.spyOn(fx.pool, 'query').mockImplementation(async (...args) => {
      if (failNext) { failNext = false; throw Error('fixture observation unavailable'); }
      const result = await original(...args);
      if (result.rows[0]?.independent_tasks?.length) failNext = true;
      return result;
    });
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });

  it('registry观测失败不授独立豁免，基数保持占位', async () => {
    await claim(); context.registryError = true;
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });

  it('两次观测之间出现真实Task关联controller时保守占位', async () => {
    const id = await claim(); const original = fx.pool.query.bind(fx.pool); let injected = false;
    vi.spyOn(fx.pool, 'query').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!injected && result.rows[0]?.independent_tasks?.length) {
        injected = true; context.processes = [{ taskId: id, runId: randomUUID(), alive: true }];
      }
      return result;
    });
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
    expect(injected).toBe(true);
  });

  it('原匿名admission不新增容量政策，不会反占唯一待派发槽', async () => {
    await claim(); const token = beginBrainLaunch();
    try {
      const budget = await calculateSlotBudget();
      expect(budget.taskPool.used).toBe(0);
      expect(budget.taskPool.available).toBe(11);
    } finally { finishBrainLaunch(token); }
  });

  it('有头标签也不能覆盖不匹配的当前claim租约', async () => {
    const id = await claim({ leaseSeconds: 120 });
    await fx.pool.query("UPDATE task_leases SET claimer='unconfirmed-other-owner' WHERE task_id=$1", [id]);
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });

  it('连基数都读不到时闭锁而非used0放行', async () => {
    vi.spyOn(fx.pool, 'query').mockRejectedValue(Error('fixture database unavailable'));
    await expect(calculateSlotBudget()).rejects.toThrow();
  });

  it('严格JSONfalse且activeWorkflow的既有代码池边界保持，字符串false不获代码豁免', async () => {
    const workflow = randomUUID();
    await fx.pool.query("INSERT INTO workflows(id,status) VALUES($1,'active')", [workflow]);
    await claim({ kind: 'script', taskType: 'script_run', payload: { runtime_requires_llm: false, workflow_id: workflow } });
    await claim({ kind: 'script', taskType: 'script_run', payload: { runtime_requires_llm: 'false', workflow_id: workflow } });
    expect((await calculateSlotBudget()).taskPool.used).toBe(1);
  });
});
