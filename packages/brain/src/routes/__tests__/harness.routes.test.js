import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import harnessRoutesRouter from '../harness.routes.js';

describe('harness.routes — GET /echo', () => {
  const app = express();
  app.use('/api/brain/harness', harnessRoutesRouter);

  it('msg=hello → 200 + {ok:true, echo:"hello"}', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=hello');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.echo).toBe('hello');
  });

  it('response keys 精确等于 ["echo","ok"]', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=test');
    expect(Object.keys(res.body).sort()).toEqual(['echo', 'ok']);
  });

  it('msg 未传 → 200 + ok=true + echo=null', async () => {
    const res = await request(app).get('/api/brain/harness/echo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.echo === '' || res.body.echo === null).toBe(true);
  });

  it('msg 含中文 URL encode → decode 原样返回', async () => {
    const res = await request(app).get('/api/brain/harness/echo?msg=%E6%B5%8B%E8%AF%95');
    expect(res.status).toBe(200);
    expect(res.body.echo).toBe('测试');
  });
});
