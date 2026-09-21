/**
 * Failing test（TDD 先行）— executor gear 校验不依赖 harness-skill-relay mock 含 deriveGear
 *
 * 根因：executor.js 原写法 `const { deriveGear } = await import('./harness-skill-relay.js')`
 * 在 mock 只导出 spawnSkillRelaySession 的测试环境下，deriveGear 为 undefined，
 * 调用 undefined() 抛 TypeError → catch 块将任务标 terminal failed（invalid_gear）
 * → relay spawn 永远不被调用 → 合法 gear 任务被错误阻断。
 *
 * 修复方向：改为内联枚举校验，不依赖 import 结果。
 *
 * SC-206: mock 无 deriveGear 时，合法/缺省 gear → relay 仍正常 spawn（不被误阻断）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getInternalTaskHandler: vi.fn(() => null),
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

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

// ── 关键：mock harness-skill-relay 仅暴露 spawnSkillRelaySession，不含 deriveGear ──
// 这模拟了"旧版/简化 mock 环境"，用于验证 executor 的 gear 校验不依赖
// 从该模块 import 的 deriveGear（否则 undefined() 抛 TypeError 误伤合法任务）。
const mockSpawnRelaySession = vi.hoisted(() => vi.fn());
vi.mock('../harness-skill-relay.js', () => ({
  spawnSkillRelaySession: (...args) => mockSpawnRelaySession(...args),
  isSkillRelayTask: vi.fn(() => true),
  controllerSkillFor: vi.fn(() => 'harness-controller'),
  _setActiveCodexRelays: vi.fn(),
  // deriveGear 故意不包含 — 这是 regression 场景的核心
}));

let runHarnessInitiativeRouter;

beforeEach(async () => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  mockSpawnRelaySession.mockResolvedValue({ ok: true, relay: true });
  vi.resetModules();
  const mod = await import('../executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
});

describe('executor gear 校验 — 不依赖 mock 含 deriveGear（SC-206 regression）', () => {
  it('SC-206: mock 无 deriveGear，gear 缺省 → relay 仍正常 spawn（不被 TypeError 误阻断）', async () => {
    const task = {
      id: 'task-gear-inline-enum-1',
      task_type: 'harness_initiative',
      title: 'gear inline enum regression test',
      payload: {
        initiative_id: 'init-gear-inline-001',
        orchestrator: 'skill-relay',
        // gear 缺省 → 应视为合法（default），不应因 deriveGear undefined 而被阻断
      },
      status: 'in_progress',
      retry_count: 0,
      execution_attempts: 0,
    };

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    // 旧代码：deriveGear=undefined → TypeError → catch → terminal failed → relay 未调用
    // 新代码：内联枚举校验通过 → relay 正常调用
    expect(mockSpawnRelaySession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, relay: true });
  });

  it('SC-207: mock 无 deriveGear，gear="hotfix" → relay 仍正常 spawn', async () => {
    const task = {
      id: 'task-gear-inline-enum-2',
      task_type: 'harness_initiative',
      title: 'gear inline enum hotfix test',
      payload: {
        initiative_id: 'init-gear-inline-002',
        orchestrator: 'skill-relay',
        gear: 'hotfix',
      },
      status: 'in_progress',
      retry_count: 0,
      execution_attempts: 0,
    };

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnRelaySession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, relay: true });
  });
});
