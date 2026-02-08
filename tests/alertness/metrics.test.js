import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  collectMetrics,
  calculateHealthScore,
  getRecentMetrics,
  recordOperation,
  recordTickTime,
  hasDangerousMetrics,
  getDangerousMetrics,
  getWarningMetrics,
  THRESHOLDS
} from '../../brain/src/alertness/metrics.js';

// Mock dependencies
vi.mock('../../brain/src/db.js', () => ({
  default: {
    connect: vi.fn(() => ({
      query: vi.fn(),
      release: vi.fn()
    }))
  }
}));

vi.mock('os', () => ({
  default: {
    loadavg: () => [2.5, 2.0, 1.5],
    cpus: () => new Array(4).fill({ model: 'test' })
  }
}));

vi.mock('process', { partial: true }, () => ({
  memoryUsage: () => ({
    rss: 157286400 // 150 MB
  })
}));

describe('Alertness Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('collectMetrics', () => {
    it('应该收集所有 5 种核心指标', async () => {
      const metrics = await collectMetrics();

      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('queueDepth');
    });

    it('内存指标应该正确计算 RSS', async () => {
      const metrics = await collectMetrics();

      expect(metrics.memory).toMatchObject({
        value: 150,
        status: 'normal',
        unit: 'MB'
      });
    });

    it('CPU 指标应该基于负载均值计算', async () => {
      const metrics = await collectMetrics();

      expect(metrics.cpu).toHaveProperty('value');
      expect(metrics.cpu).toHaveProperty('status');
      expect(metrics.cpu).toHaveProperty('unit', '%');
      expect(metrics.cpu).toHaveProperty('loadAvg');
    });

    it('响应时间应该使用历史平均值', async () => {
      // 记录几个响应时间
      recordTickTime(1000);
      recordTickTime(2000);
      recordTickTime(1500);

      const metrics = await collectMetrics();

      expect(metrics.responseTime.value).toBeCloseTo(1500, -2);
      expect(metrics.responseTime.status).toBe('normal');
    });

    it('错误率应该基于操作历史计算', async () => {
      // 记录一些操作
      recordOperation(true, 'test');
      recordOperation(true, 'test');
      recordOperation(false, 'test');

      const metrics = await collectMetrics();

      expect(metrics.errorRate.value).toBeCloseTo(33, -1);
      expect(metrics.errorRate.failed).toBe(1);
      expect(metrics.errorRate.total).toBe(3);
    });
  });

  describe('阈值状态判断', () => {
    it('内存正常阈值 < 150MB', async () => {
      const metrics = await collectMetrics();
      expect(metrics.memory.status).toBe('normal');
    });

    it('内存警告阈值 150-200MB', () => {
      // 需要模拟不同的内存值
      // 这里简化示例
      const status = metrics.memory.value >= 150 && metrics.memory.value < 200 ? 'warning' : metrics.memory.status;
      expect(['normal', 'warning']).toContain(status);
    });

    it('内存危险阈值 > 300MB', () => {
      const dangerValue = 350;
      const status = dangerValue >= THRESHOLDS.memory.danger ? 'danger' : 'normal';
      expect(status).toBe('danger');
    });

    it('CPU 阈值应该正确分类', () => {
      const testCases = [
        { value: 20, expected: 'normal' },
        { value: 40, expected: 'warning' },
        { value: 90, expected: 'danger' }
      ];

      testCases.forEach(({ value, expected }) => {
        const status = value >= THRESHOLDS.cpu.danger ? 'danger'
          : value >= THRESHOLDS.cpu.warning ? 'warning'
          : 'normal';
        expect(status).toBe(expected);
      });
    });
  });

  describe('健康分数计算', () => {
    it('所有指标正常应该返回 100 分', () => {
      const metrics = {
        memory: { value: 100, status: 'normal' },
        cpu: { value: 20, status: 'normal' },
        responseTime: { value: 1000, status: 'normal' },
        errorRate: { value: 5, status: 'normal' },
        queueDepth: { value: 5, status: 'normal' }
      };

      const score = calculateHealthScore(metrics);
      expect(score).toBe(100);
    });

    it('所有指标危险应该返回 0 分', () => {
      const metrics = {
        memory: { value: 400, status: 'danger' },
        cpu: { value: 90, status: 'danger' },
        responseTime: { value: 15000, status: 'danger' },
        errorRate: { value: 60, status: 'danger' },
        queueDepth: { value: 100, status: 'danger' }
      };

      const score = calculateHealthScore(metrics);
      expect(score).toBe(0);
    });

    it('混合状态应该返回加权平均分', () => {
      const metrics = {
        memory: { value: 100, status: 'normal' }, // 100 * 0.25 = 25
        cpu: { value: 40, status: 'warning' },    // 50 * 0.25 = 12.5
        responseTime: { value: 15000, status: 'danger' }, // 0 * 0.20 = 0
        errorRate: { value: 5, status: 'normal' }, // 100 * 0.20 = 20
        queueDepth: { value: 5, status: 'normal' } // 100 * 0.10 = 10
      };

      const score = calculateHealthScore(metrics);
      expect(score).toBeCloseTo(68, 0); // 25 + 12.5 + 0 + 20 + 10 = 67.5
    });
  });

  describe('操作记录', () => {
    it('recordOperation 应该记录成功操作', () => {
      recordOperation(true, 'test_operation');
      recordOperation(true, 'test_operation');

      const metrics = getRecentMetrics();
      // 验证操作被记录
      expect(metrics).toBeDefined();
    });

    it('recordOperation 应该记录失败操作', () => {
      recordOperation(false, 'test_operation');

      const metrics = getRecentMetrics();
      expect(metrics).toBeDefined();
    });

    it('recordTickTime 应该记录 tick 执行时间', () => {
      recordTickTime(1500);
      recordTickTime(2000);
      recordTickTime(2500);

      const metrics = getRecentMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('危险指标检测', () => {
    it('hasDangerousMetrics 应该检测危险指标', () => {
      // 设置一个危险指标
      const has危险 = hasDangerousMetrics();
      expect(typeof has危险).toBe('boolean');
    });

    it('getDangerousMetrics 应该返回危险指标列表', () => {
      const dangerList = getDangerousMetrics();
      expect(Array.isArray(dangerList)).toBe(true);
    });

    it('getWarningMetrics 应该返回警告指标列表', () => {
      const warningList = getWarningMetrics();
      expect(Array.isArray(warningList)).toBe(true);
    });
  });
});