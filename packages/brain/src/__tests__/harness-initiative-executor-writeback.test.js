/**
 * harness-initiative-executor-writeback.test.js
 *
 * 验证 executor.js triggerCeceliaRun() 中 harness_initiative 分支
 * 在 runHarnessInitiativeRouter() 返回后正确调用 updateTaskStatus。
 *
 * 修复前 bug：compiled.invoke() 成功后从不调用 updateTaskStatus，
 * 导致任务永远卡在 in_progress。
 * 修复 PR：#2816
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
          dev:               { anthropic: 'claude-sonnet-4-6', minimax: null },
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

// ── mock harness graph 动态导入 ────────────────────────────────

const mockCompiled = { stream: vi.fn() };

vi.mock('../workflows/harness-initiative.graph.js', () => ({
  compileHarnessFullGraph: vi.fn().mockResolvedValue(mockCompiled),
}));

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),  // null = fresh start
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

// ── 被测函数 ─────────────────────────────────────────────────

let triggerCeceliaRun;

beforeEach(async () => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  vi.resetModules();
  const mod = await import('../executor.js');
  triggerCeceliaRun = mod.triggerCeceliaRun;
});

const HARNESS_TASK = {
  id: 'aaaabbbb-1234-5678-9012-abcdef012345',
  task_type: 'harness_initiative',
  title: 'Test harness initiative',
  payload: {
    prd: '## 测试 PRD',
    initiative_id: 'initiative-001',
  },
  status: 'in_progress',
  retry_count: 0,
  execution_attempts: 0,
};

// ── 测试 ─────────────────────────────────────────────────────

describe('triggerCeceliaRun — harness_initiative 状态回写（PR #2816 fix）', () => {

  it('graph ok=true → updateTaskStatus("completed") 被调用', async () => {
    // graph stream 返回无 error 的 state
    mockCompiled.stream.mockImplementation(async function* () {
      yield { dbUpsert: { sub_tasks: [{ task_id: 'ws1' }] } };
    });

    const result = await triggerCeceliaRun(HARNESS_TASK);

    expect(result.success).toBe(true);
    expect(result.initiative).toBe(true);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      HARNESS_TASK.id,
      'completed',
    );
  });

  it('graph final.error 存在（ok=false）→ updateTaskStatus("failed") 被调用', async () => {
    mockCompiled.stream.mockImplementation(async function* () {
      yield { prep: { error: 'plan generation failed' } };
    });

    const result = await triggerCeceliaRun(HARNESS_TASK);

    expect(result.success).toBe(true);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      HARNESS_TASK.id,
      'failed',
      expect.objectContaining({ error_message: expect.any(String) }),
    );
  });

  it('graph 抛出异常 → updateTaskStatus("failed") 被调用且 success=true', async () => {
    mockCompiled.stream.mockImplementation(async function* () {
      throw new Error('LangGraph internal error');
    });

    const result = await triggerCeceliaRun(HARNESS_TASK);

    expect(result.success).toBe(true);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      HARNESS_TASK.id,
      'failed',
      expect.objectContaining({
        error_message: expect.stringContaining('LangGraph internal error'),
      }),
    );
  });
});
