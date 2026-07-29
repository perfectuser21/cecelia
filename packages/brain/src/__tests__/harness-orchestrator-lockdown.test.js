/**
 * Regression test — harness_initiative 点火路径隔离（硬校验）
 *
 * 背景：2026-07-04 主理人拍板全面转向 skill-relay 接力模式。
 * 之前 payload.orchestrator !== 'skill-relay' 时会默认 fallthrough 到
 * LangGraph 图路径（compileHarnessFullGraph），30 天基线成功率仅 21.7%，
 * 且这个降级是隐式的——忘记带 flag 不会报错，只会悄悄跑更差的路径。
 *
 * 修复：_driveHarnessInitiative 顶部加硬校验。
 * - payload.orchestrator !== 'skill-relay' → 立即 markInitiativeTerminalFailed
 *   (failure_class='missing_orchestrator_flag')，返回
 *   { ok:false, error:'missing_orchestrator_flag', terminal:true }，
 *   不 import/调用 compileHarnessFullGraph。
 * - payload.orchestrator === 'skill-relay' → 行为不变，走 spawnSkillRelaySession。
 *
 * SC-201: orchestrator 缺失 → 拒绝，不 invoke LangGraph 图，task 标 failed
 * SC-202: orchestrator='langgraph'（非法值）→ 同样拒绝
 * SC-203: orchestrator='skill-relay' → 正常调用 spawnSkillRelaySession，行为不变
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 所有 executor.js 的外部依赖（与 harness-max-fresh-starts.test.js 完全一致）──

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

// ── LangGraph 图早已不再被 executor.js 动态 import（刀4阶段3删码前，Task 3 已把
//    executor.js 里那段动态 import harness-initiative.graph.js 的不可达代码块整个删掉）。
//    这里不再 vi.mock 该模块——mock 一个已经没人 import 的模块没有意义。
//    mockCompileHarnessFullGraph 仅保留为断言锚点：下面 SC-201/202/203 用它验证
//    "图路径完全没被触达"，作为 executor.js 不再依赖图逻辑的回归哨兵。
const mockCompileHarnessFullGraph = vi.fn();

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

// mock spawnSkillRelaySession（skill-relay 分支依赖，验证 SC-203 时需要它被调用）
const mockSpawnSkillRelaySession = vi.fn().mockResolvedValue({ ok: true, relay: true });
// deriveGear 用真实语义的轻量重实现（不 mock 掉，executor 侧硬校验测试需要它真的抛错）——
// 与 harness-skill-relay.js 里的实现保持同步（该文件自身有独立的 deriveGear 单测覆盖真实实现）。
const GEAR_VALUES_FOR_TEST = ['default', 'hotfix', 'segmented'];
function fakeDeriveGear(task) {
  const g = task?.payload?.gear;
  if (g === undefined || g === null) return 'default';
  if (GEAR_VALUES_FOR_TEST.includes(g)) return g;
  throw new Error(`invalid_gear: ${g}`);
}
vi.mock('../harness-skill-relay.js', () => ({
  spawnSkillRelaySession: (...args) => mockSpawnSkillRelaySession(...args),
  deriveGear: (...args) => fakeDeriveGear(...args),
}));

// ── 被测函数 ──────────────────────────────────────────────────

let runHarnessInitiativeRouter;

beforeEach(async () => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  mockSpawnSkillRelaySession.mockResolvedValue({ ok: true, relay: true });
  vi.resetModules();
  const mod = await import('../executor.js');
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
});

function makeTask(orchestrator) {
  return {
    id: 'task-orch-lockdown-1',
    task_type: 'harness_initiative',
    title: 'harness init orchestrator lockdown test',
    payload: {
      initiative_id: 'init-orch-lockdown-001',
      ...(orchestrator !== undefined ? { orchestrator } : {}),
    },
    status: 'in_progress',
    retry_count: 0,
    execution_attempts: 0,
  };
}

describe('_driveHarnessInitiative — orchestrator 硬校验', () => {

  it('SC-201: orchestrator 缺失 → 拒绝，不 invoke LangGraph 图，task 标 failed', async () => {
    const task = makeTask(undefined);

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_orchestrator_flag');

    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id) &&
        call[1].some((p) => String(p).includes('missing_orchestrator_flag'))
    );
    expect(failCall).toBeTruthy();
  });

  it('SC-202: orchestrator 为非法值（如遗留的 "langgraph"）→ 同样拒绝', async () => {
    const task = makeTask('langgraph');

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_orchestrator_flag');
  });

  it('SC-203: orchestrator="skill-relay" → 正常调用 spawnSkillRelaySession，行为不变', async () => {
    const task = makeTask('skill-relay');

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnSkillRelaySession).toHaveBeenCalledTimes(1);
    expect(mockCompileHarnessFullGraph).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, relay: true });
  });
});

// ─── gear 档位硬校验（harness gear 一体化设计决策1：非法值点火即 terminal failed，
//     同 missing_orchestrator_flag 处理形态）────────────────────────────────
describe('_driveHarnessInitiative — gear 硬校验', () => {
  function makeGearTask(gear) {
    return {
      id: 'task-gear-lockdown-1',
      task_type: 'harness_initiative',
      title: 'harness init gear lockdown test',
      payload: {
        initiative_id: 'init-gear-lockdown-001',
        orchestrator: 'skill-relay',
        ...(gear !== undefined ? { gear } : {}),
      },
      status: 'in_progress',
      retry_count: 0,
      execution_attempts: 0,
    };
  }

  it('SC-204: payload.gear 非法值 → 拒绝，不 spawn relay session，task 标 failed reason=invalid_gear', async () => {
    const task = makeGearTask('turbo');

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnSkillRelaySession).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('invalid_gear');

    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id) &&
        call[1].some((p) => String(p).includes('invalid_gear'))
    );
    expect(failCall).toBeTruthy();
  });

  it('SC-205: payload.gear 缺省/合法值 → 正常调用 spawnSkillRelaySession（回归：零影响）', async () => {
    for (const gear of [undefined, 'default', 'hotfix', 'segmented']) {
      mockSpawnSkillRelaySession.mockClear();
      const task = makeGearTask(gear);
      const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });
      expect(mockSpawnSkillRelaySession, `gear=${gear}`).toHaveBeenCalledTimes(1);
      expect(result, `gear=${gear}`).toEqual({ ok: true, relay: true });
    }
  });
});

// ─── gp_anchor 硬校验（GP锚定闭环刀4 — 仅当 base_repo 含 zenithjoy-workspace 时生效，
//     不误伤 cecelia 自己或 zenithjoy-skills 等其他项目的 harness_initiative 任务）──
describe('_driveHarnessInitiative — gp_anchor 硬校验（base_repo 限定范围）', () => {
  function makeAnchorTask({ baseRepo, gpAnchor } = {}) {
    return {
      id: 'task-gp-anchor-lockdown-1',
      task_type: 'harness_initiative',
      title: 'harness init gp_anchor lockdown test',
      payload: {
        initiative_id: 'init-gp-anchor-lockdown-001',
        orchestrator: 'skill-relay',
        ...(baseRepo !== undefined ? { base_repo: baseRepo } : {}),
        ...(gpAnchor !== undefined ? { gp_anchor: gpAnchor } : {}),
      },
      status: 'in_progress',
      retry_count: 0,
      execution_attempts: 0,
    };
  }

  it('SC-206: base_repo 含 zenithjoy-workspace 且 gp_anchor 缺失 → 拒绝，标 failed reason=missing_gp_anchor', async () => {
    const task = makeAnchorTask({ baseRepo: 'https://github.com/perfectuser21/zenithjoy-workspace.git' });

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnSkillRelaySession).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_gp_anchor');

    const failCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        /UPDATE tasks SET[\s\S]*status\s*=\s*'failed'/.test(call[0]) &&
        Array.isArray(call[1]) &&
        call[1].includes(task.id) &&
        call[1].some((p) => String(p).includes('missing_gp_anchor'))
    );
    expect(failCall).toBeTruthy();
  });

  it('SC-207: base_repo 含 zenithjoy-workspace 且 gp_anchor 格式不合法 → 拒绝', async () => {
    const task = makeAnchorTask({
      baseRepo: 'https://github.com/perfectuser21/zenithjoy-workspace.git',
      gpAnchor: '这不是合法格式',
    });

    const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });

    expect(mockSpawnSkillRelaySession).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.error).toBe('missing_gp_anchor');
  });

  it('SC-208: base_repo 含 zenithjoy-workspace 且 gp_anchor 合法（三形态各一例）→ 正常调用 spawnSkillRelaySession', async () => {
    const validAnchors = [
      'line02/customer_smart_acquisition#step7',
      'line01/customer_first_success keep-green',
      'none(infra)',
      'none(docs)',
    ];
    for (const gpAnchor of validAnchors) {
      mockSpawnSkillRelaySession.mockClear();
      const task = makeAnchorTask({ baseRepo: 'https://github.com/perfectuser21/zenithjoy-workspace.git', gpAnchor });
      const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });
      expect(mockSpawnSkillRelaySession, `gp_anchor=${gpAnchor}`).toHaveBeenCalledTimes(1);
      expect(result, `gp_anchor=${gpAnchor}`).toEqual({ ok: true, relay: true });
    }
  });

  it('SC-209: base_repo 不含 zenithjoy-workspace（如 cecelia 自己）且 gp_anchor 缺失 → 不受影响（零回归）', async () => {
    const cases = [
      { baseRepo: 'https://github.com/perfectuser21/cecelia.git' },
      { baseRepo: '/Users/administrator/perfect21/cecelia' },
      { baseRepo: undefined }, // base_repo 完全缺失也视为不匹配，宽松默认不误杀
    ];
    for (const c of cases) {
      mockSpawnSkillRelaySession.mockClear();
      const task = makeAnchorTask(c);
      const result = await runHarnessInitiativeRouter(task, { pool: { query: mockQuery } });
      expect(mockSpawnSkillRelaySession, JSON.stringify(c)).toHaveBeenCalledTimes(1);
      expect(result, JSON.stringify(c)).toEqual({ ok: true, relay: true });
    }
  });
});
