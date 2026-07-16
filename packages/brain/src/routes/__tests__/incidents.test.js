/**
 * routes/incidents.js 配套单元测试
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 *
 * 完整覆盖见 tests/regression/incidents-layer/incidents-api.test.js
 * 本文件确保 lint-test-pairing 找到配套 test。
 *
 * 覆盖：
 *   [BEHAVIOR-4] GET /api/brain/incidents 返回 HTTP 200 含 incidents 数组
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock DB pool ──────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../db/pool.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
}));

describe('[BEHAVIOR-4] GET /api/brain/incidents', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'uuid-1',
          probe_id: 'launchd-patrol',
          fingerprint: 'launchd-patrol:com.cecelia.bridge',
          severity: 'p1',
          status: 'open',
          task_id: null,
          recurrence_count: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          evidence: { detail: 'test' },
        },
      ],
    });

    app = express();
    app.use(express.json());

    const { default: incidentsRouter } = await import('../incidents.js');
    app.use('/api/brain', incidentsRouter);
  });

  it('应返回 HTTP 200', async () => {
    const res = await request(app).get('/api/brain/incidents');
    expect(res.status).toBe(200);
  });

  it('response body 应含 incidents 数组', async () => {
    const res = await request(app).get('/api/brain/incidents');
    expect(Array.isArray(res.body.incidents)).toBe(true);
  });

  it('每条记录应含规定字段', async () => {
    const res = await request(app).get('/api/brain/incidents');
    const record = res.body.incidents[0];
    const required = ['id', 'probe_id', 'fingerprint', 'severity', 'status',
      'task_id', 'recurrence_count', 'created_at', 'updated_at', 'evidence'];
    for (const field of required) {
      expect(record).toHaveProperty(field);
    }
  });
});
