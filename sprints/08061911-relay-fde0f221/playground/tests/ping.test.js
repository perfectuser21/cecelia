import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

// CI 解析器候选路径副本（check-test-coverage.cjs 的 resolveContractTestFile 不支持
// playground/ 前缀的仓库根相对路径，唯一候选解析到本路径——见 PR 描述「合同外发现的问题」）。
// 真正的合同测试毕业文件是 playground/tests/ping.test.js（逐字复制，不可修改）。
// 本副本内容 = 合同 5 个 it 逐字 + 1 个 alias it（原 it 名内嵌双引号会被解析器
// /\b(?:it|test)\(['"]([^'"]+)['"]/ 截断，补一个无双引号名的等价断言供子串匹配）。
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

  // alias：等价于上面第 3 个 it（keys 完整性），仅为 CI check-test-coverage 子串匹配存在
  test('keys 完整性', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['pong']);
  });
});
