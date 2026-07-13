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
import { runRecoveryOnce, startRecoveryLoop, stopRecoveryLoop } from '../recovery-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('recovery-loop', () => {
  it('一次执行调用全部三条恢复网', async () => {
    const cleanupStaleClaims = vi.fn(async () => ({ cleaned: 2 }));
    const checkStuckPipelines = vi.fn(async () => ({ canceled: [{ id: 'p1' }] }));
    const autoFailTimedOutTasks = vi.fn(async () => [{ action: 'auto-requeue-timeout' }]);
    const fetchInProgress = vi.fn(async () => []);

    const r = await runRecoveryOnce({
      pool: fakePool, cleanupStaleClaims, checkStuckPipelines, autoFailTimedOutTasks, fetchInProgress,
    });

    expect(cleanupStaleClaims).toHaveBeenCalledTimes(1);
    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ staleReleased: 2 });
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
    });

    // cleanupStaleClaims 抛错，但另两条照常被调
    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(autoFailTimedOutTasks).toHaveBeenCalledTimes(1);
    expect(r.staleReleased).toBe(0);
  });

  // ── 场景回归：executeTick→runScheduler 迁移遗漏，三条安全网全死 ──
  // 以下三个测试模拟实际场景，验证安全网在恢复循环中真实触发并修复任务状态。

  it('[场景-stalled] owner 进程崩溃后 stale claim 被 cleanupStaleClaims 周期释放', async () => {
    // 场景：一个任务被 worker claim 后 owner 进程崩溃，任务永久卡在 queued（stale claim）。
    // executeTick 死后，cleanupStaleClaims 只在 Brain 启动时跑一次，崩溃后无法自动恢复。
    // recovery-loop 修复：周期调用 cleanupStaleClaims，返回释放数 > 0。
    let staleCleaned = 0;
    const cleanupStaleClaims = vi.fn(async () => {
      staleCleaned = 3; // 模拟3个 stale claim 被释放
      return { cleaned: staleCleaned };
    });

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims,
      checkStuckPipelines: async () => ({ canceled: [] }),
      autoFailTimedOutTasks: async () => [],
      fetchInProgress: async () => [],
    });

    expect(cleanupStaleClaims).toHaveBeenCalledTimes(1);
    expect(r.staleReleased).toBe(3);
    expect(staleCleaned).toBe(3);
  });

  it('[场景-timeout] in_progress 超时任务被 autoFailTimedOutTasks 收尾（非 harness 类型）', async () => {
    // 场景：一个普通 dev 任务已 in_progress 超过 DISPATCH_TIMEOUT_MINUTES，executor 静默死掉。
    // executeTick 死后，autoFailTimedOutTasks 永远不被调用，任务静默卡死无法自愈。
    // recovery-loop 修复：每 5 分钟调用，超时任务被标记 failed/requeued。
    const stalledDevTask = { id: 'task-001', task_type: 'dev', status: 'in_progress' };
    const stalledResearchTask = { id: 'task-002', task_type: 'research', status: 'in_progress' };
    const activeHarnessTask = { id: 'task-003', task_type: 'harness_initiative', status: 'in_progress' };

    let passedToTimeout = null;
    const autoFailTimedOutTasks = vi.fn(async (tasks) => {
      passedToTimeout = tasks;
      // 模拟两个普通任务超时被收尾
      return tasks.map((t) => ({ action: 'auto-requeue-timeout', task_id: t.id }));
    });

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines: async () => ({ canceled: [] }),
      autoFailTimedOutTasks,
      fetchInProgress: async () => [stalledDevTask, stalledResearchTask, activeHarnessTask],
    });

    // 普通任务传入，harness 任务被过滤掉
    const receivedIds = passedToTimeout.map((t) => t.id);
    expect(receivedIds).toContain('task-001');
    expect(receivedIds).toContain('task-002');
    expect(receivedIds).not.toContain('task-003'); // harness 由 harness-watchdog 专管
    // 两个任务超时被收尾
    expect(r.tasksTimedOut).toBe(2);
  });

  it('[场景-orphan] 整体 spin 的 pipeline 被 checkStuckPipelines 识别并 cancel', async () => {
    // 场景：一个 pipeline 下所有子任务各自有心跳，但 pipeline 整体不前进（orchestrator 卡住）。
    // executeTick 死后，checkStuckPipelines 6h spin 检测+cancel 永远不运行。
    // recovery-loop 修复：周期调用，卡住的 pipeline 被识别并 cancel。
    const orphanPipelineId = 'pipeline-stuck-abc';
    const checkStuckPipelines = vi.fn(async () => ({
      canceled: [{ id: orphanPipelineId, reason: 'stuck_6h' }],
    }));

    const r = await runRecoveryOnce({
      pool: fakePool,
      cleanupStaleClaims: async () => ({ cleaned: 0 }),
      checkStuckPipelines,
      autoFailTimedOutTasks: async () => [],
      fetchInProgress: async () => [],
    });

    expect(checkStuckPipelines).toHaveBeenCalledTimes(1);
    expect(r.pipelinesCancelled).toBe(1);
  });

  it('[wiring] startRecoveryLoop 启动后 stopRecoveryLoop 能干净停止（无内存泄漏）', () => {
    // 验证 loop 的 start/stop 对称性：重复 start 不会启动双跑，stop 后能重新 start。
    const started1 = startRecoveryLoop({ intervalMs: 999999 });
    const started2 = startRecoveryLoop({ intervalMs: 999999 }); // 重复调用应跳过
    expect(started1).toBe(true);
    expect(started2).toBe(false); // 已在运行，跳过

    stopRecoveryLoop();

    // stop 后可重新 start
    const started3 = startRecoveryLoop({ intervalMs: 999999 });
    expect(started3).toBe(true);
    stopRecoveryLoop(); // 清理
  });
});
