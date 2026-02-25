/**
 * Tests for GET /api/brain/routing/decisions
 *
 * Verifies thalamus routing decision history query API (DOD-9 to DOD-15)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

const mockDecision = (overrides = {}) => ({
  id: 'evt-001',
  route_type: 'quick_route',
  event_type: 'TASK_FAILED',
  confidence: 0.9,
  level: 0,
  actions: [{ type: 'cancel_task', params: { task_id: 'task-001', reason: 'retry_exceeded' } }],
  rationale: '任务失败次数超限，自动隔离',
  latency_ms: 2,
  timestamp: '2026-02-17T12:00:00.000Z',
  ...overrides
});

describe('GET /routing/decisions', () => {
  let pool;
  let app;
  let request;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
    const supertest = await import('supertest');
    const express = (await import('express')).default;
    const routes = await import('../routes.js');
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/api/brain', routes.default);
    request = supertest.default(testApp);
  });

  it('should return routing decisions with default limit', async () => {
    const decisions = [mockDecision()];
    pool.query
      .mockResolvedValueOnce({ rows: decisions })   // data
      .mockResolvedValueOnce({ rows: [{ total: '1' }] }); // count

    const res = await request.get('/api/brain/routing/decisions');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(0);
  });

  it('should respect limit parameter and cap at 200', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    // Limit=500 should be capped at 200
    const res = await request.get('/api/brain/routing/decisions?limit=500');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(200);
  });

  it('should filter by route_type', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [mockDecision({ route_type: 'quick_route' })] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const res = await request.get('/api/brain/routing/decisions?route_type=quick_route');

    expect(res.status).toBe(200);
    expect(res.body.decisions[0].route_type).toBe('quick_route');

    // Verify the SQL was called with route_type filter
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("payload->>'route_type'");
  });

  it('should filter by event_type', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [mockDecision({ event_type: 'TASK_FAILED' })] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const res = await request.get('/api/brain/routing/decisions?event_type=TASK_FAILED');

    expect(res.status).toBe(200);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("payload->>'event_type'");
  });

  it('should filter by since timestamp', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request.get('/api/brain/routing/decisions?since=2026-02-17T00:00:00Z');

    expect(res.status).toBe(200);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('created_at >=');
  });

  it('should return results in descending order', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await request.get('/api/brain/routing/decisions');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('ORDER BY created_at DESC');
  });

  it('should include cancel_task action in decision for retry_exceeded events', async () => {
    const cancelDecision = mockDecision({
      route_type: 'quick_route',
      event_type: 'TASK_FAILED',
      actions: [{ type: 'cancel_task', params: { task_id: 't1', reason: 'retry_exceeded' } }]
    });
    pool.query
      .mockResolvedValueOnce({ rows: [cancelDecision] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const res = await request.get('/api/brain/routing/decisions?event_type=TASK_FAILED');

    expect(res.status).toBe(200);
    expect(res.body.decisions[0].actions[0].type).toBe('cancel_task');
  });
});
