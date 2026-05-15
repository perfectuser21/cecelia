import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

describe('Workstream 1 — GET /echo [BEHAVIOR]', () => {
  test('GET /echo?msg=hello → 200 + {echo: "hello"}', async () => {
    const res = await request(app).get('/echo').query({ msg: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('hello');
  });

  test('GET /echo?msg= → 200 + {echo: ""} (空字符串边界，非 null)', async () => {
    const res = await request(app).get('/echo').query({ msg: '' });
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('');
  });

  test('response keys 完整性严格等于 ["echo"]', async () => {
    const res = await request(app).get('/echo').query({ msg: 'test' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['echo']);
  });

  test('禁用 key 不存在: message / result / response / data / output / text / reply / body / msg', async () => {
    const res = await request(app).get('/echo').query({ msg: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('message');
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('response');
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('output');
    expect(res.body).not.toHaveProperty('text');
    expect(res.body).not.toHaveProperty('reply');
    expect(res.body).not.toHaveProperty('body');
    expect(res.body).not.toHaveProperty('msg');
  });
});
