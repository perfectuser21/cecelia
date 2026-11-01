/**
 * Tests for alertness/healing.js
 * 自愈策略 - 恢复流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted 确保在 mock factory 中可用
const mockConnect = vi.hoisted(() => vi.fn());
const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockEmit = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({
  default: {
    connect: mockConnect,
    query: mockPoolQuery
  }
}));

vi.mock('../../event-bus.js', () => ({
  emit: mockEmit
}));

vi.mock('child_process', () => ({
  exec: mockExec
}));

vi.mock('util', () => ({
  promisify: (fn) => {
    // promisify(exec) 返回 mockExec 的包装
    return (...args) => new Promise((resolve, reject) => {
      fn(args[0], (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  }
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const { preserveFleetConfigFs } = await import('../helpers/fleet-config-fs-fixture.js');
  return preserveFleetConfigFs(actual, {
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync
});
});

let applySelfHealing;
let getRecoveryStatus;
let startRecovery;

describe('alertness/healing', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockRelease.mockImplementation(() => {});
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockConnect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: mockRelease
    });
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    vi.resetModules();

    vi.mock('../../db.js', () => ({
      default: {
        connect: mockConnect,
        query: mockPoolQuery
      }
    }));
    vi.mock('../../event-bus.js', () => ({
      emit: mockEmit
    }));
    vi.mock('child_process', () => ({
      exec: mockExec
    }));
    vi.mock('util', () => ({
      promisify: (fn) => (...args) => new Promise((resolve, reject) => {
        fn(args[0], (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      })
    }));
    vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const { preserveFleetConfigFs } = await import('../helpers/fleet-config-fs-fixture.js');
  return preserveFleetConfigFs(actual, {
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      existsSync: mockExistsSync
    });
});

    const mod = await import('../../alertness/healing.js');
    applySelfHealing = mod.applySelfHealing;
    getRecoveryStatus = mod.getRecoveryStatus;
    startRecovery = mod.startRecovery;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
  });

  // ============================================================
  // getRecoveryStatus
  // ============================================================

  describe('getRecoveryStatus', () => {
    it('初始状态 isRecovering 为 false', () => {
      const status = getRecoveryStatus();
      expect(status.isRecovering).toBe(false);
    });

    it('初始阶段为 0（IDLE）', () => {
      const status = getRecoveryStatus();
      expect(status.phase).toBe(0);
      expect(status.phaseName).toBe('IDLE');
    });

    it('返回结构包含所有字段', () => {
      const status = getRecoveryStatus();
      expect(status).toHaveProperty('isRecovering');
      expect(status).toHaveProperty('phase');
      expect(status).toHaveProperty('phaseName');
      expect(status).toHaveProperty('capacity');
      expect(status).toHaveProperty('duration');
      expect(status).toHaveProperty('strategiesApplied');
      expect(status).toHaveProperty('actionsExecuted');
    });

    it('初始 duration 为 0', () => {
      const status = getRecoveryStatus();
      expect(status.duration).toBe(0);
    });
  });

  // ============================================================
  // startRecovery / applySelfHealing
  // ============================================================

  describe('startRecovery', () => {
    it('无适用策略时直接返回（不进入恢复状态）', async () => {
      await startRecovery(['unknown_issue']);
      const status = getRecoveryStatus();
      expect(status.isRecovering).toBe(false);
    });

    it('有适用策略时进入恢复状态（phase 1 观察期）', async () => {
      await startRecovery(['high_memory']);
      const status = getRecoveryStatus();
      // 恢复已开始，phase=1
      expect(status.phase).toBe(1);
      expect(status.phaseName).toBe('OBSERVATION');
    });

    it('触发 healing:started 事件', async () => {
      await startRecovery(['queue_overflow']);
      expect(mockEmit).toHaveBeenCalledWith(
        'healing:started',
        expect.objectContaining({ issues: ['queue_overflow'] })
      );
    });

    it('已在恢复时重复调用直接返回', async () => {
      await startRecovery(['high_memory']);
      const emitCallCount = mockEmit.mock.calls.length;
      // 再次调用，已在恢复中
      await startRecovery(['high_memory']);
      // emit 不应再次被调用（跳过了）
      expect(mockEmit.mock.calls.length).toBe(emitCallCount);
    });

    it('DB 错误时被捕获，恢复仍能开始', async () => {
      mockConnect.mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error('DB error')),
        release: mockRelease
      });
      // 不应抛出
      await expect(startRecovery(['high_memory'])).resolves.not.toThrow();
    });
  });

  // ============================================================
  // applySelfHealing
  // ============================================================

  describe('applySelfHealing', () => {
    it('调用与 startRecovery 相同的逻辑', async () => {
      // applySelfHealing 是 startRecovery 的别名
      await applySelfHealing(['zombie_processes']);
      const status = getRecoveryStatus();
      expect(status.phase).toBe(1);
    });

    it('空 issues 数组时不开始恢复', async () => {
      await applySelfHealing([]);
      const status = getRecoveryStatus();
      expect(status.isRecovering).toBe(false);
    });
  });

  // ============================================================
  // HEALING_STRATEGIES 常量
  // ============================================================

  describe('HEALING_STRATEGIES', () => {
    it('包含所有预定义策略', async () => {
      const mod = await import('../../alertness/healing.js');
      const { HEALING_STRATEGIES } = mod.default;
      expect(HEALING_STRATEGIES).toHaveProperty('memory_cleanup');
      expect(HEALING_STRATEGIES).toHaveProperty('process_recovery');
      expect(HEALING_STRATEGIES).toHaveProperty('queue_drainage');
      expect(HEALING_STRATEGIES).toHaveProperty('error_mitigation');
    });

    it('每个策略包含必要字段', async () => {
      const mod = await import('../../alertness/healing.js');
      const { HEALING_STRATEGIES } = mod.default;
      for (const [key, strategy] of Object.entries(HEALING_STRATEGIES)) {
        expect(strategy).toHaveProperty('name');
        expect(strategy).toHaveProperty('condition');
        expect(strategy).toHaveProperty('priority');
        expect(strategy).toHaveProperty('actions');
        expect(Array.isArray(strategy.actions)).toBe(true);
      }
    });

    it('策略按优先级排序（priority 值递增）', async () => {
      const mod = await import('../../alertness/healing.js');
      const { HEALING_STRATEGIES } = mod.default;
      const priorities = Object.values(HEALING_STRATEGIES).map(s => s.priority);
      const sorted = [...priorities].sort((a, b) => a - b);
      expect(priorities).toEqual(sorted);
    });
  });

  // ============================================================
  // RECOVERY_PHASES 常量
  // ============================================================

  describe('RECOVERY_PHASES', () => {
    it('包含所有阶段定义 0-4', async () => {
      const mod = await import('../../alertness/healing.js');
      const { RECOVERY_PHASES } = mod.default;
      expect(RECOVERY_PHASES).toHaveProperty('0');
      expect(RECOVERY_PHASES).toHaveProperty('1');
      expect(RECOVERY_PHASES).toHaveProperty('2');
      expect(RECOVERY_PHASES).toHaveProperty('3');
      expect(RECOVERY_PHASES).toHaveProperty('4');
    });

    it('Phase 0 是 IDLE', async () => {
      const mod = await import('../../alertness/healing.js');
      const { RECOVERY_PHASES } = mod.default;
      expect(RECOVERY_PHASES[0].name).toBe('IDLE');
    });

    it('Phase 4 是 FULL（完全恢复）', async () => {
      const mod = await import('../../alertness/healing.js');
      const { RECOVERY_PHASES } = mod.default;
      expect(RECOVERY_PHASES[4].name).toBe('FULL');
    });
  });

  // ============================================================
  // 策略选择逻辑（通过 startRecovery 间接测试）
  // ============================================================

  describe('策略选择', () => {
    it('high_memory 触发 memory_cleanup 策略', async () => {
      await startRecovery(['high_memory']);
      const status = getRecoveryStatus();
      expect(status.strategiesApplied).toBeGreaterThan(0);
    });

    it('queue_overflow 触发 queue_drainage 策略', async () => {
      await startRecovery(['queue_overflow']);
      const status = getRecoveryStatus();
      expect(status.strategiesApplied).toBeGreaterThan(0);
    });

    it('zombie_processes 触发 process_recovery 策略', async () => {
      await startRecovery(['zombie_processes']);
      const status = getRecoveryStatus();
      expect(status.strategiesApplied).toBeGreaterThan(0);
    });

    it('high_error_rate 触发 error_mitigation 策略', async () => {
      await startRecovery(['high_error_rate']);
      const status = getRecoveryStatus();
      expect(status.strategiesApplied).toBeGreaterThan(0);
    });

    it('多个问题时应用多个策略', async () => {
      await startRecovery(['high_memory', 'queue_overflow']);
      const status = getRecoveryStatus();
      expect(status.strategiesApplied).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // restart_stuck_executors 测试
  // ============================================================

  describe('restart_stuck_executors', () => {
    it('无卡住任务时返回 executorsRestarted: 0', async () => {
      mockExistsSync.mockReturnValue(false);
      mockConnect.mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: mockRelease
      });

      const mod = await import('../../alertness/healing.js');
      const result = await mod.executeAction('restart_stuck_executors');
      expect(result.executorsRestarted).toBe(0);
    });
  });

  // ============================================================
  // retry_with_backoff 测试
  // ============================================================

  describe('retry_with_backoff', () => {
    it('无失败任务时返回 retriesScheduled: 0', async () => {
      mockConnect.mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: mockRelease
      });

      const mod = await import('../../alertness/healing.js');
      const result = await mod.executeAction('retry_with_backoff');
      expect(result.retriesScheduled).toBe(0);
    });
  });

  // ============================================================
  // clear_expired_cache 测试
  // ============================================================

  describe('clear_expired_cache', () => {
    it('无过期缓存时返回 entriesRemoved: 0', async () => {
      mockConnect.mockResolvedValue({
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ exists: true }] })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
        release: mockRelease
      });

      const mod = await import('../../alertness/healing.js');
      const result = await mod.executeAction('clear_expired_cache');
      expect(result.cacheCleared).toBe(true);
      expect(result.entriesRemoved).toBe(0);
    });
  });

  describe('旧路径迁入：真实恢复流程及动作产出', () => {
    function isolatedQueries() {
      const query = vi.fn(async sql => {
        if (sql.includes('information_schema')) return { rows: [{ exists: true }], rowCount: 1 };
        if (sql.includes('FROM error_logs')) return { rows: [{ count: '0' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
      mockConnect.mockResolvedValue({ query, release: mockRelease });
      return query;
    }

    it('真实计时推进观察→25%→50%→75%→完成，而非仅检查阶段常量', async () => {
      const query = isolatedQueries();
      const gc = vi.fn();
      vi.stubGlobal('gc', gc);
      await startRecovery(['high_memory']);
      await vi.advanceTimersByTimeAsync(299999);
      expect(getRecoveryStatus()).toMatchObject({ phase: 1, capacity: 0, actionsExecuted: 0 });
      expect(gc).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(getRecoveryStatus()).toMatchObject({ phase: 2, capacity: 25, actionsExecuted: 3 });
      expect(gc).toHaveBeenCalledOnce();
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('pg_terminate_backend'));
      await vi.advanceTimersByTimeAsync(600000);
      expect(getRecoveryStatus()).toMatchObject({ phase: 3, capacity: 50 });
      await vi.advanceTimersByTimeAsync(300000);
      expect(getRecoveryStatus()).toMatchObject({ phase: 3, capacity: 75 });
      await vi.advanceTimersByTimeAsync(1199999);
      expect(getRecoveryStatus()).toMatchObject({ phase: 3, capacity: 75 });
      await vi.advanceTimersByTimeAsync(1);
      expect(getRecoveryStatus()).toMatchObject({ isRecovering: false, phase: 0, capacity: 100 });
      expect(mockEmit).toHaveBeenCalledWith('healing:completed', { success: true });
      const completion = query.mock.calls.find(([sql]) => sql.includes('UPDATE self_healing_log'));
      expect(completion[1].slice(0, 2)).toEqual([true, 2400]);
      expect(JSON.parse(completion[1][2]).map(action => action.action)).toEqual([
        'force_garbage_collection', 'clear_expired_cache', 'compact_database_connections',
        'force_garbage_collection', 'clear_expired_cache', 'compact_database_connections',
      ]);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('策略选择按优先级发出真实恢复计划，不受输入 issue 顺序影响', async () => {
      isolatedQueries();
      await startRecovery(['high_error_rate', 'queue_overflow', 'high_memory']);
      const started = mockEmit.mock.calls.find(([event]) => event === 'healing:started');
      expect(started[1].strategies.map(strategy => strategy.key)).toEqual(['memory_cleanup', 'queue_drainage', 'error_mitigation']);
      expect(getRecoveryStatus()).toMatchObject({ phase: 1, strategiesApplied: 3, actionsExecuted: 0 });
    });

    it.each([
      ['redistribute_tasks', { redistributed: 3 }, 'UPDATE tasks'],
      ['cancel_duplicate_tasks', { duplicatesCanceled: 3 }, 'PARTITION BY title, goal_id, project_id'],
      ['archive_old_tasks', { archived: 3 }, "status = 'archived'"],
    ])('%s 返回实际 SQL 影响行数', async (action, expected, sqlFragment) => {
      const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 3 });
      mockConnect.mockResolvedValue({ query, release: mockRelease });
      const { executeAction } = await import('../../alertness/healing.js');
      expect(await executeAction(action)).toEqual(expected);
      expect(query).toHaveBeenCalledWith(expect.stringContaining(sqlFragment), ...(action === 'archive_old_tasks' ? [[]] : []));
      expect(mockRelease).toHaveBeenCalledOnce();
    });

    it.each([
      ['reset_process_pool', { poolReset: false, stub: true }],
      ['switch_fallback_endpoints', { fallbackEnabled: false, stub: true }],
    ])('%s 未实现时不得伪报恢复成功', async (action, expected) => {
      const { executeAction } = await import('../../alertness/healing.js');
      expect(await executeAction(action)).toEqual(expected);
    });
  });

});
