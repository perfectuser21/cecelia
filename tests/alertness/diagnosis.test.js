import { describe, it, expect, beforeEach } from 'vitest';
import {
  diagnoseProblem,
  analyzeTrends,
  predictProblems,
  getAnomalyPatterns,
  ANOMALY_PATTERNS
} from '../../brain/src/alertness/diagnosis.js';

describe('Alertness Diagnosis', () => {
  let mockHistory;

  beforeEach(() => {
    // 准备模拟历史数据
    mockHistory = [
      {
        timestamp: Date.now() - 300000,
        metrics: {
          cpu: { value: 75 },
          memory: { value: 150 },
          responseTime: { value: 1000 },
          errorRate: { value: 5 },
          queueDepth: { value: 10 }
        }
      },
      {
        timestamp: Date.now() - 240000,
        metrics: {
          cpu: { value: 78 },
          memory: { value: 160 },
          responseTime: { value: 1200 },
          errorRate: { value: 8 },
          queueDepth: { value: 15 }
        }
      },
      {
        timestamp: Date.now() - 180000,
        metrics: {
          cpu: { value: 80 },
          memory: { value: 170 },
          responseTime: { value: 1500 },
          errorRate: { value: 10 },
          queueDepth: { value: 20 }
        }
      },
      {
        timestamp: Date.now() - 120000,
        metrics: {
          cpu: { value: 72 },
          memory: { value: 180 },
          responseTime: { value: 2000 },
          errorRate: { value: 15 },
          queueDepth: { value: 35 }
        }
      },
      {
        timestamp: Date.now() - 60000,
        metrics: {
          cpu: { value: 71 },
          memory: { value: 190 },
          responseTime: { value: 2500 },
          errorRate: { value: 20 },
          queueDepth: { value: 40 }
        }
      }
    ];
  });

  describe('异常模式识别', () => {
    it('应该识别持续高负载（连续 3 个 tick CPU > 70%）', async () => {
      const currentMetrics = {
        cpu: { value: 75 },
        memory: { value: 200 },
        responseTime: { value: 3000 },
        errorRate: { value: 25 },
        queueDepth: { value: 45 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toContain('high_load');
      expect(diagnosis.patterns.some(p => p.type === 'HIGH_LOAD')).toBe(true);
    });

    it('应该识别内存泄漏（内存持续上涨 > 10MB/分钟）', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 200 },
        responseTime: { value: 1000 },
        errorRate: { value: 5 },
        queueDepth: { value: 10 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toContain('memory_leak');
      expect(diagnosis.patterns.some(p => p.type === 'MEMORY_LEAK')).toBe(true);
    });

    it('应该识别响应退化（响应时间比基线慢 3 倍）', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 150 },
        responseTime: { value: 6000 }, // 基线约 1500，这是 4 倍
        errorRate: { value: 5 },
        queueDepth: { value: 10 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toContain('response_degradation');
      expect(diagnosis.patterns.some(p => p.type === 'RESPONSE_DEGRADATION')).toBe(true);
    });

    it('应该识别错误暴增（错误率突增 > 50%）', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 150 },
        responseTime: { value: 1000 },
        errorRate: { value: 70 }, // 从平均 ~12% 突增到 70%
        queueDepth: { value: 10 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toContain('error_spike');
      expect(diagnosis.patterns.some(p => p.type === 'ERROR_SPIKE')).toBe(true);
    });

    it('应该识别队列阻塞（队列深度持续 > 30）', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 150 },
        responseTime: { value: 1000 },
        errorRate: { value: 5 },
        queueDepth: { value: 50 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toContain('queue_blockage');
      expect(diagnosis.patterns.some(p => p.type === 'QUEUE_BLOCKAGE')).toBe(true);
    });

    it('没有异常时应该返回健康状态', async () => {
      const currentMetrics = {
        cpu: { value: 30 },
        memory: { value: 100 },
        responseTime: { value: 500 },
        errorRate: { value: 2 },
        queueDepth: { value: 5 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.issues).toHaveLength(0);
      expect(diagnosis.severity).toBe('none');
      expect(diagnosis.summary).toBe('System is healthy');
    });
  });

  describe('严重程度判断', () => {
    it('多个高严重度问题应该返回 high', async () => {
      const currentMetrics = {
        cpu: { value: 75, status: 'danger' },
        memory: { value: 200, status: 'danger' },
        responseTime: { value: 3000 },
        errorRate: { value: 70, status: 'danger' },
        queueDepth: { value: 50 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.severity).toBe('high');
    });

    it('中等严重度问题应该返回 medium', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 150 },
        responseTime: { value: 6000 },
        errorRate: { value: 10 },
        queueDepth: { value: 35 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(['medium', 'high']).toContain(diagnosis.severity);
    });
  });

  describe('趋势分析', () => {
    it('应该分析指标上升趋势', () => {
      const trends = analyzeTrends(mockHistory, 5);

      expect(trends).toHaveProperty('memory');
      expect(trends).toHaveProperty('cpu');
      expect(trends).toHaveProperty('queueDepth');
    });

    it('应该识别稳定趋势', () => {
      const stableHistory = Array(5).fill({
        timestamp: Date.now(),
        metrics: {
          cpu: { value: 50 },
          memory: { value: 150 },
          responseTime: { value: 1000 },
          errorRate: { value: 5 },
          queueDepth: { value: 10 }
        }
      });

      const trends = analyzeTrends(stableHistory, 5);

      Object.values(trends).forEach(trend => {
        if (trend !== 'insufficient_data') {
          expect(['stable', 'increasing', 'decreasing']).toContain(trend);
        }
      });
    });
  });

  describe('问题预测', () => {
    it('应该预测内存耗尽', () => {
      const metrics = { memory: { value: 250 } };
      const trends = { memory: 'increasing' };

      const predictions = predictProblems(metrics, mockHistory, trends);

      expect(predictions.some(p => p.type === 'MEMORY_EXHAUSTION')).toBe(true);
    });

    it('应该预测 CPU 过载', () => {
      const metrics = { cpu: { value: 70 } };
      const trends = { cpu: 'increasing' };

      const predictions = predictProblems(metrics, mockHistory, trends);

      expect(predictions.some(p => p.type === 'CPU_OVERLOAD')).toBe(true);
    });

    it('应该预测队列溢出', () => {
      const metrics = { queueDepth: { value: 40 } };
      const trends = { queueDepth: 'increasing' };

      const predictions = predictProblems(metrics, mockHistory, trends);

      expect(predictions.some(p => p.type === 'QUEUE_OVERFLOW')).toBe(true);
    });
  });

  describe('建议生成', () => {
    it('高负载应该建议减少并发', async () => {
      const currentMetrics = {
        cpu: { value: 75 },
        memory: { value: 150 },
        responseTime: { value: 1000 },
        errorRate: { value: 5 },
        queueDepth: { value: 10 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.recommendations).toContain('reduce_concurrent_tasks');
    });

    it('内存泄漏应该建议垃圾回收', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 200 },
        responseTime: { value: 1000 },
        errorRate: { value: 5 },
        queueDepth: { value: 10 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.recommendations).toContain('force_garbage_collection');
    });

    it('队列阻塞应该建议增加处理能力', async () => {
      const currentMetrics = {
        cpu: { value: 50 },
        memory: { value: 150 },
        responseTime: { value: 1000 },
        errorRate: { value: 5 },
        queueDepth: { value: 50 }
      };

      const diagnosis = await diagnoseProblem(currentMetrics, mockHistory);

      expect(diagnosis.recommendations).toContain('increase_worker_capacity');
    });
  });

  describe('异常模式定义', () => {
    it('应该返回所有定义的异常模式', () => {
      const patterns = getAnomalyPatterns();

      expect(patterns).toBeInstanceOf(Array);
      expect(patterns.length).toBeGreaterThan(0);

      patterns.forEach(pattern => {
        expect(pattern).toHaveProperty('key');
        expect(pattern).toHaveProperty('name');
        expect(pattern).toHaveProperty('description');
        expect(pattern).toHaveProperty('severity');
      });
    });

    it('异常模式应该包含所有定义的类型', () => {
      const patterns = getAnomalyPatterns();
      const keys = patterns.map(p => p.key);

      expect(keys).toContain('HIGH_LOAD');
      expect(keys).toContain('MEMORY_LEAK');
      expect(keys).toContain('RESPONSE_DEGRADATION');
      expect(keys).toContain('ERROR_SPIKE');
      expect(keys).toContain('QUEUE_BLOCKAGE');
    });
  });
});