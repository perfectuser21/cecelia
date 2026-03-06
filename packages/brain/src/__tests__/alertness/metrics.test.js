/**
 * Tests for alertness/metrics.js
 * 指标收集器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted 确保在 mock factory 中可用
const mockConnect = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockClientQuery = vi.hoisted(() => vi.fn());

// Mock os
const mockLoadavg = vi.hoisted(() => vi.fn(() => [1.0]));
const mockCpus = vi.hoisted(() => vi.fn(() => [1, 2, 3, 4])); // 4核

vi.mock('../../db.js', () => ({
  default: { connect: mockConnect }
}));

vi.mock('os', () => ({
  default: {
    loadavg: mockLoadavg,
    cpus: mockCpus
  }
}));

let collectMetrics;
let recordOperation;
let recordTickTime;
let calculateHealthScore;
let getRecentMetrics;

describe('alertness/metrics', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    mockRelease.mockImplementation(() => {});
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease
    });

    vi.resetModules();

    vi.mock('../../db.js', () => ({
      default: { connect: mockConnect }
    }));
    vi.mock('os', () => ({
      default: {
        loadavg: mockLoadavg,
        cpus: mockCpus
      }
    }));

    const mod = await import('../../alertness/metrics.js');
    collectMetrics = mod.collectMetrics;
    recordOperation = mod.recordOperation;
    recordTickTime = mod.recordTickTime;
    calculateHealthScore = mod.calculateHealthScore;
    getRecentMetrics = mod.getRecentMetrics;
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ============================================================
  // collectMetrics
  // ============================================================

  describe('collectMetrics', () => {
    it('返回包含5种指标的对象', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('queueDepth');
    });

    it('每个指标包含 value/status/unit/timestamp', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      for (const [key, metric] of Object.entries(metrics)) {
        expect(metric).toHaveProperty('value');
        expect(metric).toHaveProperty('status');
        expect(metric).toHaveProperty('unit');
        expect(metric).toHaveProperty('timestamp');
      }
    });

    it('内存指标 value 为正数（RSS MB）', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      expect(typeof metrics.memory.value).toBe('number');
      expect(metrics.memory.value).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.unit).toBe('MB');
    });

    it('CPU 指标单位为 %', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      expect(metrics.cpu.unit).toBe('%');
      expect(typeof metrics.cpu.value).toBe('number');
    });

    it('CPU status 根据阈值正确分级', async () => {
      // loadavg[0]=0.4, cpus=4 → cpuPercent=10%, smoothed=10 → normal (< 30)
      mockLoadavg.mockReturnValue([0.4]);
      mockCpus.mockReturnValue([1, 2, 3, 4]);
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      expect(metrics.cpu.status).toBe('normal');
    });

    it('队列深度来自 DB 查询', async () => {
      mockClientQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getRecentTickTime
        .mockResolvedValueOnce({ rows: [{ count: '25' }], rowCount: 1 }); // getQueueDepth
      const metrics = await collectMetrics();
      expect(metrics.queueDepth.value).toBe(25);
    });

    it('DB 错误时队列深度返回 0', async () => {
      // mockConnect 使内部 client.query 抛出错误
      mockConnect.mockResolvedValue({
        query: vi.fn().mockRejectedValue(new Error('DB error')),
        release: mockRelease
      });
      const metrics = await collectMetrics();
      expect(metrics.queueDepth.value).toBe(0);
    });

    it('tick 历史中有执行时间时更新响应时间', async () => {
      // 第1次 connect：getRecentTickTime 返回 3000ms
      // 第2次 connect：getQueueDepth 返回 0
      const clientWithTick = {
        query: vi.fn().mockResolvedValue({ rows: [{ execution_time_ms: 3000 }], rowCount: 1 }),
        release: mockRelease
      };
      const clientWithQueue = {
        query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 }),
        release: mockRelease
      };
      mockConnect
        .mockResolvedValueOnce(clientWithTick)
        .mockResolvedValueOnce(clientWithQueue);
      const metrics = await collectMetrics();
      expect(metrics.responseTime.value).toBeGreaterThan(0);
      expect(metrics.responseTime.unit).toBe('ms');
    });

    it('错误率基于 operationHistory', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      // 先记录一些操作
      recordOperation(true, 'op1');
      recordOperation(false, 'op2');
      recordOperation(true, 'op3');
      recordOperation(false, 'op4');
      // 4个操作，2个失败 → 50%
      const metrics = await collectMetrics();
      expect(metrics.errorRate.value).toBe(50);
      expect(metrics.errorRate.unit).toBe('%');
    });

    it('无操作历史时错误率为 0', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const metrics = await collectMetrics();
      expect(metrics.errorRate.value).toBe(0);
    });

    it('更新缓存（getRecentMetrics 返回最新值）', async () => {
      mockClientQuery.mockResolvedValue({ rows: [{ count: '5' }], rowCount: 1 });
      await collectMetrics();
      const cached = getRecentMetrics();
      expect(cached).toHaveProperty('memory');
      expect(cached).toHaveProperty('cpu');
    });
  });

  // ============================================================
  // recordOperation
  // ============================================================

  describe('recordOperation', () => {
    it('记录成功操作', () => {
      expect(() => recordOperation(true, 'test_op')).not.toThrow();
    });

    it('记录失败操作', () => {
      expect(() => recordOperation(false, 'failed_op')).not.toThrow();
    });

    it('操作默认名称为 unknown', () => {
      expect(() => recordOperation(true)).not.toThrow();
    });

    it('超过上限时移除旧记录（不无限增长）', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      // 添加 15 个操作（上限 10）
      for (let i = 0; i < 15; i++) {
        recordOperation(i % 2 === 0);
      }
      const metrics = await collectMetrics();
      // 最新的 10 个：8个成功，2个失败 → 20%
      // 或者不同顺序，只要不超过 MAX_OPERATION_HISTORY
      expect(metrics.errorRate.total).toBeLessThanOrEqual(10);
    });
  });

  // ============================================================
  // recordTickTime
  // ============================================================

  describe('recordTickTime', () => {
    it('记录 tick 执行时间', () => {
      expect(() => recordTickTime(1500)).not.toThrow();
    });

    it('超过上限时移除旧记录', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      // 添加 15 个 tick 时间（上限 10）
      for (let i = 0; i < 15; i++) {
        recordTickTime(1000 + i * 100);
      }
      const metrics = await collectMetrics();
      expect(metrics.responseTime.samples).toBeLessThanOrEqual(10);
    });

    it('多次记录后响应时间为平均值', async () => {
      mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      recordTickTime(1000);
      recordTickTime(3000);
      const metrics = await collectMetrics();
      // 平均 = (1000 + 3000) / 2 = 2000
      expect(metrics.responseTime.value).toBe(2000);
    });
  });

  // ============================================================
  // calculateHealthScore
  // ============================================================

  describe('calculateHealthScore', () => {
    it('全部 normal 时返回 100', () => {
      const metrics = {
        memory: { status: 'normal' },
        cpu: { status: 'normal' },
        responseTime: { status: 'normal' },
        errorRate: { status: 'normal' },
        queueDepth: { status: 'normal' }
      };
      const score = calculateHealthScore(metrics);
      expect(score).toBe(100);
    });

    it('全部 danger 时返回 0', () => {
      const metrics = {
        memory: { status: 'danger' },
        cpu: { status: 'danger' },
        responseTime: { status: 'danger' },
        errorRate: { status: 'danger' },
        queueDepth: { status: 'danger' }
      };
      const score = calculateHealthScore(metrics);
      expect(score).toBe(0);
    });

    it('全部 warning 时返回 50', () => {
      const metrics = {
        memory: { status: 'warning' },
        cpu: { status: 'warning' },
        responseTime: { status: 'warning' },
        errorRate: { status: 'warning' },
        queueDepth: { status: 'warning' }
      };
      const score = calculateHealthScore(metrics);
      expect(score).toBe(50);
    });

    it('缺少指标时按有效指标计算', () => {
      const metrics = {
        memory: { status: 'normal' },
        cpu: { status: 'danger' }
      };
      const score = calculateHealthScore(metrics);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('空对象时返回 0', () => {
      const score = calculateHealthScore({});
      expect(score).toBe(0);
    });

    it('返回整数（已 Math.round）', () => {
      const metrics = {
        memory: { status: 'normal' },
        cpu: { status: 'warning' },
        responseTime: { status: 'normal' },
        errorRate: { status: 'danger' },
        queueDepth: { status: 'normal' }
      };
      const score = calculateHealthScore(metrics);
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  // ============================================================
  // getRecentMetrics
  // ============================================================

  describe('getRecentMetrics', () => {
    it('初始返回有效的缓存对象', () => {
      const cached = getRecentMetrics();
      expect(cached).toBeDefined();
      expect(typeof cached).toBe('object');
    });

    it('collectMetrics 后缓存被更新', async () => {
      mockClientQuery.mockResolvedValue({ rows: [{ count: '42' }], rowCount: 1 });
      await collectMetrics();
      const cached = getRecentMetrics();
      expect(cached).toHaveProperty('queueDepth');
      expect(cached.queueDepth.value).toBe(42);
    });
  });

  // ============================================================
  // THRESHOLDS 常量
  // ============================================================

  describe('THRESHOLDS', () => {
    it('包含所有指标阈值定义', async () => {
      const mod = await import('../../alertness/metrics.js');
      const { THRESHOLDS } = mod.default;
      expect(THRESHOLDS).toHaveProperty('memory');
      expect(THRESHOLDS).toHaveProperty('cpu');
      expect(THRESHOLDS).toHaveProperty('responseTime');
      expect(THRESHOLDS).toHaveProperty('errorRate');
      expect(THRESHOLDS).toHaveProperty('queueDepth');
    });

    it('每个阈值包含 normal/warning/danger', async () => {
      const mod = await import('../../alertness/metrics.js');
      const { THRESHOLDS } = mod.default;
      for (const [key, threshold] of Object.entries(THRESHOLDS)) {
        expect(threshold).toHaveProperty('normal');
        expect(threshold).toHaveProperty('warning');
        expect(threshold).toHaveProperty('danger');
        // 递增关系
        expect(threshold.normal).toBeLessThan(threshold.warning);
        expect(threshold.warning).toBeLessThan(threshold.danger);
      }
    });
  });
});
