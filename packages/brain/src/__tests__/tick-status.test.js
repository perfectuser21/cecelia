/**
 * Brain v2 Phase D2.4 — tick-status 单元测试。
 *
 * 覆盖：
 *   - getTickStatus 返回完整字段（enabled / loop_running / next_tick / quarantine 等）
 *   - isStale: 非 in_progress / 无 started_at / 超过阈值
 *   - getStartupErrors: 默认空 / 已存在
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external deps
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../executor.js', () => ({
  checkServerResources: () => ({ metrics: { max_pressure: 0.4 }, cpu_pct: 30, mem_used_mb: 100 }),
  MAX_SEATS: 9,
  INTERACTIVE_RESERVE: 2,
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({ total: 9, used: 0, available: 9 }),
}));

vi.mock('../circuit-breaker.js', () => ({
  getAllStates: () => ({}),
}));

vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: () => ({ level: 0, levelName: 'CALM' }),
}));

vi.mock('../quarantine.js', () => ({
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
}));

vi.mock('../tick-state.js', () => ({
  tickState: {
    loopTimer: null,
    recoveryTimer: null,
    tickRunning: false,
  },
}));

vi.mock('../drain.js', () => ({
  isDraining: () => false,
  getDrainStartedAt: () => null,
  isPostDrainCooldown: () => false,
}));

vi.mock('../tick-watchdog.js', () => ({
  isTickWatchdogActive: () => false,
}));

import { getTickStatus, isStale, getStartupErrors } from '../tick-status.js';

describe('tick-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── getTickStatus ────────────────────────────────────────
  describe('getTickStatus', () => {
    it('返回完整字段（enabled=true, loop_running, slot_budget 等）', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { key: 'tick_enabled', value_json: { enabled: true } },
          { key: 'tick_last', value_json: { timestamp: '2026-04-01T00:00:00Z' } },
          { key: 'tick_actions_today', value_json: { count: 5 } },
        ],
      });

      const status = await getTickStatus();
      expect(status.enabled).toBe(true);
      expect(status.loop_running).toBe(false); // mock loopTimer=null
      expect(status.tick_running).toBe(false);
      expect(status.actions_today).toBe(5);
      expect(status.last_tick).toBe('2026-04-01T00:00:00Z');
      expect(status.next_tick).toBeTruthy();
      expect(status.max_concurrent).toBe(9);
      expect(status.auto_dispatch_max).toBe(7); // 9 - 2
      expect(status.draining).toBe(false);
      expect(status.startup_ok).toBe(true);
      expect(status.startup_error_count).toBe(0);
      expect(status.tick_stats.total_executions).toBe(0);
    });

    it('startup_errors 存在时 startup_ok=false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { key: 'tick_enabled', value_json: { enabled: true } },
          { key: 'startup_errors', value_json: { total_failures: 3, errors: [] } },
        ],
      });
      const status = await getTickStatus();
      expect(status.startup_ok).toBe(false);
      expect(status.startup_error_count).toBe(3);
    });

    it('disabled 时 next_tick=null', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ key: 'tick_enabled', value_json: { enabled: false } }],
      });
      const status = await getTickStatus();
      expect(status.enabled).toBe(false);
      expect(status.next_tick).toBeNull();
    });
  });

  // ─── isStale ───────────────────────────────────────────────
  describe('isStale', () => {
    it('非 in_progress → false', () => {
      expect(isStale({ status: 'queued', started_at: '2020-01-01' })).toBe(false);
      expect(isStale({ status: 'completed' })).toBe(false);
    });

    it('无 started_at → false', () => {
      expect(isStale({ status: 'in_progress' })).toBe(false);
      expect(isStale({ status: 'in_progress', started_at: null })).toBe(false);
    });

    it('in_progress < 24h → false', () => {
      const recent = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      expect(isStale({ status: 'in_progress', started_at: recent })).toBe(false);
    });

    it('in_progress > 24h → true', () => {
      const old = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      expect(isStale({ status: 'in_progress', started_at: old })).toBe(true);
    });
  });

  // ─── getStartupErrors ─────────────────────────────────────
  describe('getStartupErrors', () => {
    it('无数据时返回默认空结构', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const r = await getStartupErrors();
      expect(r).toEqual({ errors: [], total_failures: 0, last_error_at: null });
    });

    it('有数据时返回解析结果', async () => {
      const data = {
        errors: [{ msg: 'oops' }],
        total_failures: 2,
        last_error_at: '2026-04-01T00:00:00Z',
      };
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: data }] });
      const r = await getStartupErrors();
      expect(r.total_failures).toBe(2);
      expect(r.errors).toHaveLength(1);
      expect(r.last_error_at).toBe('2026-04-01T00:00:00Z');
    });

    it('errors 字段非数组时返回空数组', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { errors: 'not-an-array', total_failures: 0 } }],
      });
      const r = await getStartupErrors();
      expect(r.errors).toEqual([]);
    });
  });
});
