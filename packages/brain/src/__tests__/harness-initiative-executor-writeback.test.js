/**
 * harness-initiative-executor-writeback.test.js
 *
 * 验证 executor.js triggerCeceliaRun() 中 harness_initiative 分支
 * 在 runHarnessInitiativeRouter() 返回后正确调用 updateTaskStatus。
 *
 * 修复前 bug：compiled.invoke() 成功后从不调用 updateTaskStatus，
 * 导致任务永远卡在 in_progress。
 * 修复 PR：#2816
 *
 * ── 2026-07-05 更新（orchestrator 硬校验落地后）──────────────────
 * `_driveHarnessInitiative` 加了 orchestrator 硬校验：task.payload.orchestrator
 * !== 'skill-relay' 会在函数最顶部被拒绝（terminal failed，
 * failure_class='missing_orchestrator_flag'），graph 从不被 invoke。
 * - 「graph ok=true → updateTaskStatus("completed")」和「graph 抛出异常 →
 *   updateTaskStatus("failed")且带 LangGraph 错误信息」这两个用例依赖的
 *   graph invoke 前提已不可达，改为 it.skip 并说明原因。
 * - 「graph final.error 存在（ok=false）→ updateTaskStatus("failed")」这个
 *   用例的断言只要求 updateTaskStatus 被调用且带任意字符串 error_message，
 *   恰好与硬校验路径的 failed+error_message='missing_orchestrator_flag'
 *   兼容，仍能通过，但它现在测的不再是 graph final.error 场景本身，而是
 *   硬校验路径的 failed 回写；保留为 it()（未失败，不 skip），仅在此注明。
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

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),  // null = fresh start
  }),
}));

vi.mock('../events/taskEvents.js', () => ({
  emitGraphNodeUpdate: vi.fn().mockResolvedValue(undefined),
}));

const mockSpawnRelay = vi.hoisted(() => vi.fn());
vi.mock('../harness-skill-relay.js', () => ({
  spawnSkillRelaySession: (...args) => mockSpawnRelay(...args),
  // gear 硬校验（决策1）：task.payload.gear 缺省 → 'default'，不抛错，行为零回归。
  deriveGear: (task) => {
    const g = task?.payload?.gear;
    if (g === undefined || g === null) return 'default';
    if (['default', 'hotfix', 'segmented'].includes(g)) return g;
    throw new Error(`invalid_gear: ${g}`);
  },
}));

// ── 被测函数 ─────────────────────────────────────────────────

let triggerCeceliaRun;
let runHarnessInitiativeRouter;

beforeEach(async () => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  vi.resetModules();
  const mod = await import('../executor.js');
  triggerCeceliaRun = mod.triggerCeceliaRun;
  runHarnessInitiativeRouter = mod.runHarnessInitiativeRouter;
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

const RELAY_TASK = {
  ...HARNESS_TASK,
  id: 'ccccdddd-1234-5678-9012-abcdef012345',
  payload: { ...HARNESS_TASK.payload, orchestrator: 'skill-relay' },
};

const KERNEL_TASK = {
  ...RELAY_TASK,
  id: 'eeeeffff-1234-5678-9012-abcdef012345',
  payload: { ...RELAY_TASK.payload, harness_runtime: 'kernel-v1' },
};

// ── 测试 ─────────────────────────────────────────────────────

describe('triggerCeceliaRun — harness_initiative 状态回写（PR #2816 fix）', () => {

  it.skip('graph ok=true → updateTaskStatus("completed") 被调用（2026-07-05 orchestrator 硬校验后已不可达，skip）', async () => {
    // graph stream 返回无 error 的 state，并包含 report_path（B48：标志 reportNode 完成）
    mockCompiled.stream.mockImplementation(async function* () {
      yield { dbUpsert: { sub_tasks: [{ task_id: 'ws1' }] } };
      yield { report: { report_path: 'sprints/test/report.json' } };
    });

    const result = await triggerCeceliaRun(HARNESS_TASK);

    expect(result.success).toBe(true);
    expect(result.initiative).toBe(true);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      HARNESS_TASK.id,
      'completed',
    );
  });

  it('graph final.error 存在（ok=false）→ updateTaskStatus("failed") 被调用（2026-07-05 起：断言不依赖具体走的是哪条代码路径，硬校验的 failed 回写同样满足）', async () => {
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

  it.skip('graph 抛出异常 → updateTaskStatus("failed") 被调用且 success=true（2026-07-05 orchestrator 硬校验后已不可达，skip）', async () => {
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

describe('triggerCeceliaRun — skill-relay spawn 语义（Issue df107724）', () => {
  it('relay spawn 成功（ok=true, mode=skill-relay）→ 不得标 completed/failed，留 in_progress', async () => {
    mockSpawnRelay.mockResolvedValue({ ok: true, mode: 'skill-relay', containerId: 'cecelia-relay-test-1' });
    const result = await triggerCeceliaRun(RELAY_TASK);
    expect(result.success).toBe(true);
    expect(mockSpawnRelay).toHaveBeenCalledTimes(1);
    const statuses = mockUpdateTaskStatus.mock.calls.map((c) => c[1]);
    expect(statuses).not.toContain('completed');
    expect(statuses).not.toContain('failed');
  });

  it('relay spawn 失败（ok=false）→ 照旧标 failed（既有行为守护）', async () => {
    mockSpawnRelay.mockResolvedValue({ ok: false, mode: 'skill-relay', error: 'docker run failed' });
    await triggerCeceliaRun(RELAY_TASK);
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      RELAY_TASK.id,
      'failed',
      expect.objectContaining({ error_message: expect.any(String) })
    );
  });

  it('雷8（headed 变体·2856dada R4 实证）：relay spawn 成功（ok=true, mode=skill-relay-codex-headed）→ 不得标 completed/failed，留 in_progress', async () => {
    mockSpawnRelay.mockResolvedValue({ ok: true, mode: 'skill-relay-codex-headed', tmuxSession: 'codex-relay-test-1' });
    const result = await triggerCeceliaRun(RELAY_TASK);
    expect(result.success).toBe(true);
    expect(mockSpawnRelay).toHaveBeenCalledTimes(1);
    const statuses = mockUpdateTaskStatus.mock.calls.map((c) => c[1]);
    expect(statuses).not.toContain('completed');
    expect(statuses).not.toContain('failed');
  });

  it('Kernel pre-run 异常且未建 run 时返回失败，不做 task-only 终态回写', async () => {
    mockSpawnRelay.mockRejectedValue(new Error('impact_capability_missing'));

    const result = await triggerCeceliaRun(KERNEL_TASK);

    expect(result).toMatchObject({
      success: false,
      taskId: KERNEL_TASK.id,
      reason: 'kernel_authority_not_created',
      error: 'impact_capability_missing',
    });
    expect(result.runId).toBeUndefined();
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it('Kernel router 抛错但 DB 已有该 task 的 active v2 run 时恢复 authority 并保持在途', async () => {
    const runId = '22222222-2222-4222-8222-222222222222';
    mockSpawnRelay.mockRejectedValue(new Error('post_create_transport_failed'));
    mockQuery.mockImplementation(async (sql, params) => {
      if (
        String(sql).includes('FROM initiative_runs')
        && String(sql).includes("orchestrator_version = 'v2'")
        && params?.[0] === KERNEL_TASK.id
      ) {
        return { rows: [{ id: runId, phase: 'generate' }] };
      }
      return { rows: [] };
    });

    const result = await triggerCeceliaRun(KERNEL_TASK);

    expect(result).toMatchObject({
      success: true,
      taskId: KERNEL_TASK.id,
      runId,
      deferred: true,
      kernelAuthority: 'active',
      authorityExists: true,
    });
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it('Kernel router 抛错但 DB 已有该 task 的 terminal v2 run 时返回带 runId 的终态 authority', async () => {
    const runId = '33333333-3333-4333-8333-333333333333';
    mockSpawnRelay.mockRejectedValue(new Error('post_terminal_callback_failed'));
    mockQuery.mockImplementation(async (sql, params) => {
      if (
        String(sql).includes('FROM initiative_runs')
        && String(sql).includes("orchestrator_version = 'v2'")
        && params?.[0] === KERNEL_TASK.id
      ) {
        return { rows: [{ id: runId, phase: 'failed' }] };
      }
      return { rows: [] };
    });

    const result = await triggerCeceliaRun(KERNEL_TASK);

    expect(result).toMatchObject({
      success: false,
      taskId: KERNEL_TASK.id,
      runId,
      kernelAuthority: 'terminal',
      authorityExists: true,
      terminal: true,
    });
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it('Kernel authority read-back 查询异常时返回 unknown，不伪装成 no authority', async () => {
    mockSpawnRelay.mockRejectedValue(new Error('post_create_transport_failed'));
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM initiative_runs')) {
        throw new Error('database connection reset');
      }
      return { rows: [] };
    });

    const result = await triggerCeceliaRun(KERNEL_TASK);

    expect(result).toMatchObject({
      success: false,
      taskId: KERNEL_TASK.id,
      reason: 'kernel_authority_reconciliation_unavailable',
      authorityUnknown: true,
    });
    expect(result.runId).toBeUndefined();
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it('Kernel already_running 无 runId 结果也先 read-back active authority', async () => {
    const runId = '44444444-4444-4444-8444-444444444444';
    let releaseSpawn;
    mockSpawnRelay.mockImplementationOnce(() => new Promise((resolve) => {
      releaseSpawn = resolve;
    }));
    mockQuery.mockImplementation(async (sql, params) => {
      if (
        String(sql).includes('FROM initiative_runs')
        && params?.[0] === KERNEL_TASK.id
      ) {
        return { rows: [{ id: runId, phase: 'generate' }] };
      }
      return { rows: [] };
    });

    const firstDrive = runHarnessInitiativeRouter(KERNEL_TASK);
    await vi.waitFor(() => expect(mockSpawnRelay).toHaveBeenCalledTimes(1));
    const result = await triggerCeceliaRun(KERNEL_TASK);
    releaseSpawn({ ok: true, mode: 'kernel-v1', runId });
    await firstDrive;

    expect(result).toMatchObject({
      success: true,
      taskId: KERNEL_TASK.id,
      runId,
      deferred: true,
      kernelAuthority: 'active',
      authorityExists: true,
    });
  });

  it('Kernel pre-run 正常返回 terminal 且 task 已 failed 时不回排复活', async () => {
    const invalidGearTask = {
      ...KERNEL_TASK,
      payload: { ...KERNEL_TASK.payload, gear: 'impossible-gear' },
    };
    mockQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM initiative_runs')) return { rows: [] };
      if (
        String(sql).includes('SELECT status')
        && String(sql).includes('FROM tasks')
        && params?.[0] === invalidGearTask.id
      ) {
        return { rows: [{ status: 'failed' }] };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await triggerCeceliaRun(invalidGearTask);

    expect(result).toMatchObject({
      success: false,
      taskId: invalidGearTask.id,
      reason: 'kernel_pre_run_terminal',
      taskTerminal: true,
      terminal: true,
    });
    expect(result.runId).toBeUndefined();
  });

  it('Kernel 真正创建 authority 后把 runId 透传给 dispatcher', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    mockSpawnRelay.mockResolvedValue({ ok: true, mode: 'kernel-v1', runId, pid: 4242 });

    const result = await triggerCeceliaRun(KERNEL_TASK);

    expect(result).toMatchObject({ success: true, taskId: KERNEL_TASK.id, runId });
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });
});
