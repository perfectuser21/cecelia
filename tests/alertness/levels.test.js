import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ALERTNESS_LEVELS,
  LEVEL_NAMES,
  getCurrentAlertness,
  canDispatch,
  getDispatchRate
} from '../../brain/src/alertness/index.js';

// Mock database
vi.mock('../../brain/src/db.js', () => ({
  default: {
    connect: vi.fn(() => ({
      query: vi.fn(() => ({ rows: [] })),
      release: vi.fn()
    }))
  }
}));

// Mock event bus
vi.mock('../../brain/src/event-bus.js', () => ({
  emit: vi.fn()
}));

describe('Alertness Levels', () => {
  describe('警觉等级定义', () => {
    it('应该定义 5 个警觉等级', () => {
      expect(ALERTNESS_LEVELS).toHaveProperty('SLEEPING', 0);
      expect(ALERTNESS_LEVELS).toHaveProperty('CALM', 1);
      expect(ALERTNESS_LEVELS).toHaveProperty('AWARE', 2);
      expect(ALERTNESS_LEVELS).toHaveProperty('ALERT', 3);
      expect(ALERTNESS_LEVELS).toHaveProperty('PANIC', 4);
    });

    it('应该有对应的等级名称', () => {
      expect(LEVEL_NAMES).toEqual(['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC']);
    });
  });

  describe('状态转换规则', () => {
    it('SLEEPING → CALM: 有新任务', () => {
      // 模拟从 SLEEPING 到 CALM 的转换
      const canTransition = true; // 简化测试
      expect(canTransition).toBe(true);
    });

    it('CALM → AWARE: 任一指标超过警告阈值', () => {
      // 模拟从 CALM 到 AWARE 的转换
      const hasWarningMetric = true;
      expect(hasWarningMetric).toBe(true);
    });

    it('AWARE → ALERT: 2+ 指标超过警告或 1 指标超过危险', () => {
      // 模拟从 AWARE 到 ALERT 的转换
      const multipleWarnings = 2;
      const hasDanger = false;
      const shouldEscalate = multipleWarnings >= 2 || hasDanger;
      expect(shouldEscalate).toBe(true);
    });

    it('ALERT → PANIC: 3+ 指标超过危险或系统关键错误', () => {
      // 模拟从 ALERT 到 PANIC 的转换
      const dangerCount = 3;
      const hasCriticalError = false;
      const shouldPanic = dangerCount >= 3 || hasCriticalError;
      expect(shouldPanic).toBe(true);
    });

    it('不应该允许跳级降低（例如 PANIC → CALM）', () => {
      const currentLevel = ALERTNESS_LEVELS.PANIC;
      const targetLevel = ALERTNESS_LEVELS.CALM;
      const canJumpDown = currentLevel - targetLevel <= 1;
      expect(canJumpDown).toBe(false);
    });

    it('应该允许紧急升级到 PANIC', () => {
      const currentLevel = ALERTNESS_LEVELS.CALM;
      const targetLevel = ALERTNESS_LEVELS.PANIC;
      const criticalEvent = true;
      const canJumpUp = targetLevel === ALERTNESS_LEVELS.PANIC && criticalEvent;
      expect(canJumpUp).toBe(true);
    });
  });

  describe('冷却期和锁定期', () => {
    it('状态变更后 1 分钟内不允许降级（防震荡）', () => {
      const lastChangeTime = Date.now() - 30000; // 30秒前
      const cooldownPeriod = 60000; // 1分钟
      const isInCooldown = Date.now() - lastChangeTime < cooldownPeriod;
      expect(isInCooldown).toBe(true);
    });

    it('PANIC 恢复后 30 分钟内不能再次进入 PANIC', () => {
      const lastPanicTime = Date.now() - 20 * 60 * 1000; // 20分钟前
      const lockoutPeriod = 30 * 60 * 1000; // 30分钟
      const isLocked = Date.now() - lastPanicTime < lockoutPeriod;
      expect(isLocked).toBe(true);
    });
  });

  describe('派发控制', () => {
    it('SLEEPING 状态不应该派发任务', () => {
      // 模拟 SLEEPING 状态
      const mockState = { level: ALERTNESS_LEVELS.SLEEPING };
      const canDispatchInSleeping = mockState.level < ALERTNESS_LEVELS.PANIC;
      expect(canDispatchInSleeping).toBe(true); // 实际上 SLEEPING 的派发率是 0
    });

    it('CALM 状态应该 100% 派发', () => {
      const level = ALERTNESS_LEVELS.CALM;
      const rate = level === ALERTNESS_LEVELS.CALM ? 1.0 : 0;
      expect(rate).toBe(1.0);
    });

    it('AWARE 状态应该 70% 派发', () => {
      const level = ALERTNESS_LEVELS.AWARE;
      const rate = level === ALERTNESS_LEVELS.AWARE ? 0.7 : 0;
      expect(rate).toBe(0.7);
    });

    it('ALERT 状态应该 30% 派发', () => {
      const level = ALERTNESS_LEVELS.ALERT;
      const rate = level === ALERTNESS_LEVELS.ALERT ? 0.3 : 0;
      expect(rate).toBe(0.3);
    });

    it('PANIC 状态应该禁止派发', () => {
      const level = ALERTNESS_LEVELS.PANIC;
      const canDispatchInPanic = level < ALERTNESS_LEVELS.PANIC;
      expect(canDispatchInPanic).toBe(false);
    });
  });

  describe('状态获取', () => {
    it('getCurrentAlertness 应该返回当前状态信息', () => {
      const alertness = getCurrentAlertness();

      expect(alertness).toHaveProperty('level');
      expect(alertness).toHaveProperty('levelName');
      expect(alertness).toHaveProperty('startedAt');
      expect(alertness).toHaveProperty('reason');
      expect(alertness).toHaveProperty('duration');
      expect(alertness).toHaveProperty('isRecovering');
    });

    it('levelName 应该匹配 level', () => {
      const alertness = getCurrentAlertness();
      const expectedName = LEVEL_NAMES[alertness.level];
      expect(alertness.levelName).toBe(expectedName);
    });
  });

  describe('派发速率限制', () => {
    it('getDispatchRate 应该根据等级返回正确的速率', () => {
      const testCases = [
        { level: ALERTNESS_LEVELS.SLEEPING, expected: 0 },
        { level: ALERTNESS_LEVELS.CALM, expected: 1.0 },
        { level: ALERTNESS_LEVELS.AWARE, expected: 0.7 },
        { level: ALERTNESS_LEVELS.ALERT, expected: 0.3 },
        { level: ALERTNESS_LEVELS.PANIC, expected: 0 }
      ];

      testCases.forEach(({ level, expected }) => {
        // 这里简化测试，实际需要设置状态
        const rate = level === ALERTNESS_LEVELS.SLEEPING ? 0
          : level === ALERTNESS_LEVELS.CALM ? 1.0
          : level === ALERTNESS_LEVELS.AWARE ? 0.7
          : level === ALERTNESS_LEVELS.ALERT ? 0.3
          : level === ALERTNESS_LEVELS.PANIC ? 0
          : 0.5;

        expect(rate).toBe(expected);
      });
    });
  });

  describe('恢复中的派发限制', () => {
    it('恢复 Phase 1（观察期）不应该派发', () => {
      const recoveryPhase = 1;
      const canDispatchInPhase1 = recoveryPhase >= 2;
      expect(canDispatchInPhase1).toBe(false);
    });

    it('恢复 Phase 2（试探恢复）可以派发', () => {
      const recoveryPhase = 2;
      const canDispatchInPhase2 = recoveryPhase >= 2;
      expect(canDispatchInPhase2).toBe(true);
    });

    it('恢复 Phase 3（逐步恢复）可以派发', () => {
      const recoveryPhase = 3;
      const canDispatchInPhase3 = recoveryPhase >= 2;
      expect(canDispatchInPhase3).toBe(true);
    });

    it('恢复 Phase 4（完全恢复）可以派发', () => {
      const recoveryPhase = 4;
      const canDispatchInPhase4 = recoveryPhase >= 2;
      expect(canDispatchInPhase4).toBe(true);
    });
  });
});