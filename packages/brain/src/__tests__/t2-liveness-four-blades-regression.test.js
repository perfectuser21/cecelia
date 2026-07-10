/**
 * T2 Liveness Contract — 四刀守护模块回归测试
 *
 * 07-10 事故参数回归：headed-session 任务活跃时四刀均不杀
 * 单元用例：各执行者 dead 判断下的正确 action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────
// Mock: executor-contracts.js（在 __tests__ 目录，相对路径 '../'）
// ──────────────────────────────────────────────────────────────
vi.mock('../executor-contracts.js', () => ({
  assessTaskLiveness: vi.fn(),
}));

// ──────────────────────────────────────────────────────────────
// Mock: db.js
// ──────────────────────────────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// ──────────────────────────────────────────────────────────────
// Mock: executor.js（tick-helpers 依赖）
// ──────────────────────────────────────────────────────────────
vi.mock('../executor.js', () => ({
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ metrics: { max_pressure: 0.3 } }),
  probeTaskLiveness: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  getBillingPause: vi.fn().mockReturnValue(null),
}));

// ──────────────────────────────────────────────────────────────
// Mock: quarantine.js
// ──────────────────────────────────────────────────────────────
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({
    quarantined: false,
    failure_count: 1,
    result: { reason: 'retry' },
  }),
}));

// ──────────────────────────────────────────────────────────────
// Mock: event-bus.js
// ──────────────────────────────────────────────────────────────
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────────────────────
// Mock: alertness/index.js
// ──────────────────────────────────────────────────────────────
vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  ALERTNESS_LEVELS: { CALM: 0, AWARE: 1, ALERT: 2, PANIC: 4 },
}));

// ──────────────────────────────────────────────────────────────
// Mock: drain.js
// ──────────────────────────────────────────────────────────────
vi.mock('../drain.js', () => ({
  isPostDrainCooldown: vi.fn().mockReturnValue(false),
}));

// ──────────────────────────────────────────────────────────────
// Mock: platform-utils.js（healing.js 依赖）
// ──────────────────────────────────────────────────────────────
vi.mock('../platform-utils.js', () => ({
  processExists: vi.fn().mockReturnValue(false),
}));

// ──────────────────────────────────────────────────────────────
// 源码自省：tick-runner.js dead-reset 区块
// ──────────────────────────────────────────────────────────────
const TICK_RUNNER_PATH = resolve(__dirname, '../tick-runner.js');
const TICK_RUNNER_SRC = readFileSync(TICK_RUNNER_PATH, 'utf8');

function extractDeadTaskResetBlock(src) {
  const startIdx = src.indexOf('6.6. Dead task reset');
  if (startIdx === -1) throw new Error('找不到 "6.6. Dead task reset" 注释');
  const endIdx = src.indexOf('// 7. Dispatch tasks', startIdx);
  if (endIdx === -1) throw new Error('找不到 "// 7. Dispatch tasks" 结束标记');
  return src.slice(startIdx, endIdx);
}

// ══════════════════════════════════════════════════════════════
// 回归用例（07-10 事故参数：四刀均不杀活跃任务）
// ══════════════════════════════════════════════════════════════

describe('T2 Liveness 回归 — 07-10 事故：四刀均不杀 alive 任务', () => {

  // ──── 刀①: zombie-reaper 回归 ────────────────────────────────
  describe('刀① zombie-reaper: assessTaskLiveness=alive 时跳过不杀', () => {
    let reapZombies;
    let mockPool;
    let assessTaskLiveness;

    beforeEach(async () => {
      vi.resetModules();

      // 重新 mock
      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({
          verdict: 'alive',
          onStale: 'release-claim-and-alert',
        }),
      }));

      mockPool = {
        query: vi.fn(),
      };

      // SELECT 返回一个 headed-session 任务
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'task-alive-01',
          title: 'headed session active',
          task_type: 'dev',
          executor_kind: 'headed-session',
          updated_at: new Date(Date.now() - 63 * 60 * 1000).toISOString(),
          last_attempt_at: null,
          claimed_by: 'session:my-tmux',
        }],
      });

      const contracts = await import('../executor-contracts.js');
      assessTaskLiveness = contracts.assessTaskLiveness;

      const mod = await import('../zombie-reaper.js');
      reapZombies = mod.reapZombies;
    });

    it('verdict=alive 时：不调用 UPDATE tasks SET status=failed 也不调用 status=queued', async () => {
      await reapZombies({ pool: mockPool, idleMinutes: 60, ctx: {} });

      // SELECT 调用一次
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      // 没有第二次 UPDATE 调用
      const calls = mockPool.query.mock.calls;
      const updateCalls = calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE tasks')
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ──── 刀②: tick-helpers 回归 ─────────────────────────────────
  describe('刀② tick-helpers: executor_kind=headed-session + assessTaskLiveness=alive 时不 kill', () => {
    let autoFailTimedOutTasks;
    let killProcess;
    let assessTaskLiveness;

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({ verdict: 'alive' }),
      }));

      vi.doMock('../executor.js', () => ({
        killProcess: vi.fn(),
        checkServerResources: vi.fn().mockReturnValue({ metrics: { max_pressure: 0.3 } }),
        probeTaskLiveness: vi.fn(),
        killProcessTwoStage: vi.fn(),
        requeueTask: vi.fn(),
        getBillingPause: vi.fn().mockReturnValue(null),
      }));

      vi.doMock('../quarantine.js', () => ({
        handleTaskFailure: vi.fn().mockResolvedValue({
          quarantined: false,
          failure_count: 1,
          result: { reason: 'retry' },
        }),
      }));

      vi.doMock('../event-bus.js', () => ({
        emit: vi.fn().mockResolvedValue(undefined),
      }));

      vi.doMock('../db.js', () => ({
        default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      }));

      vi.doMock('../alertness/index.js', () => ({
        getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
        ALERTNESS_LEVELS: { CALM: 0, AWARE: 1, ALERT: 2, PANIC: 4 },
      }));

      vi.doMock('../drain.js', () => ({
        isPostDrainCooldown: vi.fn().mockReturnValue(false),
      }));

      const mod = await import('../tick-helpers.js');
      autoFailTimedOutTasks = mod.autoFailTimedOutTasks;

      const executorMod = await import('../executor.js');
      killProcess = executorMod.killProcess;

      const contractsMod = await import('../executor-contracts.js');
      assessTaskLiveness = contractsMod.assessTaskLiveness;
    });

    it('headed-session 任务 elapsed>100min + alive → killProcess 未调用，actions 为空', async () => {
      const task = {
        id: 'task-headed-01',
        title: 'headed session task',
        executor_kind: 'headed-session',
        updated_at: new Date(Date.now() - 63 * 60 * 1000).toISOString(),
        last_attempt_at: null,
        claimed_by: 'session:active-tmux',
        payload: {
          run_triggered_at: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
        },
        started_at: null,
      };

      const actions = await autoFailTimedOutTasks([task]);

      expect(killProcess).not.toHaveBeenCalled();
      expect(actions).toHaveLength(0);
    });
  });

  // ──── 刀③: tick-runner SQL 回归 ──────────────────────────────
  describe('刀③ tick-runner.js dead-reset SQL：executor_kind IN 白名单，不再 IS DISTINCT FROM', () => {
    const block = extractDeadTaskResetBlock(TICK_RUNNER_SRC);

    it('dead-reset 区块包含 executor_kind IN (\'brain-local\', \'bridge\')', () => {
      expect(block).toMatch(/executor_kind\s+IN\s+\(\s*'brain-local'\s*,\s*'bridge'\s*\)/);
    });

    it('dead-reset 区块不再包含 IS DISTINCT FROM \'skill-relay\'', () => {
      expect(block).not.toMatch(/IS DISTINCT FROM\s+'skill-relay'/);
    });
  });

  // ──── 刀④: healing 回归 ──────────────────────────────────────
  describe('刀④ healing restartStuckExecutors: assessTaskLiveness=alive 时不 UPDATE', () => {
    let executeAction;
    let mockClientQuery;

    beforeEach(async () => {
      vi.resetModules();

      mockClientQuery = vi.fn();

      // healing.js 中 restartStuckExecutors 用 pool.connect()
      // 我们 mock pool.connect 返回带 query 的 client
      vi.doMock('../db.js', () => ({
        default: {
          query: vi.fn().mockResolvedValue({ rows: [] }),
          connect: vi.fn().mockResolvedValue({
            query: mockClientQuery,
            release: vi.fn(),
          }),
        },
      }));

      vi.doMock('../platform-utils.js', () => ({
        processExists: vi.fn().mockReturnValue(false),
      }));

      vi.doMock('../event-bus.js', () => ({
        emit: vi.fn(),
      }));

      // assessTaskLiveness 返回 alive
      // healing.js 位于 alertness/ 子目录，import '../executor-contracts.js'
      // vitest doMock 路径需相对于测试文件（__tests__/），指向同一个 src/executor-contracts.js
      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({ verdict: 'alive', onStale: 'release-claim-and-alert' }),
      }));

      // SELECT 返回一个 headed-session 任务
      mockClientQuery.mockResolvedValueOnce({
        rows: [{
          id: 'task-heal-01',
          title: 'healing stuck task',
          started_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
          payload: {},
          executor_kind: 'headed-session',
          last_attempt_at: null,
          claimed_by: 'session:alive-session',
          updated_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
        }],
        rowCount: 1,
      });

      const mod = await import('../alertness/healing.js');
      executeAction = mod.executeAction;
    });

    it('verdict=alive 时：restart_stuck_executors 不调用 UPDATE tasks', async () => {
      await executeAction('restart_stuck_executors');

      // 检查 mockClientQuery 调用：只有 SELECT，没有 UPDATE tasks SET status='queued'
      const updateCalls = mockClientQuery.mock.calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE tasks')
      );
      expect(updateCalls).toHaveLength(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// 单元用例
// ══════════════════════════════════════════════════════════════

describe('单元用例', () => {

  // ──── 用例5: zombie-reaper headed-session dead → release-claim ─
  describe('用例5: zombie-reaper — headed-session probe=dead → UPDATE status=queued', () => {
    let reapZombies;
    let mockPool;

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({
          verdict: 'dead',
          onStale: 'release-claim-and-alert',
          kind: 'headed-session',
        }),
      }));

      mockPool = {
        query: vi.fn(),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'task-dead-01',
          title: 'stale headed session',
          task_type: 'dev',
          executor_kind: 'headed-session',
          updated_at: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
          last_attempt_at: null,
          claimed_by: 'session:dead-tmux',
        }],
      });

      // UPDATE 成功
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const mod = await import('../zombie-reaper.js');
      reapZombies = mod.reapZombies;
    });

    it('dead + release-claim-and-alert → UPDATE status=queued 且不是 failed', async () => {
      await reapZombies({ pool: mockPool, idleMinutes: 60, ctx: {} });

      const updateCalls = mockPool.query.mock.calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE tasks')
      );
      expect(updateCalls).toHaveLength(1);
      const [sql] = updateCalls[0];
      expect(sql).toMatch(/status\s*=\s*'queued'/);
      expect(sql).not.toMatch(/status\s*=\s*'failed'/);
      // 还应清空 claimed_by
      expect(sql).toMatch(/claimed_by\s*=\s*NULL/);
    });
  });

  // ──── 用例6: tick-helpers brain-local dead → killProcess 调用 ──
  describe('用例6: tick-helpers — executor_kind=brain-local probe=dead elapsed>100min → killProcess 调用', () => {
    let autoFailTimedOutTasks;
    let killProcess;

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({
          verdict: 'dead',
          onStale: 'fail',
          kind: 'brain-local',
        }),
      }));

      vi.doMock('../executor.js', () => ({
        killProcess: vi.fn(),
        checkServerResources: vi.fn().mockReturnValue({ metrics: { max_pressure: 0.3 } }),
        probeTaskLiveness: vi.fn(),
        killProcessTwoStage: vi.fn(),
        requeueTask: vi.fn(),
        getBillingPause: vi.fn().mockReturnValue(null),
      }));

      vi.doMock('../quarantine.js', () => ({
        handleTaskFailure: vi.fn().mockResolvedValue({
          quarantined: false,
          failure_count: 1,
          result: { reason: 'retry' },
        }),
      }));

      vi.doMock('../event-bus.js', () => ({
        emit: vi.fn().mockResolvedValue(undefined),
      }));

      vi.doMock('../db.js', () => ({
        default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      }));

      vi.doMock('../alertness/index.js', () => ({
        getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
        ALERTNESS_LEVELS: { CALM: 0, AWARE: 1, ALERT: 2, PANIC: 4 },
      }));

      vi.doMock('../drain.js', () => ({
        isPostDrainCooldown: vi.fn().mockReturnValue(false),
      }));

      const mod = await import('../tick-helpers.js');
      autoFailTimedOutTasks = mod.autoFailTimedOutTasks;

      const executorMod = await import('../executor.js');
      killProcess = executorMod.killProcess;
    });

    it('brain-local dead → killProcess 被调用', async () => {
      const task = {
        id: 'task-local-01',
        title: 'brain-local timed out',
        executor_kind: 'brain-local',
        updated_at: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
        last_attempt_at: null,
        claimed_by: null,
        payload: {
          run_triggered_at: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
        },
        started_at: null,
      };

      await autoFailTimedOutTasks([task]);

      expect(killProcess).toHaveBeenCalledWith('task-local-01');
    });
  });

  // ──── 用例7: healing external-worker alive → 不重置 ──────────
  describe('用例7: healing — executor_kind=external-worker probe=alive → 不重置', () => {
    let executeAction;
    let mockClientQuery;

    beforeEach(async () => {
      vi.resetModules();

      mockClientQuery = vi.fn();

      vi.doMock('../db.js', () => ({
        default: {
          query: vi.fn().mockResolvedValue({ rows: [] }),
          connect: vi.fn().mockResolvedValue({
            query: mockClientQuery,
            release: vi.fn(),
          }),
        },
      }));

      vi.doMock('../platform-utils.js', () => ({
        processExists: vi.fn().mockReturnValue(false),
      }));

      vi.doMock('../event-bus.js', () => ({
        emit: vi.fn(),
      }));

      vi.doMock('../executor-contracts.js', () => ({
        assessTaskLiveness: vi.fn().mockResolvedValue({ verdict: 'alive', onStale: 'never' }),
      }));

      mockClientQuery.mockResolvedValueOnce({
        rows: [{
          id: 'task-ext-01',
          title: 'external worker task',
          started_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
          payload: {},
          executor_kind: 'external-worker',
          last_attempt_at: null,
          claimed_by: null,
          updated_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
        }],
        rowCount: 1,
      });

      const mod = await import('../alertness/healing.js');
      executeAction = mod.executeAction;
    });

    it('external-worker alive → 不调用 UPDATE tasks', async () => {
      await executeAction('restart_stuck_executors');

      const updateCalls = mockClientQuery.mock.calls.filter(([sql]) =>
        typeof sql === 'string' && sql.includes('UPDATE tasks')
      );
      expect(updateCalls).toHaveLength(0);
    });
  });
});
