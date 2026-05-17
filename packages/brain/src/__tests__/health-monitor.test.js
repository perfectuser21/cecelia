/**
 * Health Monitor 单元测试 (mock pool — 不需要真实数据库)
 *
 * 覆盖 health-monitor.js 的所有导出：
 *   - runLayer2HealthCheck
 *   - calculateHealthLevel
 *   - recordHealthEvent
 *   - THRESHOLDS
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runLayer2HealthCheck,
  calculateHealthLevel,
  recordHealthEvent,
  THRESHOLDS,
} from '../health-monitor.js';

// ─── Mock Pool 工厂 ──────────────────────────────────────────

/**
 * 创建 mock pool，每次 query 根据 SQL 内容返回对应的模拟数据。
 * overrides 可以覆盖默认返回值或注入 Error。
 */
function makeMockPool(overrides = {}) {
  const defaults = {
    // Check 1: dispatched_1h — 过去1小时完成任务数
    dispatched_1h_cnt: { rows: [{ cnt: '5' }] },
    // Check 1 附属: 系统运行时间
    uptime_h: { rows: [{ uptime_h: '10' }] },
    // Check 2: stuck_tasks
    stuck_tasks_cnt: { rows: [{ cnt: '0' }] },
    // Check 3: last_success_ago_min
    last_success_ago: { rows: [{ ago_min: 30 }] },
    // Check 4: queue_depth
    queue_depth_cnt: { rows: [{ cnt: '10' }] },
    // recordHealthEvent INSERT
    insert: { rows: [] },
  };

  const merged = { ...defaults, ...overrides };

  return {
    query: vi.fn(async (sql, params) => {
      // Check 1: dispatched_1h（包含 '1 hour' 的 completed 查询）
      if (sql.includes("status = 'completed'") && sql.includes('1 hour')) {
        if (merged.dispatched_1h_cnt instanceof Error) throw merged.dispatched_1h_cnt;
        return merged.dispatched_1h_cnt;
      }
      // Check 1 附属: uptime 查询
      if (sql.includes('EXTRACT(EPOCH') && sql.includes('MIN(created_at)')) {
        if (merged.uptime_h instanceof Error) throw merged.uptime_h;
        return merged.uptime_h;
      }
      // Check 2: stuck_tasks
      if (sql.includes("status = 'in_progress'") && sql.includes('2 hours')) {
        if (merged.stuck_tasks_cnt instanceof Error) throw merged.stuck_tasks_cnt;
        return merged.stuck_tasks_cnt;
      }
      // Check 3: last_success_ago_min
      if (sql.includes('MAX(updated_at)') && sql.includes("status = 'completed'")) {
        if (merged.last_success_ago instanceof Error) throw merged.last_success_ago;
        return merged.last_success_ago;
      }
      // Check 4: queue_depth
      if (sql.includes("status = 'queued'")) {
        if (merged.queue_depth_cnt instanceof Error) throw merged.queue_depth_cnt;
        return merged.queue_depth_cnt;
      }
      // INSERT（recordHealthEvent）
      if (sql.includes('INSERT')) {
        if (merged.insert instanceof Error) throw merged.insert;
        return merged.insert;
      }
      return { rows: [] };
    }),
  };
}

// ─── THRESHOLDS 常量测试 ─────────────────────────────────────

describe('THRESHOLDS', () => {
  it('应该导出所有阈值配置', () => {
    expect(THRESHOLDS).toBeDefined();
    expect(THRESHOLDS.dispatched_1h).toEqual({ warning_below: 1, system_min_uptime_h: 3 });
    expect(THRESHOLDS.stuck_tasks).toEqual({ warning_above: 3, critical_above: 10 });
    expect(THRESHOLDS.last_success_ago_min).toEqual({ warning_above: 360 });
    expect(THRESHOLDS.queue_depth).toEqual({ warning_above: 50 });
  });
});

// ─── calculateHealthLevel 测试 ───────────────────────────────

