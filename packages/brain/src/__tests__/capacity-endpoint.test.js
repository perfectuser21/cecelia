/**
 * GET /api/brain/capacity endpoint tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../executor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getBudgetCap: vi.fn(() => ({ budget: null, physical: 5, effective: 5 })),
    INTERACTIVE_RESERVE: 2,
  };
});

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import brainRoutes from '../routes.js';

const app = express();
app.use(express.json());
app.use('/api/brain', brainRoutes);

describe('GET /api/brain/capacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns max_seats field', async () => {
    const { getBudgetCap } = await import('../executor.js');
    getBudgetCap.mockReturnValue({ budget: null, physical: 5, effective: 5 });

    const res = await request(app).get('/api/brain/capacity');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('max_seats');
  });

  it('returns correct capacity values', async () => {
    const { getBudgetCap } = await import('../executor.js');
    getBudgetCap.mockReturnValue({ budget: 3, physical: 5, effective: 3 });

    const res = await request(app).get('/api/brain/capacity');
    expect(res.status).toBe(200);
    expect(res.body.max_seats).toBe(3);
    expect(res.body.physical_capacity).toBe(5);
    expect(res.body.budget_cap).toBe(3);
    expect(res.body.interactive_reserve).toBe(2);
  });

  it('returns 500 on error', async () => {
    const { getBudgetCap } = await import('../executor.js');
    getBudgetCap.mockImplementation(() => { throw new Error('executor unavailable'); });

    const res = await request(app).get('/api/brain/capacity');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
