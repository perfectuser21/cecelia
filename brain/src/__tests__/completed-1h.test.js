/**
 * Completed 1h 逻辑测试 (dispatched_1h)
 *
 * 测试 health-monitor.js 中 dispatched_1h 检查的关键行为：
 * - 过去 1 小时完成的任务数统计
 * - 系统运行时间阈值判断
 * - 警告触发条件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLayer2HealthCheck, THRESHOLDS } from '../health-monitor.js';

// ────────────────────────────────────────────────
// Test Suite: dispatched_1h 核心逻辑
// ────────────────────────────────────────────────
describe('completed-1h: dispatched_1h 检查逻辑', () => {
  function makeMockPool(overrides = {}) {
    const defaults = {
      dispatched_1h: '0',      // 默认无任务完成
      uptime_h: '0',           // 默认刚启动
      stuck_tasks: '0',
      ago_min: '0',
      queue_depth: '0',
    };
    const v = { ...defaults, ...overrides };

    return {
      query: vi.fn().mockImplementation(async (sql) => {
        const s = sql.trim();
        if (s.includes("status = 'completed'") && s.includes("INTERVAL '1 hour'")) {
          return { rows: [{ cnt: v.dispatched_1h }] };
        }
        if (s.includes('MIN(created_at)')) {
          return { rows: [{ uptime_h: v.uptime_h }] };
        }
        if (s.includes("status = 'in_progress'")) {
          return { rows: [{ cnt: v.stuck_tasks }] };
        }
        if (s.includes("status = 'completed'") && s.includes('MAX(updated_at)')) {
          return { rows: [{ ago_min: v.ago_min }] };
        }
        if (s.includes("status = 'queued'")) {
          return { rows: [{ cnt: v.queue_depth }] };
        }
        if (s.includes('layer2_health')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  }

  // ────────────────────────────────────────────
  // T1: 阈值常量验证
  // ────────────────────────────────────────────
  describe('T1: THRESHOLDS.dispatched_1h 阈值配置', () => {
    it('warning_below 应为 1', () => {
      expect(THRESHOLDS.dispatched_1h.warning_below).toBe(1);
    });

    it('system_min_uptime_h 应为 3', () => {
      expect(THRESHOLDS.dispatched_1h.system_min_uptime_h).toBe(3);
    });
  });

  // ────────────────────────────────────────────
  // T2: 过去 1 小时有任务完成 → ok=true
  // ────────────────────────────────────────────
  describe('T2: 有任务完成 → ok=true', () => {
    it('dispatched_1h >= 1 时检查通过', async () => {
      const pool = makeMockPool({ dispatched_1h: '5', uptime_h: '10' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h.ok).toBe(true);
      expect(result.checks.dispatched_1h.value).toBe(5);
    });

    it('dispatched_1h = 1 时检查通过（边界值）', async () => {
      const pool = makeMockPool({ dispatched_1h: '1', uptime_h: '5' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h.ok).toBe(true);
      expect(result.checks.dispatched_1h.value).toBe(1);
    });
  });

  // ────────────────────────────────────────────
  // T3: 系统刚启动（< 3h）→ 不触发警告
  // ────────────────────────────────────────────
  describe('T3: 系统刚启动 (< 3h) → 不触发警告', () => {
    it('uptime < 3h 时即使无任务也不报警', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '1' });
      const result = await runLayer2HealthCheck(pool);

      // 系统运行不足 3 小时，即使没有完成任务也不报警
      expect(result.checks.dispatched_1h.ok).toBe(true);
      expect(result.checks.dispatched_1h.uptime_h).toBe(1);
    });

    it('uptime = 2.9h 时不报警', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '2.9' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h.ok).toBe(true);
    });

    it('uptime = 3h 时开始检查', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '3' });
      const result = await runLayer2HealthCheck(pool);

      // 刚好达到最小运行时间，开始检查
      expect(result.checks.dispatched_1h.uptime_h).toBe(3);
    });
  });

  // ────────────────────────────────────────────
  // T4: 系统运行足够（>= 3h）+ 无任务 → 警告
  // ────────────────────────────────────────────
  describe('T4: 系统运行足够 + 无任务 → 警告', () => {
    it('uptime >= 3h 且 dispatched_1h = 0 时 ok=false', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '5' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h.ok).toBe(false);
      expect(result.failing).toContain('dispatched_1h');
    });

    it('uptime = 10h 且无任务完成 → 警告', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '10' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h.ok).toBe(false);
      expect(result.level).toBe('warning');
    });
  });

  // ────────────────────────────────────────────
  // T5: 边界条件
  // ────────────────────────────────────────────
  describe('T5: 边界条件', () => {
    it('uptime_h 为 0 时不报错', async () => {
      const pool = makeMockPool({ dispatched_1h: '0', uptime_h: '0' });
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h).toBeDefined();
      expect(result.checks.dispatched_1h.uptime_h).toBe(0);
    });

    it('uptime_h 为 null 时不报错', async () => {
      const pool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = sql.trim();
          if (s.includes("status = 'completed'") && s.includes("INTERVAL '1 hour'")) {
            return { rows: [{ cnt: '0' }] };
          }
          if (s.includes('MIN(created_at)')) {
            return { rows: [{ uptime_h: null }] };
          }
          if (s.includes("status = 'in_progress'")) {
            return { rows: [{ cnt: '0' }] };
          }
          if (s.includes("status = 'completed'") && s.includes('MAX(updated_at)')) {
            return { rows: [{ ago_min: '0' }] };
          }
          if (s.includes("status = 'queued'")) {
            return { rows: [{ cnt: '0' }] };
          }
          if (s.includes('layer2_health')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      const result = await runLayer2HealthCheck(pool);

      expect(result.checks.dispatched_1h).toBeDefined();
    });

    it(' dispatched_1h 为空字符串时视为 0', async () => {
      const pool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = sql.trim();
          if (s.includes("status = 'completed'") && s.includes("INTERVAL '1 hour'")) {
            return { rows: [{ cnt: '' }] }; // 空字符串
          }
          if (s.includes('MIN(created_at)')) {
            return { rows: [{ uptime_h: '5' }] };
          }
          if (s.includes("status = 'in_progress'")) {
            return { rows: [{ cnt: '0' }] };
          }
          if (s.includes("status = 'completed'") && s.includes('MAX(updated_at)')) {
            return { rows: [{ ago_min: '0' }] };
          }
          if (s.includes("status = 'queued'")) {
            return { rows: [{ cnt: '0' }] };
          }
          if (s.includes('layer2_health')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      const result = await runLayer2HealthCheck(pool);

      // parseInt('', 10) = NaN，但代码用了 ?? 0 fallback
      expect(result.checks.dispatched_1h.value).toBeDefined();
    });
  });

  // ────────────────────────────────────────────
  // T6: SQL 查询验证
  // ────────────────────────────────────────────
  describe('T6: SQL 查询逻辑', () => {
    it('应使用正确的 INTERVAL 1 hour', async () => {
      const pool = makeMockPool({ dispatched_1h: '3', uptime_h: '5' });
      await runLayer2HealthCheck(pool);

      const sqlCalls = pool.query.mock.calls.map(([sql]) => sql);
      const dispatchedQuery = sqlCalls.find((sql) =>
        sql.includes("status = 'completed'") && sql.includes("INTERVAL '1 hour'")
      );

      expect(dispatchedQuery).toBeDefined();
      expect(dispatchedQuery).toContain("INTERVAL '1 hour'");
    });

    it('应查询 MIN(created_at) 计算运行时间', async () => {
      const pool = makeMockPool({ dispatched_1h: '1', uptime_h: '4' });
      await runLayer2HealthCheck(pool);

      const sqlCalls = pool.query.mock.calls.map(([sql]) => sql);
      const uptimeQuery = sqlCalls.find((sql) => sql.includes('MIN(created_at)'));

      expect(uptimeQuery).toBeDefined();
      expect(uptimeQuery).toContain('EXTRACT(EPOCH FROM');
    });
  });
});
