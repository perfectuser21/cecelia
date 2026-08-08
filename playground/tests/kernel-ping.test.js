import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('GET /kernel-ping 合同 Red', () => {
  test('GET /kernel-ping 返回 200', async () => {
    const res = await request(app).get('/kernel-ping');
    expect(res.status).toBe(200);
  });

  test('响应体严格等于 ok', async () => {
    const res = await request(app).get('/kernel-ping');
    expect(res.text).toBe('ok');
  });

  test('连续两次调用稳定返回 ok', async () => {
    const first = await request(app).get('/kernel-ping');
    const second = await request(app).get('/kernel-ping');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.text).toBe('ok');
    expect(second.text).toBe('ok');
  });

  test('POST 保持 404 且既有 /ping 不回退', async () => {
    const post = await request(app).post('/kernel-ping');
    const ping = await request(app).get('/ping');
    expect(post.status).toBe(404);
    expect(ping.status).toBe(200);
    expect(ping.body).toEqual({ pong: true });
  });
});
