/**
 * Consciousness Tick Runtime Integration Test
 *
 * 断言 executeTick 会根据 consciousness guard 的状态跳过或触发意识模块。
 * 用 vi.mock 真实 mock 意识模块（方便断言调用次数），其余重依赖 noop 防副作用。
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

const cleanupMocks = vi.hoisted(() => ({
  zombieSweep: vi.fn().mockResolvedValue({
    started_at: '2026-07-27T00:00:00.000Z',
    completed_at: '2026-07-27T00:00:00.000Z',
    worktrees: { checked: 0, removed: 0, skipped: 0, errors: [] },
    processes: { checked: 0, killed: 0, errors: [] },
    lock_slots: { checked: 0, removed: 0, errors: [] },
  }),
  cleanupWorkerTick: vi.fn().mockResolvedValue({
    success: true,
    stdout: '',
    stderr: '',
  }),
  runZombieCleanup: vi.fn().mockResolvedValue({
    slotsReclaimed: 0,
    worktreesRemoved: 0,
    timestamp: '2026-07-27T00:00:00.000Z',
    errors: [],
  }),
  cleanupStaleHarnessWorktrees: vi.fn().mockResolvedValue({
    cleaned: 0,
    errors: 0,
  }),
}));

// executeTick owns destructive host cleanup edges. This integration test exercises
// consciousness wiring only, so every cleanup boundary must remain an explicit noop.
vi.mock('../../zombie-sweep.js', () => ({
  zombieSweep: cleanupMocks.zombieSweep,
}));
vi.mock('../../cleanup-worker-plugin.js', () => ({
  tick: cleanupMocks.cleanupWorkerTick,
}));
vi.mock('../../zombie-cleaner.js', () => ({
  runZombieCleanup: cleanupMocks.runZombieCleanup,
}));
vi.mock('../../harness-worktree.js', () => ({
  cleanupStaleHarnessWorktrees: cleanupMocks.cleanupStaleHarnessWorktrees,
}));

// ========== 意识模块 mocks（要断言调用次数）==========
vi.mock('../../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({ accumulator: 0 }) }));
vi.mock('../../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../suggestion-cycle.js', () => ({ runSuggestionCycle: vi.fn().mockResolvedValue({}) }));
vi.mock('../../conversation-consolidator.js', () => ({ runConversationConsolidator: vi.fn().mockResolvedValue({}) }));
vi.mock('../../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../self-report-collector.js', () => ({ collectSelfReport: vi.fn().mockResolvedValue({}) }));
vi.mock('../../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
  synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue({}) }));
vi.mock('../../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue({ triggered: 0, skipped: 0, results: [] }) }));

// ========== 其它重依赖 mocks（noop 防副作用）==========
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: false, reason: 'test-skip' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockResolvedValue(0),
  getActiveProcesses: vi.fn().mockReturnValue([]),
  removeActiveProcess: vi.fn(),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({
    ok: true,
    reason: 'test-mock',
    effectiveSlots: 3,
    metrics: { max_pressure: 0, cpu_pressure: 0, mem_pressure: 0 },
  }),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 3,
  INTERACTIVE_RESERVE: 1,
  PHYSICAL_CAPACITY: 3,
  getEffectiveMaxSeats: vi.fn().mockReturnValue(3),
  getBudgetCap: vi.fn().mockReturnValue({ cap: 3, physical: 3, budget: 3, effective: 3, reason: 'mock' }),
  getTokenPressure: vi.fn().mockResolvedValue({ token_pressure: 0, available_accounts: 3, details: 'mock' }),
  getTotalCapacity: vi.fn().mockReturnValue(3),
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({}),
  generateDecision: vi.fn().mockResolvedValue({ action: 'noop' }),
  executeDecision: vi.fn().mockResolvedValue({}),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ decisions: [] }),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: 'mock' }),
}));
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue({}),
  expireStaleProposals: vi.fn(),
}));

// 真实 import
import { executeTick } from '../../tick.js';
import {
  initConsciousnessGuard,
  setConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';
import { runRumination } from '../../rumination.js';
import { generateDailyDiaryIfNeeded } from '../../diary-scheduler.js';
import { runDesireSystem } from '../../desire/index.js';
import { resetTickStateForTests } from '../../tick-state.js';
// scanEvolutionIfNeeded 不在此列：已移出 consciousness 守护（纯 GitHub API 调用，不消耗 LLM），
// consciousness=false 时仍正常运行，不应断言它被跳过。

const CONSCIOUSNESS_MOCKS = [runRumination, generateDailyDiaryIfNeeded, runDesireSystem];
const CLEANUP_MOCKS = Object.values(cleanupMocks);

describe('consciousness tick runtime (real executeTick + mocked deps)', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    resetTickStateForTests();
    CONSCIOUSNESS_MOCKS.forEach((m) => m.mockClear());
    CLEANUP_MOCKS.forEach((m) => m.mockClear());
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  test('memory=false: executeTick skips all consciousness modules', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);
    await executeTick();
    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  }, 60000);

  test('env override beats memory: env=false + memory=true → modules skipped', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    await executeTick();
    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  }, 60000);

  test('executeTick keeps every host cleanup boundary mocked', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);

    await executeTick();

    for (const cleanupMock of CLEANUP_MOCKS) {
      expect(vi.isMockFunction(cleanupMock)).toBe(true);
      expect(cleanupMock).toHaveBeenCalledTimes(1);
    }
    expect(await cleanupMocks.zombieSweep.mock.results[0].value).toMatchObject({
      worktrees: { removed: 0 },
      processes: { killed: 0 },
      lock_slots: { removed: 0 },
    });
    expect(await cleanupMocks.runZombieCleanup.mock.results[0].value).toMatchObject({
      slotsReclaimed: 0,
      worktreesRemoved: 0,
    });
    expect(
      await cleanupMocks.cleanupStaleHarnessWorktrees.mock.results[0].value,
    ).toEqual({ cleaned: 0, errors: 0 });
  }, 60000);

  test('env override can force-enable: env=true + memory=false → guard returns true', async () => {
    // tick 正路径在完整 mock 环境下仍可能 timeout（内部有很多真实 DB 查询未 mock）；
    // 因此这条用 guard 直查替代，断言 env 强启逻辑。三条合起来覆盖：memory / env-kill / env-force。
    const { isConsciousnessEnabled } = await import('../../consciousness-guard.js');
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);
    expect(isConsciousnessEnabled()).toBe(false);
    process.env.CONSCIOUSNESS_ENABLED = 'true';
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
