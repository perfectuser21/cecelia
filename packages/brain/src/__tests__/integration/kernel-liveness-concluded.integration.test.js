/**
 * kernel-liveness-concluded.integration.test.js —— "已有定论" vs "真查不到"（刀1，2026-07-29）
 *
 * 事故背景：task 4a530430（P0 Kernel Fleet recovery），initiative_runs 下 15 条记录
 * 全部 phase='failed'，但 loadKernelRun 的查询带 `WHERE phase NOT IN ('done','failed')`，
 * 于是这些终态行全被过滤掉，assessKernelLiveness 查不到任何"非终态"行就判定
 * verdict='unknown', reason='no_kernel_run' —— 把"这个任务的 run 早就有明确失败结论，
 * 只是没人回写 task 状态"和"真的查不到任何信息，活死未知"这两种完全不同的情况混为一谈。
 * 后果：task 在 tasks 表里 status 永远卡在 in_progress，占着 active_pipelines 并发槽位。
 *
 * 本测试真连 cecelia_test Postgres（不 mock ../../db.js / ../../lib/kernel-liveness.js），
 * 插入真实 tasks + initiative_runs 行复现该场景。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let pool;
let assessKernelLiveness;
let loadKernelRun;
const seededTaskIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ assessKernelLiveness, loadKernelRun } = await import('../../lib/kernel-liveness.js'));
});

afterEach(async () => {
  while (seededTaskIds.length) {
    const taskId = seededTaskIds.pop();
    await pool.query('DELETE FROM initiative_runs WHERE current_task_id = $1::uuid', [taskId]);
    await pool.query('DELETE FROM tasks WHERE id = $1::uuid', [taskId]);
  }
});

/** 插入一个 kernel-v1 task + N 条 initiative_runs（全部终态），模拟 4a530430 场景。 */
async function seedAllTerminalRuns({ phases = ['failed', 'failed'], failureReason = 'contract timeout' } = {}) {
  const taskId = randomUUID();
  seededTaskIds.push(taskId);

  await pool.query(
    `INSERT INTO tasks (id, title, status, task_type, payload, updated_at)
     VALUES ($1::uuid, $2, 'in_progress', 'harness_initiative', $3::jsonb, NOW() - INTERVAL '40 hours')`,
    [taskId, `kernel-liveness concluded regression ${taskId.slice(0, 8)}`, JSON.stringify({ harness_runtime: 'kernel-v1' })]
  );

  let runId = null;
  let ts = Date.now() - phases.length * 60_000;
  for (const phase of phases) {
    ts += 30_000;
    const { rows } = await pool.query(
      `INSERT INTO initiative_runs
         (initiative_id, current_task_id, phase, orchestrator_version, failure_reason, started_at)
       VALUES ($1::uuid, $1::uuid, $2, 'v2', $3, to_timestamp($4::double precision / 1000))
       RETURNING id`,
      [taskId, phase, phase === 'failed' ? failureReason : null, ts]
    );
    runId = rows[0].id;
  }

  return { taskId, latestRunId: runId };
}

function kernelTask(taskId) {
  return { id: taskId, task_type: 'harness_initiative', status: 'in_progress', payload: { harness_runtime: 'kernel-v1' } };
}

describe('回归锁：task 4a530430 —— 15 条 initiative_runs 全 failed 但被过滤掉', () => {
  it('loadKernelRun（终态过滤查询）对全终态 task 返回 null —— 现有行为不变', async () => {
    const { taskId } = await seedAllTerminalRuns();
    const run = await loadKernelRun(pool, { taskId });
    expect(run).toBe(null);
  });

  it('assessKernelLiveness 必须区分"已有定论"与"真查不到"：全部 run 都是 failed → verdict=concluded，绝不能是 unknown', async () => {
    const { taskId, latestRunId } = await seedAllTerminalRuns({ failureReason: 'contract timeout' });
    const r = await assessKernelLiveness({ pool, task: kernelTask(taskId) });

    expect(r.verdict).toBe('concluded');
    expect(r.phase).toBe('failed');
    expect(r.failure_reason).toBe('contract timeout');
    expect(r.runId).toBe(latestRunId);
  });

  it('全部 run 都是 done → verdict=concluded, phase=done', async () => {
    const { taskId } = await seedAllTerminalRuns({ phases: ['failed', 'done'], failureReason: null });
    const r = await assessKernelLiveness({ pool, task: kernelTask(taskId) });

    expect(r.verdict).toBe('concluded');
    expect(r.phase).toBe('done');
  });

  it('真查不到任何 run 行（表里根本没有这个 task）→ 仍是 unknown/no_kernel_run，fail-open 铁律不能动', async () => {
    const ghostTaskId = randomUUID();
    const r = await assessKernelLiveness({ pool, task: kernelTask(ghostTaskId) });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toBe('no_kernel_run');
  });
});