describe('calculateHealthLevel', () => {
  it('所有检查通过时返回 healthy', () => {
    const checks = {
      dispatched_1h: { value: 5, ok: true },
      stuck_tasks: { value: 0, ok: true },
      last_success_ago_min: { value: 30, ok: true },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('healthy');
  });

  it('1 项检查失败时返回 warning', () => {
    const checks = {
      dispatched_1h: { value: 0, ok: false },
      stuck_tasks: { value: 0, ok: true },
      last_success_ago_min: { value: 30, ok: true },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('warning');
  });

  it('2 项检查失败时返回 warning', () => {
    const checks = {
      dispatched_1h: { value: 0, ok: false },
      stuck_tasks: { value: 2, ok: true },
      last_success_ago_min: { value: 500, ok: false },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('warning');
  });

  it('3 项或更多检查失败时返回 critical', () => {
    const checks = {
      dispatched_1h: { value: 0, ok: false },
      stuck_tasks: { value: 5, ok: false },
      last_success_ago_min: { value: 500, ok: false },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('critical');
  });

  it('stuck_tasks 超过 critical 阈值时返回 critical（即使 failCount < 3）', () => {
    const checks = {
      dispatched_1h: { value: 5, ok: true },
      stuck_tasks: { value: 11, ok: false },
      last_success_ago_min: { value: 30, ok: true },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('critical');
  });

  it('stuck_tasks 正好等于 critical 阈值时不触发 critical', () => {
    // stuck > 10 才是 critical，等于 10 不是
    const checks = {
      dispatched_1h: { value: 5, ok: true },
      stuck_tasks: { value: 10, ok: false },
      last_success_ago_min: { value: 30, ok: true },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('warning');
  });

  it('stuck_tasks 为 undefined 时默认为 0', () => {
    const checks = {
      dispatched_1h: { value: 5, ok: true },
      // stuck_tasks 缺失
      last_success_ago_min: { value: 30, ok: true },
      queue_depth: { value: 10, ok: true },
    };
    expect(calculateHealthLevel(checks)).toBe('healthy');
  });
});

// ─── recordHealthEvent 测试 ──────────────────────────────────

describe('recordHealthEvent', () => {
  it('应该将健康检查结果写入 cecelia_events 表', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const result = {
      level: 'healthy',
      checks: {},
      failing: [],
      summary: 'Layer2Health: healthy (0 issues: none)',
      checked_at: new Date().toISOString(),
    };

    await recordHealthEvent(pool, result);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO cecelia_events');
    expect(sql).toContain('layer2_health');
    expect(sql).toContain('brain_health_monitor');
    expect(params).toHaveLength(1);
    expect(JSON.parse(params[0])).toEqual(result);
  });

  it('数据库写入失败时应抛出错误', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('DB write failed'); }) };
    const result = { level: 'healthy', checks: {} };

    await expect(recordHealthEvent(pool, result)).rejects.toThrow('DB write failed');
  });
});

// ─── runLayer2HealthCheck 集成测试 ───────────────────────────

describe('runLayer2HealthCheck', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // --- 正常场景 ---

  it('所有检查通过时应返回 healthy', async () => {
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);

    expect(result.level).toBe('healthy');
    expect(result.failing).toEqual([]);
    expect(result.summary).toContain('healthy');
    expect(result.summary).toContain('0 issues');
    expect(result.checked_at).toBeDefined();
  });

  it('结果应包含所有 4 个检查项', async () => {
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.dispatched_1h).toBeDefined();
    expect(result.checks.stuck_tasks).toBeDefined();
    expect(result.checks.last_success_ago_min).toBeDefined();
    expect(result.checks.queue_depth).toBeDefined();
  });

  // --- dispatched_1h 场景 ---

  it('系统运行时间足够但无完成任务时应报 warning', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: { rows: [{ cnt: '0' }] },
      uptime_h: { rows: [{ uptime_h: '10' }] }, // 运行 > 3 小时
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.dispatched_1h.ok).toBe(false);
    expect(result.checks.dispatched_1h.value).toBe(0);
    expect(result.failing).toContain('dispatched_1h');
  });

  it('系统运行时间不足时即使无完成任务也不报 warning', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: { rows: [{ cnt: '0' }] },
      uptime_h: { rows: [{ uptime_h: '1' }] }, // 运行 < 3 小时
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.dispatched_1h.ok).toBe(true);
    expect(result.checks.dispatched_1h.value).toBe(0);
  });

  it('dispatched_1h 应包含 uptime_h 信息（四舍五入到一位小数）', async () => {
    const pool = makeMockPool({
      uptime_h: { rows: [{ uptime_h: '5.678' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.dispatched_1h.uptime_h).toBe(5.7);
  });

  it('dispatched_1h 查询出错时 ok 应为 true（non-blocking）', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: new Error('query timeout'),
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.dispatched_1h.ok).toBe(true);
    expect(result.checks.dispatched_1h.error).toBe('query timeout');
  });

  // --- stuck_tasks 场景 ---

  it('stuck_tasks 超过 warning 阈值时应报 warning', async () => {
    const pool = makeMockPool({
      stuck_tasks_cnt: { rows: [{ cnt: '5' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.stuck_tasks.ok).toBe(false);
    expect(result.checks.stuck_tasks.value).toBe(5);
    expect(result.failing).toContain('stuck_tasks');
  });

  it('stuck_tasks 等于 warning 阈值时不报 warning', async () => {
    const pool = makeMockPool({
      stuck_tasks_cnt: { rows: [{ cnt: '3' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.stuck_tasks.ok).toBe(true);
  });

  it('stuck_tasks 查询出错时 ok 应为 true（non-blocking）', async () => {
    const pool = makeMockPool({
      stuck_tasks_cnt: new Error('connection lost'),
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.stuck_tasks.ok).toBe(true);
    expect(result.checks.stuck_tasks.error).toBe('connection lost');
  });

  // --- last_success_ago_min 场景 ---

  it('距上次成功过久时应报 warning', async () => {
    const pool = makeMockPool({
      last_success_ago: { rows: [{ ago_min: 500 }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.last_success_ago_min.ok).toBe(false);
    expect(result.checks.last_success_ago_min.value).toBe(500);
    expect(result.failing).toContain('last_success_ago_min');
  });

  it('距上次成功刚好等于阈值时不报 warning', async () => {
    const pool = makeMockPool({
      last_success_ago: { rows: [{ ago_min: 360 }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.last_success_ago_min.ok).toBe(true);
  });

  it('没有任何已完成任务时（ago_min 为 null）不报 warning', async () => {
    const pool = makeMockPool({
      last_success_ago: { rows: [{ ago_min: null }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.last_success_ago_min.ok).toBe(true);
    expect(result.checks.last_success_ago_min.value).toBe(null);
  });

  it('last_success_ago_min 查询出错时 ok 应为 true（non-blocking）', async () => {
    const pool = makeMockPool({
      last_success_ago: new Error('relation does not exist'),
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.last_success_ago_min.ok).toBe(true);
    expect(result.checks.last_success_ago_min.error).toBe('relation does not exist');
  });

  // --- queue_depth 场景 ---

  it('队列深度超过阈值时应报 warning', async () => {
    const pool = makeMockPool({
      queue_depth_cnt: { rows: [{ cnt: '60' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.queue_depth.ok).toBe(false);
    expect(result.checks.queue_depth.value).toBe(60);
    expect(result.failing).toContain('queue_depth');
  });

  it('队列深度等于阈值时不报 warning', async () => {
    const pool = makeMockPool({
      queue_depth_cnt: { rows: [{ cnt: '50' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.queue_depth.ok).toBe(true);
  });

  it('queue_depth 查询出错时 ok 应为 true（non-blocking）', async () => {
    const pool = makeMockPool({
      queue_depth_cnt: new Error('too many connections'),
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.checks.queue_depth.ok).toBe(true);
    expect(result.checks.queue_depth.error).toBe('too many connections');
  });

  // --- 组合场景 ---

  it('多项异常时应正确汇总 failing 列表', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: { rows: [{ cnt: '0' }] },
      uptime_h: { rows: [{ uptime_h: '10' }] },
      stuck_tasks_cnt: { rows: [{ cnt: '5' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.failing).toContain('dispatched_1h');
    expect(result.failing).toContain('stuck_tasks');
    expect(result.failing).toHaveLength(2);
    expect(result.level).toBe('warning');
  });

  it('stuck_tasks 超 critical 阈值时整体应为 critical', async () => {
    const pool = makeMockPool({
      stuck_tasks_cnt: { rows: [{ cnt: '15' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.level).toBe('critical');
  });

  it('3 项及以上异常时整体应为 critical', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: { rows: [{ cnt: '0' }] },
      uptime_h: { rows: [{ uptime_h: '10' }] },
      stuck_tasks_cnt: { rows: [{ cnt: '5' }] },
      last_success_ago: { rows: [{ ago_min: 500 }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.level).toBe('critical');
    expect(result.failing).toHaveLength(3);
  });

  // --- recordHealthEvent 集成 ---

  it('应该调用 recordHealthEvent 写入结果', async () => {
    const pool = makeMockPool();
    await runLayer2HealthCheck(pool);

    // 验证 INSERT 被调用了
    const insertCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT'));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0]).toContain('cecelia_events');
  });

  it('recordHealthEvent 失败时不影响主流程（non-fatal）', async () => {
    const pool = makeMockPool({
      insert: new Error('disk full'),
    });
    const result = await runLayer2HealthCheck(pool);

    // 主结果仍然返回正常
    expect(result.level).toBe('healthy');
    expect(result.checks).toBeDefined();
    // console.error 被调用
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[health-monitor]'),
      expect.stringContaining('disk full')
    );
  });

  // --- summary 格式 ---

  it('summary 应包含 level 和 issues 数量', async () => {
    const pool = makeMockPool({
      stuck_tasks_cnt: { rows: [{ cnt: '5' }] },
    });
    const result = await runLayer2HealthCheck(pool);

    expect(result.summary).toMatch(/^Layer2Health: warning \(1 issues: stuck_tasks\)$/);
  });

  it('无异常时 summary 应显示 none', async () => {
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);

    expect(result.summary).toMatch(/^Layer2Health: healthy \(0 issues: none\)$/);
  });

  // --- 边界值 ---

  it('rows 为空时 cnt 默认为 0', async () => {
    const pool = makeMockPool({
      dispatched_1h_cnt: { rows: [{}] },
      stuck_tasks_cnt: { rows: [{}] },
      queue_depth_cnt: { rows: [{}] },
    });
    const result = await runLayer2HealthCheck(pool);

    // cnt 为 undefined 时 ?? 0 → parseInt('0') = 0
    expect(result.checks.stuck_tasks.value).toBe(0);
    expect(result.checks.queue_depth.value).toBe(0);
  });

  it('checked_at 应为有效的 ISO 时间字符串', async () => {
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);

    expect(() => new Date(result.checked_at)).not.toThrow();
    expect(new Date(result.checked_at).toISOString()).toBe(result.checked_at);
  });
});
