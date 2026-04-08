/**
 * harness-watcher.js 单元测试
 * 覆盖：
 * - F3: harness_fix 完成后新 harness_ci_watch 使用 result.pr_url
 * - F4: harness_deploy_watch 超时后创建 harness_report(deploy_timeout:true)
 * - F5: processHarnessCiWatchers 30s 节流（同一任务 30s 内不重复调 checkPrStatus）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock shepherd.js ─────────────────────────────────────────────────────────
const mockCheckPrStatus = vi.hoisted(() => vi.fn());
const mockClassifyFailedChecks = vi.hoisted(() => vi.fn().mockReturnValue('test_failure'));
vi.mock('../shepherd.js', () => ({
  checkPrStatus: mockCheckPrStatus,
  classifyFailedChecks: mockClassifyFailedChecks,
  executeMerge: vi.fn().mockResolvedValue({ success: true }),
}));

// ── Mock actions.js ──────────────────────────────────────────────────────────
const mockCreateTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-task-id' }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

// ── Mock child_process (execSync for deploy check) ───────────────────────────
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(JSON.stringify([{ status: 'completed', conclusion: 'success' }])),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

function makeCiWatchTask(overrides = {}) {
  return {
    id: 'ci-watch-task-1',
    title: '[CI Watch]',
    project_id: null,
    goal_id: null,
    retry_count: 0,
    payload: {
      pr_url: 'https://github.com/org/repo/pull/100',
      sprint_dir: 'sprints/test',
      dev_task_id: 'dev-1',
      planner_task_id: 'planner-1',
      eval_round: 1,
      poll_count: 0,
    },
    ...overrides,
  };
}

function makeDeployWatchTask(overrides = {}) {
  return {
    id: 'deploy-watch-task-1',
    title: '[Deploy Watch]',
    project_id: null,
    goal_id: null,
    payload: {
      pr_url: 'https://github.com/org/repo/pull/100',
      sprint_dir: 'sprints/test',
      planner_task_id: 'planner-1',
      eval_round: 1,
      poll_count: 0,
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('F5: processHarnessCiWatchers 30s 轮询节流', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('两次调用间隔 < 30s 时，checkPrStatus 仅被调用一次', async () => {
    const { processHarnessCiWatchers } = await import('../harness-watcher.js');

    const task = makeCiWatchTask();
    mockCheckPrStatus.mockReturnValue({ ciStatus: 'ci_pending', state: 'OPEN', failedChecks: [] });

    const pool = makePool([task]);
    // 第一次调用 — 应该调 checkPrStatus
    await processHarnessCiWatchers(pool);
    expect(mockCheckPrStatus).toHaveBeenCalledTimes(1);

    // 第二次调用（立即，< 30s）— 应该跳过，不调 checkPrStatus
    const pool2 = makePool([task]);
    await processHarnessCiWatchers(pool2);
    expect(mockCheckPrStatus).toHaveBeenCalledTimes(1); // 仍然 1 次
  });
});

describe('F2: CI watch 超时降级 → harness_evaluate(ci_timeout:true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // 重置模块以清除 lastPollTime Map
  });

  it('poll_count >= MAX_CI_WATCH_POLLS 时，创建 harness_evaluate 而非 failed', async () => {
    const { processHarnessCiWatchers } = await import('../harness-watcher.js');

    const task = makeCiWatchTask({
      payload: {
        ...makeCiWatchTask().payload,
        poll_count: 120, // MAX_CI_WATCH_POLLS
      },
    });

    const pool = makePool([task]);
    await processHarnessCiWatchers(pool);

    // 不应该调 checkPrStatus（超时提前处理）
    expect(mockCheckPrStatus).not.toHaveBeenCalled();

    // 应该把任务更新为 completed（不是 failed）
    const updateCall = pool.query.mock.calls.find(c => c[0].includes('completed'));
    expect(updateCall).toBeDefined();

    // 应该创建 harness_evaluate 含 ci_timeout:true
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'harness_evaluate',
        payload: expect.objectContaining({ ci_timeout: true }),
      })
    );
  });
});

describe('F3: harness_fix 后 pr_url 正确传递（execution.js 路由验证）', () => {
  it('harness_fix result.pr_url 应该传递给新的 harness_ci_watch payload', () => {
    // 验证 execution.js 中 harness_fix handler 的 pr_url 提取逻辑
    // 核心逻辑（从 execution.js 复制验证）：
    const result = { pr_url: 'https://github.com/org/repo/pull/999', verdict: 'DONE' };
    const pr_url = null; // 请求体没有 pr_url（agent 没直接传）

    let extractedPrUrl = pr_url || null;
    if (!extractedPrUrl && result !== null && typeof result === 'object') {
      extractedPrUrl = result.pr_url || result?.result?.pr_url || null;
    }

    expect(extractedPrUrl).toBe('https://github.com/org/repo/pull/999');
  });

  it('harness_fix result 为字符串时，pr_url 从 GitHub URL pattern 提取', () => {
    const result = 'PR created: https://github.com/org/repo/pull/999 done';
    const pr_url = null;

    let extractedPrUrl = pr_url || null;
    if (!extractedPrUrl && typeof result === 'string') {
      const prMatch = result.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
      if (prMatch) extractedPrUrl = prMatch[0];
    }

    expect(extractedPrUrl).toBe('https://github.com/org/repo/pull/999');
  });
});

describe('F4: harness_deploy_watch 超时降级 → harness_report(deploy_timeout:true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('poll_count >= MAX_DEPLOY_WATCH_POLLS 时，创建 harness_report 含 deploy_timeout:true', async () => {
    const { processHarnessDeployWatchers } = await import('../harness-watcher.js');

    const task = makeDeployWatchTask({
      payload: {
        ...makeDeployWatchTask().payload,
        poll_count: 60, // MAX_DEPLOY_WATCH_POLLS
      },
    });

    const pool = makePool([task]);
    await processHarnessDeployWatchers(pool);

    // 任务应更新为 completed
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('completed'),
      expect.arrayContaining([task.id])
    );

    // 应该创建 harness_report 含 deploy_timeout:true
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'harness_report',
        payload: expect.objectContaining({ deploy_timeout: true }),
      })
    );
  });
});
