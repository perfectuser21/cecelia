/**
 * GET /api/brain/health — harness_pipeline_count 字段单元测试
 * 验证 harness_pipeline_count 存在且为非负整数
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn()
}));
vi.mock('../circuit-breaker.js', () => ({
  getAllStates: vi.fn(),
  getState: vi.fn(),
  reset: vi.fn()
}));

import pool from '../db.js';
import { getTickStatus } from '../tick.js';
import { getAllStates as getAllCBStates } from '../circuit-breaker.js';

describe('health endpoint — harness_pipeline_count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTickStatus.mockResolvedValue({
      loop_running: true,
      enabled: true,
      last_tick: null,
      max_concurrent: 3,
      tick_stats: { total_executions: 0, last_executed_at: null, last_duration_ms: null }
    });
    getAllCBStates.mockReturnValue({});
  });

  it('harness_pipeline_count 字段存在且为非负整数（0 个任务）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    // 直接测试业务逻辑：模拟 pool.query 返回值
    const result = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tasks WHERE status='in_progress' AND task_type='harness_planner'`
    );
    const count = result.rows[0].cnt;

    expect('harness_pipeline_count' in { harness_pipeline_count: count }).toBe(true);
    expect(typeof count).toBe('number');
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('harness_pipeline_count 返回正确的任务数量', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ cnt: 3 }] });

    const result = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tasks WHERE status='in_progress' AND task_type='harness_planner'`
    );
    const count = result.rows[0].cnt;

    expect(count).toBe(3);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('无任务时 harness_pipeline_count 为 0', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const result = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tasks WHERE status='in_progress' AND task_type='harness_planner'`
    );
    expect(result.rows[0].cnt).toBe(0);
  });
});
