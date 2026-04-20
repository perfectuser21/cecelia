/**
 * executor.js: harness_task 容器派发分支测试
 *
 * DoD:
 * - triggerCeceliaRun(task) 对 task_type='harness_task' 分支到 triggerHarnessTaskDispatch
 * - triggerHarnessTaskDispatch 调 executeInDocker（而非 cecelia-bridge fetch）
 * - executeInDocker 收到的 opts 含 worktreePath + env.GITHUB_TOKEN
 * - Fix 模式 payload 映射到 env.HARNESS_FIX_MODE=1 / HARNESS_FIX_ROUND=N
 *
 * 背景（harness-v2-fix-2）：
 * task-router 声明 harness_task 是 /_internal（Brain tick 内部处理），但 executor.js
 * 此前对 harness_task 无分支 → 落到默认 bridge headless Claude，绕过 PR-1 的
 * worktree 挂载 + GITHUB_TOKEN 注入。这里固化容器派发路径防回归。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 全量 mock 侧效库（避免 db / fs / trace 污染）─────────────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
  refreshCache: vi.fn(),
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(() => ({ end: vi.fn() })),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(() => null),
  getAccountUsage: vi.fn(() => ({})),
  isSpendingCapped: vi.fn(() => false),
  isAuthFailed: vi.fn(() => false),
}));

vi.mock('../learning-retriever.js', () => ({
  buildLearningContext: vi.fn(async () => ''),
}));

vi.mock('../decisions-context.js', () => ({
  getDecisionsSummary: vi.fn(async () => ''),
}));

vi.mock('../dopamine.js', () => ({
  recordExpectedReward: vi.fn(),
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => null),
  FALLBACK_PROFILE: {
    config: {
      executor: {
        default_provider: 'anthropic',
        model_map: {},
        fixed_provider: {},
      },
    },
  },
  getCascadeForTask: vi.fn(() => []),
}));

vi.mock('../platform-utils.js', () => ({
  sampleCpuUsage: vi.fn(() => 0),
  _resetCpuSampler: vi.fn(),
  getSwapUsedPct: vi.fn(() => 0),
  getDmesgInfo: vi.fn(() => ''),
  countClaudeProcesses: vi.fn(() => 0),
  calculatePhysicalCapacity: vi.fn(() => 10),
  evaluateMemoryHealth: vi.fn(() => ({ healthy: true })),
  getBrainRssMB: vi.fn(() => 100),
  IS_DARWIN: false,
}));

// ─── Mock 三个目标：docker-executor / harness-worktree / harness-credentials ──
const mockExecuteInDocker = vi.fn();
const mockEnsureHarnessWorktree = vi.fn();
const mockResolveGitHubToken = vi.fn();

vi.mock('../docker-executor.js', () => ({
  executeInDocker: mockExecuteInDocker,
  writeDockerCallback: vi.fn(async () => {}),
  resolveResourceTier: vi.fn(() => ({ memoryMB: 1024, cpuCores: 1, tier: 'normal' })),
  isDockerAvailable: vi.fn(() => true),
}));

vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: mockEnsureHarnessWorktree,
  cleanupHarnessWorktree: vi.fn(),
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: mockResolveGitHubToken,
}));

vi.mock('../harness-graph.js', () => ({
  loadSkillContent: vi.fn(() => '# harness-generator skill (mock)'),
}));

// 禁用 cecelia-bridge fetch 分支（只要被调就应失败）
const bridgeFetchSpy = vi.fn();
global.fetch = bridgeFetchSpy;

describe('executor: harness_task 容器派发分支', () => {
  let triggerCeceliaRun;
  let triggerHarnessTaskDispatch;

  beforeEach(async () => {
    vi.resetModules();
    mockExecuteInDocker.mockReset();
    mockEnsureHarnessWorktree.mockReset();
    mockResolveGitHubToken.mockReset();
    bridgeFetchSpy.mockReset();

    mockEnsureHarnessWorktree.mockResolvedValue(
      '/tmp/cecelia/.claude/worktrees/harness-v2/task-abcdef12'
    );
    mockResolveGitHubToken.mockResolvedValue('ghs_harness_task_token');
    mockExecuteInDocker.mockResolvedValue({
      exit_code: 0,
      timed_out: false,
      stdout: '',
      stderr: '',
      duration_ms: 123,
      container: 'cecelia-task-abcdef12',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });

    const mod = await import('../executor.js');
    triggerCeceliaRun = mod.triggerCeceliaRun;
    triggerHarnessTaskDispatch = mod.triggerHarnessTaskDispatch;
  });

  it('executor.js 导出 triggerHarnessTaskDispatch', () => {
    expect(typeof triggerHarnessTaskDispatch).toBe('function');
  });

  it('triggerCeceliaRun 对 harness_task 走 Docker（不 fetch bridge）', async () => {
    const task = {
      id: 'abcdef1234567890-harness-task-1',
      task_type: 'harness_task',
      title: '加 harness_task 派发',
      description: 'generate some code',
      payload: {
        initiative_id: 'init-123',
        parent_task_id: 'initparent-456',
        logical_task_id: 'ws1',
        files: ['packages/brain/src/executor.js'],
        dod: ['[BEHAVIOR] executor 含 harness_task 分支'],
      },
    };

    const res = await triggerCeceliaRun(task);

    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(bridgeFetchSpy).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.docker).toBe(true);
    expect(res.taskId).toBe(task.id);
  });

  it('executeInDocker 收到 worktreePath + GITHUB_TOKEN', async () => {
    const task = {
      id: 'abcdef1234567890-harness-task-2',
      task_type: 'harness_task',
      title: 't',
      description: 'd',
      payload: { initiative_id: 'init-xyz' },
    };

    await triggerCeceliaRun(task);

    const opts = mockExecuteInDocker.mock.calls[0][0];
    expect(opts.worktreePath).toBe(
      '/tmp/cecelia/.claude/worktrees/harness-v2/task-abcdef12'
    );
    expect(opts.env).toBeTruthy();
    expect(opts.env.GITHUB_TOKEN).toBe('ghs_harness_task_token');
    expect(opts.env.HARNESS_NODE).toBe('generator');
    expect(opts.env.HARNESS_INITIATIVE_ID).toBe('init-xyz');
    // 容器内任务类型应是 harness_generate（新建模式）
    expect(opts.task.task_type).toBe('harness_generate');
    // prompt 应含 skill 内容占位
    expect(typeof opts.prompt).toBe('string');
    expect(opts.prompt).toContain('harness-generator');
  });

  it('Fix 模式 payload 映射到 env.HARNESS_FIX_MODE + 容器任务类型 harness_fix', async () => {
    const task = {
      id: 'abcdef1234567890-harness-task-3',
      task_type: 'harness_task',
      title: 'fix-r2',
      description: 'fix round 2',
      payload: {
        initiative_id: 'init-fix',
        parent_task_id: 'parent-fix',
        fix_mode: true,
        fix_round: 2,
        original_task_id: 'orig-1',
        failure_scenarios: [
          { name: 'scenario_a', exitCode: 1 },
          { name: 'scenario_b', exitCode: 2 },
        ],
      },
    };

    const res = await triggerCeceliaRun(task);

    const opts = mockExecuteInDocker.mock.calls[0][0];
    expect(opts.env.HARNESS_FIX_MODE).toBe('1');
    expect(opts.env.HARNESS_FIX_ROUND).toBe('2');
    expect(opts.task.task_type).toBe('harness_fix');
    expect(opts.prompt).toContain('scenario_a');
    expect(res.fixMode).toBe(true);
    expect(res.fixRound).toBe(2);
  });

  it('worktree / token 失败时快速返回 error，不调 executeInDocker', async () => {
    mockResolveGitHubToken.mockRejectedValueOnce(new Error('github_token_unavailable'));

    const task = {
      id: 'abcdef1234567890-harness-task-4',
      task_type: 'harness_task',
      title: 't',
      description: 'd',
      payload: { initiative_id: 'init-err' },
    };

    const res = await triggerCeceliaRun(task);

    expect(mockExecuteInDocker).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/github_token_unavailable/);
  });

  it('非 harness_task 任务不走 triggerHarnessTaskDispatch（回归保护）', async () => {
    // 调 triggerHarnessTaskDispatch 直接验证隔离性
    const task = {
      id: 'abcdef1234567890-isolated',
      task_type: 'harness_task',
      title: 't',
      description: 'd',
      payload: {},
    };
    await triggerHarnessTaskDispatch(task);
    expect(mockEnsureHarnessWorktree).toHaveBeenCalledWith({
      taskId: task.id,
      initiativeId: task.id, // fallback when no initiative_id in payload
    });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
  });
});
