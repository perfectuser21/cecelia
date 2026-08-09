import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));

import projectionsRouter from '../projections.js';

describe('projections routes', () => {
  it('returns the canonical Workbench summary from Brain tables', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ waiting: 2, in_progress: 1, blocked: 0, done: 3, dropped: 0 }] })
      .mockResolvedValueOnce({ rows: [{ captured: 4, clarified: 1 }] })
      .mockResolvedValueOnce({ rows: [{ pending: 2, dead: 0 }] });
    const app = express();
    app.use('/api/brain', projectionsRouter);

    const response = await request(app).get('/api/brain/workbench/summary');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tasks: { waiting: 2, in_progress: 1, blocked: 0, done: 3, dropped: 0 },
      captures: { captured: 4, clarified: 1 },
      projection: { pending: 2, dead: 0 },
    });
  });
});
