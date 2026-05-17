/**
 * selectNextDispatchableTask — claimed_by IS NULL 过滤测试
 *
 * 背景：PR #2389（C1）加了 claimed_by / claimed_at 列 + 原子 claim 逻辑。
 * 但 selectNextDispatchableTask 的 SELECT WHERE 没加 claimed_by IS NULL 过滤，
 * 会返回已被别的 runner claim 的任务，浪费一轮 pre-flight；
 * 更严重的是 claim 残留的任务永远不会被后续 tick 重新选中。
 *
 * 本测试拦截 pool.query，断言 selectNextDispatchableTask 发出的 SELECT SQL
 * 字符串包含 `t.claimed_by IS NULL`。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦截 pool.query —— 仅用于捕获 SQL 字符串
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// 避免 selectNextDispatchableTask 内部 dynamic import 被真实加载
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

// task-weight 需 stub（sortTasksByWeight 默认按原顺序返回）
vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn((rows) => rows)
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('selectNextDispatchableTask — claimed_by 过滤', () => {
  it('SELECT SQL 应含 AND t.claimed_by IS NULL（防止返回已 claim 任务）', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    // 传入正常 goalIds，触发主 SELECT
    await selectNextDispatchableTask(['goal-uuid-1']);

    // 第一条 pool.query 调用即 selectNextDispatchableTask 主查询
    expect(mockQuery).toHaveBeenCalled();
    const firstCallSql = mockQuery.mock.calls[0][0];

    expect(firstCallSql).toContain("t.status = 'queued'");
    expect(firstCallSql).toContain('t.claimed_by IS NULL');
  });

  it('goalIds=null（无 goal 过滤）时 SQL 仍含 claimed_by IS NULL', async () => {
    const { selectNextDispatchableTask } = await import('../tick.js');

    await selectNextDispatchableTask(null);

    const firstCallSql = mockQuery.mock.calls[0][0];
    expect(firstCallSql).toContain('t.claimed_by IS NULL');
  });
});
