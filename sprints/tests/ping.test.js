import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../playground/server.js';

// TDD Red：/ping 路由尚未实现，下列断言应全部 FAIL（404 / pong undefined）
describe('GET /ping (smoke fire)', () => {
  test('GET /ping → 200 + {pong:true}', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
    expect(typeof res.body.pong).toBe('boolean');
  });

  test('GET /ping → 顶层 keys 完全等于 ["pong"]（schema 完整性）', async () => {
    const res = await request(app).get('/ping');
    expect(Object.keys(res.body).sort()).toEqual(['pong']);
  });

  test('GET /ping → 不含禁用字段 ok/status/alive（反向验证）', async () => {
    const res = await request(app).get('/ping');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'ok')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'status')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'alive')).toBe(false);
  });

  test('GET /ping?x=1&foo=bar → 仍 200 + {pong:true}（query 参数被忽略）', async () => {
    const res = await request(app).get('/ping').query({ x: '1', foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  test('POST /ping → 404（仅 GET 注册，未误注册其他方法）', async () => {
    const res = await request(app).post('/ping');
    expect(res.status).toBe(404);
  });
});
