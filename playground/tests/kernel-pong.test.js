import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

// 合同测试（TDD Red）：generator 必须将本文件复制为 playground/tests/kernel-pong.test.js
// （import '../server.js' 相对 playground/tests/ 解析；放在 sprint 目录直接跑会解析失败——
//   Red 证据采集：cd playground && npx vitest run tests/kernel-pong.test.js，实现路由前 5 条全 FAIL）
describe('GET /kernel-pong', () => {
  test('GET /kernel-pong → 200 + {pong: true}', async () => {
    const res = await request(app).get('/kernel-pong');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
    expect(res.body.pong).toBe(true);
  });

  test('GET /kernel-pong 带任意 query 参数 → 忽略参数仍 200 + {pong: true}', async () => {
    const res = await request(app).get('/kernel-pong').query({ x: '1', foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  test('response keys 完整性 == ["pong"]（不允许多余字段）', async () => {
    const res = await request(app).get('/kernel-pong');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['pong']);
  });

  test('禁用 key 反向：kernel/ok/result/message/status 均不存在', async () => {
    const res = await request(app).get('/kernel-pong');
    expect(res.status).toBe(200);
    const forbidden = ['kernel', 'ok', 'result', 'message', 'status'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });

  test('POST /kernel-pong → 404（不注册非 GET 方法，走 Express 默认 404）', async () => {
    const res = await request(app).post('/kernel-pong');
    expect(res.status).toBe(404);
  });
});
