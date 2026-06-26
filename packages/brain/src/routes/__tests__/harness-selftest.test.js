/**
 * routes/__tests__/harness-selftest.test.js — lint-test-pairing 配对 + 行为验证
 *
 * 覆盖 routes/harness-selftest.js：只读自检端点 GET /api/brain/harness-selftest
 * 零 DB、零副作用，无需 mock 数据库。
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import harnessSelftestRouter from '../harness-selftest.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', harnessSelftestRouter);
  return app;
}

describe('routes/harness-selftest.js', () => {
  it('GET /api/brain/harness-selftest 返回 200 + {ok:true, service:"harness"}', async () => {
    const res = await request(makeApp()).get('/api/brain/harness-selftest').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('harness');
  });

  it('顶层 keys 恰好 [ok, service]，不泄漏 version/timestamp/status', async () => {
    const res = await request(makeApp()).get('/api/brain/harness-selftest').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'service']);
    expect(res.body).not.toHaveProperty('version');
    expect(res.body).not.toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('status');
  });

  it('幂等：两次调用响应体逐字节一致', async () => {
    const app = makeApp();
    const a = await request(app).get('/api/brain/harness-selftest').expect(200);
    const b = await request(app).get('/api/brain/harness-selftest').expect(200);
    expect(a.body).toEqual(b.body);
  });
});
