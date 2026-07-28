import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db.js';
import opsRouter from './ops.js';

function makeApp() {
  const app = express();
  app.use('/', opsRouter);
  return app;
}

describe('GET /learnings task authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters by exact task_id and returns task_id on every observed row', async () => {
    const taskId = '33333333-3333-4333-8333-333333333333';
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'learning-1',
          title: 'bounded',
          content: 'result channel learning',
          category: 'dev',
          digested: false,
          archived: false,
          created_at: '2026-07-28T00:00:00.000Z',
          task_id: taskId,
        }],
      });

    const res = await request(makeApp())
      .get(`/learnings?task_id=${taskId}&limit=100&offset=0`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      learnings: [expect.objectContaining({ task_id: taskId })],
      total: 1,
      limit: 100,
      offset: 0,
    });
    for (const [sql, params] of pool.query.mock.calls) {
      expect(sql).toMatch(/task_id = \$\d+/);
      expect(params).toContain(taskId);
    }
  });
});
