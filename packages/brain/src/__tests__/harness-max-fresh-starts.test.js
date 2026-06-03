/**
 * Regression test — runHarnessInitiativeRouter 全局 fresh-start 上限
 *
 * Bug: 坏 checkpoint（channel_values.error 有值）时，runHarnessInitiativeRouter 升
 * attemptN 做 fresh start 从头重跑 planner。execution_attempts 一直涨，但从无上限判定。
 * 本机 Docker 抽风时 → 无限重跑、20+ planner 容器、永不收敛。
 *
 * 修复：加导出常量 MAX_INITIATIVE_FRESH_STARTS（默认 3）。
 * - 若 (task.execution_attempts || 0) >= MAX_INITIATIVE_FRESH_STARTS：
 *     不再 fresh-start / 不 invoke graph，把 task 标 terminal failed
 *     （status='failed' + failure_class='max_fresh_starts_exceeded'），
 *     返回 { ok:false, error:'max_fresh_starts_exceeded', terminal:true }。
 * - 若 existing.channel_values.error.terminal === true：同样视为 terminal（Wave 2b 钩子）。
 *
 * SC-101: execution_attempts == 上限 + error checkpoint + resume → stream 从未被调用，
 *         task 标 status=failed/failure_class=max_fresh_starts_exceeded，返回 terminal=true
 * SC-102: execution_attempts < 上限 + error checkpoint → 仍正常 fresh start（stream 被调用、attemptN 升）
 * SC-103: existing.channel_values.error.terminal === true → terminal，stream 不被调用
 * SC-104: MAX_INITIATIVE_FRESH_STARTS 被导出且为正整数（默认 3）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 所有 executor.js 的外部依赖 ──────────────────────────

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockUpdateTaskStatus = vi.fn();
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: (...args) => mockUpdateTaskStatus(...args),
  updateTaskProgress: vi.fn(),
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

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  })),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { FAILED: 'failed', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn(),
}));

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(),
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, levelName: 'CALM' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { ALERT: 3 },
  LEVEL_NAMES: {},
}));

vi.mock('../alertness/metrics.js', () => ({
  recordTickTime: vi.fn(),
  recordOperation: vi.fn(),
}));

vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ isRecovering: false }),
}));

vi.mock('../platform-utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listProcessesWithPpid: vi.fn(() => []),
    listProcessesWithElapsed: vi.fn(() => []),
    getMacOSMemoryPressure: vi.fn(() => 0),
    getAvailableMemoryMB: vi.fn(() => 8000),
    calculatePhysicalCapacity: vi.fn(() => 4),
    countClaudeProcesses: vi.fn(() => 0),
    sampleCpuUsage: vi.fn(() => 0),
    getSwapUsedPct: vi.fn(() => 0),
    getDmesgInfo: vi.fn(() => ''),
    evaluateMemoryHealth: vi.fn(() => ({
      brain_memory_ok: true, system_memory_ok: true, action: 'proceed',
      reason: 'mock', brain_rss_mb: 200, system_available_mb: 8000,
      system_threshold_mb: 600, brain_rss_danger_mb: 1500, brain_rss_warn_mb: 1000,
    })),
    getBrainRssMB: vi.fn(() => 200),
    IS_DARWIN: false,
  };
});

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1', model: 'sonnet' }),
  selectBestAccountForHaiku: vi.fn().mockResolvedValue('account1'),
  getAccountUsage: vi.fn().mockResolvedValue({}),
  markSpendingCap: vi.fn(),
  isSpendingCapped: vi.fn().mockReturnValue(false),
  isAllAccountsSpendingCapped: vi.fn().mockReturnValue(false),
  getSpendingCapStatus: vi.fn().mockReturnValue([]),
  loadSpendingCapsFromDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockResolvedValue(null),
  FALLBACK_PROFILE: {
    id: 'profile-anthropic',
    name: 'mock',
    config: {
      thalamus: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001', fallbacks: [] },
      cortex:   { provider: 'anthropic-api', model: 'claude-sonnet-4-6' },
      executor: {
        default_provider: 'anthropic',
        model_map: {
          dev:                { anthropic: 'claude-sonnet-4-6', minimax: null },
          harness_initiative: { anthropic: 'claude-sonnet-4-6', minimax: null },
        },
        fixed_provider: {},
      },
    },
  },
  getModelForTaskType: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('../learning-retriever.js', () => ({
  buildLearningContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('../decisions-context.js', () => ({
  getDecisionsSummary: vi.fn().mockResolvedValue(null),
}));

vi.mock('../dopamine.js', () => ({
  recordExpectedReward: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(),
  resolveResourceTier: vi.fn(() => 'standard'),
  isDockerAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock('../spawn/index.js', () => ({
  spawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn().mockResolvedValue(undefined),
}));

// ── mock harness graph 动态导入 ─────────────────────────────────

// capturedStreamInput 记录 compiled.stream() 被调用时的 input 参数
let capturedStreamInput = undefined;
let streamCallCount = 0;

const mockCompiled = {
  stream: vi.fn(async function* (input) {
    capturedStreamInput = input;
    streamCallCount++;
    yield { dbUpsert: { sub_tasks: [] } };
  }),
};

vi.mock('../workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: vi.fn().mockResolvedValue(mockCompiled),
}));

// mockCheckpointerGet 由各测试用例按需覆写
const mockCheckpointerGet = vi.fn();
vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: (...args) => mockCheckpointerGet(...args),
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

// ── 被测函数 ──────────────────────────────────────────────────

let runHarnessInitiativeRouter;
let MAX_INITIATIVE_FRESH_STARTS;

beforeEach(async () => {
  vi.clearAllMocks();
  capturedStreamInput = undefined;
  streamCallCount = 0;
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  vi.resetModules();
  const mod = await import('../executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
  MAX_INITIATIVE_FRESH_STARTS = mod.MAX_INITIATIVE_FRESH_STARTS;
});

function makeTask(executionAttempts) {
  return {
    id: 'task-max-fresh-1',
    task_type: 'harness_initiative',
    title: 'harness init max-fresh-starts test',
    payload: {
      initiative_id: 'init-max-fresh-001',
      resume_from_checkpoint: true,
    },
    status: 'in_progress',
    retry_count: 0,
    execution_attempts: executionAttempts,
  };
}

describe('runHarnessInitiativeRouter — 全局 fresh-start 上限', () => {

  it('SC-104: MAX_INITIATIVE_FRESH_STARTS 被导出且为正整数（默认 3）', () => {
    expect(typeof MAX_INITIATIVE_FRESH_STARTS).toBe('number');
    expect(Number.isInteger(MAX_INITIATIVE_FRESH_STARTS)).toBe(true);
    expect(MAX_INITIATIVE_FRESH_STARTS).toBeGreaterThan(0);
    expect(MAX_INITIATIVE_FRESH_STARTS).toBe(3);
  });

  it('SC-101: execution_attempts==上限 + error checkpoint + resume → stream 从未被调用，task 标 terminal failed', async () => {
    const task = makeTask(MAX_INITIATIVE_FRESH_STARTS);
    // 坏 checkpoint（error 有值），但已达上限，不应再 fresh start
    mockCheckpointerGet.mockResolvedValue({
      channel_values: { error: 'ganLoop failed: executor timeout' },
    });

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    // 1) compiled.stream 从未被调用（没再 fresh-start / 没 invoke graph）
    expect(streamCallCount).toBe(0);
    expect(mockCompiled.stream).not.toHaveBeenCalled();

    // 2) 返回 terminal
    expect(result.terminal).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('max_fresh_starts_exceeded');

    // 3) task 标 status=failed + failure_class=max_fresh_starts_exceeded
    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id) &&
        call[1].some((p) => String(p).includes('max_fresh_starts_exceeded'))
    );
    expect(failCall).toBeTruthy();
  });

  it('SC-102: execution_attempts<上限 + error checkpoint → 仍正常 fresh start（stream 被调用、attemptN 升）', async () => {
    const task = makeTask(MAX_INITIATIVE_FRESH_STARTS - 1); // 低于上限
    mockCheckpointerGet.mockResolvedValue({
      channel_values: { error: 'ganLoop failed: executor timeout' },
    });

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    // 仍 fresh start：stream 被调用，且 input = { task }
    expect(streamCallCount).toBe(1);
    expect(capturedStreamInput).toEqual({ task });

    // attemptN 升：baseAttemptN = execution_attempts+1，坏 checkpoint → +1
    const expectedAttemptN = (task.execution_attempts + 1) + 1;
    expect(result.attemptN).toBe(expectedAttemptN);
    expect(result.terminal).not.toBe(true);
  });

  it('SC-103: existing.channel_values.error.terminal === true → terminal，stream 不被调用', async () => {
    const task = makeTask(0); // 远低于上限，但 checkpoint 标了 terminal
    mockCheckpointerGet.mockResolvedValue({
      channel_values: { error: { terminal: true, message: 'permanent failure' } },
    });

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(streamCallCount).toBe(0);
    expect(mockCompiled.stream).not.toHaveBeenCalled();
    expect(result.terminal).toBe(true);
    expect(result.ok).toBe(false);

    // task 标 status=failed
    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id)
    );
    expect(failCall).toBeTruthy();
  });
});
