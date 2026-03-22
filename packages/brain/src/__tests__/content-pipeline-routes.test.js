/**
 * content-pipeline 路由单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn(),
}));

import pool from '../db.js';
import { listContentTypes } from '../content-types/content-type-registry.js';
import contentPipelineRouter from '../routes/content-pipeline.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/pipelines', contentPipelineRouter);
  app.use('/api/brain', contentPipelineRouter);
  return app;
}

describe('GET /api/brain/content-types', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回内容类型数组', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case', 'short-video']);
    const res = await request(makeApp()).get('/api/brain/content-types');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['solo-company-case', 'short-video']);
  });

  it('registry 异常时返回 500', async () => {
    listContentTypes.mockRejectedValue(new Error('目录读取失败'));
    const res = await request(makeApp()).get('/api/brain/content-types');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('目录读取失败');
  });
});

describe('GET /api/brain/pipelines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 content-pipeline 任务列表', async () => {
    const rows = [
      { id: 'abc-1', title: '[内容工厂] 字节跳动', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toContain('字节跳动');
  });

  it('DB 异常时返回 500', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/brain/pipelines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功创建 content-pipeline 任务', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const newRow = {
      id: 'new-id', title: '[内容工厂] 字节跳动 (solo-company-case)',
      status: 'queued', priority: 'P1', payload: {}, created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
  });

  it('缺少 keyword 时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ content_type: 'solo-company-case' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('keyword');
  });

  it('缺少 content_type 时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('content_type');
  });

  it('content_type 不存在时返回 400', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'unknown-type' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unknown-type');
  });

  it('priority 非法时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'solo-company-case', priority: 'P9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('priority');
  });
});

describe('POST /api/brain/pipelines/batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('批量创建 5 条 pipeline 返回 201 + 5 条记录', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const mockRow = { id: 'mock-id', title: '[内容工厂] test', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() };
    pool.query.mockResolvedValue({ rows: [mockRow] });

    const items = [
      { keyword: '字节跳动', content_type: 'solo-company-case' },
      { keyword: '美团', content_type: 'solo-company-case' },
      { keyword: '拼多多', content_type: 'solo-company-case' },
      { keyword: '滴滴', content_type: 'solo-company-case' },
      { keyword: '快手', content_type: 'solo-company-case' },
    ];
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(5);
    expect(res.body.pipelines).toHaveLength(5);
  });

  it('items 少于 2 返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items: [{ keyword: '字节跳动', content_type: 'solo-company-case' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('至少 2 项');
  });

  it('items 超过 20 返回 400', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ keyword: `关键词${i}`, content_type: 'solo-company-case' }));
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('不超过 20 项');
  });

  it('非法 content_type 返回 400', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items: [
        { keyword: '字节跳动', content_type: 'solo-company-case' },
        { keyword: '美团', content_type: 'unknown-type' },
      ]});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unknown-type');
  });

  it('使用 default_content_type 批量创建', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const mockRow = { id: 'mock-id', title: '[内容工厂] test', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() };
    pool.query.mockResolvedValue({ rows: [mockRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({
        items: [{ keyword: '字节跳动' }, { keyword: '美团' }],
        default_content_type: 'solo-company-case',
      });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });
});
