/**
 * POST /api/brain/can-run 单测
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import canRunRoutes from '../routes/can-run.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', canRunRoutes);
  return app;
}

describe('POST /api/brain/can-run', () => {
  const app = createApp();

  it('正常请求 notebooklm → approved=true', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'notebooklm' });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
    expect(res.body.reason).toContain('v1');
  });

  it('正常请求 llm with size → approved=true', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'llm', size: 2 });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
  });

  it('正常请求 image-gen → approved=true', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'image-gen' });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
  });

  it('未知 resource_type → 400', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'unknown-thing' });
    expect(res.status).toBe(400);
    expect(res.body.approved).toBe(false);
    expect(res.body.reason).toContain('未知');
  });

  it('缺少 resource_type → 400', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.approved).toBe(false);
  });

  it('空 body → 400', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send();
    expect(res.status).toBe(400);
    expect(res.body.approved).toBe(false);
  });

  it('size 为 0 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'llm', size: 0 });
    expect(res.status).toBe(400);
    expect(res.body.approved).toBe(false);
    expect(res.body.reason).toContain('size');
  });

  it('size 为负数 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/can-run')
      .send({ resource_type: 'llm', size: -1 });
    expect(res.status).toBe(400);
    expect(res.body.approved).toBe(false);
  });
});
