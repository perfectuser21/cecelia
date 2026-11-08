import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const boundary = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: boundary.query } }));
import router from '../clips.js';
const app = express().use(express.json()).use('/clips', router);
beforeEach(() => { boundary.query.mockReset().mockResolvedValue({ rows: [] }); });
afterEach(() => { vi.unstubAllGlobals(); });
it.each(['submit', 'retry', 'timeout'])('%s persists the actual extractor rejection', async entry => {
  boundary.query.mockResolvedValueOnce({ rows: [{ id: 'owned', status: 'pending', retry_count: 2,
    url: 'https://douyin.com/owned', created_at: 'owned' }] });
  const remote = vi.fn();
  if (entry === 'timeout') remote.mockRejectedValue(new DOMException('owned timeout', 'TimeoutError'));
  else remote.mockResolvedValue({ ok: false, status: 500, text: async () => 'owned unavailable' });
  vi.stubGlobal('fetch', remote);
  const res = await request(app).post(entry === 'retry' ? '/clips/owned/retry' : '/clips')
    .send({ url: 'https://douyin.com/owned' });
  expect(res.status).toBe(entry === 'retry' ? 200 : 201);
  await vi.waitFor(() => expect(boundary.query).toHaveBeenCalledTimes(2));
  expect(remote).toHaveBeenCalledTimes(1);
  expect(JSON.parse(remote.mock.calls[0][1].body).url).toBe('https://douyin.com/owned');
  const [sql, values] = boundary.query.mock.calls[1];
  expect(sql).toMatch(/UPDATE clips/);
  expect(sql).toMatch(/status\s*=\s*'failed'/);
  expect(values).toContain(entry === 'timeout' ? 'owned timeout' : 'content-service error 500: owned unavailable');
  expect(values).toContain(2);
});
it('accepted extraction remains pending; nonretryable requests never dispatch', async () => {
  boundary.query.mockResolvedValueOnce({ rows: [{ id: 'owned', status: 'pending', retry_count: 0 }] });
  const remote = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', remote);
  expect((await request(app).post('/clips').send({ url: 'https://douyin.com/owned' })).status).toBe(201);
  expect(boundary.query).toHaveBeenCalledTimes(1);
  expect((await request(app).post('/clips/owned/retry').send({})).status).toBe(409);
  expect(remote).toHaveBeenCalledTimes(1);
});
