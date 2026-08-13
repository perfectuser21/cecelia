/**
 * ci-patrol-scheduler.test.js
 * ci_patrol 调度器单元测试（从 daily-review-scheduler.test.js 搬出——
 * 该文件被 vitest.config.js exclude，导致这些测试永远不会被 CI 执行）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isInCiPatrolWindow,
  hasTodayCiPatrol,
  triggerCiPatrol,
} from '../daily-review-scheduler.js';

// ── ci_patrol 调度（每日北京 08:00 = UTC 00:00）─────────────────────────────
describe('isInCiPatrolWindow', () => {
  it('UTC 00:00-00:04 在窗口内', () => {
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:00:00Z'))).toBe(true);
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:04:59Z'))).toBe(true);
  });
  it('UTC 00:05 及其他小时不在窗口', () => {
    expect(isInCiPatrolWindow(new Date('2026-07-09T00:05:00Z'))).toBe(false);
    expect(isInCiPatrolWindow(new Date('2026-07-09T08:00:00Z'))).toBe(false);
  });
});

describe('hasTodayCiPatrol', () => {
  it('当天已有 ci_patrol 任务返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1' }] }) };
    expect(await hasTodayCiPatrol(pool)).toBe(true);
    expect(pool.query.mock.calls[0][0]).toContain("task_type = 'ci_patrol'");
  });
  it('当天没有返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(await hasTodayCiPatrol(pool)).toBe(false);
  });
});

describe('triggerCiPatrol', () => {
  it('窗口外直接跳过，不查库', async () => {
    const pool = { query: vi.fn() };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T12:00:00Z'));
    expect(r).toEqual({ triggered: false, skipped_window: true, skipped_recent: false });
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('当日已有则去重跳过', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1' }] }) };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'));
    expect(r).toEqual({ triggered: false, skipped_window: false, skipped_recent: true });
  });
  it('窗口内且无当日任务 → INSERT 正确字段', async () => {
    const createTask = vi.fn(async (input) => ({ task: { id: 'new-task-id', ...input } }));
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                    // hasTodayCiPatrol
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }), // INSERT
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'), createTask);
    expect(r.triggered).toBe(true);
    expect(r.task_id).toBe('new-task-id');
    const params = createTask.mock.calls[0][0];
    expect(params.task_type).toBe('ci_patrol');
    expect(params.trigger_source).toBe('brain_auto');
    expect(params.location ?? 'us').toBe('us');
    expect(params.title).toContain('[ci-patrol]');
    const payload = params.payload;
    expect(payload.prd_summary.length).toBeGreaterThanOrEqual(20);
  });
  it('去重查询失败时 warn 后继续创建（宁重不漏，同 arch 模式）', async () => {
    const createTask = vi.fn(async () => ({ task: { id: 'new-task-id' } }));
    const pool = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }),
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'), createTask);
    expect(r.triggered).toBe(true);
  });
  it('INSERT 失败返回 error 不抛出', async () => {
    const createTask = vi.fn(async () => { throw new Error('insert fail'); });
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('insert fail')),
    };
    const r = await triggerCiPatrol(pool, new Date('2026-07-09T00:01:00Z'), createTask);
    expect(r.triggered).toBe(false);
    expect(r.error).toBe('insert fail');
  });
});
