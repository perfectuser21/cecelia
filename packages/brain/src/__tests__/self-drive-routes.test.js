/**
 * Self-Drive route tests — GET /api/brain/self-drive/latest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js
vi.mock('../db.js', () => {
  const mockQuery = vi.fn();
  return {
    default: { query: mockQuery },
    __mockQuery: mockQuery,
  };
});

describe('Self-Drive Routes', () => {
  let app;
  let mockQuery;

  beforeEach(async () => {
    vi.resetModules();

    // Get the mock query function
    const dbModule = await import('../db.js');
    mockQuery = dbModule.__mockQuery || dbModule.default.query;
    mockQuery.mockReset();

    app = express();
    app.use(express.json());

    const routeModule = await import('../routes/self-drive.js');
    app.use('/api/brain/self-drive', routeModule.default);
  });

  it('GET /latest returns null when no events exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/self-drive/latest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBeNull();
  });

  it('GET /latest returns the most recent self_drive event', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'evt-1',
          event_type: 'self_drive',
          source: 'self-drive',
          created_at: '2026-03-21T00:00:00Z',
          payload: {
            subtype: 'cycle_complete',
            reasoning: '系统运行正常',
            tasks_created: 2,
            adjustments_executed: 1,
            tasks: [{ title: 't1' }],
            adjustments: [{ type: 'adjust_priority' }],
            probe_summary: { status: 'ok' },
            scan_summary: { islands: 12 },
          },
        },
      ],
    });

    const res = await request(app).get('/api/brain/self-drive/latest');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event.id).toBe('evt-1');
    expect(res.body.event.reasoning).toBe('系统运行正常');
    expect(res.body.event.tasks_created).toBe(2);
    expect(res.body.event.adjustments_executed).toBe(1);
    expect(res.body.event.tasks).toHaveLength(1);
    expect(res.body.event.adjustments).toHaveLength(1);
    expect(res.body.event.probe_summary).toEqual({ status: 'ok' });
    expect(res.body.event.scan_summary).toEqual({ islands: 12 });
  });

  it('GET /latest handles string payload (JSON parse)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'evt-2',
          event_type: 'self_drive',
          source: 'self-drive',
          created_at: '2026-03-21T01:00:00Z',
          payload: JSON.stringify({
            subtype: 'cycle_complete',
            reasoning: '测试字符串 payload',
            tasks_created: 0,
          }),
        },
      ],
    });

    const res = await request(app).get('/api/brain/self-drive/latest');
    expect(res.status).toBe(200);
    expect(res.body.event.reasoning).toBe('测试字符串 payload');
    expect(res.body.event.tasks_created).toBe(0);
  });

  it('GET /latest returns 500 on DB error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/api/brain/self-drive/latest');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('SelfDrive');
  });
});
