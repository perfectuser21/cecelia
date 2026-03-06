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

    const mod = await import('../../alertness/healing.js');
    applySelfHealing = mod.applySelfHealing;
    getRecoveryStatus = mod.getRecoveryStatus;
    startRecovery = mod.startRecovery;
  });

  afterEach(() => {
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
});
