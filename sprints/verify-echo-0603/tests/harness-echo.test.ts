import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 此测试在 harness.routes.js 不存在时 FAIL（TDD Red）
// Generator 实现后应全部 PASS
let harnessRoutesModule: any;

describe('GET /api/brain/harness/echo [BEHAVIOR]', () => {
  let app: any;

  beforeEach(async () => {
    harnessRoutesModule = await import('../../../packages/brain/src/routes/harness.routes.js');
    app = express();
    app.use('/api/brain/harness', harnessRoutesModule.default);
  });

  it('msg=hello 时返回 {ok:true, echo:"hello"}', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=hello');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.echo).toBe('hello');
  });

  it('response schema keys 精确等于 ["echo","ok"]，无多余字段', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=hello');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['echo', 'ok']);
  });

  it('msg 未传时返回 200，ok=true，echo 为空字符串或 null', async () => {
    const res = await request(app).get('/api/brain/harness/echo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.echo === '' || res.body.echo === null).toBe(true);
  });

  it('msg 含中文时 URL decode 后原样返回', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=%E6%B5%8B%E8%AF%95');
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('测试');
  });
});
