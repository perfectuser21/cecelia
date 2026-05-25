import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock pool
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

import pool from '../../db.js';
import express from 'express';
import skillsRouter from '../skills.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/skills', skillsRouter);
  return app;
}

describe('GET /api/brain/skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with array of skills', async () => {
    pool.query.mockResolvedValue({ rows: [
      { id: 'abc', name: '/dev', status: 'active', notion_id: null }
    ]});
    const app = makeApp();
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/brain/skills');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('/dev');
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const app = makeApp();
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/brain/skills?status=deprecated');
    expect(res.status).toBe(200);
    const call = pool.query.mock.calls[0];
    expect(call[0]).toContain('status');
  });
});

describe('POST /api/brain/skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a skill and returns 201', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'xyz', name: '/new-skill', status: 'active' }] });
    const app = makeApp();
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/brain/skills')
      .send({ name: '/new-skill', description: 'test skill' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('/new-skill');
  });

  it('returns 400 when name missing', async () => {
    const app = makeApp();
    const { default: request } = await import('supertest');
    const res = await request(app).post('/api/brain/skills').send({});
    expect(res.status).toBe(400);
  });
});
