/**
 * Tests for alertness/diagnosis.js
 * 诊断引擎 - 异常模式识别
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { diagnoseProblem, getAnomalyPatterns } from '../../alertness/diagnosis.js';

describe('alertness/diagnosis', () => {
  // ============================================================
  // diagnoseProblem
  // ============================================================

  describe('diagnoseProblem', () => {
    it('健康系统：无异常时返回 none 严重程度', async () => {
      const metrics = {
        memory: { value: 100, status: 'normal' },
        cpu: { value: 20, status: 'normal' },
        errorRate: { value: 5, status: 'normal' },
        queueDepth: { value: 5, status: 'normal' }
      };
      const result = await diagnoseProblem(metrics, []);
      expect(result.severity).toBe('none');
      expect(result.issues).toHaveLength(0);
      expect(result.patterns).toHaveLength(0);
      expect(result.summary).toBe('System is healthy');
    });

    it('返回结构包含所有必要字段', async () => {
      const metrics = { memory: { value: 50, status: 'normal' } };
      const result = await diagnoseProblem(metrics, []);
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('metrics');
      expect(typeof result.timestamp).toBe('number');
    });

    it('HIGH_LOAD：连续3个 tick CPU > 70% 时触发', async () => {
      const metrics = { cpu: { value: 85, status: 'danger' } };
      const history = [
        { metrics: { cpu: { value: 75 } } },
        { metrics: { cpu: { value: 80 } } },
        { metrics: { cpu: { value: 85 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('high_load');
      expect(result.severity).toBe('high');
      expect(result.recommendations).toContain('reduce_concurrent_tasks');
      expect(result.recommendations).toContain('increase_tick_interval');
    });

    it('HIGH_LOAD：历史不足 3 条时不触发', async () => {
      const metrics = { cpu: { value: 85, status: 'danger' } };
      const history = [
        { metrics: { cpu: { value: 80 } } },
        { metrics: { cpu: { value: 85 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('high_load');
    });

    it('HIGH_LOAD：有一个 CPU <= 70 时不触发', async () => {
      const metrics = { cpu: { value: 85 } };
      const history = [
        { metrics: { cpu: { value: 75 } } },
        { metrics: { cpu: { value: 65 } } }, // 不超过 70
        { metrics: { cpu: { value: 80 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('high_load');
    });

    it('MEMORY_LEAK：内存持续上涨 > 50MB/分钟 且 RSS > 200MB 时触发', async () => {
      const now = Date.now();
      const metrics = { memory: { value: 350, status: 'danger' } };
      // 构造10条历史，timeDiff约1分钟，增长量 > 50MB
      const history = Array.from({ length: 10 }, (_, i) => ({
        metrics: { memory: { value: 100 + i * 7 } },
        timestamp: now - (9 - i) * 6000 // 54秒跨度
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('memory_leak');
    });

    it('MEMORY_LEAK：RSS < 200MB 时不触发', async () => {
      const now = Date.now();
      const metrics = { memory: { value: 150, status: 'warning' } };
      const history = Array.from({ length: 10 }, (_, i) => ({
        metrics: { memory: { value: 100 + i * 10 } },
        timestamp: now - (9 - i) * 6000
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('memory_leak');
    });

    it('MEMORY_LEAK：历史不足 10 条时不触发', async () => {
      const metrics = { memory: { value: 350, status: 'danger' } };
      const history = Array.from({ length: 5 }, (_, i) => ({
        metrics: { memory: { value: 300 + i * 20 } },
        timestamp: Date.now() - (4 - i) * 6000
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('memory_leak');
    });

    it('RESPONSE_DEGRADATION：响应时间超基线3倍时触发', async () => {
      const metrics = { responseTime: { value: 9000, status: 'danger' } };
      const history = Array.from({ length: 5 }, () => ({
        metrics: { responseTime: { value: 2000 } }
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('response_degradation');
      expect(result.recommendations).toContain('optimize_slow_queries');
    });

    it('RESPONSE_DEGRADATION：没有 responseTime 指标时不触发', async () => {
      const metrics = { memory: { value: 50, status: 'normal' } };
      const history = Array.from({ length: 5 }, () => ({
        metrics: { responseTime: { value: 2000 } }
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('response_degradation');
    });

    it('RESPONSE_DEGRADATION：历史全为0时不触发', async () => {
      const metrics = { responseTime: { value: 5000 } };
      const history = Array.from({ length: 5 }, () => ({
        metrics: { responseTime: { value: 0 } }
      }));
      const result = await diagnoseProblem(metrics, history);
      // 历史全为0，filter(v => v > 0) 后为空，不触发
      expect(result.issues).not.toContain('response_degradation');
    });

    it('ERROR_SPIKE：错误率突增 > 50% 时触发', async () => {
      const metrics = { errorRate: { value: 80, status: 'danger' } };
      const history = Array.from({ length: 5 }, () => ({
        metrics: { errorRate: { value: 5 } }
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('error_spike');
      expect(result.recommendations).toContain('review_error_logs');
      expect(result.recommendations).toContain('enable_circuit_breaker');
    });

    it('ERROR_SPIKE：相对增长超过2倍时触发', async () => {
      const metrics = { errorRate: { value: 60, status: 'danger' } };
      const history = Array.from({ length: 5 }, () => ({
        metrics: { errorRate: { value: 20 } }
      }));
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('error_spike');
    });

    it('ERROR_SPIKE：没有 errorRate 指标时不触发', async () => {
      const metrics = { memory: { value: 50, status: 'normal' } };
      const history = [{ metrics: { errorRate: { value: 5 } } }];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('error_spike');
    });

    it('QUEUE_BLOCKAGE：队列深度连续 > 60 时触发', async () => {
      const metrics = { queueDepth: { value: 70, status: 'danger' } };
      const history = [
        { metrics: { queueDepth: { value: 65 } } },
        { metrics: { queueDepth: { value: 68 } } },
        { metrics: { queueDepth: { value: 72 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).toContain('queue_blockage');
      expect(result.recommendations).toContain('increase_worker_capacity');
      expect(result.recommendations).toContain('prioritize_critical_tasks');
    });

    it('QUEUE_BLOCKAGE：有一个历史低于 60 时不触发', async () => {
      const metrics = { queueDepth: { value: 70 } };
      const history = [
        { metrics: { queueDepth: { value: 30 } } }, // 低于60
        { metrics: { queueDepth: { value: 65 } } },
        { metrics: { queueDepth: { value: 70 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.issues).not.toContain('queue_blockage');
    });

    it('多异常同时存在时，高严重程度优先', async () => {
      // 同时触发 HIGH_LOAD (high) 和 QUEUE_BLOCKAGE (medium)
      const metrics = {
        cpu: { value: 85, status: 'danger' },
        queueDepth: { value: 70, status: 'danger' }
      };
      const history = [
        { metrics: { cpu: { value: 75 }, queueDepth: { value: 65 } } },
        { metrics: { cpu: { value: 80 }, queueDepth: { value: 68 } } },
        { metrics: { cpu: { value: 82 }, queueDepth: { value: 70 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.severity).toBe('high');
      expect(result.issues.length).toBeGreaterThan(1);
    });

    it('摘要包含异常数量和名称', async () => {
      const metrics = { cpu: { value: 85, status: 'danger' } };
      const history = [
        { metrics: { cpu: { value: 75 } } },
        { metrics: { cpu: { value: 80 } } },
        { metrics: { cpu: { value: 82 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      expect(result.summary).toContain('持续高负载');
      expect(result.summary).toContain('1 个异常');
    });

    it('摘要包含危险指标值（memory danger 时）', async () => {
      const metrics = {
        cpu: { value: 85, status: 'normal' },
        memory: { value: 350, status: 'danger' }
      };
      const history = [
        { metrics: { cpu: { value: 75 } } },
        { metrics: { cpu: { value: 80 } } },
        { metrics: { cpu: { value: 82 } } }
      ];
      const result = await diagnoseProblem(metrics, history);
      if (result.patterns.length > 0) {
        expect(result.summary).toContain('内存 350MB');
      }
    });

    it('simplifyMetrics 只保留 value/status/unit', async () => {
      const metrics = {
        memory: { value: 100, status: 'normal', unit: 'MB', extraField: 'should-be-removed' }
      };
      const result = await diagnoseProblem(metrics, []);
      expect(result.metrics.memory).toHaveProperty('value', 100);
      expect(result.metrics.memory).toHaveProperty('status', 'normal');
      expect(result.metrics.memory).toHaveProperty('unit', 'MB');
      expect(result.metrics.memory).not.toHaveProperty('extraField');
    });
  });

  // ============================================================
  // getAnomalyPatterns
  // ============================================================

  describe('getAnomalyPatterns', () => {
    it('返回所有异常模式定义', () => {
      const patterns = getAnomalyPatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThanOrEqual(5);
    });

    it('每个模式包含必要字段', () => {
      const patterns = getAnomalyPatterns();
      for (const p of patterns) {
        expect(p).toHaveProperty('key');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('description');
        expect(p).toHaveProperty('severity');
      }
    });

    it('包含所有预定义的异常类型', () => {
      const patterns = getAnomalyPatterns();
      const keys = patterns.map(p => p.key);
      expect(keys).toContain('HIGH_LOAD');
      expect(keys).toContain('MEMORY_LEAK');
      expect(keys).toContain('RESPONSE_DEGRADATION');
      expect(keys).toContain('ERROR_SPIKE');
      expect(keys).toContain('QUEUE_BLOCKAGE');
    });

    it('severity 值只有合法枚举', () => {
      const validSeverities = ['low', 'medium', 'high', 'critical'];
      const patterns = getAnomalyPatterns();
      for (const p of patterns) {
        expect(validSeverities).toContain(p.severity);
      }
    });
  });
});
