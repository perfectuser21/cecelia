/**
 * Regression: recovery-loop 必须周期性跑三条"原接在废弃 executeTick 上的"恢复安全网。
 *
 * 根因（2026-06-27 审计）：executeTick→runScheduler 迁移后，只有 harness-watchdog-loop
 * 被重新接线。autoFailTimedOutTasks / checkStuckPipelines / 周期 cleanupStaleClaims 三条
 * 全断在废弃 executeTick 里无人调用 → queued+stale-claim 任务永久卡死、pipeline 整体 spin
 * 无人 cancel、普通任务超时无人收尾。recovery-loop 仿 harness-watchdog-loop 独立 setInterval 接回。
 *
 * 关键不变量：autoFailTimedOutTasks 是 wall-clock 超时，会误杀长跑的活跃 harness 任务
 * （harness 由 harness-watchdog 用心跳判据专管）→ 必须排除 harness_* 任务类型。
 */
import { describe, it, expect, vi } from 'vitest';
import { runRecoveryOnce } from '../recovery-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('recovery-loop', () => {
  it('一次执行调用全部四条恢复网（含 probeTaskLiveness）', async () => {
    const cleanupStaleClaims = vi.fn(async () => ({ cleaned: 2 }));
    const checkStuckPipelines = vi.fn(async () => ({ canceled: [{ id: 'p1' }] }));
    const autoFailTimedOutTasks = vi.fn(async () => [{ action: 'auto-requeue-timeout' }]);
    const fetchInProgress = vi.fn(async () => []);
    const probeTaskLiveness = vi.fn(async () => []);

    const r = await runRecoveryOnce({
      pool: fakePool, cleanupStaleClaims, checkStuckPipelines, autoFailTimedOutTasks, fetchInProgress, probeTaskLiveness,
    });

    expect(cleanupStaleClaims).toHaveBeenCalledTimes(1);
    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(probeTaskLiveness).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ staleReleased: 2, orphansRequeued: 0 });
  });

  it('autoFailTimedOutTasks 只收到非-harness 任务（harness 由 harness-watchdog 专管，不被 wall-clock 误杀）', async () => {
    const inProgress = [
      { id: 'a', task_type: 'dev' },
      { id: 'b', task_type: 'harness_initiative' },
      { id: 'c', task_type: 'harness_generator' },
      { id: 'd', task_type: 'content-generate' },
    ];
    let received = null;
    const autoFailTimedOutTasks = vi.fn(async (list) => { received = list; return []; });

    await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines: async () => ({ canceled: [] }),
      autoFailTimedOutTasks,
      fetchInProgress: async () => inProgress,
      probeTaskLiveness: async () => [],
    });

    const ids = received.map((t) => t.id);
    expect(ids).toContain('a');          // 普通 dev 任务在内
    expect(ids).not.toContain('b');      // harness_initiative 排除
    expect(ids).not.toContain('c');      // harness_generator 排除
  });

  it('一条网抛错不影响其它两条（各自独立 try-catch）', async () => {
    const checkStuckPipelines = vi.fn(async () => ({ canceled: [] }));
    const autoFailTimedOutTasks = vi.fn(async () => []);

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => { throw new Error('boom'); },
      checkStuckPipelines,
      autoFailTimedOutTasks,
      fetchInProgress: async () => [],
      probeTaskLiveness: async () => [],
    });

    // cleanupStaleClaims 抛错，但另两条照常被调
    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(r.staleReleased).toBe(0);
  });
});
