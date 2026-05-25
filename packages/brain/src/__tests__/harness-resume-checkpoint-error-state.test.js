/**
 * Regression test — runHarnessInitiativeRouter 续 checkpoint 前必须检查 error 状态
 *
 * Bug: Brain 重启后 syncOrphanTasksOnStartup 对 harness_initiative 任务设置
 * resume_from_checkpoint=true。runHarnessInitiativeRouter 看到此 flag + 存在 checkpoint
 * 时直接 input=null（resume 模式），但未检查 checkpoint.channel_values.error 是否有值。
 *
 * 若 checkpoint 处于 error 状态（如 ganLoop 节点执行失败），resume 会立即路由到 END，
 * final=null → task 被标 failed → consciousness-loop 再 retry → 每 2min 死循环。
 *
 * 修复：在 `input = null` 之前，检查 existing.channel_values?.error：
 * - 有 error → 坏 checkpoint，升 attemptN，fresh start
 * - 无 error → 正常 resume（input = null）
 *
 * SC-001: 坏 checkpoint（error 有值）+ resumeRequested → fresh start（input = { task }）
 * SC-002: 好 checkpoint（无 error）+ resumeRequested → resume（input = null）
 * SC-003: 坏 checkpoint → attemptN 被升（baseAttemptN + 1），threadId 包含新 attemptN
 * SC-004: 坏 checkpoint → DB UPDATE execution_attempts 被调用
 * SC-005: 好 checkpoint（channel_values 存在但 error 为 null）→ 仍走 resume
 * SC-005b: 好 checkpoint（channel_values 存在但 error 为 undefined）→ 仍走 resume
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

const mockCompiled = {
  stream: vi.fn(async function* (input) {
    capturedStreamInput = input;
    // yield 一个无 error 的 state，让 runHarnessInitiativeRouter 正常完成
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

beforeEach(async () => {
  vi.clearAllMocks();
  capturedStreamInput = undefined;
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  vi.resetModules();
  const mod = await import('../executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
});

// ── 基础 task fixture ────────────────────────────────────────

const BASE_TASK = {
  id: 'task-resume-test-1',
  task_type: 'harness_initiative',
  title: 'harness init resume test',
  payload: {
    initiative_id: 'init-resume-001',
    resume_from_checkpoint: true,
  },
  status: 'in_progress',
  retry_count: 0,
  execution_attempts: 2,  // baseAttemptN = 3
};

// ── 测试 ────────────────────────────────────────────────────

describe('runHarnessInitiativeRouter — 坏 checkpoint 检测（resume-checkpoint 无限循环修复）', () => {

  it('SC-001: 坏 checkpoint（channel_values.error 有值）+ resumeRequested → fresh start（input = { task }）', async () => {
    // 返回一个处于 error 状态的 checkpoint（ganLoop 失败）
    mockCheckpointerGet.mockResolvedValue({
      channel_values: {
        error: 'ganLoop failed: executor timeout',
        task: BASE_TASK,
      },
    });

    await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    // fresh start: compiled.stream 必须以 { task } 作为 input，而不是 null
    expect(capturedStreamInput).toEqual({ task: BASE_TASK });
  });

  it('SC-002: 好 checkpoint（channel_values 无 error）+ resumeRequested → resume（input = null）', async () => {
    // 返回一个正常 checkpoint（无 error 字段）
    mockCheckpointerGet.mockResolvedValue({
      channel_values: {
        task: BASE_TASK,
        planner_output: { some: 'state' },
      },
    });

    await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    // resume: compiled.stream 必须以 null 作为 input
    expect(capturedStreamInput).toBeNull();
  });

  it('SC-003: 坏 checkpoint → attemptN 被升（execution_attempts+1+1），threadId 包含新 attemptN', async () => {
    mockCheckpointerGet.mockResolvedValue({
      channel_values: { error: 'ganLoop failed' },
    });

    const result = await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    // BASE_TASK.execution_attempts=2 → baseAttemptN=3，坏 checkpoint → attemptN=4
    const expectedAttemptN = (BASE_TASK.execution_attempts + 1) + 1;
    expect(result.attemptN).toBe(expectedAttemptN);
    expect(result.threadId).toContain(`:${expectedAttemptN}`);
  });

  it('SC-004: 坏 checkpoint → DB UPDATE execution_attempts 被调用（避免重复使用旧 attemptN）', async () => {
    mockCheckpointerGet.mockResolvedValue({
      channel_values: { error: 'ganLoop node threw exception' },
    });

    const expectedAttemptN = (BASE_TASK.execution_attempts + 1) + 1;
    await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    // 找到 UPDATE tasks SET execution_attempts=$1 WHERE id=$2
    const updateCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' &&
               call[0].includes('UPDATE tasks SET execution_attempts') &&
               call[1]?.[0] === expectedAttemptN &&
               call[1]?.[1] === BASE_TASK.id
    );
    expect(updateCall).toBeTruthy();
  });

  it('SC-005: 好 checkpoint（channel_values 存在但 error 为 null）→ 走 resume（input = null）', async () => {
    mockCheckpointerGet.mockResolvedValue({
      channel_values: {
        error: null,  // 明确设为 null，不应触发 fresh start
        task: BASE_TASK,
      },
    });

    await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    expect(capturedStreamInput).toBeNull();
  });

  it('SC-005b: 好 checkpoint（channel_values 存在但 error 为 undefined）→ 走 resume（input = null）', async () => {
    mockCheckpointerGet.mockResolvedValue({
      channel_values: {
        task: BASE_TASK,
        // error 字段不存在（undefined）
      },
    });

    await runHarnessInitiativeRouter(BASE_TASK, { pool: { query: mockQuery } });

    expect(capturedStreamInput).toBeNull();
  });
});
