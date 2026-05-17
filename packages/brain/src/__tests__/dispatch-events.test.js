/**
 * dispatch-events.test.js — B6 TDD
 *
 * 覆盖范围：
 * (a) recordDispatchResult 真 INSERT 一行到 dispatch_events 表
 * (b) GET /api/brain/dispatch/recent 返回最近 N 条事件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordDispatchResult } from '../dispatch-stats.js';

// ─────────────────────────────────────────
// (a) recordDispatchResult 真写 dispatch_events
// ─────────────────────────────────────────

describe('recordDispatchResult - dispatch_events INSERT', () => {
  const NOW = 1_700_000_000_000;

  function makePool() {
    return { query: vi.fn() };
  }

  it('success=true 时 INSERT dispatch_events (event_type=dispatched)', async () => {
    const pool = makePool();
    // call 0: readDispatchStats (working_memory SELECT)
    pool.query.mockResolvedValueOnce({ rows: [] });
    // call 1: dispatch_events INSERT
    pool.query.mockResolvedValueOnce({ rows: [] });
    // call 2: writeDispatchStats (working_memory UPSERT)
    pool.query.mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(pool, true, null, NOW);

    const calls = pool.query.mock.calls;
    const insertCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('dispatch_events'));
    expect(insertCall).toBeDefined();
    expect(insertCall[0]).toMatch(/INSERT INTO dispatch_events/);

    // event_type should be 'dispatched'
    const params = insertCall[1];
    const eventType = params.find(p => p === 'dispatched' || p === 'failed_dispatch' || p === 'skipped');
    expect(eventType).toBe('dispatched');
  });

  it('success=false 时 INSERT dispatch_events (event_type=failed_dispatch)', async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    await recordDispatchResult(pool, false, 'draining', NOW);

    const calls = pool.query.mock.calls;
    const insertCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('dispatch_events'));
    expect(insertCall).toBeDefined();

    const params = insertCall[1];
    const eventType = params.find(p => p === 'dispatched' || p === 'failed_dispatch' || p === 'skipped');
    expect(eventType).toBe('failed_dispatch');

    // reason should be included
    expect(params).toContain('draining');
  });

  it('task_id 参数传入时写入 dispatch_events', async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const taskId = '00000000-0000-0000-0000-000000000001';
    await recordDispatchResult(pool, true, null, NOW, taskId);

    const calls = pool.query.mock.calls;
    const insertCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('dispatch_events'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toContain(taskId);
  });

  it('DB 错误时静默（不影响调用方）', async () => {
    const pool = makePool();
    // readDispatchStats fails → entire try/catch swallows
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    await expect(recordDispatchResult(pool, true, null, NOW)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────
// (b) GET /api/brain/dispatch/recent 路由测试
// ─────────────────────────────────────────

describe('GET /dispatch/recent route', () => {
  it('返回最近 dispatch_events 行（默认 limit=20）', async () => {
    const mockRows = [
      { id: 'uuid-1', task_id: null, event_type: 'failed_dispatch', reason: 'draining', created_at: new Date().toISOString() },
      { id: 'uuid-2', task_id: 'task-uuid', event_type: 'dispatched', reason: null, created_at: new Date().toISOString() },
    ];

    // Mock pool
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: mockRows }) };

    // Dynamically import and test the route handler logic
    const { buildRecentDispatchEventsHandler } = await import('../routes/dispatch.js');
    const handler = buildRecentDispatchEventsHandler(mockPool);

    const req = { query: {} };
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([
        expect.objectContaining({ event_type: 'failed_dispatch' }),
        expect.objectContaining({ event_type: 'dispatched' }),
      ]),
      limit: 20,
    }));
  });

  it('支持 ?limit=5 query 参数', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const { buildRecentDispatchEventsHandler } = await import('../routes/dispatch.js');
    const handler = buildRecentDispatchEventsHandler(mockPool);

    const req = { query: { limit: '5' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handler(req, res);

    // Verify the SQL was called with limit=5
    const queryCall = mockPool.query.mock.calls[0];
    expect(queryCall[1]).toContain(5);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });

  it('limit 超过 100 时 clamp 到 100', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const { buildRecentDispatchEventsHandler } = await import('../routes/dispatch.js');
    const handler = buildRecentDispatchEventsHandler(mockPool);

    const req = { query: { limit: '999' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handler(req, res);

    const queryCall = mockPool.query.mock.calls[0];
    expect(queryCall[1]).toContain(100);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });
});
