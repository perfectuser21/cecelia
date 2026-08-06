import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

// 合同测试（TDD Red）：generator 必须将本文件逐字复制为 playground/tests/ping.test.js
// （import '../server.js' 相对路径以 playground/tests/ 为基准，放在 sprint 目录下直接跑会解析失败——
//   Red 证据采集方式见 contract-draft.md「TDD Red 采集方式」小节）
describe('GET /ping', () => {
  test('GET /ping → 200 + {pong: true}', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
    expect(res.body.pong).toBe(true);
  });

  test('GET /ping 带任意 query 参数 → 忽略参数仍 200 + {pong: true}', async () => {
    const res = await request(app).get('/ping').query({ foo: 'bar', x: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  test('response keys 完整性 == ["pong"]（不允许多余字段）', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['pong']);
  });

  test('禁用 key 反向：ping/alive/ok/status/result 均不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    const forbidden = ['ping', 'alive', 'ok', 'status', 'result'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });

  test('POST /ping → 404（不注册非 GET 方法，走 Express 默认 404）', async () => {
    const res = await request(app).post('/ping');
    expect(res.status).toBe(404);
  });
});
