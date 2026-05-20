/**
 * routes/__tests__/clips.test.js
 * Unit tests for clips route — POST/GET/retry/callback/webhook
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../clips-extractor.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../../db.js';
import { extractClip } from '../../clips-extractor.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('clips router — exports', () => {
  it('exports an express router function', async () => {
    const { default: router } = await import('../clips.js');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});

describe('POST /api/brain/clips — create clip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 with id and status=pending on success', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', status: 'pending', created_at: '2026-05-20T00:00:00Z' }],
    });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/xxx' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('uuid-1');
    expect(res.body.status).toBe('pending');
    expect(extractClip).toHaveBeenCalledOnce();
    expect(extractClip).toHaveBeenCalledWith('uuid-1', 'https://v.douyin.com/xxx');
  });

  it('returns 400 if url is missing', async () => {
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).post('/api/brain/clips').send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 if url already exists (unique constraint)', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    pool.query
      .mockRejectedValueOnce(err)  // first call: INSERT throws 23505
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid', status: 'done' }] }); // second call: SELECT existing
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/duplicate' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_exists');
  });
});

describe('GET /api/brain/clips — list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with data array', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', url: 'https://v.douyin.com/xxx', platform: 'douyin', status: 'done' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).get('/api/brain/clips');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

describe('POST /api/brain/clips/:id/callback — content-service result', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates clip to done and returns 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', status: 'done' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .send({ success: true, title: 'Test Video', transcript: 'hello world', platform: 'douyin' });

    expect(res.status).toBe(200);
  });
});
