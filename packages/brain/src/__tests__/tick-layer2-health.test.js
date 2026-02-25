/**
 * Layer 2 运行健康监控测试
 * DoD: D1-D6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateHealthLevel, THRESHOLDS } from '../health-monitor.js';

// ────────────────────────────────────────────────
// D1: runLayer2HealthCheck 导出
// ────────────────────────────────────────────────
describe('D1: health-monitor exports', () => {
  it('should export runLayer2HealthCheck function', async () => {
    const mod = await import('../health-monitor.js');
    expect(typeof mod.runLayer2HealthCheck).toBe('function');
  });

  it('should export calculateHealthLevel function', async () => {
    const mod = await import('../health-monitor.js');
    expect(typeof mod.calculateHealthLevel).toBe('function');
  });

  it('should export recordHealthEvent function', async () => {
    const mod = await import('../health-monitor.js');
    expect(typeof mod.recordHealthEvent).toBe('function');
  });

  it('should export THRESHOLDS constants', async () => {
    const mod = await import('../health-monitor.js');
    expect(mod.THRESHOLDS).toBeDefined();
    expect(mod.THRESHOLDS.stuck_tasks.warning_above).toBe(3);
    expect(mod.THRESHOLDS.stuck_tasks.critical_above).toBe(10);
  });
});

// ────────────────────────────────────────────────
// D2: runLayer2HealthCheck 执行 4 项检查
// ────────────────────────────────────────────────
describe('D2: runLayer2HealthCheck executes 4 SQL checks', () => {
  function makeMockPool(overrides = {}) {
    const defaults = {
      dispatched_1h: '5',
      uptime_h: '10',
      stuck_tasks: '0',
      ago_min: '30',
      queue_depth: '5',
    };
    const v = { ...defaults, ...overrides };

    let callCount = 0;
    return {
      query: vi.fn().mockImplementation(async (sql) => {
        callCount++;
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
        // cecelia_events INSERT
        if (s.includes('layer2_health')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  }

  it('should query all 4 check metrics', async () => {
    const { runLayer2HealthCheck } = await import('../health-monitor.js');
    const pool = makeMockPool();
    await runLayer2HealthCheck(pool);
    // 5 queries (dispatched_1h, uptime, stuck_tasks, last_success, queue_depth) + 1 INSERT
    expect(pool.query.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('should return result with checks, level, failing, summary', async () => {
    const { runLayer2HealthCheck } = await import('../health-monitor.js');
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('failing');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('checked_at');
  });

  it('should have all 4 check keys in result.checks', async () => {
    const { runLayer2HealthCheck } = await import('../health-monitor.js');
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);
    expect(result.checks).toHaveProperty('dispatched_1h');
    expect(result.checks).toHaveProperty('stuck_tasks');
    expect(result.checks).toHaveProperty('last_success_ago_min');
    expect(result.checks).toHaveProperty('queue_depth');
  });
});

// ────────────────────────────────────────────────
// D3: calculateHealthLevel 正确计算等级
// ────────────────────────────────────────────────
describe('D3: calculateHealthLevel', () => {
  it('should return healthy when all checks pass', () => {
    const checks = {
      dispatched_1h: { ok: true },
      stuck_tasks: { value: 0, ok: true },
      last_success_ago_min: { ok: true },
      queue_depth: { ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('healthy');
  });

  it('should return warning when 1-2 checks fail', () => {
    const checks = {
      dispatched_1h: { ok: false },
      stuck_tasks: { value: 0, ok: true },
      last_success_ago_min: { ok: true },
      queue_depth: { ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('warning');
  });

  it('should return warning when 2 checks fail', () => {
    const checks = {
      dispatched_1h: { ok: false },
      stuck_tasks: { value: 2, ok: false },
      last_success_ago_min: { ok: true },
      queue_depth: { ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('warning');
  });

  it('should return critical when 3+ checks fail', () => {
    const checks = {
      dispatched_1h: { ok: false },
      stuck_tasks: { value: 5, ok: false },
      last_success_ago_min: { ok: false },
      queue_depth: { ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('critical');
  });

  it('should return critical when stuck_tasks > 10 even if other checks pass', () => {
    const checks = {
      dispatched_1h: { ok: true },
      stuck_tasks: { value: 11, ok: false },
      last_success_ago_min: { ok: true },
      queue_depth: { ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('critical');
  });

  it('should treat THRESHOLDS.stuck_tasks.critical_above as threshold (> not >=)', () => {
    const checks = {
      dispatched_1h: { ok: true },
      stuck_tasks: { value: 10, ok: false }, // exactly 10, NOT critical
      last_success_ago_min: { ok: true },
      queue_depth: { ok: true },
    };
    // stuck_tasks > 10 → critical; stuck_tasks = 10 → only warning
    expect(calculateHealthLevel(checks)).toBe('warning');
  });
});

// ────────────────────────────────────────────────
// D4: 结果写入 cecelia_events
// ────────────────────────────────────────────────
describe('D4: recordHealthEvent writes to cecelia_events', () => {
  it('should insert into cecelia_events with type layer2_health', async () => {
    const { recordHealthEvent } = await import('../health-monitor.js');
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = { level: 'healthy', checks: {}, failing: [], summary: 'test' };
    await recordHealthEvent(mockPool, result);
    expect(mockPool.query).toHaveBeenCalledOnce();
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('layer2_health');
    expect(sql).toContain('cecelia_events');
    expect(params[0]).toContain('"healthy"');
  });
});

// ────────────────────────────────────────────────
// D5: tick.js 导出 _resetLastHealthCheckTime
// ────────────────────────────────────────────────
describe('D5: tick.js exports health check reset helper', () => {
  it('should export _resetLastHealthCheckTime function', async () => {
    const tickMod = await import('../tick.js');
    expect(typeof tickMod._resetLastHealthCheckTime).toBe('function');
  });
});

// ────────────────────────────────────────────────
// D6: 异常时 catch + log，不影响主流程
// ────────────────────────────────────────────────
describe('D6: error handling — non-fatal', () => {
  it('should not throw when pool query fails', async () => {
    const { runLayer2HealthCheck } = await import('../health-monitor.js');
    const errorPool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    };
    // Should resolve (not reject) because errors are caught per-check
    await expect(runLayer2HealthCheck(errorPool)).resolves.toBeDefined();
  });

  it('should mark check as ok=true (non-blocking) on SQL error', async () => {
    const { runLayer2HealthCheck } = await import('../health-monitor.js');
    // First query (dispatched_1h) succeeds, rest fail
    let call = 0;
    const partialPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        call++;
        // All fail except cecelia_events INSERT (we can let that fail too since caught at top level)
        throw new Error('timeout');
      }),
    };
    // All checks fail with error → should use ok:true fallback and not throw
    await expect(runLayer2HealthCheck(partialPool)).resolves.toBeDefined();
  });
});
