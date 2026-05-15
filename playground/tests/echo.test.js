import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('GET /echo', () => {
  test('GET /echo?msg=hello → 200 + {echo: "hello"}', async () => {
    const res = await request(app).get('/echo').query({ msg: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ echo: 'hello' });
  });

  test('GET /echo?msg= → 200 + {echo: ""}（空字符串非 null）', async () => {
    const res = await request(app).get('/echo').query({ msg: '' });
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('');
    expect(res.body.echo).not.toBeNull();
  });

  test('response keys 完整性 == ["echo"]（不允许多余字段）', async () => {
    const res = await request(app).get('/echo').query({ msg: 'test' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['echo']);
  });

  test('禁用 key 反向：message/result/response/data/output/text/reply/body/msg 均不存在', async () => {
    const res = await request(app).get('/echo').query({ msg: 'hello' });
    expect(res.status).toBe(200);
    const forbidden = ['message', 'result', 'response', 'data', 'output', 'text', 'reply', 'body', 'msg'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });
});
