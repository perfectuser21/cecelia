/**
 * TDD Red — Brain 只读自检端点 GET /api/brain/harness-selftest
 *
 * 测试在 Generator 实现 packages/brain/src/routes/harness-selftest.js 之前必然 FAIL：
 *   - 动态 import 找不到模块 → 红
 *   - 或路由未注册 → 404 → 断言失败 → 红
 *
 * 该端点为纯只读、零 DB、零副作用，无需 mock 数据库。
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

async function makeApp() {
  const app = express();
  app.use(express.json());
  // 期望 Generator 新增此路由文件（默认 Router）；不存在时 import 抛错 → 红
  const selftestRouter = await import('../routes/harness-selftest.js').then(m => m.default);
  // 与 server.js 顶层 /api/brain 前缀挂载方式一致
  app.use('/api/brain', selftestRouter);
  return app;
}

describe('GET /api/brain/harness-selftest [BEHAVIOR]', () => {
  it('返回 HTTP 200', async () => {
    const app = await makeApp();
    await request(app).get('/api/brain/harness-selftest').expect(200);
  });

  it('响应体 ok === true', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('响应体 service === "harness"', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(res.body.service).toBe('harness');
  });

  it('顶层 keys 恰好等于 [ok, service]（不泄漏动态运行时状态）', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'service']);
  });

  it('不含 version / timestamp / status 等动态字段', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(res.body).not.toHaveProperty('version');
    expect(res.body).not.toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('status');
  });

  it('幂等：两次调用响应体一致', async () => {
    const app = await makeApp();
    const a = await request(app).get('/api/brain/harness-selftest').expect(200);
    const b = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(a.body).toEqual(b.body);
  });

  it('Content-Type 为 application/json', async () => {
    const app = await makeApp();
    await request(app)
      .get('/api/brain/harness-selftest')
      .expect(200)
      .expect('Content-Type', /application\/json/);
  });
});
