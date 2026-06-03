import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../../db.js';
import router from '../initiative-runs.js';

const app = express();
app.use('/api/brain/initiative-runs', router);

describe('GET /api/brain/initiative-runs/phase-summary (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with phase/count array', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { phase: 'A_contract', count: '3' },
        { phase: 'done', count: '1' },
      ],
    });
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toEqual({ phase: 'A_contract', count: 3 });
    expect(res.body[1]).toEqual({ phase: 'done', count: 1 });
  });

  it('returns empty array when no rows', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('converts count string to number', async () => {
    pool.query.mockResolvedValue({ rows: [{ phase: 'B_task_loop', count: '7' }] });
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(typeof res.body[0].count).toBe('number');
    expect(res.body[0].count).toBe(7);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/api/brain/initiative-runs/phase-summary');
    expect(res.status).toBe(500);
  });
});
