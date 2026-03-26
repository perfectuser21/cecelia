/**
 * system_registry 路由测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pool
vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import registryRouter from '../routes/registry.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/registry', registryRouter);
  return app;
}

describe('GET /api/brain/registry', () => {
  it('返回条目列表', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: '1', type: 'skill', name: '/dev' }] });
    const res = await request(makeApp()).get('/api/brain/registry');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('支持 type 过滤', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/registry?type=skill');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/brain/registry/exists', () => {
  it('存在时返回 exists: true', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: '1', type: 'skill', name: '/dev' }] });
    const res = await request(makeApp()).get('/api/brain/registry/exists?type=skill&name=/dev');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.item).toBeDefined();
  });

  it('不存在时返回 exists: false', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/registry/exists?type=skill&name=/nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  it('缺少参数时返回 400', async () => {
    const res = await request(makeApp()).get('/api/brain/registry/exists?type=skill');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/brain/registry', () => {
  it('登记新条目', async () => {
    const item = { id: '1', type: 'skill', name: '/new-skill', status: 'active' };
    pool.query.mockResolvedValueOnce({ rows: [item] });
    const res = await request(makeApp())
      .post('/api/brain/registry')
      .send({ type: 'skill', name: '/new-skill', description: '新 skill' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('/new-skill');
  });

  it('缺少必填字段返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/registry')
      .send({ type: 'skill' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/brain/registry/:id', () => {
  it('更新状态', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: '1', status: 'deprecated' }] });
    const res = await request(makeApp())
      .patch('/api/brain/registry/1')
      .send({ status: 'deprecated' });
    expect(res.status).toBe(200);
  });

  it('无更新字段返回 400', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/registry/1')
      .send({});
    expect(res.status).toBe(400);
  });
});
