import { describe, expect, test } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('GET /kernel-ping [BEHAVIOR]', () => {
  test('GET /kernel-ping 返回 200 且响应为 {ok:true}', async () => {
    const response = await request(app).get('/kernel-ping');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('GET /kernel-ping 响应 keys 完整性严格等于 ["ok"]', async () => {
    const response = await request(app).get('/kernel-ping');

    expect(Object.keys(response.body)).toEqual(['ok']);
  });

  test('GET /kernel-ping 响应不含 status、pong、result 禁用字段', async () => {
    const response = await request(app).get('/kernel-ping');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body).not.toHaveProperty('status');
    expect(response.body).not.toHaveProperty('pong');
    expect(response.body).not.toHaveProperty('result');
  });

  test('连续两次 GET /kernel-ping 每次均独立返回 {ok:true}', async () => {
    const first = await request(app).get('/kernel-ping');
    const second = await request(app).get('/kernel-ping');

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });
  });

  test('POST /kernel-ping 不进入 GET 成功路径并返回 404', async () => {
    const response = await request(app).post('/kernel-ping');

    expect(response.status).toBe(404);
  });
});
