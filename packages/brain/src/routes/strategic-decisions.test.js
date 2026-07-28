import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [{ id: 1, topic: 't', decision: 'd', status: 'active' }] }) },
}));

import pool from '../db.js';
import strategicDecisionsRouter from './strategic-decisions.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', strategicDecisionsRouter);
  return app;
}

describe('strategic-decisions routes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /', () => {
    it('returns 400 if topic missing', async () => {
      const res = await request(makeApp())
        .post('/')
        .send({ decision: 'some decision' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 if decision missing', async () => {
      const res = await request(makeApp())
        .post('/')
        .send({ topic: 'some topic' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 if status is invalid', async () => {
      const res = await request(makeApp())
        .post('/')
        .send({ topic: 'some topic', decision: 'some decision', status: 'invalid_status' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/status 非法/);
    });

    it('accepts valid status values', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, topic: 'some topic', decision: 'some decision', status: 'active' }] });
      const res = await request(makeApp())
        .post('/')
        .send({ topic: 'some topic', decision: 'some decision', status: 'active' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('accepts executed as valid status', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 2, topic: 'some topic', decision: 'some decision', status: 'executed' }] });
      const res = await request(makeApp())
        .post('/')
        .send({ topic: 'some topic', decision: 'some decision', status: 'executed' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('accepts expired as valid status', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 3, topic: 'some topic', decision: 'some decision', status: 'expired' }] });
      const res = await request(makeApp())
        .post('/')
        .send({ topic: 'some topic', decision: 'some decision', status: 'expired' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /', () => {
    it('filters judgment authority by exact source_ref and returns the binding', async () => {
      const taskId = 'task-result-channel';
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'decision-1',
          category: 'judgment',
          topic: 'bounded',
          decision: 'accepted',
          status: 'active',
          source_ref: taskId,
        }],
      });

      const res = await request(makeApp())
        .get(`/?category=judgment&source_ref=${taskId}&limit=10000`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [expect.objectContaining({
          category: 'judgment',
          source_ref: taskId,
        })],
        total: 1,
      });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toMatch(/source_ref/);
      expect(sql).toMatch(/source_ref = \$\d+/);
      expect(params).toContain(taskId);
    });
  });
});
