/**
 * Tests for ACTIVE-CHECKPOINT guard in handleTaskFailure.
 *
 * 背景：shepherd/handleTaskFailure 在每个 tick 扫历史失败 >= N 的 task 并隔离。
 * 问题：docker 容器里正在跑的 task（checkpoints 表里有活跃记录）也被误判隔离。
 *
 * 修复：handleTaskFailure 先查 checkpoints 表，如果该 task 仍在活跃运行，
 * 直接返回 skipped_active=true，不累计失败也不隔离。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock db.js so this test can run without PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

let handleTaskFailure;
let hasActiveCheckpoint;
let pool;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
  hasActiveCheckpoint = mod.hasActiveCheckpoint;
  pool = (await import('../db.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasActiveCheckpoint', () => {
  it('返回 true 当 checkpoints 表中存在该 task 的记录', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await hasActiveCheckpoint('task-1');
    expect(result).toBe(true);
    // 验证调用了 checkpoints 表
    const calls = pool.query.mock.calls;
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toContain('checkpoints');
    expect(calls[0][1]).toEqual(['task-1']);
  });

  it('返回 false 当 checkpoints 表中没有该 task 的记录', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await hasActiveCheckpoint('task-2');
    expect(result).toBe(false);
  });

  it('查询异常时安全返回 false（不阻塞主流程）', async () => {
    pool.query.mockRejectedValueOnce(new Error('checkpoints table missing'));
    const result = await hasActiveCheckpoint('task-3');
    expect(result).toBe(false);
  });
});

describe('handleTaskFailure — active checkpoint 守卫', () => {
  it('活跃任务（checkpoints 有行）不隔离、不累加 failure_count', async () => {
    // 第一次 query = hasActiveCheckpoint → 返回有行
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await handleTaskFailure('task-active-001');

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBe(true);
    expect(result.failure_count).toBe(0);

    // 只有 1 次 query（checkpoints 查询），没有后续 SELECT tasks / UPDATE
    expect(pool.query.mock.calls.length).toBe(1);
    expect(String(pool.query.mock.calls[0][0])).toContain('checkpoints');
  });

  it('非活跃任务（checkpoints 无行）会进入正常失败处理流程', async () => {
    // checkpoints 查询：无行
    pool.query.mockResolvedValueOnce({ rows: [] });
    // hasActivePr 查询：pr_url=NULL 无活跃 PR
    pool.query.mockResolvedValueOnce({ rows: [{ pr_url: null, pr_status: null }] });
    // SELECT tasks 返回一个空 failure_count 的 task（首次失败）
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-idle-002',
        status: 'failed',
        payload: { failure_count: 0 },
      }],
    });
    // UPDATE tasks（failure_count + failure_classification）
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleTaskFailure('task-idle-002');

    // 首次失败（count 1 < 阈值 3）：不隔离、不是 active skip
    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBeUndefined();
    expect(result.failure_count).toBe(1);

    // 至少有 1 次 UPDATE（失败计数）
    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('skipCount=true 时 active 守卫仍优先生效（双保险）', async () => {
    // 当前实现下，active 守卫在 skipCount 之前。
    // 若 task 活跃，skipCount 的 requeue 也不执行（不触碰 status）。
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await handleTaskFailure('task-active-003', { skipCount: true });

    expect(result.skipped_active).toBe(true);
    expect(pool.query.mock.calls.length).toBe(1);
  });
});
