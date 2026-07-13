/**
 * Regression: 三条任务恢复安全网——stalled/timeout/orphan——均在独立 loop 中运行，
 * 不再挂接废弃的 executeTick。
 *
 * 根因（2026-07-13）：executeTick→runScheduler 迁移后：
 *   - stalled 检测：harness-watchdog-loop resumeStalledHarnessDrivers 已接回独立 loop
 *   - timeout 重试：recovery-loop autoFailTimedOutTasks 已接回独立 loop
 *   - orphan 回收：probeTaskLiveness 仍挂废弃 executeTick → 本次补接 recovery-loop
 *
 * 验收：三条场景各一测试，全部绿。
 */
import { describe, it, expect, vi } from 'vitest';
import { runRecoveryOnce } from '../recovery-loop.js';
import { runHarnessWatchdogOnce } from '../harness-watchdog-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

// ── 安全网 1：stalled 检测（harness-watchdog-loop 接管） ────────────────────
describe('stalled 检测：harness 驱动器静默 → resumeStalledHarnessDrivers 重排队', () => {
  it('模拟 harness 驱动器已死场景：runHarnessWatchdogOnce 调用 resumeStalledHarnessDrivers 并返回 resumed 数', async () => {
    const STALLED_TASK_ID = 'stalled-harness-task-abc123';

    // Mock：scanStuckHarness 无逾期，resumeStalledHarnessDrivers 发现 1 个驱动器已死 → resumed
    const mockScanStuck = vi.fn(async () => ({ scanned: 1, flagged: [] }));
    const mockResume = vi.fn(async () => ({ scanned: 2, resumed: [STALLED_TASK_ID] }));
    const mockRelayResume = vi.fn(async () => ({ scanned: 0, resumed: 0 }));

    vi.doMock('../harness-watchdog.js', () => ({
      scanStuckHarness: mockScanStuck,
      resumeStalledHarnessDrivers: mockResume,
    }));
    vi.doMock('../harness-relay-watchdog.js', () => ({
      resumeStalledRelayRuns: mockRelayResume,
    }));

    const { runHarnessWatchdogOnce: freshFn } = await import('../harness-watchdog-loop.js');
    const r = await freshFn({ pool: fakePool });

    // 安全网实际触发并修复任务状态
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(r.resumed).toBe(1);

    vi.doUnmock('../harness-watchdog.js');
    vi.doUnmock('../harness-relay-watchdog.js');
  });
});

// ── 安全网 2：timeout 重试（recovery-loop 接管） ─────────────────────────────
describe('timeout 重试：普通任务超时 → autoFailTimedOutTasks 标记失败', () => {
  it('模拟 dev 任务超过 wall-clock 限制：runRecoveryOnce 调用 autoFailTimedOutTasks 并返回 tasksTimedOut=1', async () => {
    const TIMEOUT_TASK_ID = 'timed-out-dev-task-xyz789';

    // Mock：autoFailTimedOutTasks 接收到超时任务 → 返回一条 auto-fail action
    const autoFailTimedOutTasks = vi.fn(async (tasks) => {
      // 验证：harness 任务被排除，只收到 dev 任务
      const ids = tasks.map((t) => t.id);
      expect(ids).toContain(TIMEOUT_TASK_ID);
      expect(ids.every((id) => !id.startsWith('harness-'))).toBe(true);
      return [{ action: 'auto-requeue-timeout', task_id: TIMEOUT_TASK_ID }];
    });

    const fetchInProgress = vi.fn(async () => [
      { id: TIMEOUT_TASK_ID, task_type: 'dev', started_at: new Date(Date.now() - 200 * 60_000) },
      // harness 任务应被排除
      { id: 'harness-init-999', task_type: 'harness_initiative', started_at: new Date() },
    ]);

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines: async () => ({ canceled: [] }),
      autoFailTimedOutTasks,
      fetchInProgress,
      probeTaskLiveness: async () => [],
    });

    // 安全网实际触发并修复任务状态
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(r.tasksTimedOut).toBe(1);
  });
});

// ── 安全网 3：orphan 回收（recovery-loop 新接入 probeTaskLiveness） ──────────
describe('orphan 回收：进程已死 → probeTaskLiveness 检测并重排队', () => {
  it('模拟 in_progress 任务进程消失：runRecoveryOnce 调用 probeTaskLiveness 并返回 orphansRequeued=1', async () => {
    const ORPHAN_TASK_ID = 'orphan-dev-task-abc456';

    // Mock：probeTaskLiveness 发现 1 个孤儿进程 → 重排队
    const probeTaskLiveness = vi.fn(async () => [
      {
        action: 'liveness_auto_requeue',
        task_id: ORPHAN_TASK_ID,
        suspect_since: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    ]);

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines: async () => ({ canceled: [] }),
      autoFailTimedOutTasks: async () => [],
      fetchInProgress: async () => [],
      probeTaskLiveness,
    });

    // 安全网实际触发并修复任务状态
    expect(probeTaskLiveness).toHaveBeenCalledTimes(1);
    expect(r.orphansRequeued).toBe(1);
  });

  it('probeTaskLiveness 抛错不影响其余三条网（独立 try-catch）', async () => {
    const autoFailTimedOutTasks = vi.fn(async () => []);
    const checkStuckPipelines = vi.fn(async () => ({ canceled: [] }));

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines,
      autoFailTimedOutTasks,
      fetchInProgress: async () => [],
      probeTaskLiveness: async () => { throw new Error('liveness boom'); },
    });

    // 其余网照常运行
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(r.orphansRequeued).toBe(0);
  });
});
