/**
 * Tests for quota_exhausted status: should not trigger FAILURE_THRESHOLD quarantine logic
 *
 * Design: quota_exhausted tasks ran out of API quota — not a task failure.
 * They must not increment failure_count or trigger quarantine.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock db.js so this test can run without PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

let shouldQuarantineOnFailure;
let handleTaskFailure;
let pool;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  shouldQuarantineOnFailure = mod.shouldQuarantineOnFailure;
  handleTaskFailure = mod.handleTaskFailure;
  pool = (await import('../db.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shouldQuarantineOnFailure — quota_exhausted', () => {
  it('返回 shouldQuarantine=false 当 task.status 为 quota_exhausted', async () => {
    const task = {
      id: 'test-id',
      status: 'quota_exhausted',
      payload: { failure_count: 2 }, // 已有 2 次失败，但 status 是 quota_exhausted
    };
    const result = await shouldQuarantineOnFailure(task);
    expect(result.shouldQuarantine).toBe(false);
  });

  it('正常触发隔离：failed 状态且 failure_count >= FAILURE_THRESHOLD', async () => {
    const task = {
      id: 'test-id',
      status: 'failed',
      payload: { failure_count: 2 }, // 2 + 1 = 3 >= FAILURE_THRESHOLD(3)
    };
    const result = await shouldQuarantineOnFailure(task);
    expect(result.shouldQuarantine).toBe(true);
  });

  it('不隔离：failed 状态但 failure_count 未达阈值', async () => {
    const task = {
      id: 'test-id',
      status: 'failed',
      payload: { failure_count: 1 }, // 1 + 1 = 2 < 3
    };
    const result = await shouldQuarantineOnFailure(task);
    expect(result.shouldQuarantine).toBe(false);
  });
});

describe('handleTaskFailure — quota_exhausted 早返回', () => {
  it('quota_exhausted 任务不增加 failure_count，直接返回 skipped', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-1', status: 'quota_exhausted', payload: { failure_count: 0 } }],
    });

    const result = await handleTaskFailure('task-1');

    expect(result.quarantined).toBe(false);
    expect(result.skipped).toBe('quota_exhausted');

    // 不应执行任何 UPDATE（failure_count 不增加）
    const updateCalls = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updateCalls.length).toBe(0);
  });
});
