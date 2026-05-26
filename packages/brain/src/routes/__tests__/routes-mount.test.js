import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import express from 'express';
import mainRouter from '../../routes.js';

describe('routes.js mounting', () => {
  it('mounts /skills router — GET /api/brain/skills returns 200 not 404', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mainRouter);

    // mock pool for this test
    const pool = (await import('../../db.js')).default;
    pool.query.mockResolvedValue({ rows: [] });

    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/brain/skills');
    // Before fix: 404. After fix: 200
    expect(res.status).toBe(200);
  });
});
