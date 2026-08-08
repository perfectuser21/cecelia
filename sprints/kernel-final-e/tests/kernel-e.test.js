import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

// 合同测试（TDD Red）：generator 必须将本文件逐字复制为 playground/tests/kernel-e.test.js
// （import '../server.js' 相对路径以 playground/tests/ 为基准；放在 sprint 目录下直接跑会解析失败——
//   Red 证据采集方式见 contract-draft.md「TDD Red 采集方式」小节）
describe('GET /kernel-e', () => {
  test('GET /kernel-e → 200 + {result: "ok-e"}', async () => {
    const res = await request(app).get('/kernel-e');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'ok-e' });
    expect(res.body.result).toBe('ok-e');
  });

  test('GET /kernel-e 带任意多余 query 参数 → 忽略参数仍 200 + {result: "ok-e"}', async () => {
    const res = await request(app).get('/kernel-e').query({ foo: 'bar', x: '1', value: 'ignored' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'ok-e' });
  });

  test('response keys 完整性 == ["result"]（不允许多余字段）', async () => {
    const res = await request(app).get('/kernel-e');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['result']);
  });

  test('禁用 key 反向：ok/pong/msg/echo/status/message/data/output 均不存在', async () => {
    const res = await request(app).get('/kernel-e');
    expect(res.status).toBe(200);
    const forbidden = ['ok', 'pong', 'msg', 'echo', 'status', 'message', 'data', 'output'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });

  test('POST /kernel-e → 404（不注册非 GET 方法，走 Express 默认 404）', async () => {
    const res = await request(app).post('/kernel-e');
    expect(res.status).toBe(404);
  });
});
