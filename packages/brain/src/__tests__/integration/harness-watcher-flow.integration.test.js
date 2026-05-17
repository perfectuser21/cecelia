/**
 * harness-watcher CI 监控流集成测试
 *
 * 覆盖路径：
 *   Path 1: 无待处理任务 → 返回空结果（不报错）
 *   Path 2: pr_url 缺失 → 任务标记为 failed
 *   Path 3: 超过最大轮询次数 → 任务标记 completed + 创建 harness_fix（ci_timeout）
 *   Path 4: 节流逻辑 — 30s 内同一任务不重复查询 GitHub API
 *   Path 5: CI 通过 → 创建 harness_report
 *   Path 6: CI 失败 → 创建 harness_fix（含 ci_fail_context）
 *
 * 测试策略：
 *   - mock pool（db.js）控制 DB 返回数据
 *   - mock shepherd.js（GitHub API 轮询）返回各种 CI 状态
 *   - mock actions.js（不测任务创建）
 *   - mock child_process.execSync（不执行 git 命令）
 *
 * 关联模块：harness-watcher.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock DB pool ─────────────────────────────────────────────────────────────
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// ─── Mock shepherd（GitHub API 调用）─────────────────────────────────────────
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: vi.fn().mockReturnValue({ ciStatus: 'ci_pending', failedChecks: [] }),
  classifyFailedChecks: vi.fn().mockReturnValue('test_failure'),
  executeMerge: vi.fn().mockResolvedValue({ merged: true }),
}));

// ─── Mock actions（不测任务创建）─────────────────────────────────────────────
vi.mock('../../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue('new-task-id'),
}));

// ─── Mock child_process（不执行 git 命令）────────────────────────────────────
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

// ─────────────────────────────────────────────────────────────────────────────

// Sprint 1: harness-watcher.js retired (Phase B/C 进 LangGraph，sub-graph poll_ci 替代)。
// 整段 skip，新覆盖见 src/workflows/__tests__/harness-task.graph.test.js poll_ci e2e。
describe.skip('[Sprint 1 retired → harness-task.graph.poll_ci] harness-watcher CI 监控流集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Path 1: 无待处理任务 ─────────────────────────────────────────────────

  describe('Path 1: 无待处理任务', () => {
    it('harness_ci_watch 队列为空时返回 processed=0 且不报错', async () => {
      mockPool.query.mockResolvedValue({ rows: [] }); // 无 queued 任务

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result = await processHarnessCiWatchers(mockPool);

      expect(result).toBeDefined();
      expect(result.processed).toBe(0);
    });

    it('DB query 失败时优雅降级（不抛异常）', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');

      // 不应抛异常
      await expect(processHarnessCiWatchers(mockPool)).resolves.toBeDefined();
    });
  });

  // ─── Path 2: pr_url 缺失 ─────────────────────────────────────────────────

  describe('Path 2: pr_url 缺失任务处理', () => {
    it('pr_url 缺失时任务标记 failed，error_message 含 no pr_url', async () => {
      const taskWithoutPr = {
        id: 'watch-001',
        title: '[Test] harness CI watch',
        payload: {},    // 无 pr_url
        project_id: 'proj-1',
        goal_id: 'kr-1',
        retry_count: 0,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [taskWithoutPr] }) // 查询 harness_ci_watch 任务
        .mockResolvedValue({ rows: [] }); // UPDATE 操作

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result = await processHarnessCiWatchers(mockPool);

      // 验证调用了 UPDATE tasks SET status = 'failed'
      const updateCalls = mockPool.query.mock.calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes("status = 'failed'")
      );
      expect(updateCalls.length).toBeGreaterThan(0);

      // 验证 error_message 包含 no pr_url
      const updateCall = updateCalls[0];
      expect(updateCall[1] || updateCall[0]).toBeDefined();
      // UPDATE SQL 含 no pr_url 字符串
      const allCallArgs = mockPool.query.mock.calls.flat();
      const hasPrUrlError = allCallArgs.some(arg =>
        typeof arg === 'string' && arg.includes('no pr_url')
      );
      expect(hasPrUrlError).toBe(true);

      expect(result.processed).toBe(1);
    });
  });

  // ─── Path 3: 超过最大轮询次数 ────────────────────────────────────────────

  describe('Path 3: 超过最大 poll 次数（CI 超时）', () => {
    it('poll_count >= 120 时任务标记 completed + 创建 harness_fix（ci_timeout=true）', async () => {
      const { createTask } = await import('../../actions.js');

      const timedOutTask = {
        id: 'watch-002',
        title: '[Test] timed out CI watch',
        payload: {
          pr_url: 'https://github.com/test/repo/pull/50',
          poll_count: 120,  // MAX_CI_WATCH_POLLS = 120
          sprint_dir: 'sprints/sprint-1',
          planner_task_id: 'planner-uuid-1234',
          eval_round: 2,
        },
        project_id: 'proj-2',
        goal_id: 'kr-2',
        retry_count: 0,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [timedOutTask] }) // 查询任务
        .mockResolvedValue({ rows: [] }); // UPDATE 操作

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result = await processHarnessCiWatchers(mockPool);

      // 任务应被标记 completed（带 ci_timeout）
      const completedCalls = mockPool.query.mock.calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes("status = 'completed'")
      );
      expect(completedCalls.length).toBeGreaterThan(0);

      // 应创建 harness_fix 任务
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_type: 'harness_fix',
          payload: expect.objectContaining({ ci_timeout: true }),
        })
      );

      expect(result.processed).toBe(1);
    });
  });

  // ─── Path 4: 节流逻辑 ─────────────────────────────────────────────────────

  describe('Path 4: 节流 — 30s 内同一任务不重复调用 GitHub API', () => {
    it('第二次处理同一任务时跳过 GitHub API 调用（ci_pending 计数+1）', async () => {
      const { checkPrStatus } = await import('../../shepherd.js');

      const ciPendingTask = {
        id: 'watch-003',
        title: '[Test] CI pending task',
        payload: {
          pr_url: 'https://github.com/test/repo/pull/51',
          poll_count: 5,
        },
        project_id: 'proj-3',
        goal_id: 'kr-3',
        retry_count: 0,
      };

      // 第一次调用：模拟 CI pending
      checkPrStatus.mockReturnValue({ ciStatus: 'ci_pending', failedChecks: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [ciPendingTask] }).mockResolvedValue({ rows: [] });

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result1 = await processHarnessCiWatchers(mockPool);

      // 第二次立即处理同一任务（30s 内）
      mockPool.query.mockResolvedValueOnce({ rows: [ciPendingTask] }).mockResolvedValue({ rows: [] });
      const result2 = await processHarnessCiWatchers(mockPool);

      // 节流：checkPrStatus 只被调用一次（第二次被节流跳过）
      const totalCheckPrCalls = checkPrStatus.mock.calls.length;
      expect(totalCheckPrCalls).toBe(1);

      // 第二次 ci_pending 计数增加
      expect(result2.ci_pending).toBe(1);
    });
  });

  // ─── Path 5: CI 通过 ──────────────────────────────────────────────────────

  describe('Path 5: CI 通过 → 创建 harness_report', () => {
    it('ciStatus=ci_passed 时创建 harness_report 任务', async () => {
      const { checkPrStatus } = await import('../../shepherd.js');
      const { createTask } = await import('../../actions.js');

      checkPrStatus.mockReturnValue({ ciStatus: 'ci_passed', failedChecks: [] });

      const ciPassedTask = {
        id: 'watch-004',
        title: '[Test] CI passed',
        payload: {
          pr_url: 'https://github.com/test/repo/pull/52',
          poll_count: 3,
          planner_task_id: 'planner-abcd-1234',
          sprint_dir: 'sprints/sprint-1',
          contract_branch: 'cp-harness-review-approved-abcd1234',
        },
        project_id: 'proj-4',
        goal_id: 'kr-4',
        retry_count: 0,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [ciPassedTask] }).mockResolvedValue({ rows: [] });

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result = await processHarnessCiWatchers(mockPool);

      // 应创建 harness_report 任务
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_type: 'harness_report',
          payload: expect.objectContaining({ harness_mode: true }),
        })
      );

      expect(result.ci_passed).toBe(1);
    });
  });

  // ─── Path 6: CI 失败 ──────────────────────────────────────────────────────

  describe('Path 6: CI 失败 → 创建 harness_fix', () => {
    it('ciStatus=ci_failed 时创建 harness_fix 任务（含 ci_fail_context）', async () => {
      const { checkPrStatus, classifyFailedChecks } = await import('../../shepherd.js');
      const { createTask } = await import('../../actions.js');

      checkPrStatus.mockReturnValue({
        ciStatus: 'ci_failed',
        failedChecks: ['brain-unit', 'brain-integration'],
      });
      classifyFailedChecks.mockReturnValue('test_failure');

      const ciFailedTask = {
        id: 'watch-005',
        title: '[Test] CI failed',
        payload: {
          pr_url: 'https://github.com/test/repo/pull/53',
          poll_count: 8,
          planner_task_id: 'planner-efgh-5678',
          sprint_dir: 'sprints/sprint-2',
          eval_round: 1,
        },
        project_id: 'proj-5',
        goal_id: 'kr-5',
        retry_count: 0,
      };

      mockPool.query.mockResolvedValueOnce({ rows: [ciFailedTask] }).mockResolvedValue({ rows: [] });

      const { processHarnessCiWatchers } = await import('../../harness-watcher.js');
      const result = await processHarnessCiWatchers(mockPool);

      // 应创建 harness_fix 任务（含 ci_fail_context）
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_type: 'harness_fix',
          payload: expect.objectContaining({
            ci_fail_context: expect.any(String),
          }),
        })
      );

      expect(result.ci_failed).toBe(1);
    });
  });
});
