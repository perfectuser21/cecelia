/**
 * harness-orphan-guard-concluded.integration.test.js —— kernel 判活闸放行"已有定论"任务
 * （刀2，2026-07-29，事故 task 4a530430）
 *
 * 背景：kernelGuardHolds 目前对 assessKernelLiveness 返回的 verdict==='unknown' 一律 hold，
 * 不 requeue。但 kernel-liveness.js 的修复（刀1）让"全部 initiative_runs 都已终态
 * （done/failed）"这种情况从 verdict='unknown' 改判 verdict='concluded'。
 * kernelGuardHolds 必须放行 'concluded'（返回 false，不 hold），让调用方继续走
 * 已有的 requeueOrphanTask 计数/封顶/终态收口逻辑 —— 否则任务永远卡 in_progress，
 * 占用 active_pipelines 唯一并发槽位（真实案例：占槽近 40 小时）。
 *
 * 本测试真连 cecelia_test Postgres（不 mock ../../db.js / ../../lib/kernel-liveness.js /
 * ../../lib/harness-orphan-guard.js），不传 assessKernel override —— 走真实判活模块 + 真实 SQL，
 * 只 mock docker execFn（返回空，模拟无活容器，这是 kernel 任务的常态）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let pool;
let sweepOrphanHarnessTasks;
let handleRelayExitConsistency;
const seededTaskIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ sweepOrphanHarnessTasks, handleRelayExitConsistency } = await import('../../lib/harness-orphan-guard.js'));
});

afterEach(async () => {
  while (seededTaskIds.length) {
    const taskId = seededTaskIds.pop();
    await pool.query('DELETE FROM initiative_runs WHERE current_task_id = $1::uuid', [taskId]);
    await pool.query('DELETE FROM tasks WHERE id = $1::uuid', [taskId]);
  }
});

/** 插入一个卡 in_progress 的 kernel-v1 任务 + 全部终态的 initiative_runs（模拟 4a530430）。 */
async function seedStuckKernelTask({ orphanRequeueCount = 0 } = {}) {
  const taskId = randomUUID();
  seededTaskIds.push(taskId);

  await pool.query(
    `INSERT INTO tasks (id, title, status, task_type, payload, updated_at)
     VALUES ($1::uuid, $2, 'in_progress', 'harness_initiative', $3::jsonb, NOW() - INTERVAL '40 hours')`,
    [
      taskId,
      `orphan-guard concluded regression ${taskId.slice(0, 8)}`,
      JSON.stringify({ harness_runtime: 'kernel-v1', orphan_requeue_count: orphanRequeueCount }),
    ]
  );

  for (let i = 0; i < 15; i++) {
    await pool.query(
      `INSERT INTO initiative_runs
         (initiative_id, current_task_id, phase, orchestrator_version, failure_reason, started_at)
       VALUES ($1::uuid, $1::uuid, 'failed', 'v2', $2, NOW() - INTERVAL '1 hour' + ($3 || ' seconds')::interval)`,
      [taskId, `attempt ${i} failed`, i * 10]
    );
  }

  return taskId;
}

async function fetchTask(taskId) {
  const { rows } = await pool.query('SELECT status, payload FROM tasks WHERE id = $1::uuid', [taskId]);
  return rows[0];
}

const noContainers = () => '';

describe('回归锁：task 4a530430 —— 15 条 run 全 failed 却永久卡 in_progress', () => {
  it('sweepOrphanHarnessTasks：全终态 kernel 任务必须被 requeue，不能一直 kernelHeld', async () => {
    const taskId = await seedStuckKernelTask();

    const r = await sweepOrphanHarnessTasks({ pool, execFn: noContainers, idleMinutes: 15 });

    expect(r.requeued).toBeGreaterThanOrEqual(1);
    expect(r.kernelHeld).toBe(0);

    const after = await fetchTask(taskId);
    expect(after.status).toBe('queued');
    expect(Number(after.payload.orphan_requeue_count)).toBe(1);
  });

  it('sweepOrphanHarnessTasks：orphan_requeue_count 已达上限(3) → 转 failed 终态收口', async () => {
    const taskId = await seedStuckKernelTask({ orphanRequeueCount: 3 });

    const r = await sweepOrphanHarnessTasks({ pool, execFn: noContainers, idleMinutes: 15 });

    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(r.kernelHeld).toBe(0);

    const after = await fetchTask(taskId);
    expect(after.status).toBe('failed');
  });

  it('handleRelayExitConsistency：容器退出回调到达时，全终态 kernel 任务同样必须 requeue', async () => {
    const taskId = await seedStuckKernelTask();
    const containerId = `cecelia-relay-${taskId.slice(0, 8)}-deadbeef`;

    const r = await handleRelayExitConsistency({
      pool, execFn: noContainers, containerId, exitCode: 1, resultText: '',
    });

    expect(r.action).toBe('requeued');

    const after = await fetchTask(taskId);
    expect(after.status).toBe('queued');
  });
});
