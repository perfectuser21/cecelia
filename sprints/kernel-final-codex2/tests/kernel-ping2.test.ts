import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

describe('GET /kernel-ping2 [BEHAVIOR]', () => {
  test('返回严格 200 且 result 为 ok2', async () => {
    const res = await request(app).get('/kernel-ping2');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ok2');
  });

  test('仅含 result 字段', async () => {
    const res = await request(app).get('/kernel-ping2');
    expect(Object.keys(res.body)).toEqual(['result']);
  });

  test('POST 不成功', async () => {
    const res = await request(app).post('/kernel-ping2');
    expect(res.status).not.toBe(200);
  });

  test('既有 health 不回退', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
