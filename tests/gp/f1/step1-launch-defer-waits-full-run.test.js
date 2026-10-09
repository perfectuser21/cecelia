// F1「工厂 · 开发闭环」步骤 1「接单进车间即分档」—— 边：跑场机满员时任务排队等槽，而不是被判死
//
// 2026-09-24 22:10 实证（任务 f61fc0c6）：MMV 两条 run 各跑 5–6 小时占满双槽，第三条任务每 2 分钟
// tick 撞一次 429 → deferred 回队；默认上限 10 次 = 20 分钟即终态 failed，远小于一条 run 的时长，
// 等于"排队 20 分钟没轮到就出局"。上限必须按"等完一整轮 run"量级。
// 真 import kernel-run-store.js（lint-gp-anchor-artifact 要求），不 mock 它；只注入假 pool。
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KERNEL_LAUNCH_MAX_DEFERS,
  requeueKernelRunLaunchDeferred,
} from '../../../packages/brain/src/orchestrator/kernel-run-store.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const REASON = 'kernel_remote_launch_deferred:orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted';

function poolWithDeferCount(deferCount) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', payload: { kernel_launch_defer_count: deferCount } }] };
      }
      if (/FROM initiative_runs/.test(sql)) {
        return { rows: [{ id: RUN_ID, current_task_id: TASK_ID, phase: 'planning' }] };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, calls };
}

describe('F1 step1 · 跑场机满员时任务排队等槽，不被判死', () => {
  it('默认延后上限 ≥ 一整轮 run（5–6h / 2min tick ≈ 180 次）', () => {
    expect(DEFAULT_KERNEL_LAUNCH_MAX_DEFERS).toBeGreaterThanOrEqual(180);
  });

  it('模拟 6 小时每 tick 撞 429：任务始终回 queued，直到上限才 exhausted', async () => {
    const ticksInSixHours = (6 * 60) / 2; // 180
    for (let n = 0; n < ticksInSixHours; n += 1) {
      const { pool, calls } = poolWithDeferCount(n);
      const result = await requeueKernelRunLaunchDeferred(pool, { runId: RUN_ID, expectedTaskId: TASK_ID, reason: REASON });
      expect(result, `tick ${n}`).toMatchObject({ changed: true, deferCount: n + 1 });
      const taskUpdate = calls.find((c) => /UPDATE tasks/.test(c.sql));
      expect(taskUpdate.sql, `tick ${n}`).toMatch(/status = 'queued'/);
    }
    const { pool: fullPool, calls: fullCalls } = poolWithDeferCount(DEFAULT_KERNEL_LAUNCH_MAX_DEFERS);
    const exhausted = await requeueKernelRunLaunchDeferred(fullPool, { runId: RUN_ID, expectedTaskId: TASK_ID, reason: REASON });
    expect(exhausted).toMatchObject({ changed: false, exhausted: true });
    expect(fullCalls.some((c) => /^\s*UPDATE/.test(c.sql))).toBe(false);
  });
});
