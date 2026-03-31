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
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn(),
}));

import pool from '../db.js';
import { listContentTypes, getContentType } from '../content-types/content-type-registry.js';
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

  it('响应包含 error_message 字段（成功时为 null，失败时为字符串）', async () => {
    const rows = [
      { id: 'ok-1', title: '[内容工厂] 字节跳动', status: 'completed', priority: 'P1', payload: {}, created_at: new Date(), started_at: null, completed_at: new Date(), error_message: null },
      { id: 'fail-1', title: '[内容工厂] 美团', status: 'failed', priority: 'P1', payload: {}, created_at: new Date(), started_at: null, completed_at: new Date(), error_message: 'content_type "bad-type" 不存在于注册表' },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(res.body[0], 'error_message')).toBe(true);
    expect(res.body[0].error_message).toBeNull();
    expect(res.body[1].error_message).toContain('不存在于注册表');
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

describe('GET /api/brain/pipelines/:id/stages — rule_scores & llm_reviewed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stages 响应包含 review_passed 字段（true）', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: 'true',
          rule_scores: null,
          llm_reviewed: null,
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    expect(res.body.stages['content-copy-review'].review_passed).toBe(true);
  });

  it('stages 响应包含 rule_scores 数组（当 DB 有值时）', async () => {
    const scores = [{ id: 'tone', score: 8, pass: true }, { id: 'length', score: 5, pass: false }];
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: 'true',
          rule_scores: scores,
          llm_reviewed: 'true',
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    const stage = res.body.stages['content-copy-review'];
    expect(stage.rule_scores).toEqual(scores);
    expect(stage.llm_reviewed).toBe(true);
  });

  it('stages 响应不包含 rule_scores 字段（当 DB 值为 null 时）', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: null,
          rule_scores: null,
          llm_reviewed: null,
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    const stage = res.body.stages['content-copy-review'];
    expect(stage).not.toHaveProperty('rule_scores');
    expect(stage).not.toHaveProperty('llm_reviewed');
    expect(stage).not.toHaveProperty('review_passed');
  });
});

describe('POST /api/brain/pipelines — notebook_id 自动读取 + fail-fast 记录', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未传 notebook_id 时从 content-type 配置自动读取', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: 'nb-auto-123', content_type: 'solo-company-case' });
    const newRow = {
      id: 'nb-auto-id',
      title: '[内容工厂] 测试关键词 (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-auto-123' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '测试关键词', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    // 验证 pool.query 被调用时 payload 包含自动读取的 notebook_id
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    expect(insertCall).toBeDefined();
    const payloadArg = JSON.parse(insertCall[1][6]);
    expect(payloadArg.notebook_id).toBe('nb-auto-123');
  });

  it('请求中传入 notebook_id 时优先使用请求值', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: 'nb-from-yaml', content_type: 'solo-company-case' });
    const newRow = {
      id: 'nb-req-id',
      title: '[内容工厂] 测试关键词 (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-from-request' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-from-request' });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    const payloadArg = JSON.parse(insertCall[1][6]);
    expect(payloadArg.notebook_id).toBe('nb-from-request');
  });

  it('content-type 配置无 notebook_id 时 payload 不包含 notebook_id', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: '', content_type: 'solo-company-case' });
    const newRow = {
      id: 'no-nb-id',
      title: '[内容工厂] 无notebook (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '无notebook', content_type: 'solo-company-case' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '无notebook', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    const payloadArg = JSON.parse(insertCall[1][6]);
    // 没有 notebook_id 时不应包含该字段（executeResearch 会在执行时 FAIL）
    expect(payloadArg).not.toHaveProperty('notebook_id');
  });
});
